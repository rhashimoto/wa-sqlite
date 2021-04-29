// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
import * as VFS from '../VFS.js';

// Default block size for new databases.
const BLOCK_SIZE = 8192;

// This is the number of hexadecimal digits in block keys. Note that
// changing this number will make existing databases unreadable.
const BLOCK_KEY_DIGITS = 10;

// This is the maximum number of cached blocks per file.
const CACHE_SIZE = 16;

// Use IndexedDB as a block device. This class does not implement locking
// so although it can be used for multiple connections to a database, it
// is not safe for concurrent transactions (arbitration must be provided
// at the application level).
export class IndexedDbVFS extends VFS.Base {
  name = 'idb';
  mapIdToFile = new Map();

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

  async getBlock(store, file, index) {
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
    file.cache.set(key, { data: blockData });
    this.purgeCache(store, file);
    return blockData;
  }

  putBlock(store, file, index, blockData, options) {
    const key = this._blockKey(file.meta.name, index);
    file.cache.delete(key);
    file.cache.set(key, { data: blockData, dirty: true });
    this.purgeCache(store, file);
  }

  purgeCache(store, file, size = CACHE_SIZE) {
    const keys = Array.from(file.cache.keys()).slice(0, -size);
    for (const key of keys) {
      const block = file.cache.get(key);
      file.cache.delete(key);
      if (block.dirty) {
        idb(store.put(block.data, key));
      }
    }
  }

  async flushCache(store, file) {
    for (const [key, block] of file.cache.entries()) {
      if (block.dirty) {
        await idb(store.put(block.data, key));
        block.dirty = false;
      }
    }
  }

  xOpen(name, fileId, flags, pOutFlags) {
    return this.handleAsync(async () => {
      // Generate a random name if requested.
      name = name || Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);

      if (this.db.then) await this.db;

      // If creating the database file, get and put must be in the same
      // transaction to prevent simultaneous creation (unlikely but possible).
      const store = this.db.transaction('blocks', 'readwrite').objectStore('blocks');
      let meta = await idb(store.get(this._metaKey(name)));
      if (!meta) {
        if (flags & VFS.SQLITE_OPEN_CREATE) {
          // Create a new metadata object.
          meta = {
            name,
            size: 0,
            blockSize: BLOCK_SIZE
          };
          store.put(meta, this._metaKey(name));
        } else {
          return VFS.SQLITE_CANTOPEN;
        }
      }

      const file = {
        meta,
        flags,
        cache: new Map()
      };

      // Put the file in the opened files map.
      this.mapIdToFile.set(fileId, file);
      pOutFlags.set(flags);
      return VFS.SQLITE_OK;
    });
  }

  xClose(fileId) {
    return this.handleAsync(async () => {
      const file = this.mapIdToFile.get(fileId);
      if (file.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
        const file = this.mapIdToFile.get(fileId);
        await this._delete(this._metaKey(file.name));
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
        const store = this.db.transaction('blocks', 'readwrite').objectStore('blocks');
        while (nRemaining) {
          const blockIndex = Math.floor(fileOffset / meta.blockSize);
          const blockOffset = fileOffset % meta.blockSize;
          const blockBytes = Math.min(meta.blockSize - blockOffset, nRemaining);

          let blockData = await this.getBlock(store, file, blockIndex);
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
        const store = this.db.transaction('blocks', 'readwrite').objectStore('blocks');
        while (nRemaining) {
          const blockIndex = Math.floor(fileOffset / meta.blockSize);
          const blockOffset = fileOffset % meta.blockSize;
          const blockBytes = Math.min(meta.blockSize - blockOffset, nRemaining);

          const key = this._blockKey(meta.name, blockIndex);
          let blockData;
          if (blockIndex <= lastBlockIndex && blockBytes < meta.blockSize) {
            // The write is to only part of a block that may have been
            // already written.
            blockData = await this.getBlock(store, file, blockIndex);
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
          this.putBlock(store, file, blockIndex, blockData);

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
      const meta = this.mapIdToFile.get(fileId).meta;
      meta.size = Math.min(meta.size, iSize);

      const nBlocks = Math.floor((meta.size + meta.blockSize - 1) / meta.blockSize);
      this._delete(this._blockKey(meta.name, nBlocks), this._metaKey(meta.name));
      return VFS.SQLITE_OK;
    });
  }

  xSync(fileId, flags) {
    return this.handleAsync(async () => {
      const file = this.mapIdToFile.get(fileId);
      const meta = file.meta;
      await this._putMeta(meta.name, meta);

      const store = this.db.transaction('blocks', 'readwrite').objectStore('blocks');
      await this.flushCache(store, file);
      return VFS.SQLITE_OK;
    });
  }

  xFileSize(fileId, pSize64) {
    const meta = this.mapIdToFile.get(fileId).meta;

    pSize64.set(meta.size);
    return VFS.SQLITE_OK;
  }

  xLock(fileId, flags) {
    return this.handleAsync(async () => {
      // Update metadata.
      const file = this.mapIdToFile.get(fileId);
      file.meta = await this._getMeta(file.meta.name);

      // TODO: Retain cache if file not changed.
      file.cache.clear();
      return VFS.SQLITE_OK;
    });
  }

  xUnlock(fileId, flags) {
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
      await this._delete(this._metaKey(name));
      return VFS.SQLITE_OK;
    });
  }

  xAccess(name, flags, pResOut) {
    return this.handleAsync(async () => {
      const meta = await this._getMeta(name);
      pResOut.set(meta ? 1 : 0);
      return VFS.SQLITE_OK;
    });
  }

  /**
   * Fetch file metadata.
   * @param {string} name 
   * @returns {Promise<object|undefined>}
   */
  _getMeta(name) {
    const blocks = this.db.transaction('blocks', 'readonly').objectStore('blocks');
    return idb(blocks.get(this._metaKey(name)));
  }

  /**
   * Store file metadata.
   * @param {string} name 
   * @param {object} metadata 
   * @returns {Promise}
   */
  _putMeta(name, metadata) {
    const blocks = this.db.transaction('blocks', 'readwrite').objectStore('blocks');
    return idb(blocks.put(metadata, this._metaKey(name)));
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

  /**
   * Helper function that deletes all keys greater or equal to `key`
   * provided they start with `prefix`.
   * @param {string} key 
   * @param {string} [prefix] 
   * @returns 
   */
  _delete(key, prefix = key) {
    const store = this.db.transaction('blocks', 'readwrite').objectStore('blocks');
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