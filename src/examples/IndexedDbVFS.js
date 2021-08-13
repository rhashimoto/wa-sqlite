// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
import * as VFS from '../VFS.js';

// Default block size for new databases.
const BLOCK_SIZE = 8192;

// This is the number of hexadecimal digits in block keys. Note that
// changing this number will make existing databases unreadable.
const BLOCK_KEY_DIGITS = 10;

const IDB_DATABASE_PREFIX = 'sqlite--';
const KEEPALIVE_DEFAULT = 2;

// Use IndexedDB as a block device.
export class IndexedDbVFS extends VFS.Base {
  name = 'idb';
  /** @type {Map<number, File>} */ mapIdToFile = new Map();

  xOpen(name, fileId, flags, pOutFlags) {
    return this.handleAsync(async () => {
      // console.debug(`xOpen ${name} 0x${flags.toString(16)}`);

      // Generate a random name if requested.
      name = name || Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);

      const file = await File.open(name, { create: flags & VFS.SQLITE_OPEN_CREATE });
      if (!file) return VFS.SQLITE_CANTOPEN;

      Object.assign(file, {
        flags,
        lockType: VFS.SQLITE_LOCK_NONE
      });
      this.mapIdToFile.set(fileId, file);
      pOutFlags.set(flags);
      return VFS.SQLITE_OK;
    });
  }

  xClose(fileId) {
    return this.handleAsync(async () => {
      const file = this.mapIdToFile.get(fileId);
      // console.debug(`xClose ${file.getName()}`);
      file.close();
      if (file.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
        File.delete(file.getName());
      }
      this.mapIdToFile.delete(fileId);
      return VFS.SQLITE_OK;
    });
  }

  xRead(fileId, pData, iOffset) {
    return this.handleAsync(async () => {
      const file = this.mapIdToFile.get(fileId);
      // console.debug(`xRead ${file.getName()} offset 0x${iOffset} len ${pData.size}`);

      // Clip the requested read to the file boundary.
      const bgn = Math.min(iOffset, file.getSize());
      const end = Math.min(iOffset + pData.size, file.getSize());
      const blockSize = file.getBlockSize();

      let nRemaining = end - bgn;
      let arrayOffset = 0;
      if (nRemaining) {
        let fileOffset = iOffset;
        while (nRemaining) {
          const blockIndex = Math.floor(fileOffset / blockSize);
          const blockOffset = fileOffset % blockSize;
          const blockBytes = Math.min(blockSize - blockOffset, nRemaining);

          let blockData = await file.getBlock(blockIndex);
          if (!blockData) {
            // This block doesn't exist in spite of being within the file
            // size. This can happen if writes are not purely sequential.
            blockData = new ArrayBuffer(blockSize);
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
        pData.value.fill(0, arrayOffset);
        return VFS.SQLITE_IOERR_SHORT_READ;
      }
      return VFS.SQLITE_OK;
    });
  }

  xWrite(fileId, pData, iOffset) {
    return this.handleAsync(async () => {
      const file = this.mapIdToFile.get(fileId);
      // console.debug(`xWrite ${file.getName()} offset 0x${iOffset} len ${pData.size}`);

      const blockSize = file.getBlockSize();

      let arrayOffset = 0;
      let nRemaining = pData.size;
      if (nRemaining) {
        let fileOffset = iOffset;
        const nBlocks = Math.floor((file.getSize() + blockSize - 1) / blockSize);
        while (nRemaining) {
          const blockIndex = Math.floor(fileOffset / blockSize);
          const blockOffset = fileOffset % blockSize;
          const blockBytes = Math.min(blockSize - blockOffset, nRemaining);

          let blockData;
          if (blockIndex < nBlocks && blockBytes < blockSize) {
            // The write is to only part of a block that may have been
            // already written.
            blockData = await file.getBlock(blockIndex);
          }
          if (!blockData) {
            // We should reach here when:
            // - writing a complete block
            // - writing past the previous last block of the file
            // - writing in an empty gap
            blockData = new ArrayBuffer(blockSize);
          }

          new Int8Array(blockData, blockOffset, blockBytes)
            .set(pData.value.subarray(arrayOffset, arrayOffset + blockBytes));
          file.putBlock(blockIndex, blockData);

          arrayOffset += blockBytes;
          fileOffset += blockBytes;
          nRemaining -= blockBytes;
        }
      }

      const size = Math.max(file.getSize(), iOffset + pData.size);
      file.setSize(size);
      return VFS.SQLITE_OK;
    });
  }

  xTruncate(fileId, iSize) {
    return this.handleAsync(async () => {
      const file = this.mapIdToFile.get(fileId);
      // console.debug(`xTruncate ${file.getName()}`);
      const blockSize = file.getBlockSize();
      const size = Math.min(file.getSize(), iSize);
      file.setSize(size);

      const nBlocks = Math.floor((size + blockSize - 1) / blockSize);
      file.deleteBlocks(nBlocks);
      return VFS.SQLITE_OK;
    });
  }

  xFileSize(fileId, pSize64) {
    const file = this.mapIdToFile.get(fileId);
    // console.debug(`xFileSize ${file.getName()}`);
    pSize64.set(file.getSize());
    return VFS.SQLITE_OK;
  }

  xLock(fileId, flags) {
    return this.handleAsync(async () => {
      const file = this.mapIdToFile.get(fileId);
      // console.debug(`xLock ${file.getName()} ${flags}`);
      if (flags !== file.lockType && file.lockType === VFS.SQLITE_LOCK_NONE) {
        file.setKeepAlive(Number.POSITIVE_INFINITY);
        await file.readMetadata();
      }
      file.lockType = flags;
      return VFS.SQLITE_OK;
    });
  }

  xUnlock(fileId, flags) {
    const file = this.mapIdToFile.get(fileId);
    // console.debug(`xUnlock ${file.getName()} ${flags}`);
    if (flags !== file.lockType && flags === VFS.SQLITE_LOCK_NONE) {
      file.setKeepAlive(KEEPALIVE_DEFAULT);
      file.writeMetadata();
    }
    file.lockType = flags;
    return VFS.SQLITE_OK;
  }

  xSectorSize(fileId) {
    const file = this.mapIdToFile.get(fileId);
    // console.debug(`xSectorSize ${file.getName()}`);
    return file.getBlockSize();
  }

  xDeviceCharacteristics(fileId) {
    // console.debug(`xDeviceCharacteristics`);
    return VFS.SQLITE_IOCAP_SAFE_APPEND |
           VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN;
  }

  xDelete(name, syncDir) {
    return this.handleAsync(async () => {
      // console.debug(`xDelete ${name}`);
      await File.delete(name);
      return VFS.SQLITE_OK;
    });
  }

  xAccess(name, flags, pResOut) {
    return this.handleAsync(async () => {
      // console.debug(`xAccess ${name}`);
      pResOut.set(await File.test(name) ? 1 : 0);
      return VFS.SQLITE_OK;
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

class File {
  /**
   * @param {string} name 
   * @param {Object} options 
   * @returns {Promise<File?>}
   */
  static async open(name, options = {}) {
    // Open IDB database.
    const dbName = IDB_DATABASE_PREFIX + name;
    const db = await idb(globalThis.indexedDB.open(dbName, 1), {
      upgradeneeded(event) {
        const db = event.target.result;
        db.createObjectStore('blocks');
        db.isNew = true;
      }
    });

    /** @type {File} */ let file;
    if (!db.isNew || options.create) {
      file = new File(name, db, options);
      await file.readMetadata();
    } else {
      db.close();
      await File.delete(name);
      file = null;
    }

    return file;
  }

  /**
   * @param {string} name 
   */
  static async delete(name) {
    const dbName = IDB_DATABASE_PREFIX + name;
    await idb(globalThis.indexedDB.deleteDatabase(dbName));
  }

  static async test(name) {
    // @ts-ignore
    if (globalThis.indexedDB.databases) {
      // @ts-ignore
      const databases = await globalThis.indexedDB.databases();
      return databases.includes(IDB_DATABASE_PREFIX + name);
    }

    // Fallback for no IDBFactory.databases() (Firefox).
    const file = await File.open(name);
    file?.close?.();
    return !!file;
  }

  /** @type {IDBDatabase} */ _db;

  _metadata = {};

  /** @type {IDBTransaction} */ _tx = null;
  _txKeepAlive = 0;
  _txKeepAliveMax = KEEPALIVE_DEFAULT;

  _requestsPending = [];
  _requestsExecuting = 0;

  /** @type {number} */ flags;
  /** @type {number} */ lockType;

  /**
   * @param {string} name
   * @param {IDBDatabase} db
   * @param {Object} options
   */
  constructor(name, db, options) {
    this._name = name;
    this._db = db;
  }

  close() {
    this.setKeepAlive(0);
    this._db.close();
  }

  getName() {
    return this._metadata.name;
  }

  getSize() {
    return this._metadata.size;
  }

  setSize(value) {
    this._metadata.size = value;
  }

  getBlockSize() {
    return this._metadata.blockSize;
  }

  async readMetadata() {
    const metadata = await this._addRequest(store => store.get(''));
    this._metadata = Object.assign({
      name: this._name,
      size: 0,
      blockSize: BLOCK_SIZE
    }, metadata);
  }

  writeMetadata() {
    return this._addRequest(store => store.put(this._metadata, ''));
  }

  putBlock(index, block) {
    const key = this._makeBlockKey(index);
    return this._addRequest(store => store.put(block, key));
  }

  getBlock(index) {
    const key = this._makeBlockKey(index);
    return this._addRequest(store => store.get(key));
  }

  deleteBlocks(start, end = -1) {
    const startKey = this._makeBlockKey(start);
    const range = end >= 0 ?
      IDBKeyRange.bound(startKey, this._makeBlockKey(end), true, false) :
      IDBKeyRange.lowerBound(startKey);
    return this._addRequest(store => store.delete(range));
  }

  setKeepAlive(value) {
    this._txKeepAliveMax = value;
  }

  _addRequest(builder) {
    // A new transaction is needed if no transaction exists, or if we
    // can't determine when the current transaction will be active.
    if (!this._tx || !this._requestsExecuting) {
      this._tx = this._db.transaction('blocks', 'readwrite');
      this._tx.oncomplete =
      this._tx.onabort = event => {
        if (this._tx === event.target) {
          this._tx = null;
        }
      };
    }

    this._txKeepAlive = 0;
    return this._queueRequest(builder);
  }

  _queueRequest(builder) {
    return new Promise((resolve, reject) => {
      this._requestsPending.push({ builder, resolve, reject });
      if (!this._requestsExecuting) {
        this._executeRequests();
      }
    });
  }

  _executeRequests() {
    const store = this._tx.objectStore(this._tx.objectStoreNames[0]);
    for (const requestConfig of this._requestsPending) {
      const request = requestConfig.builder(store);
      request.onsuccess = () => {
        requestConfig.resolve(request.result);
        this._finishRequest();
      }
      request.onerror = () => {
        requestConfig.reject(request.error);
        this._finishRequest();
      }
    }
    this._requestsExecuting += this._requestsPending.length;
    this._requestsPending = [];
  }

  _finishRequest() {
    --this._requestsExecuting;
    if (this._requestsPending.length) {
      this._executeRequests();
    } else if (!this._requestsExecuting && ++this._txKeepAlive <= this._txKeepAliveMax) {
      // Issue a request to extend the transaction lifetime.
      this._queueRequest(store => store.put(this._metadata, ''));
    }
  }

  _makeBlockKey(index) {
    return index.toString(16).padStart(BLOCK_KEY_DIGITS, '0');
  }
};
