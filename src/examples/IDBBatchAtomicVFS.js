// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
import * as VFS from '../VFS.js';
import { WebLocks } from './WebLocks.js';
import { IDBContext } from './IDBContext.js';

const SECTOR_SIZE = 512;

/**
 * @typedef VFSOptions
 * @property {"default"|"strict"|"relaxed"} [durability]
 * @property {"deferred"|"manual"} [purge]
 * @property {number} [purgeAtLeast]
 */

/** @type {VFSOptions} */
const DEFAULT_OPTIONS = {
  durability: "default",
  purge: "deferred",
  purgeAtLeast: 16
};

function log(...args) {
  // console.debug(...args);
}

/**
 * @typedef FileBlock
 * @property {string} path
 * @property {number} offset negative of position in file
 * @property {number} version
 * @property {Int8Array} data
 *
 * Block 0 only.
 * @property {number} [fileSize]
*/

/**
 * @typedef OpenedFileEntry
 * @property {string} path
 * @property {number} flags
 * @property {FileBlock} block0
 * 
 * Extra state for batch atomic write.
 * @property {Set<number>} [changedPages]
 */

// Use IndexedDB as a versioned block device. Each object in IndexedDB holds
// a fixed-size block of file data (block 0 for each file contains some
// extra metadata).
//
// There can be multiple versions of a file block. Newer versions have lower
// numbers (e.g. version -50 is newer than version -20), which makes it
// easier to get the latest version using IndexedDB.
export class IDBBatchAtomicVFS extends VFS.Base {
  #options;
  /** @type {Map<number, OpenedFileEntry>} */ #mapIdToFile = new Map();
  /** @type {Map<string, OpenedFileEntry>} */ #mapPathToFile = new Map();

  /** @type {IDBContext} */ #idb;
  #webLocks = new WebLocks();
  /** @type {Set<string>} */ #pendingPurges = new Set();

  constructor(idbDatabaseName = 'wa-sqlite', options = DEFAULT_OPTIONS) {
    super();
    this.name = idbDatabaseName;
    this.#options = Object.assign({}, DEFAULT_OPTIONS, options);
    this.#idb = new IDBContext(openDatabase(idbDatabaseName), {
      durability: this.#options.durability
    });
  }

