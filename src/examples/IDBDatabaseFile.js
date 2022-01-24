import * as VFS from '../VFS.js';
import { WebLocksMixin } from './WebLocksMixin.js';
import { IDBActivity } from './IDBActivity.js';

// Default block size for new databases.
const BLOCK_SIZE = 8192;

// Max number of blocks to store in the 1st-level write cache.
const WRITE_CACHE_SIZE = 2048;

export class IDBDatabaseFile extends WebLocksMixin() {
  // Two-level write cache, RAM and IndexedDB. Only writes are cached;
  // read caching is left to SQLite.
  writeCache = new Map();
  spillCache = new Set();

  // Out-of-band rollback state. Discard writes when signalled directly
  // by the journal file without SQLite's knowledge.
  rollbackOOB = false;
  rollbackSize = 0;

  /** @type {?IDBTransaction} */ #tx = null;

  constructor(/** @type {IDBDatabase} */ db) {
    super();
    this.db = db;
    this.idb = new IDBActivity(db, ['database', 'spill'], 'readwrite');
  }

  get name() { return this.metadata.name; }
  get type() { return this.flags & VFS.FILE_TYPE_MASK; }

  async xOpen(name, fileId, flags, pOutFlags) {
    this.flags = flags;

    // Fetch metadata.
    this.metadata = await this.idb.run(({ database }) => database.get([name, 'metadata']));
    if (!this.metadata) {
      // File doesn't exist, create if requested.
      if (flags & VFS.SQLITE_OPEN_CREATE) {
        this.metadata = {
          name,
          index: 'metadata',
          fileSize: 0,
          blockSize: BLOCK_SIZE
        };
        this.idb.run(({ database }) => database.put(this.metadata));
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
    const blockIndex = (iOffset / this.metadata.blockSize) | 0;
    if (iOffset + pData.size > (blockIndex + 1) * this.metadata.blockSize) {
      console.assert(false, 'unexpected read across block boundary');
      return VFS.SQLITE_IOERR;
    }

    // Check for read past the end of data.
    if (iOffset >= this.metadata.fileSize) {
      pData.value.fill(0, pData.size);
      return VFS.SQLITE_IOERR_SHORT_READ;
    }

    // Fetch the file data.
    let block = this.getBlock(blockIndex);
    block = block.name ? block : await block;

    const blockOffset = iOffset % this.metadata.blockSize;
    pData.value.set(new Int8Array(block.data, blockOffset, pData.size));
    return VFS.SQLITE_OK;
  }

  xWrite(fileId, pData, iOffset) {
    const blockIndex = (iOffset / this.metadata.blockSize) | 0;
    if (iOffset !== blockIndex * this.metadata.blockSize ||
        pData.size !== this.metadata.blockSize) {
      // Not a single complete block write.
      console.assert(false, 'unexpected write parameters');
      return VFS.SQLITE_IOERR;
    }

    // Check for write past the end of data.
    this.metadata.fileSize = Math.max(this.metadata.fileSize, iOffset + pData.size);

    // Get the block from the cache, creating if not present.
    let block = this.writeCache.get(blockIndex) ?? {
      name: this.name,
      index: blockIndex,
      data: new ArrayBuffer(this.metadata.blockSize)
    };
    new Int8Array(block.data).set(pData.value);
    this.putBlock(block);
    return VFS.SQLITE_OK;
  }

  xTruncate(fileId, iSize) {
    this.metadata.fileSize = iSize;
    return VFS.SQLITE_OK;
  }

  xSync(fileId, flags) {
    return VFS.SQLITE_OK;
  }

  xFileSize(fileId, pSize64) {
    pSize64.set(this.metadata.fileSize);
    return VFS.SQLITE_OK
  }

  async xLock(fileId, flags) {
    const result = (super.xLock && await super.xLock(fileId, flags)) ?? VFS.SQLITE_OK;
    switch (this.lockState) {
      case VFS.SQLITE_LOCK_SHARED: // read lock
        this.idb.updateTxMode('readonly');
        this.metadata = await this.getBlock('metadata');
        this.rollbackSize = this.metadata.fileSize;
        this.writeCache.clear();
        this.spillCache.clear();
        break;
      case VFS.SQLITE_LOCK_EXCLUSIVE: // write lock
        this.idb.updateTxMode('readwrite');
        break;
    }
    return result;
  }

  async xUnlock(fileId, flags) {
    if (this.rollbackOOB) {
      await this.rollback();
      this.rollbackOOB = false;
    }

    if (this.lockState === VFS.SQLITE_LOCK_EXCLUSIVE) {
      await this.idb.run(async ({ database, spill }) => {
        // Flush metadata.
        database.put(this.metadata);

        // Flush the 1st level cache stored in memory.
        for (const block of this.writeCache.values()) {
          if (block.index * this.metadata.blockSize < this.metadata.fileSize) {
            database.put(block);
          }
        }
        this.writeCache.clear();

        // Flush the 2nd level cache stored in IndexedDB.
        if (this.spillCache.size) {
          let query = IDBKeyRange.lowerBound([this.name], true);
          let blocks = [];
          do {
            blocks = await spill.getAll(query, WRITE_CACHE_SIZE);
            for (const block of blocks) {
              if (this.spillCache.has(block.index) &&
                  block.index * this.metadata.blockSize < this.metadata.fileSize) {
                database.put(block);
              }
            }
            query = IDBKeyRange.lowerBound([this.name, blocks.pop()?.index ?? 0], true);
          } while (blocks.length);
          this.spillCache.clear();
          spill.clear();
        }

        // Remove blocks truncated from the file.
        const truncateRange = IDBKeyRange.bound(
          [this.name, (this.metadata.fileSize / this.metadata.blockSize) | 0],
          [this.name, Number.MAX_VALUE]);
        database.delete(truncateRange);
      });
    }

    return (super.xUnlock && super.xUnlock(fileId, flags)) ?? VFS.SQLITE_OK;
  }

  xSectorSize(fileId) {
    return this.metadata.blockSize;
  }

  xDeviceCharacteristics(fileId) {
    return VFS.SQLITE_IOCAP_SAFE_APPEND |
           VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN;
  }

  async rollback() {
    // If all changes fit into the SQLite internal cache, the
    // database will never have been locked for writing.
    const lockState = this.lockState;
    if (lockState !== VFS.SQLITE_LOCK_EXCLUSIVE) {
      super.xLock && await super.xLock(0, VFS.SQLITE_LOCK_EXCLUSIVE);
      this.idb.updateTxMode('readwrite');
    }

    // At this point the SQLite internal cache may be inconsistent
    // because it has not received complete rollback data. Increment
    // the file change counter to force a reload. Note that this does
    // not work with `PRAGMA locking_mode=exclusive` (unless the
    // SQLite cache is disabled, in which case it is not needed).
    await this.idb.run(async ({ database, spill }) => {
      const block = await database.get([this.name, 0]);
      const view = new DataView(block.data);
      view.setUint32(24, view.getUint32(24) + 1);
      await database.put(block);

      this.metadata.fileSize = this.rollbackSize;
      if (this.writeCache.size >= WRITE_CACHE_SIZE) {
        spill.clear();
      }
      this.writeCache.clear();
      this.spillCache.clear();
    });

    if (lockState !== VFS.SQLITE_LOCK_EXCLUSIVE) {
      super.xUnlock && await super.xUnlock(0, lockState);
    }
  }

  getBlock(index) {
    const block = this.writeCache.get(index);
    if (block) return block;

    if (this.spillCache.has(index)) {
      return this.idb.run(({ spill }) => spill.get([this.name, index]));
    }
    return this.idb.run(({ database }) => database.get([this.name, index]));
  }

  putBlock(block) {
    // Replace or insert at the end of the write cache.
    this.writeCache.delete(block.index);
    this.writeCache.set(block.index, block);

    // Remove any spill cache entry.
    this.spillCache.delete(block.index);

    // Spill any write cache overflow.
    for (const candidate of this.writeCache.values()) {
      if (this.writeCache.size <= WRITE_CACHE_SIZE) break;

      // Keep block 0 in memory to improve performance.
      if (candidate.index > 0) {
        this.idb.run(({ spill }) => spill.put(candidate));
        this.spillCache.add(candidate.index);
        this.writeCache.delete(candidate.index);
      }
    }
  }
}