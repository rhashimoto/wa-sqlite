import * as VFS from '../VFS.js';
import { IDBContext } from './IDBContext.js';
import { WebLocks } from './WebLocks.js';

function log(...args) {
  // console.debug(...args);
}

const DEFAULT_OPTIONS = { durability: "default" };

/**
 * @typedef FileBlock
 * @property {string} name
 * @property {number} offset negative of position in file
 * @property {Int8Array} data
 */

/**
 * @typedef OpenedFileEntry
 * @property {string} path
 * @property {number} flags
 * @property {number} fileSize
 */

/**
 * This is an IndexedDB VFS with very simple logic. It makes two assumptions
 * on how SQLite will call it:
 * 
 *  1. Any overwritten data uses the same write offset and size.
 *  2. Any read requests data from only one write.
 * 
 * It uses one trick - it stores each write as-is into IndexedDB using
 * the negative of the file offset as part of the key. This bypasses the
 * typical conversion to and from fixed-size blocks.
 */
export class IDBMinimalVFS extends VFS.Base {
  /** @type {Map<number, OpenedFileEntry>} */ #mapIdToFile = new Map();
  /** @type {IDBContext} */ #idb;
  #webLocks = new WebLocks();
  #options;

  constructor(idbDatabaseName = 'wa-sqlite', options = DEFAULT_OPTIONS) {
    super();
    this.name = idbDatabaseName;
    this.#options = options;
    this.#idb = new IDBContext(openDatabase(idbDatabaseName), options);
  }

  xOpen(name, fileId, flags, pOutFlags) {
    return this.handleAsync(async () => {
      if (name === null) name = `null_${fileId}`;
      log(`xOpen ${name} ${fileId} 0x${flags.toString(16)}`);

      try {
        const url = new URL(name, 'http://localhost/');
        const file = {
          path: url.pathname,
          flags,
          fileSize: 0
        };
        this.#mapIdToFile.set(fileId, file);

        // Read the last block to get the file size.
        const lastBlock = await this.#idb.run('readonly', ({blocks}) => {
          return blocks.get(this.#bound(file, -Infinity));
        });
        if (lastBlock) {
          file.fileSize = lastBlock.data.length - lastBlock.offset;
        } else if (flags & VFS.SQLITE_OPEN_CREATE) {
          const block = {
            path: file.path,
            offset: 0,
            data: new Int8Array(0),
          };
          this.#idb.run('readwrite', ({blocks}) => blocks.put(block));
        } else {
          throw new Error(`file not found: ${file.path}`);
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
            blocks.delete(this.#bound(file, -Infinity));
          });
        }
      }
      return VFS.SQLITE_OK;
    });
  }

  xRead(fileId, pData, iOffset) {
    return this.handleAsync(async () => {
      const file = this.#mapIdToFile.get(fileId);
      log(`xRead ${file.path} ${pData.value.length} ${iOffset}`);

      if (iOffset >= file.fileSize) {
        pData.value.fill(0, pData.value.length);
        return VFS.SQLITE_IOERR_SHORT_READ;
      }

      try {
        /** @type {FileBlock} */
        const block = await this.#idb.run('readonly', ({blocks}) => {
          return blocks.get(this.#bound(file, -iOffset));
        });

        const blockOffset = iOffset + block.offset;
        pData.value.set(block.data.subarray(blockOffset, blockOffset + pData.value.length));
        return VFS.SQLITE_OK;
      } catch (e) {
        console.error('assumptions violated', e);
        return VFS.SQLITE_IOERR;
      }
    });
  }

  xWrite(fileId, pData, iOffset) {
    const file = this.#mapIdToFile.get(fileId);
    log(`xWrite ${file.path} ${pData.value.length} ${iOffset}`);

    const block = {
      path: file.path,
      offset: -iOffset,
      data: pData.value.slice()
    };
    this.#idb.run('readwrite', ({blocks}) => blocks.put(block));
    file.fileSize = Math.max(file.fileSize, iOffset + pData.value.length);
    return VFS.SQLITE_OK;
  }

  xTruncate(fileId, iSize) {
    const file = this.#mapIdToFile.get(fileId);
    log(`xTruncate ${file.path} ${iSize}`);

    file.fileSize = iSize;
    this.#idb.run('readwrite', ({blocks})=> {
      blocks.delete(this.#bound(file, -Infinity, -iSize));
      if (iSize === 0) {
        blocks.put({
          path: file.path,
          offset: 0,
          data: new Int8Array(0)
        })
      }
    });
    return VFS.SQLITE_OK;
  }

  xSync(fileId, flags) {
    return this.handleAsync(async () => {
      const file = this.#mapIdToFile.get(fileId);
      log(`xSync ${file.path} ${flags}`);

      if (this.#options.durability !== 'relaxed') await this.#idb.sync();
      return VFS.SQLITE_OK;
    });
  }

  xFileSize(fileId, pSize64) {
    const file = this.#mapIdToFile.get(fileId);
    log(`xFileSize ${file.path}`);

    pSize64.set(file.fileSize)
    return VFS.SQLITE_OK;
  }

  xLock(fileId, flags) {
    return this.handleAsync(async () => {
      const file = this.#mapIdToFile.get(fileId);
      log(`xLock ${file.path} ${flags}`);

      await this.#webLocks.lock(file.path, flags);
      return VFS.SQLITE_OK;
    });
  }

  xUnlock(fileId, flags) {
    return this.handleAsync(async () => {
      const fileEntry = this.#mapIdToFile.get(fileId);
      log(`xUnlock ${fileEntry.path} ${flags}`);

      await this.#webLocks.unlock(fileEntry.path, flags);
      return VFS.SQLITE_OK;
    });
  }

  xSectorSize(fileId) {
    log('xSectorSize');
    return 512;
  }

  xDeviceCharacteristics(fileId) {
    log('xDeviceCharacteristics');
    return VFS.SQLITE_IOCAP_SAFE_APPEND |
           VFS.SQLITE_IOCAP_SEQUENTIAL |
           VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN;
  }

  xAccess(name, flags, pResOut) {
    return this.handleAsync(async () => {
      const path = new URL(name, 'file://localhost/').pathname;
      log(`xAccess ${path} ${flags}`);

      // Check if any block exists.
      const key = await this.#idb.run('readonly', ({blocks}) => {
        return blocks.getKey(this.#bound({path}, -Infinity));
      });
      pResOut.set(key ? 1 : 0);
      return VFS.SQLITE_OK;
    });
  }

  xDelete(name, syncDir) {
    return this.handleAsync(async () => {
      const path = new URL(name, 'file://localhost/').pathname;
      log(`xDelete ${path} ${syncDir}`);

      const complete = this.#idb.run('readwrite', ({blocks}) => {
        return blocks.delete(this.#bound({path}, -Infinity));
      });
      if (syncDir) await complete;
      return VFS.SQLITE_OK;
    });
  }

  #bound(file, begin, end = 0) {
    return IDBKeyRange.bound([file.path, begin], [file.path, end]);
  }
}

function openDatabase(idbDatabaseName) {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(idbDatabaseName, 1);
    request.addEventListener('upgradeneeded', () => {
      request.result.createObjectStore('blocks', { keyPath: ['path', 'offset'] });
    });
    request.addEventListener('success', () => {
      resolve(request.result);
    });
    request.addEventListener('error', () => {
      reject(request.error);
    });
  });
}