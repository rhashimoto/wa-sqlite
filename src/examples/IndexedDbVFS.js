// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
import * as VFS from '../VFS.js';

// Default block size for new databases.
const BLOCK_SIZE = 8192;

// This is the number of hexadecimal digits in block keys. Note that
// changing this number will make existing databases unreadable.
const BLOCK_KEY_DIGITS = 10;

// This is the default maximum number of cached blocks per file.
const DEFAULT_CACHE_SIZE = 16;

// Use IndexedDB as a block device. This class does not wait for a lock;
// it returns SQLITE_BUSY if the database is already locked. This can
// result in an orphaned lock, e.g. if an application holding the lock
// exits or crashes during a transaction.
export class IndexedDbVFS extends VFS.Base {
  name = 'idb';
  mapIdToFile = new Map();
  cacheSize = DEFAULT_CACHE_SIZE;

  /**
   * @param {string} idbName Name of IndexedDB database.
   */
  constructor(idbName = 'sqlite') {
    super();
    this.db = idb(globalThis.indexedDB.open(idbName, 1), {
      upgradeneeded(event) {
        const db = event.target.result;
        db.createObjectStore('blocks');
      }
    }).then(db => this.db = db);
  }

  async close() {
    if (this.db.then) await this.db;
    this.db.close();
  }

