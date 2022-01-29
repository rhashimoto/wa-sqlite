import * as VFS from '../VFS.js';
import { WebLocksMixin } from './WebLocksMixin.js';
import { IDBActivity } from './IDBActivity.js';

// Default block size for new databases.
const BLOCK_SIZE = 8192;

// Max number of blocks to store in the 1st-level write cache.
const WRITE_CACHE_SIZE = 2048;

// This implementation of a SQLite database file buffers writes (in
// memory spilling to IndexedDB), and writes the SQLite transaction
// in a single IndexedDB transaction at commit. File data is stored
// to IndexedDB in fixed-size blocks, plus a special object for
// file metadata.
export class IDBDatabaseFile extends WebLocksMixin() {
  // Two-level write cache, RAM and IndexedDB. Only writes are cached;
  // read caching is left to SQLite.
  writeCache = new Map();
  spillCache = new Set();

  block0 = null;
  truncateRange = null;

  constructor(/** @type {IDBDatabase} */ db) {
    super();
    this.db = db;
    this.idb = new IDBActivity(db, ['database', 'spill'], 'readonly');
  }

  get name() { return this.block0.name; }
  get type() { return this.flags & VFS.FILE_TYPE_MASK; }
  get blockSize() { return this.block0.data.byteLength; }

  async xOpen(name, fileId, flags, pOutFlags) {
    this.flags = flags;

    // Fetch metadata.
    this.block0 = await this.idb.run(({ database }) => database.get([name, 0]));
    if (!this.block0) {
      // File doesn't exist, create if requested.
      if (flags & VFS.SQLITE_OPEN_CREATE) {
        this.block0 = {
          name,
          index: 0,
          data: new ArrayBuffer(BLOCK_SIZE),
          fileSize: 0
        };
        this.idb.updateTxMode('readwrite');
        this.idb.run(({ database }) => database.put(this.block0));
        await this.idb.sync();
        this.idb.updateTxMode('readonly');
      } else {
        return VFS.SQLITE_CANTOPEN;
      }
    }
    pOutFlags.set(0);
    return VFS.SQLITE_OK;
  }

  xClose() {
    return VFS.SQLITE_OK;
  }

  async xRead(fileId, pData, iOffset) {
    const blockIndex = (iOffset / this.blockSize) | 0;
    if (iOffset + pData.size > (blockIndex + 1) * this.blockSize) {
      console.assert(false, 'unexpected read across block boundary');
      return VFS.SQLITE_IOERR;
    }

    // Check for read past the end of data.
    if (iOffset >= this.block0.fileSize) {
      pData.value.fill(0, pData.size);
      return VFS.SQLITE_IOERR_SHORT_READ;
    }

    // Fetch the file data.
    const block = this.#getBlock(blockIndex);
    const blockData = (block.then ? await block : block).data;
    const blockOffset = iOffset % this.blockSize;
    pData.value.set(new Int8Array(blockData, blockOffset, pData.size));
    return VFS.SQLITE_OK;
  }

  xWrite(fileId, pData, iOffset) {
    const blockIndex = (iOffset / this.blockSize) | 0;
    if (iOffset !== blockIndex * this.blockSize ||
        pData.size !== this.blockSize) {
      // Not a single complete block write.
      console.assert(false, 'unexpected write parameters');
      return VFS.SQLITE_IOERR;
    }

    // Extend the file when writing past the end.
    this.block0.fileSize = Math.max(this.block0.fileSize, iOffset + pData.size);

    // Get the block from the cache, creating if not present.
    const block = blockIndex === 0 ? this.block0 : this.writeCache.get(blockIndex) ?? {
      name: this.name,
      index: blockIndex,
      data: new ArrayBuffer(this.blockSize)
    };
    new Int8Array(block.data).set(pData.value);
    this.#putBlock(block);
    return VFS.SQLITE_OK;
  }

  xTruncate(fileId, iSize) {
    this.block0.fileSize = iSize;
    this.truncateRange = IDBKeyRange.bound(
      [this.name, (this.block0.fileSize / this.blockSize) | 0],
      [this.name, Number.MAX_VALUE]);
    return VFS.SQLITE_OK;
  }

  xSync(fileId, flags) {
    return VFS.SQLITE_OK;
  }

  xFileSize(fileId, pSize64) {
    pSize64.set(this.block0.fileSize);
    return VFS.SQLITE_OK
  }

  async xLock(fileId, flags) {
    const result = (super.xLock && await super.xLock(fileId, flags)) ?? VFS.SQLITE_OK;
    switch (this.lockState) {
      case VFS.SQLITE_LOCK_SHARED: // read lock
        this.block0 = await this.idb.run(({ database }) => database.get([this.name, 0]));
        break;
      case VFS.SQLITE_LOCK_EXCLUSIVE: // write lock
        this.idb.updateTxMode('readwrite');
        break;
    }
    return result;
  }

  async xUnlock(fileId, flags) {
    if (this.lockState === VFS.SQLITE_LOCK_EXCLUSIVE) {
      this.commit();
      await this.idb.sync();
      this.idb.updateTxMode('readonly');
    }

    return (super.xUnlock && super.xUnlock(fileId, flags)) ?? VFS.SQLITE_OK;
  }

  xSectorSize(fileId) {
    return this.blockSize;
  }

  xDeviceCharacteristics(fileId) {
    return VFS.SQLITE_IOCAP_SAFE_APPEND |
           VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN;
  }

  commit() {
    // All file changes, except creation, take place here.
    this.idb.run(async ({ database, spill }) => {
      if (this.writeCache.size) {
        // Flush metadata.
        database.put(this.block0);

        // Flush the 1st level cache stored in memory.
        for (const block of this.writeCache.values()) {
          if (block.index * this.blockSize < this.block0.fileSize) {
            database.put(block);
          }
        }
        this.writeCache.clear();
      }

      // Flush the 2nd level cache stored in IndexedDB.
      if (this.spillCache.size) {
        let query = IDBKeyRange.lowerBound([this.name], true);
        let blocks = [];
        do {
          blocks = await spill.getAll(query, WRITE_CACHE_SIZE);
          for (const block of blocks) {
            if (this.spillCache.has(block.index) &&
                block.index * this.blockSize < this.block0.fileSize) {
              database.put(block);
            }
          }
          query = IDBKeyRange.lowerBound([this.name, blocks.pop()?.index ?? 0], true);
        } while (blocks.length);
        this.spillCache.clear();
        spill.clear();
      }

      // Remove blocks truncated from the file.
      if (this.truncateRange) {
        database.delete(this.truncateRange);
        this.truncateRange = null;
      }
    });
  }

  #getBlock(index) {
    if (index === 0) return this.block0;

    const block = this.writeCache.get(index);
    if (block) return block;

    if (this.spillCache.has(index)) {
      return this.idb.run(({ spill }) => spill.get([this.name, index]));
    }
    return this.idb.run(({ database }) => database.get([this.name, index]));
  }

  #putBlock(block) {
    if (block.index === 0) return;

    // Replace or insert at the end of the write cache.
    this.writeCache.delete(block.index);
    this.writeCache.set(block.index, block);

    // Remove any spill cache entry.
    this.spillCache.delete(block.index);

    // Spill any write cache overflow.
    for (const candidate of this.writeCache.values()) {
      if (this.writeCache.size <= WRITE_CACHE_SIZE) break;

      this.idb.run(({ spill }) => spill.put(candidate));
      this.spillCache.add(candidate.index);
      this.writeCache.delete(candidate.index);
    }
  }
}