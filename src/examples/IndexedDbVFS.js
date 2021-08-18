// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
import * as VFS from '../VFS.js';

// Default block size for new databases.
const BLOCK_SIZE = 8192;

// This is the number of hexadecimal digits in block keys. Note that
// changing this number will make existing databases unreadable.
const BLOCK_KEY_DIGITS = 10;
const BLOCK_KEY_SEPARATOR = '\u00a7';

const KEEPALIVE_DEFAULT = 2;

/**
 * @typedef Metadata
 * @property {number} size
 * @property {number} blockSize
 */

/**
 * @typedef File
 * @property {string} name
 * @property {number} flags
 * @property {number} lockType
 * @property {Metadata} metadata
 * @property {number} cachedBlockIndex
 * @property {ArrayBuffer} cachedBlock
 * @property {boolean} needsSync
 */

/**
 * @typedef Request
 * @property {(store: IDBObjectStore) => IDBRequest} builder
 * @property {function} resolve
 * @property {function} reject
 */

function log(...args) {
  // console.debug(...args);
}

// Use IndexedDB as a block device.
export class IndexedDbVFS extends VFS.Base {
  name = 'idb';
  /** @type {Promise<IDBDatabase>} */ databaseReady;
  /** @type {IDBDatabase} */ database;

  /** @type {Map<number, File>} */ mapIdToFile = new Map();
  nLockedFiles = 0;

  /** @type {IDBTransaction} */ tx;
  nKeepAlive = 0;
  /** @type {Request[]} */ requestQueue = [];
  nRequestsActive = 0;
  