// /** @type {Map<number, Int8Array>} */ mapIdToAlt = new Map();
// altWrite(fileId, pData, iOffset) {
//   let alt = this.mapIdToAlt.get(fileId) ?? new Int8Array(0);
//   let maybeFileSize = pData.value.length + iOffset;
//   if (maybeFileSize > alt.length) {
//     const newAlt = new Int8Array(maybeFileSize);
//     newAlt.set(alt);
//     this.mapIdToAlt.set(fileId, alt = newAlt);
//   }
//   alt.set(pData.value, iOffset);
// }
// altRead(fileId, pData, iOffset) {
//   const alt = this.mapIdToAlt.get(fileId) ?? new Int8Array(0);
//   const altData = alt.subarray(iOffset, iOffset + pData.value.length);
//   if (Array.prototype.some.call(altData, (b, i) => b !== pData.value[i])) {
//     console.error(new Error('altRead mismatch'));
//     // debugger;
//     // throw new Error('mismatch');
//   }
// }
// altTruncate(fileId, iSize) {
//   const alt = this.mapIdToAlt.get(fileId) ?? new Int8Array(0);
//   const newAlt = alt.slice(0, iSize);
//   this.mapIdToAlt.set(fileId, newAlt);
// }

  xOpen(name, fileId, flags, pOutFlags) {
    return this.handleAsync(async () => {
      if (name === null) name = `null_${fileId}`;
      log(`xOpen ${name} 0x${fileId.toString(16)} 0x${flags.toString(16)}`);

      try {
        // Filenames can be URLs, possibly with query parameters.
        const url = new URL(name, 'http://localhost/');
        const file = {
          path: url.pathname,
          flags,
          block0: null
        };
        this.#mapIdToFile.set(fileId, file);
        this.#mapPathToFile.set(file.path, file);

        // Read the first block, which also contains the file metadata.
        file.block0 = await this.#idb.run('readonly', ({blocks}) => {
          return blocks.get(IDBKeyRange.bound(
            [file.path, 0],
            [file.path, 0, Infinity]))
        });
        if (!file.block0) {
          // File doesn't exist, create if requested.
          if (flags & VFS.SQLITE_OPEN_CREATE) {
            file.block0 = {
              path: file.path,
              offset: 0,
              version: 0,
              data: new Int8Array(0),
              fileSize: 0
            };

            // Write metadata block to IndexedDB.
            this.#idb.run('readwrite', ({blocks}) => blocks.put(file.block0));
            await this.#idb.sync();
          } else {
            throw new Error(`file not found: ${file.path}`);
          }
        }

        pOutFlags.set(flags & VFS.SQLITE_OPEN_READONLY);
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
        this.#mapPathToFile.delete(file.path);
        if (file.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
          this.#idb.run('readwrite', ({blocks}) => {
            blocks.delete(IDBKeyRange.bound(
              [file.path],
              [file.path, []],
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
      log(`xRead ${file.path} ${pData.value.length} ${iOffset}`);

      try {
        // Read as many blocks as necessary to satisfy the read request.
        // Usually a read fits within a single write but there is at least
        // one case - rollback after journal spill - where reads cross
        // write boundaries.
        let bufferOffset = 0;
        while (bufferOffset < pData.value.length) {
          // Fetch the IndexedDB block for this file location. Use the
          // cached block 0 if in a batch atomic transaction.
          const fileOffset = iOffset + bufferOffset;
          /** @type {FileBlock} */
          const block = (file.changedPages && fileOffset < file.block0.data.length) ?
            file.block0 :
            await this.#idb.run('readonly', ({blocks}) => {
              return blocks.get(this.#bound(file, -fileOffset));
            });
          if (block.offset === 0) file.block0 = block;

          if (!block || block.data.length - block.offset <= fileOffset) {
            pData.value.fill(0, bufferOffset);
            return VFS.SQLITE_IOERR_SHORT_READ;
          }

          const buffer = pData.value.subarray(bufferOffset);
          const blockOffset = fileOffset + block.offset;
          const nBytesToCopy = Math.min(
            Math.max(block.data.length - blockOffset, 0), // source bytes
            buffer.length);                               // destination bytes
          buffer.set(block.data.subarray(blockOffset, blockOffset + nBytesToCopy));
          bufferOffset += nBytesToCopy;
        }
        // this.altRead(fileId, pData, iOffset);
        return VFS.SQLITE_OK;
      } catch (e) {
        console.error(e);
        return VFS.SQLITE_IOERR;
      }
    });
  }

  xWrite(fileId, pData, iOffset) {
    const file = this.#mapIdToFile.get(fileId);
    log(`xWrite ${file.path} ${pData.value.length} ${iOffset}`);
    // this.altWrite(fileId, pData, iOffset);

    // Convert the write directly into an IndexedDB object.
    file.block0.fileSize = Math.max(file.block0.fileSize, iOffset + pData.value.length);
    const block = iOffset === 0 ? file.block0 : {
      path: file.path,
      offset: -iOffset,
      version: file.block0.version,
      data: null
    };
    block.data = pData.value.slice();

    if (file.changedPages) {
      // Batch atomic write.
      file.changedPages.add(-iOffset);

      // Defer writing block 0.
      if (iOffset !== 0) {
        this.#idb.run('readwrite', ({blocks}) => blocks.put(block));
      }
    } else {
      // Not a batch atomic write.  
      this.#idb.run('readwrite', ({blocks}) => blocks.put(block));
    }
    return VFS.SQLITE_OK;
  }

  xTruncate(fileId, iSize) {
    const file = this.#mapIdToFile.get(fileId);
    log(`xTruncate ${file.path} ${iSize}`);

    Object.assign(file.block0, {
      fileSize: iSize,
      data: iSize !== 0 ? file.block0.data : new Int8Array(0)
    });

    // Update metadata and delete all blocks beyond the file size. We
    // expect SQLite to call this outside any journal lifetime.
    const block0 = Object.assign({}, file.block0);
    this.#idb.run('readwrite', ({blocks})=> {
      blocks.delete(this.#bound(file, -Infinity, -iSize));
      blocks.put(block0);
    });
    // this.altTruncate(fileId, iSize);
    return VFS.SQLITE_OK;
  }

  xSync(fileId, flags) {
    const file = this.#mapIdToFile.get(fileId);
    log(`xSync ${file.path} ${flags}`);

    if (this.#options.durability !== 'relaxed') {
      return this.handleAsync(async () => {
        await this.#idb.sync();
        return VFS.SQLITE_OK;
      });
    }
    return VFS.SQLITE_OK;
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

      // Acquire the lock.
      const result = this.#webLocks.lock(file.path, flags);
      if (flags === VFS.SQLITE_LOCK_RESERVED) {
        // Clear blocks from abandoned transactions, i.e. blocks with
        // lower (newer) versions than block 0. This is done on reserved
        // locking which is after changes by other connections can be made,
        // and before a journal file is initialized.
        this.#idb.run('readwrite', async ({blocks}) => {
          const keys = await blocks.index('version').getAllKeys(IDBKeyRange.bound(
            [file.path],
            [file.path, file.block0.version],
            false, true));
          for (const key of keys) {
            blocks.delete(key);
          }
        });
      }
      return result;
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
    log('xSectorSize');
    return SECTOR_SIZE;
  }

  xDeviceCharacteristics(fileId) {
    log('xDeviceCharacteristics');
    return VFS.SQLITE_IOCAP_BATCH_ATOMIC |
           VFS.SQLITE_IOCAP_SAFE_APPEND |
           VFS.SQLITE_IOCAP_SEQUENTIAL |
           VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN;
    return VFS.SQLITE_IOCAP_SAFE_APPEND |
           VFS.SQLITE_IOCAP_SEQUENTIAL |
           VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN;
  }

  xFileControl(fileId, op, pArg) {
    const file = this.#mapIdToFile.get(fileId);
    log(`xFileControl ${file.path} ${op}`);

    switch (op) {
      case 31: // SQLITE_FCNTL_BEGIN_ATOMIC_WRITE
        file.block0.version--;
        file.changedPages = new Set();
        return VFS.SQLITE_OK;

      case 32: // SQLITE_FCNTL_COMMIT_ATOMIC_WRITE
        // Don't accept changes to the page size.
        if (file.block0.fileSize) {
          const view = new DataView(file.block0.data.buffer, file.block0.data.byteOffset);
          const pageSize = view.getUint16(16);
          if (pageSize !== file.block0.data.length) {
            console.error('unsupported page size change');
            return VFS.SQLITE_IOERR;
          }
        }

        const block0 = Object.assign({}, file.block0);
        block0.data = block0.data.slice();
        const changedPages = file.changedPages;
        file.changedPages = null;
        this.#idb.run('readwrite', async ({blocks})=> {
          // Write block 0 to commit the new version.
          blocks.put(block0);

          // Blocks to purge are saved in a special IndexedDB object with
          // an "index" of "purge".
          const purgeBlock = await blocks.get([file.path, 'purge', 0]) ?? {
            path: file.path,
            offset: 'purge',
            version: 0,
            data: new Map()
          };

          for (const pageIndex of changedPages) {
            purgeBlock.data.set(pageIndex, block0.version);
          }

          blocks.put(purgeBlock);
          this.#maybePurge(file.path, purgeBlock.data.size);
        });
        return VFS.SQLITE_OK;

      case 33: // SQLITE_FCNTL_ROLLBACK_ATOMIC_WRITE
        // Restore original state.
        file.changedPages = null;
        return this.handleAsync(async () => {
          await this.#idb.run('readonly', async ({blocks}) => {
            file.block0 = await blocks.get([file.path, 0, file.block0.version + 1]);
          });
          return VFS.SQLITE_OK;
        });
    }
    return VFS.SQLITE_NOTFOUND;
  }

  xAccess(name, flags, pResOut) {
    return this.handleAsync(async () => {
      const path = new URL(name, 'file://localhost/').pathname;
      log(`xAccess ${path} ${flags}`);

      // Check if block 0 exists.
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
      const path = new URL(name, 'file://localhost/').pathname;
      log(`xDelete ${path} ${syncDir}`);

      const complete = this.#idb.run('readwrite', ({blocks}) => {
        return blocks.delete(IDBKeyRange.bound(
          [path],
          [path, []]));
      });
      if (syncDir) {
        await complete;
      }
      return VFS.SQLITE_OK;
    });
  }

  /**
   * Purge obsolete blocks from a database file.
   * @param {string} name 
   */
  purge(name) {
    const start = Date.now();
    const path = new URL(name, 'file://localhost/').pathname;
    this.#idb.run('readwrite', async ({blocks}) => {
      const purgeBlock = await blocks.get([path, 'purge', 0]);
      if (purgeBlock) {
        for (const [pageOffset, version] of purgeBlock.data) {
          blocks.delete(IDBKeyRange.bound(
            [path, pageOffset, version],
            [path, pageOffset, Infinity],
            true, false));
        }
        await blocks.delete([path, 'purge', 0]);
      }
      log(`purge ${name} ${purgeBlock?.data.size ?? 0} pages in ${Date.now() - start} ms`);
    });
  }

  /**
   * Conditionally schedule a purge task.
   * @param {string} name 
   * @param {number} nPages 
   */
  #maybePurge(name, nPages) {
    if (this.#options.purge === 'manual' ||
        this.#pendingPurges.has(name) ||
        nPages < this.#options.purgeAtLeast) {
      // No purge needed.
      return;
    }
    
    if (globalThis.requestIdleCallback) {
      globalThis.requestIdleCallback(() => {
        this.purge(name);
        this.#pendingPurges.delete(name)
      });
    } else {
      setTimeout(() => {
        this.purge(name);
        this.#pendingPurges.delete(name)
      });
    }
    this.#pendingPurges.add(name);
  }

  #bound(file, begin, end = 0) {
    // Fetch newest block 0. For other blocks, use block 0 version.
    const version = Math.abs(begin) < file.block0.data.length ?
      -Infinity :
      file.block0.version;
    return IDBKeyRange.bound(
      [file.path, begin, version],
      [file.path, end, Infinity]);
  }
}

function openDatabase(idbDatabaseName) {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(idbDatabaseName, 5);
    request.addEventListener('upgradeneeded', function() {
      const blocks = request.result.createObjectStore('blocks', {
        keyPath: ['path', 'offset', 'version']
      });
      blocks.createIndex('version', ['path', 'version']);
    });
    request.addEventListener('success', () => {
      resolve(request.result);
    });
    request.addEventListener('error', () => {
      reject(request.error);
    });
  });
}
