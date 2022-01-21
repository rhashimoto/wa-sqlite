import * as VFS from '../VFS.js';
import { WebLocksMixin } from './WebLocksMixin.js';

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
  }

  get name() { return this.metadata.name; }
  get type() { return this.flags & VFS.FILE_TYPE_MASK; }

  async xOpen(name, fileId, flags, pOutFlags) {
    this.flags = flags;

    // Fetch metadata.
    this.metadata = await this.#idbGet('database', [name, 'metadata']);
    if (!this.metadata) {
      // File doesn't exist, create if requested.
      if (flags & VFS.SQLITE_OPEN_CREATE) {
        this.metadata = {
          name,
          index: 'metadata',
          fileSize: 0,
          blockSize: BLOCK_SIZE
        };
        this.#idbPut('database', this.metadata);
      } else {
        return VFS.SQLITE_CANTOPEN;
      }
    }
    pOutFlags.set(0);
    return VFS.SQLITE_OK;
  }

  xClose() {
    // Clearing the spill data from IndexedDB on every SQLite transaction
    // benchmarks measurably slower, so just do it on close.
    this.db.transaction('spill', 'readwrite')
      .objectStore('spill')
      .delete(IDBKeyRange.bound([this.name], [this.name, Number.MAX_VALUE]));
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
    this.putBlock(blockIndex, block);

    new Int8Array(block.data).set(pData.value);
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
    switch (this.lockState) {
      case VFS.SQLITE_LOCK_SHARED: // read lock
        this.metadata = await this.getBlock('metadata');
        this.rollbackSize = this.metadata.fileSize;
        this.writeCache.clear();
        this.spillCache.clear();
        break;
      case VFS.SQLITE_LOCK_EXCLUSIVE: // write lock
        // Discard any previous readonly transaction.
        this.#tx = null;
        break;
    }
    return result;
  }

  async xUnlock(fileId, flags) {
    if (this.lockState === VFS.SQLITE_LOCK_EXCLUSIVE) {
      if (!this.rollbackOOB) {
        // Flush metadata.
        this.#idbPut('database', this.metadata);

        // Flush the 2nd level cache stored in IndexedDB.
        await new Promise((resolve, reject) => {
          // Iterate spilled blocks.
          const spillRange = IDBKeyRange.bound(
            [this.name, 0],
            [this.name, Number.MAX_VALUE]);
          const request = this.#tx.objectStore('spill').openCursor(spillRange)
            request.addEventListener('success', event => {
            // @ts-ignore
            /** @type {IDBCursorWithValue} */ const cursor = event.target.result;
            if (cursor) {
              // Ignore unreferenced entries that occur when a block has
              // been overridden by a new write cache entry.
              const block = cursor.value;
              if (this.spillCache.has(block.index) &&
                  block.index * this.metadata.blockSize < this.metadata.fileSize) {
                this.#idbPut('database', block);
              }
              cursor.continue();
            } else {
              resolve();
            }
          });
          request.addEventListener('error', reject);
        });

        // Flush the 1st level cache stored in memory.
        for (const block of this.writeCache.values()) {
          if (block.index * this.metadata.blockSize < this.metadata.fileSize) {
            this.#idbPut('database', block);
          }
        }

        // Remove blocks truncated from the file.
        const truncateRange = IDBKeyRange.bound(
          [this.name, (this.metadata.fileSize / this.metadata.blockSize) | 0],
          [this.name, Number.MAX_VALUE])
        this.#idbDelete('database', truncateRange);
      }

      this.writeCache.clear();
      this.spillCache.clear();
    }

    if (this.rollbackOOB) {
      // This is an out-of-band rollback so no writes are passed on to
      // the database. Increment the change counter in the database header
      // so SQLite will invalidate its internal cache.
      if (this.#tx?.mode !== 'readwrite') {
        // This happens when all changes have only been made in the
        // SQLite cache so the VFS has a reserved lock (not an exclusive
        // lock) and this doesn't have a read-write transaction.
        this.#tx = this.db.transaction('database', 'readwrite');
      }
      const block = await this.#idbGet('database', [this.name, 0]);
      const view = new DataView(block.data);
      const counter = view.getUint32(24);
      view.setUint32(24, counter + 1);
      this.#idbPut('database', block);

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
      return this.#idbGet('spill', [this.name, index]);
    }
    return this.#idbGet('database', [this.name, index]);
  }

  putBlock(index, block) {
    // Replace or insert at the end of the write cache.
    this.writeCache.delete(index);
    this.writeCache.set(index, block);

    // Remove any spill cache entry.
    this.spillCache.delete(index);

    // Spill any write cache overflow.
    for (const candidate of this.writeCache.values()) {
      if (this.writeCache.size <= WRITE_CACHE_SIZE) break;

      // Keep block 0 in memory to improve performance.
      if (candidate.index > 0) {
        this.#idbPut('spill', candidate);
        this.spillCache.add(candidate.index);
        this.writeCache.delete(candidate.index);
      }
    }
  }

  #idbGet(/** @type {string} */ storeName, key) {
    return this.#store(storeName, store => store.get(key));
  }

  #idbPut(/** @type {string} */ storeName, key) {
    return this.#store(storeName, store => store.put(key));
  }

  #idbDelete(/** @type {string} */ storeName, key) {
    return this.#store(storeName, store => store.delete(key));
  }

  /**
   * Helper to reuse the last IndexedDB transaction for a new request,
   * if possible.
   * @param {string} storeName 
   * @param {(store: IDBObjectStore) => IDBRequest} callback 
   * @returns Promise
   */
  #store(storeName, callback) {
    for (let i = 0; i < 2; ++i) {
      if (!this.#tx) {
        const [stores, mode] = this.lockState === VFS.SQLITE_LOCK_EXCLUSIVE
          ? [['database', 'spill'], 'readwrite']
          : [['database'], 'readonly'];
        // @ts-ignore
        this.#tx = this.db.transaction(stores, mode);
        this.#tx.oncomplete = ({ target }) => {
          if (this.#tx === target) {
            this.tx = null;
          }
        }
      }

      try {
        const request = callback(this.#tx.objectStore(storeName));
        return this.#idbWrap(request);
      } catch (e) {
        if (i) throw e;
        // console.log(`new transaction ${storeName} (${e.message})`);
        this.#tx = null;
      }
    }
  }

  /**
   * Promise wrapper for IDBRequest.
   * @param {IDBRequest} request 
   * @returns Promise
   */
  #idbWrap(request) {
    return new Promise(function(resolve, reject) {
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
  }
}