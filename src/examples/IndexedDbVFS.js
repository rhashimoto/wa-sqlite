// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
import * as VFS from '../VFS.js';

// Default block size for new databases.
const BLOCK_SIZE = 8192;

// This is the number of hexadecimal digits in block keys. Note that
// changing this number will make existing databases unreadable.
const BLOCK_KEY_DIGITS = 10;

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

   xOpen(name, fileId, flags, pOutFlags) {
    return this.handleAsync(async () => {
      // Generate a random name if requested.
      name = name || Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);

      if (this.db.then) await this.db;

      // If creating the database file, get and put must be in the same
      // transaction to prevent simultaneous creation (unlikely but possible).
      const blocks = this.db.transaction('blocks', 'readwrite').objectStore('blocks');
      let meta = await idb(blocks.get(this._metaKey(name)));
      if (!meta) {
        if (flags & VFS.SQLITE_OPEN_CREATE) {
          // Create a new metadata object.
          meta = {
            name,
            size: 0,
            blockSize: BLOCK_SIZE
          };
          blocks.put(meta, this._metaKey(name));
        } else {
          return VFS.SQLITE_CANTOPEN;
        }
      }

      const file = { meta };
      if (flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
        file.deleteOnClose = true;
      }

      // Put the file in the opened files map.
      this.mapIdToFile.set(fileId, file);
      pOutFlags.set(flags);
      return VFS.SQLITE_OK;
    });
  }

  xClose(fileId) {
    return this.handleAsync(async () => {
      const file = this.mapIdToFile.get(fileId);
      if (file.deleteOnClose) {
        const file = this.mapIdToFile.get(fileId);
        await this._delete(this._metaKey(file.name));
      }
      this.mapIdToFile.delete(fileId);
      return VFS.SQLITE_OK;
    });
  }

  xRead(fileId, pData, iOffset) {
    return this.handleAsync(async () => {
      const meta = this.mapIdToFile.get(fileId).meta;

      // Clip the requested read to the file boundary.
      const bgn = Math.min(iOffset, meta.size);
      const end = Math.min(iOffset + pData.size, meta.size);

      let nRemaining = end - bgn;
      let arrayOffset = 0;
      if (nRemaining) {
        let fileOffset = iOffset;
        const blocks = this.db.transaction('blocks', 'readonly').objectStore('blocks');
        while (nRemaining) {
          const blockIndex = Math.floor(fileOffset / meta.blockSize);
          const blockOffset = fileOffset % meta.blockSize;
          const blockBytes = Math.min(meta.blockSize - blockOffset, nRemaining);

          const key = this._blockKey(meta.name, blockIndex);
          let blockData = await idb(blocks.get(key));
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
      const meta = this.mapIdToFile.get(fileId).meta;
      
      let arrayOffset = 0;
      let nRemaining = pData.size;
      if (nRemaining) {
        let fileOffset = iOffset;
        const lastBlockIndex = Math.floor(meta.size / meta.blockSize);
        const blocks = this.db.transaction('blocks', 'readwrite').objectStore('blocks');
        while (nRemaining) {
          const blockIndex = Math.floor(fileOffset / meta.blockSize);
          const blockOffset = fileOffset % meta.blockSize;
          const blockBytes = Math.min(meta.blockSize - blockOffset, nRemaining);

          const key = this._blockKey(meta.name, blockIndex);
          let blockData;
          if (blockIndex <= lastBlockIndex && blockBytes < meta.blockSize) {
            // The write is to only part of a block that may have been
            // already written.
            blockData = await idb(blocks.get(key));
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
          await idb(blocks.put(blockData, key));

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
      const meta = this.mapIdToFile.get(fileId).meta;
      await this._putMeta(meta.name, meta);
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
           VFS.SQLITE_IOCAP_SEQUENTIAL |
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