  xOpen(name, fileId, flags, pOutFlags) {
    return this.handleAsync(async () => {
      // Generate a random name if requested.
      name = name || Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);

      if (this.db.then) await this.db;

      // If creating the database file, get and put must be in the same
      // transaction to prevent simultaneous creation (unlikely but possible).
      const metaKey = this._metaKey(name);
      const store = this._getStore();
      let meta = await idb(store.get(metaKey));
      if (!meta) {
        if (flags & VFS.SQLITE_OPEN_CREATE) {
          // Create a new metadata object.
          meta = {
            name,
            size: 0,
            blockSize: BLOCK_SIZE,
            isLocked: false,
            syncs: 0
          };
          store.put(meta, metaKey);
        } else {
          return VFS.SQLITE_CANTOPEN;
        }
      }

      // Put the file in the opened files map.
      this.mapIdToFile.set(fileId, {
        meta,
        metaKey,
        flags,
        lockType: VFS.SQLITE_LOCK_NONE,
        cache: new Map()
      });
      pOutFlags.set(flags);
      return VFS.SQLITE_OK;
    });
  }

  xClose(fileId) {
    return this.handleAsync(async () => {
      const file = this.mapIdToFile.get(fileId);
      if (file.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
        const file = this.mapIdToFile.get(fileId);
        await this._delete(file.metaKey);
      }
      this.mapIdToFile.delete(fileId);
      return VFS.SQLITE_OK;
    });
  }

  xRead(fileId, pData, iOffset) {
    return this.handleAsync(async () => {
      const file = this.mapIdToFile.get(fileId);
      const meta = file.meta;

      // Clip the requested read to the file boundary.
      const bgn = Math.min(iOffset, meta.size);
      const end = Math.min(iOffset + pData.size, meta.size);

      let nRemaining = end - bgn;
      let arrayOffset = 0;
      if (nRemaining) {
        let fileOffset = iOffset;
        const store = this._getStore();
        while (nRemaining) {
          const blockIndex = Math.floor(fileOffset / meta.blockSize);
          const blockOffset = fileOffset % meta.blockSize;
          const blockBytes = Math.min(meta.blockSize - blockOffset, nRemaining);

          let blockData = await this._getBlock(store, file, blockIndex);
          if (!blockData) {
            // This block doesn't exist in spite of being within the file
            // size. This can happen if writes are not purely sequential.
            blockData = new ArrayBuffer(meta.blockSize);
          }

          pData.value.subarray(arrayOffset)
            .set(new Int8Array(blockData, blockOffset, blockBytes));
          arrayOffset += blockBytes;
          fileOffset += blockBytes;
          nRemaining -= blockBytes;
        }
      }

      if (arrayOffset !== pData.size) {
        // Zero unused area of read buffer.
        pData.value.subarray(arrayOffset).fill(0, pData.size - arrayOffset);
        return VFS.SQLITE_IOERR_SHORT_READ;
      }
      return VFS.SQLITE_OK;
    });
  }

  xWrite(fileId, pData, iOffset) {
    return this.handleAsync(async () => {
      const file = this.mapIdToFile.get(fileId);
      const meta = file.meta;
      
      let arrayOffset = 0;
      let nRemaining = pData.size;
      if (nRemaining) {
        let fileOffset = iOffset;
        const lastBlockIndex = Math.floor(meta.size / meta.blockSize);
        const store = this._getStore();
        while (nRemaining) {
          const blockIndex = Math.floor(fileOffset / meta.blockSize);
          const blockOffset = fileOffset % meta.blockSize;
          const blockBytes = Math.min(meta.blockSize - blockOffset, nRemaining);

          let blockData;
          if (blockIndex <= lastBlockIndex && blockBytes < meta.blockSize) {
            // The write is to only part of a block that may have been
            // already written.
            blockData = await this._getBlock(store, file, blockIndex);
          }
          if (!blockData) {
            // We should reach here when:
            // - writing a complete block
            // - writing past the previous last block of the file
            // - writing in an empty gap
            blockData = new ArrayBuffer(meta.blockSize);
          }

          new Int8Array(blockData, blockOffset, blockBytes)
            .set(pData.value.subarray(arrayOffset, arrayOffset + blockBytes));
          this._putBlock(store, file, blockIndex, blockData);

          arrayOffset += blockBytes;
          fileOffset += blockBytes;
          nRemaining -= blockBytes;
        }
      }

      meta.size = Math.max(meta.size, iOffset + pData.size);
      return VFS.SQLITE_OK;
    });
  }

  xTruncate(fileId, iSize) {
    return this.handleAsync(async () => {
      const file = this.mapIdToFile.get(fileId);
      const meta = file.meta;
      meta.size = Math.min(meta.size, iSize);

      // Remove blocks past EOF from the cache.
      const nBlocks = Math.floor((meta.size + meta.blockSize - 1) / meta.blockSize);
      const startKey = this._blockKey(meta.name, nBlocks);
      const endKey = this._blockKey(meta.name, parseInt('f'.repeat(BLOCK_KEY_DIGITS), 16));
      for (const key of file.cache.keys()) {
        if (key >= startKey && key <= endKey) {
          file.cache.delete(key);
        }
      }
      return VFS.SQLITE_OK;
    });
  }

  xSync(fileId, flags) {
    return this.handleAsync(async () => {
      // Write blocks before updating file size metadata.
      const file = this.mapIdToFile.get(fileId);
      const meta = file.meta;
      const store = this._getStore();
      await this._flushCache(store, file);

      meta.syncs = ++meta.syncs >>> 0;
      await idb(store.put(meta, file.metaKey));

      // Remove blocks past EOF from IndexedDB.
      const nBlocks = Math.floor((meta.size + meta.blockSize - 1) / meta.blockSize);
      this._delete(this._blockKey(meta.name, nBlocks), file.metaKey);

      return VFS.SQLITE_OK;
    });
  }

  xFileSize(fileId, pSize64) {
    const file = this.mapIdToFile.get(fileId);
    pSize64.set(file.meta.size);
    return VFS.SQLITE_OK;
  }

  xLock(fileId, flags) {
    return this.handleAsync(async () => {
      const file = this.mapIdToFile.get(fileId);
      if (flags !== file.lockType && file.lockType === VFS.SQLITE_LOCK_NONE) {
        const syncs = file.meta.syncs;

        // Acquire lock atomically.
        const store = this._getStore();
        file.meta = await idb(store.get(file.metaKey));
        if (file.meta.isLocked) {
          // Don't block if already locked; just give up.
          return VFS.SQLITE_BUSY;
        }
        file.meta.isLocked = true;
        idb(store.put(file.meta, file.metaKey));

        if (file.meta.syncs !== syncs) {
          // Another connection has synced this file.
          file.cache.clear();
        }
      }
      file.lockType = flags;
      return VFS.SQLITE_OK;
    });
  }

  xUnlock(fileId, flags) {
    const file = this.mapIdToFile.get(fileId);
    if (flags !== file.lockType && flags === VFS.SQLITE_LOCK_NONE) {
      file.meta.isLocked = false;
      const store = this._getStore();
      idb(store.put(file.meta, file.metaKey));
    }
    file.lockType = flags;
    return VFS.SQLITE_OK;
  }

  xSectorSize(fileId) {
    const meta = this.mapIdToFile.get(fileId).meta;
    return meta.blockSize;
  }

  xDeviceCharacteristics(fileId) {
    return VFS.SQLITE_IOCAP_ATOMIC |
           VFS.SQLITE_IOCAP_SAFE_APPEND |
           VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN;
  }

  xDelete(name, syncDir) {
    return this.handleAsync(async () => {
      await this.deleteFile(name);
      return VFS.SQLITE_OK;
    });
  }

  xAccess(name, flags, pResOut) {
    return this.handleAsync(async () => {
      const store = this._getStore('readonly');
      const meta = await idb(store.getKey(this._metaKey(name)));
      pResOut.set(meta ? 1 : 0);
      return VFS.SQLITE_OK;
    });
  }

  /**
   * Delete a file from IndexedDB.
   * @param {string} name 
   */
  async deleteFile(name) {
    await this._delete(this._metaKey(name));
  }

  /**
   * Forcibly clear an orphaned file lock.
   * @param {string} name 
   */
  async forceClearLock(name) {
    const store = this._getStore();
    const key = this._metaKey(name);
    const meta = await idb(store.get(key));
    meta.isLocked = false;
    await idb(store.put(meta, key));
  }

  _getStore(mode = 'readwrite') {
    return this.db.transaction('blocks', mode).objectStore('blocks');
  }

  /**
   * Returns the key for file metadata.
   * @param {string} name 
   * @returns 
   */
  _metaKey(name) {
    return `${name}#`
  }

  /**
   * Returns the key for file block data.
   * @param {string} name 
   * @param {number} index 
   * @returns 
   */
  _blockKey(name, index) {
    return this._metaKey(name) + index.toString(16).padStart(BLOCK_KEY_DIGITS, '0');
  }

  async _getBlock(store, file, index) {
    const key = this._blockKey(file.meta.name, index);
    if (file.cache.has(key)) {
      // Move the cache entry to the end of the map.
      const block = file.cache.get(key);
      file.cache.delete(key);
      file.cache.set(key, block);
      return block.data;
    }

    // Cache miss, fetch from IDB.
    const blockData = await idb(store.get(key));
    file.cache.set(key, { data: blockData, dirty: false });
    this._purgeCache(store, file);
    return blockData;
  }

  _putBlock(store, file, index, blockData) {
    const key = this._blockKey(file.meta.name, index);
    file.cache.delete(key);
    file.cache.set(key, { data: blockData, dirty: true });
    this._purgeCache(store, file);
  }

  _purgeCache(store, file, size = this.cacheSize) {
    const keys = Array.from(file.cache.keys()).slice(0, -size);
    for (const key of keys) {
      const block = file.cache.get(key);
      file.cache.delete(key);
      if (block.dirty) {
        idb(store.put(block.data, key));
      }
    }
  }

  async _flushCache(store, file) {
    for (const [key, block] of file.cache.entries()) {
      if (block.dirty) {
        await idb(store.put(block.data, key));
        block.dirty = false;
      }
    }
  }

  /**
   * Helper function that deletes all keys greater or equal to `key`
   * provided they start with `prefix`.
   * @param {string} key 
   * @param {string} [prefix] 
   * @returns 
   */
  _delete(key, prefix = key) {
    const store = this._getStore();
    return idb(store.openCursor(IDBKeyRange.lowerBound(key)), {
      success(event) {
        const cursor = event.target.result;
        if (cursor && cursor.key.startsWith(prefix)) {
          cursor.delete();
          return cursor.continue();
        }
        return event.target.resolve();
      }
    });
  }
}

// Convenience Promisification for IDBRequest.
function idb(request, listeners = {}) {
  listeners = Object.assign({
    'success': () => request.resolve(request.result),
    'error': () => request.reject('idb error')
  }, listeners);
  return new Promise(function(resolve, reject) {
    Object.assign(request, { resolve, reject });
    for (const type of Object.keys(listeners)) {
      request.addEventListener(type, listeners[type]);
    }
  });
}