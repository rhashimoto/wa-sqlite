// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
import * as VFS from '../VFS.js';
import { WebLocks } from './WebLocks.js';
import { IDBContext } from './IDBContext.js';

const BLOCK_SIZE = 4096;

function log(...args) {
  // console.debug(...args);
}

/**
 * @typedef FileBlock
 * @property {string} name
 * @property {number} index
 * @property {number} version
 * @property {Int8Array} data
 *
 * @property {number} [fileSize]
*/

/**
 * @typedef OpenedFileEntry
 * @property {string} path
 * @property {number} flags
 * @property {FileBlock} block0;
 */

// Use IndexedDB as a block device.
export class IndexedDbVFS extends VFS.Base {
  name = 'idb';

  /** @type {Map<number, OpenedFileEntry>} */ #mapIdToFile = new Map();

  /** @type {IDBContext} */ #idb;
  #webLocks = new WebLocks();

  constructor(idbDatabaseName = 'sqlite') {
    super();
    this.#idb = new IDBContext(idbDatabaseName);
  }

  xOpen(name, fileId, flags, pOutFlags) {
    return this.handleAsync(async () => {
      log(`xOpen ${name} ${fileId} 0x${flags.toString(16)}`);

      try {
        const url = new URL(name, 'http://localhost/');
        const file = {
          path: url.pathname,
          flags,
          block0: null
        };
        this.#mapIdToFile.set(fileId, file);

        // Read the first block, which also contains the file metadata.
        file.block0 = await this.#idb.run('readonly', ({blocks}) => {
          return blocks.get(IDBKeyRange.bound(
            [file.path, 0, -Infinity],
            [file.path, 0, Infinity]))
        });
        if (!file.block0) {
          // File doesn't exist, create if requested.
          if (flags & VFS.SQLITE_OPEN_CREATE) {
            file.block0 = {
              name: file.path,
              index: 0,
              version: 0,
              data: new Int8Array(BLOCK_SIZE),

              fileSize: 0
            };
            this.#idb.run('readwrite', ({blocks}) => blocks.put(file.block0));
            await this.#idb.sync();
          } else {
            throw new Error(`file not found: ${file.path}`);
          }
        }
        pOutFlags.set(0);
        return VFS.SQLITE_OK;
      } catch (e) {
        console.error(e.message);
        return VFS.SQLITE_CANTOPEN;
      }
    });
  }

  xClose(fileId) {
    return this.handleAsync(async () => {
      const file = this.#mapIdToFile.get(fileId);
      if (file) {
        log(`xClose ${file.path}`);

        this.#mapIdToFile.delete(fileId);
        if (file.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
          this.#idb.run('readwrite', ({blocks}) => {
            blocks.delete(IDBKeyRange.bound(
              [file.path, 0],
              [file.path, Infinity],
            ))
          });
        }
      }
      return VFS.SQLITE_OK;
    });
  }

  xRead(fileId, pData, iOffset) {
    return this.handleAsync(async () => {
      const file = this.#mapIdToFile.get(fileId);
      log(`xRead ${file.path} ${pData.size} ${iOffset}`);

      // We believe SQLite never reads across a block boundary.
      const blockSize = file.block0.data.byteLength;
      const blockIndex = (iOffset / blockSize) | 0;
      if (iOffset + pData.size > (blockIndex + 1) * blockSize) {
        console.assert(false, 'unexpected read across block boundary');
        return VFS.SQLITE_IOERR;
      }
  
      // Check for read past the end of data.
      if (iOffset >= file.block0.fileSize) {
        pData.value.fill(0, pData.size);
        return VFS.SQLITE_IOERR_SHORT_READ;
      }

      // Fetch the file data.
      /** @type {FileBlock} */ const block = blockIndex === 0 ?
        file.block0 :
        await this.#idb.run('readonly', ({blocks}) => {
          return blocks.get(IDBKeyRange.bound(
            [file.path, blockIndex, file.block0.version],
            [file.path, blockIndex, Infinity]));
        });
      const blockOffset = iOffset % blockSize;
      pData.value.set(block.data.subarray(blockOffset, blockOffset + pData.value.length));
      return VFS.SQLITE_OK
    });
  }

  xWrite(fileId, pData, iOffset) {
    const file = this.#mapIdToFile.get(fileId);
    log(`xWrite ${file.path} ${pData.size} ${iOffset}`);

    // SQLite writes full blocks so we never do a read-modify-write.
    const blockSize = file.block0.data.byteLength;
    const blockIndex = (iOffset / blockSize) | 0;
    if (iOffset !== blockIndex * blockSize || pData.size !== blockSize) {
      console.assert(false, 'unexpected write parameters');
      return VFS.SQLITE_IOERR;
    }

    // Extend the file when writing past the end.
    file.block0.fileSize = Math.max(file.block0.fileSize, iOffset + pData.size);

    // Copy data into a block.
    /** @type {FileBlock} */ const block = blockIndex === 0 ?
      file.block0 :
      {
        name: file.block0.name,
        index: blockIndex,
        version: file.block0.version,
        data: new Int8Array(file.block0.data.length)
      };
    block.data.set(pData.value);

    // Store the block to IndexedDB, except not block 0 yet. Block 0
    // contains the published file version so it isn't written until
    // the transaction is complete.
    if (blockIndex) {
      this.#idb.run('readwrite', ({blocks}) => {
        blocks.put(block);
      });
    }
    return VFS.SQLITE_OK;
  }

  xTruncate(fileId, iSize) {
    const file = this.#mapIdToFile.get(fileId);
    log(`xTruncate ${file.path} ${iSize}`);

    file.block0.fileSize = iSize;
    return VFS.SQLITE_OK;
  }

  xSync(fileId, flags) {
    return this.handleAsync(async () => {
      const file = this.#mapIdToFile.get(fileId);
      log(`xSync ${file.path} ${flags}`);

      await this.#idb.run('readwrite', ({blocks})=> {
        return blocks.put(file.block0);
      });
      await this.#idb.sync();
      return VFS.SQLITE_OK;
    });
  }

  xFileSize(fileId, pSize64) {
    const file = this.#mapIdToFile.get(fileId);
    log(`xFileSize ${file.path}`);

    pSize64.set(file.block0.fileSize)
    return VFS.SQLITE_OK;
  }

  xLock(fileId, flags) {
    return this.handleAsync(async () => {
      const file = this.#mapIdToFile.get(fileId);
      log(`xLock ${file.path} ${flags}`);

      return this.#webLocks.lock(file.path, flags);
    });
  }

  xUnlock(fileId, flags) {
    return this.handleAsync(async () => {
      const file = this.#mapIdToFile.get(fileId);
      log(`xUnlock ${file.path} ${flags}`);
      
      return this.#webLocks.unlock(file.path, flags);
    });
  }

  xSectorSize(fileId) {
    log('xSectorSize', BLOCK_SIZE);
    return BLOCK_SIZE;
  }

  xDeviceCharacteristics(fileId) {
    log('xDeviceCharacteristics');
    return VFS.SQLITE_IOCAP_SAFE_APPEND |
           VFS.SQLITE_IOCAP_SEQUENTIAL |
           VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN;
  }

  xAccess(name, flags, pResOut) {
    return this.handleAsync(async () => {
      log(`xAccess ${name} ${flags}`);

      // Check if block 0 exists.
      const path = new URL(name, 'file://localhost/').pathname;
      const key = await this.#idb.run('readonly', ({blocks}) => {
        return blocks.getKey(IDBKeyRange.bound(
          [path, 0],
          [path, 0, Infinity]));
      });
      pResOut.set(key ? 1 : 0);
      return VFS.SQLITE_OK;
    });
  }

  xDelete(name, syncDir) {
    return this.handleAsync(async () => {
      log(`xDelete ${name} ${syncDir}`);

      const path = new URL(name, 'file://localhost/').pathname;
      const complete = this.#idb.run('readwrite', ({blocks}) => {
        return blocks.delete(IDBKeyRange.bound(
          [path, 0],
          [path, Infinity, Infinity]));
      });
      if (syncDir) {
        await complete;
      }
      return VFS.SQLITE_OK;
    });
  }
}

function wrapRequest(request, listeners) {
  return new Promise(function(resolve, reject) {
    for (const [key, listener] of Object.entries(listeners)) {
      request.addEventListener(key, listener);
    }
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}