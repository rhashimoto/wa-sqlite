import * as VFS from '../VFS.js';
import { WebLocksMixin } from './WebLocksMixin.js';
import * as IDBUtils from './IDBUtils.js';

// Default block size for new databases.
const BLOCK_SIZE = 8192;

// Max number of blocks to store in the 1st-level write cache.
const CACHE_SIZE = 2048;

export class IDBDatabaseFile extends WebLocksMixin() {
  // Two-level write cache, RAM and IndexedDB. Only writes are cached;
  // read caching is left to SQLite.
  writeCache = new Map();
  spillCache = new Set();

  // Out-of-band rollback state. Discard writes when signalled directly
  // by the journal file without SQLite's knowledge.
  rollbackOOB = false;
  rollbackSize = 0;

  constructor(/** @type {IDBDatabase} */ db) {
    super();
    this.db = db;
    this.databaseStore = new IDBUtils.StoreManager(db, 'database');
    this.spillStore = new IDBUtils.StoreManager(db, 'spill');
  }

  get name() { return this.metadata.name; }
  get type() { return this.flags & VFS.FILE_TYPE_MASK; }

  async xOpen(name, fileId, flags, pOutFlags) {
    this.flags = flags;

    // Fetch metadata.
    this.metadata = await this.databaseStore.get([name, 'metadata']);
    if (!this.metadata) {
      // File doesn't exist, create if requested.
      if (flags & VFS.SQLITE_OPEN_CREATE) {
        this.metadata = {
          name,
          index: 'metadata',
          fileSize: 0,
          blockSize: BLOCK_SIZE
        };
        this.databaseStore.put(this.metadata);
      } else {
        return VFS.SQLITE_CANTOPEN;
      }
    }
    pOutFlags.set(0);
    return VFS.SQLITE_OK;
  }

  xClose() {
    // All output is flushed on xUnlock so sync is unnecessary here.
    this.spillStore.delete(IDBKeyRange.bound([this.name], [this.name, Number.MAX_VALUE]));
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
    if (iOffset + pData.size > (blockIndex + 1) * this.metadata.blockSize) {
      console.assert(false, 'unexpected write across block boundary');
      return VFS.SQLITE_IOERR;
    }

    // Check for write past the end of data.
    if (iOffset + pData.size >= this.metadata.fileSize) {
      this.metadata.fileSize = iOffset + pData.size;
    }

    // Get the block from the cache, creating if necessary.
    let block = this.writeCache.get(blockIndex) ?? {
      name: this.name,
      index: blockIndex,
      data: new ArrayBuffer(this.metadata.blockSize)
    };
    this.putBlock(blockIndex, block);

    const blockOffset = iOffset % this.metadata.blockSize;
    new Int8Array(block.data, blockOffset).set(pData.value);
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
    const result = (super.xLock && super.xLock(fileId, flags)) ?? VFS.SQLITE_OK;
    if (this.lockState === VFS.SQLITE_LOCK_NONE) {
      this.metadata = await this.getBlock('metadata');
      this.rollbackSize = this.metadata.fileSize;
      this.writeCache.clear();
      this.spillCache.clear();
    }
    return result;
  }

  async xUnlock(fileId, flags) {
    if (this.lockState === VFS.SQLITE_LOCK_EXCLUSIVE) {
      if (!this.rollbackOOB) {
        // Commit writes stored in both cache levels in a single transaction.
        const tx = this.db.transaction(['database', 'spill'], 'readwrite');
        tx.objectStore('database').put(this.metadata);
        for (const block of this.writeCache.values()) {
          // Skip blocks past EOF.
          if (block.index * this.metadata.blockSize < this.metadata.fileSize) {
            tx.objectStore('database').put(block);
          }
        }

        await new Promise((resolve, reject) => {
        // Iterate spilled blocks.
        const spillRange = IDBKeyRange.bound(
          [this.name, 0],
          [this.name, Number.MAX_VALUE]);
        const request = tx.objectStore('spill').openCursor(spillRange)
          request.addEventListener('success', event => {
          // @ts-ignore
          /** @type {IDBCursorWithValue} */ const cursor = event.target.result;
          if (cursor) {
            // Ignore unreferenced entries that occur when a block has
            // been overridden by a new write cache entry.
            const block = cursor.value;
            if (this.spillCache.has(block.index)) {
              tx.objectStore('database').put(block);
            }
            cursor.continue();
          } else {
            resolve();
          }
        });
          request.addEventListener('error', reject);
        });

        // Remove blocks truncated from the file.
        const truncateRange = IDBKeyRange.bound(
          [this.name, (this.metadata.fileSize / this.metadata.blockSize) | 0],
          [this.name, Number.MAX_VALUE])
        tx.objectStore('database').delete(truncateRange);

        await new Promise(resolve => {
          tx.addEventListener('complete', resolve);
          tx.commit();
        });
      }

      this.writeCache.clear();
      this.spillCache.clear();
    }

    if (this.rollbackOOB) {
      // This is an out-of-band rollback so no writes are passed on to
      // the database. Note that rollback can be received even if the
      // VFS never receives an exclusive lock, which happens when all
      // changes have only been made in the SQLite cache.
      await new Promise(async (resolve) => {
        // Increment the change counter in the database header so SQLite
        // will invalidate its internal cache.
        const tx = this.db.transaction('database', 'readwrite');
        const store = tx.objectStore('database');
        const block = await IDBUtils.promisify(store.get([this.name, 0]));
        const view = new DataView(block.data);
        const counter = view.getUint32(24);
        view.setUint32(24, counter + 1);
        store.put(block);

        tx.addEventListener('complete', resolve);
        tx.commit();
      });
      this.metadata.fileSize = this.rollbackSize;
      this.rollbackOOB = false;
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

  getBlock(index) {
    const block = this.writeCache.get(index);
    if (block) return block;

    if (this.spillCache.has(index)) {
      return this.spillStore.get([this.name, index]);
    }
    return this.databaseStore.get([this.name, index]);
  }

  putBlock(index, block) {
    // Replace or insert at the end of the write cache.
    this.writeCache.delete(index);
    this.writeCache.set(index, block);

    // Remove the corresponding block from spill.
    if (this.spillCache.has(index)) {
      // Just delete the in-memory reference. The block will still be in
      // IndexedDB but it will be ignored.
      this.spillCache.delete(index);
    }

    for (const candidate of this.writeCache.values()) {
      if (this.writeCache.size <= CACHE_SIZE) break;

      // Keep block 0 in the cache.
      if (candidate.index > 0) {
        this.spillStore.put(candidate);
        this.spillCache.add(candidate.index);
        this.writeCache.delete(candidate.index);
      }
    }
  }
}