  constructor(idbDatabaseName = 'sqlite') {
    super();

    // Open IDB database.
    this.databaseReady = new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open(idbDatabaseName, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => request.result.createObjectStore('blocks');
    });
  }

  xOpen(name, fileId, flags, pOutFlags) {
    return this.handleAsync(async () => {
      log(`xOpen ${name} 0x${flags.toString(16)}`);

      // Generate a random name if requested.
      name = name || Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);

      const file = {
        name,
        flags,
        lockType: VFS.SQLITE_LOCK_NONE,
        metadata: await this._loadFileMetadata(name),
        cachedBlockIndex: -1,
        cachedBlock: null,
        needsSync: false
      }
      if (!file.metadata) {
        if (flags & VFS.SQLITE_OPEN_CREATE) {
          file.metadata = {
            size: 0,
            blockSize: BLOCK_SIZE
          };
          this._saveFileMetadata(file.name, file.metadata);
        } else {
          return VFS.SQLITE_CANTOPEN;
        }
      }

      this.mapIdToFile.set(fileId, file);
      pOutFlags.set(flags);
      return VFS.SQLITE_OK;
    });
  }

  xClose(fileId) {
    return this.handleAsync(async () => {
      const file = this.mapIdToFile.get(fileId);
      log(`xClose ${file.name}`);

      if (file.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
        this._deleteFile(file.name);
      } else if (file.needsSync) {
        this._saveFileMetadata(file.name, file.metadata);
      }
      this.mapIdToFile.delete(fileId);
      return VFS.SQLITE_OK;
    });
  }

  xRead(fileId, pData, iOffset) {
    return this.handleAsync(async () => {
      const file = this.mapIdToFile.get(fileId);
      log(`xRead ${file.name} offset 0x${iOffset} len ${pData.size}`);

      // Clip the requested read to the file boundary.
      const bgn = Math.min(iOffset, file.metadata.size);
      const end = Math.min(iOffset + pData.size, file.metadata.size);
      const blockSize = file.metadata.blockSize;

      let nRemaining = end - bgn;
      let arrayOffset = 0;
      if (nRemaining) {
        let fileOffset = iOffset;
        while (nRemaining) {
          const blockIndex = Math.floor(fileOffset / blockSize);
          const blockOffset = fileOffset % blockSize;
          const blockBytes = Math.min(blockSize - blockOffset, nRemaining);

          let blockData = await this._getBlock(file, blockIndex);
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
      log(`xWrite ${file.name} offset 0x${iOffset} len ${pData.size}`);

      const blockSize = file.metadata.blockSize;

      let arrayOffset = 0;
      let nRemaining = pData.size;
      if (nRemaining) {
        let fileOffset = iOffset;
        const nBlocks = Math.floor((file.metadata.size + blockSize - 1) / blockSize);
        while (nRemaining) {
          const blockIndex = Math.floor(fileOffset / blockSize);
          const blockOffset = fileOffset % blockSize;
          const blockBytes = Math.min(blockSize - blockOffset, nRemaining);

          let blockData;
          if (blockIndex < nBlocks && blockBytes < blockSize) {
            // The write is to only part of a block that may have been
            // already written.
            blockData = await this._getBlock(file, blockIndex);
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
          this._putBlock(file, blockIndex, blockData);

          arrayOffset += blockBytes;
          fileOffset += blockBytes;
          nRemaining -= blockBytes;
        }
      }

      const size = Math.max(file.metadata.size, iOffset + pData.size);
      file.metadata.size = size;
      file.needsSync = true;
      return VFS.SQLITE_OK;
    });
  }

  xTruncate(fileId, iSize) {
    return this.handleAsync(async () => {
      const file = this.mapIdToFile.get(fileId);
      log(`xTruncate ${file.name}`);
      const blockSize = file.metadata.blockSize;
      const size = Math.min(file.metadata.size, iSize);
      file.metadata.size = size;
      file.needsSync = true;

      const nBlocks = Math.floor((size + blockSize - 1) / blockSize);
      this._deleteBlocks(file.name, nBlocks);
      return VFS.SQLITE_OK;
    });
  }

  xFileSize(fileId, pSize64) {
    const file = this.mapIdToFile.get(fileId);
    log(`xFileSize ${file.name}`);
    pSize64.set(file.metadata.size);
    return VFS.SQLITE_OK;
  }

  xLock(fileId, flags) {
    return this.handleAsync(async () => {
      const file = this.mapIdToFile.get(fileId);
      log(`xLock ${file.name} ${flags}`);
      if (flags !== file.lockType && file.lockType === VFS.SQLITE_LOCK_NONE) {
        ++this.nLockedFiles;
        file.metadata = await this._loadFileMetadata(file.name);
      }
      file.lockType = flags;
      return VFS.SQLITE_OK;
    });
  }

  xUnlock(fileId, flags) {
    const file = this.mapIdToFile.get(fileId);
    log(`xUnlock ${file.name} ${flags}`);
    if (flags !== file.lockType && flags === VFS.SQLITE_LOCK_NONE) {
      --this.nLockedFiles;
      if (file.needsSync) {
        this._saveFileMetadata(file.name, file.metadata);
        file.needsSync = false;
      }
    }
    file.lockType = flags;
    return VFS.SQLITE_OK;
  }

  xSectorSize(fileId) {
    const file = this.mapIdToFile.get(fileId);
    log(`xSectorSize ${file.name}`);
    return file.metadata.blockSize;
  }

  xDeviceCharacteristics(fileId) {
    log(`xDeviceCharacteristics`);
    return VFS.SQLITE_IOCAP_SAFE_APPEND |
           VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN;
  }

  xDelete(name, syncDir) {
    return this.handleAsync(async () => {
      log(`xDelete ${name}`);
      await this._deleteFile(name);
      return VFS.SQLITE_OK;
    });
  }

  xAccess(name, flags, pResOut) {
    return this.handleAsync(async () => {
      log(`xAccess ${name}`);
      pResOut.set(await this._loadFileMetadata(name) ? 1 : 0);
      return VFS.SQLITE_OK;
    });
  }

  async _addRequest(builder) {
    // A new transaction is needed if no transaction exists, or if we
    // can't determine when the current transaction will be active.
    if (!this.tx || !this.nRequestsActive) {
      if (!this.database) {
        this.database = await this.databaseReady;
      }
      this.tx = this.database.transaction('blocks', 'readwrite');
      this.txIsNew = true;
      this.tx.oncomplete =
      this.tx.onabort = event => {
        if (this.tx === event.target) {
          this._tx = null;
        }
      };
    }

    this.nKeepAlive = 0;
    return this._queueRequest(builder);
  }

  _queueRequest(builder) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ builder, resolve, reject });
      if (this.txIsNew) {
        this.txIsNew = false;
        this._executeRequests();
      }
    });
  }

  _executeRequests() {
    const store = this.tx.objectStore(this.tx.objectStoreNames[0]);
    for (const { builder, resolve, reject } of this.requestQueue) {
      const request = builder(store);
      request.onsuccess = () => {
        resolve(request.result);
        this._finishRequest();
      }
      request.onerror = () => {
        reject(request.error);
        this._finishRequest();
      }
    }
    this.nRequestsActive += this.requestQueue.length;
    this.requestQueue = [];
  }

  _finishRequest() {
    if (--this.nRequestsActive === 0 && this.requestQueue.length === 0) {
      // No requests are queued so issue a dummy request to keep the
      // transaction from autoclosing. If any files are locked this is
      // done indefinitely, otherwise a fixed number of times.
      const keepAliveMax = this.nLockedFiles ? Number.POSITIVE_INFINITY : KEEPALIVE_DEFAULT;
      if (++this.nKeepAlive <= keepAliveMax) {
        this._queueRequest(store => store.get(''));
      }
    }
    this._executeRequests();
  }

  /**
   * @param {string} name 
   * @returns {Promise<Metadata>}
   */
  _loadFileMetadata(name) {
    return this._addRequest(store => {
      const key = this._getMetadataKey(name);
      return store.get(key);
    });
  }

  /**
   * @param {string} name 
   * @param {Metadata} metadata 
   * @returns {Promise<void>}
   */
  _saveFileMetadata(name, metadata) {
    return this._addRequest(store => {
      const key = this._getMetadataKey(name);
      return store.put(metadata, key);
    });
  }

  /**
   * @param {File} file 
   * @param {number} index 
   * @returns {Promise<ArrayBuffer>}
   */
  _getBlock(file, index) {
    if (index === file.cachedBlockIndex) {
      return Promise.resolve(file.cachedBlock);
    }
    return this._addRequest(store => {
      const key = this._getBlockKey(file.name, index);
      return store.get(key);
    });
  }

  /**
   * @param {File} file 
   * @param {number} index 
   * @param {ArrayBuffer} data 
   * @returns 
   */
  _putBlock(file, index, data) {
    file.cachedBlockIndex = index;
    file.cachedBlock = data;
    return this._addRequest(store => {
      const key = this._getBlockKey(file.name, index);
      return store.put(data, key);
    });
  }

  /**
   * @param {string} name 
   * @returns {Promise<void>}
   */
  _deleteFile(name) {
    return this._addRequest(store => {
      const key = this._getMetadataKey(name);
      const range = IDBKeyRange.bound(key, key + '~', false, true);
      return store.delete(range);
    });
  }

  /**
   * @param {string} name 
   * @param {number} start 
   * @returns {Promise<void>}
   */
  _deleteBlocks(name, start) {
    const key = this._getMetadataKey(name);
    const startKey = this._getBlockKey(name, start);
    const range = IDBKeyRange.bound(startKey, key + '~', false, true);
    return this._addRequest(store => store.delete(range));
  }

  /**
   * 
   * @param {string} name 
   * @returns {string}
   */
  _getMetadataKey(name) {
    return name + BLOCK_KEY_SEPARATOR;
  }

  /**
   * @param {string} name 
   * @param {number} index 
   * @returns {string}
   */
  _getBlockKey(name, index) {
    return this._getMetadataKey(name) + index.toString(16).padStart(BLOCK_KEY_DIGITS, '0');
  }
}
