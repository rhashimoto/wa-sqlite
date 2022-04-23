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
 * @property {FileBlock} block0
 * 
 * Extra state for database files:
 * @property {Set<number>} [changed]
 * 
 * Extra state for journal files:
 * @property {number[]} [pageList]
 * @property {number} [cachedPageIndex]
 * @property {Int8Array} [cachedPageEntry]
 */

// Use IndexedDB as a block device.
export class IndexedDbVFS extends VFS.Base {
  name = 'idb';

  /** @type {Map<number, OpenedFileEntry>} */ #mapIdToFile = new Map();
  /** @type {Map<string, OpenedFileEntry>} */ #mapPathToFile = new Map();

  /** @type {IDBContext} */ #idb;
  #webLocks = new WebLocks();

  constructor(idbDatabaseName = 'sqlite') {
    super();
    const idbDatabase = new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open(idbDatabaseName, 5);
      request.addEventListener('upgradeneeded', event => {
        const { oldVersion, newVersion } = event;
        console.log(`Upgrading "${idbDatabaseName}" ${oldVersion} -> ${newVersion}`);
        if (oldVersion !== 0) {
          // A production implementation should upgrade old databases.
          const error = new Error(`incompatible IDB database '${idbDatabaseName}' exists`);
          reject(error);
          throw error;
        }

        const db = request.result;
        db.createObjectStore('blocks', {
          keyPath: ['name', 'index', 'version']
        }).createIndex('version', ['name', 'version']);
      });
      request.addEventListener('success', () => {
        resolve(request.result);
      });
      request.addEventListener('error', () => {
        reject(request.error);
      });
    });
    this.#idb = new IDBContext(idbDatabase);
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
        this.#mapPathToFile.set(file.path, file);

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

            // Write metadata block to IndexedDB. Journal files are not
            // written to IndexedDB.
            if (!this.#isJournal(file)) {
              this.#idb.run('readwrite', ({blocks}) => blocks.put(file.block0));
              await this.#idb.sync();
            }
            // else {
            //   jId = fileId;
            // }
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
        this.#mapPathToFile.delete(file.path);
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
      // Special handling for journal files.
      const file = this.#mapIdToFile.get(fileId);
      if (this.#isJournal(file)) {
        return this.#xReadJournal(file, pData, iOffset);
      }

      const blockSize = file.block0.data.byteLength;
      const blockIndex = (iOffset / blockSize) | 0;
      if (iOffset + pData.size > (blockIndex + 1) * blockSize) {
        // TODO: consider using #xReadGeneral for all cases.
        return this.#xReadGeneral(file, pData, iOffset);
      }
  
      log(`xRead ${file.path} ${pData.size} ${iOffset}`);

      // Check for read past the end of data.
      if (iOffset >= file.block0.fileSize) {
        pData.value.fill(0, pData.size);
        return VFS.SQLITE_IOERR_SHORT_READ;
      }

      // Fetch from IndexedDB.
      /** @type {FileBlock} */ let block = await this.#idb.run('readonly', ({blocks}) => {
        return blocks.get(IDBKeyRange.bound(
          [file.path, blockIndex, file.block0.version],
          [file.path, blockIndex, Infinity]));
      });

      // Block 0 contains file metadata so it is cached.
      if (blockIndex === 0) {
        if (file.block0.version > block.version) {
          // Incoming version is newer.
          file.block0 = block;
        } else {
          block = file.block0;
        }
      }

      const blockOffset = iOffset % blockSize;
      pData.value.set(block.data.subarray(blockOffset, blockOffset + pData.value.length));

      if (blockIndex === 0) {
        file.block0 = block;
      }
      return VFS.SQLITE_OK
    });
  }

  /**
   * @param {OpenedFileEntry} file 
   * @param {*} pData 
   * @param {number} iOffset 
   * @returns {Promise<number>}
   */
  async #xReadGeneral(file, pData, iOffset) {
    log(`xRead (slow path) ${file.path} ${pData.size} ${iOffset}`);

    // Clip the requested read to the file boundary.
    const bgn = Math.min(iOffset, file.block0.fileSize);
    const end = Math.min(iOffset + pData.size, file.block0.fileSize);    

    let bytesRemaining = end - bgn;
    let bufferOffset = 0;
    let fileOffset = iOffset;
    const blockSize = file.block0.data.byteLength;
    while (bytesRemaining) {
      const blockIndex = Math.floor(fileOffset / blockSize);
      const blockOffset = fileOffset % blockSize;
      const blockBytes = Math.min(blockSize - blockOffset, bytesRemaining);

      // Fetch from IndexedDB.
      /** @type {FileBlock} */ let block = await this.#idb.run('readonly', ({blocks}) => {
          return blocks.get(IDBKeyRange.bound(
            [file.path, blockIndex, file.block0.version],
            [file.path, blockIndex, Infinity]
          ));
        }) ?? file.block0;

      // Block 0 contains file metadata so it is cached.
      if (blockIndex === 0) {
        if (file.block0.version > block.version) {
          // Incoming version is newer.
          file.block0 = block;
        } else {
          block = file.block0;
        }
      }

      pData.value.subarray(bufferOffset)
        .set(block.data.subarray(blockOffset, blockOffset + blockBytes));

      bufferOffset += blockBytes;
      fileOffset += blockBytes;
      bytesRemaining -= blockBytes;
    }

    if (bufferOffset !== pData.size) {
      // Zero unused area of read buffer.
      pData.value.subarray(bufferOffset).fill(0, pData.size - bufferOffset);
      return VFS.SQLITE_IOERR_SHORT_READ;
    }
    return VFS.SQLITE_OK;
  }
  
  /**
   * @param {OpenedFileEntry} file 
   * @param {*} pData 
   * @param {number} iOffset 
   * @returns 
   */
  async #xReadJournal(file, pData, iOffset) {
    log(`xRead (journal) ${file.path} ${pData.size} ${iOffset}`);

    const dbPath = this.#getJournalDatabasePath(file);
    const dbFile = this.#mapPathToFile.get(dbPath);
    const journalHeaderView = new DataView(file.block0.data.buffer);
    const sectorSize = journalHeaderView.getUint32(20);
    const entrySize = dbFile.block0.data.length + 8;
    if (iOffset >= sectorSize) {
      // The rollback page entry for this read is regenerated by reading
      // the file. The entry is read with multiple xRead() calls so it
      // is cached for reuse.
      const entryIndex = ((iOffset - sectorSize) / entrySize) | 0;
      const pageIndex = file.pageList[entryIndex];
      if (file.cachedPageIndex !== pageIndex) {
        // Fetch file data. Note that the lower version bound is open,
        // so we don't read data from the current transaction.
        /** @type {FileBlock} */ const block = await this.#idb.run('readonly', ({blocks}) => {
          return blocks.get(IDBKeyRange.bound(
            [dbPath, pageIndex - 1, dbFile.block0.version],
            [dbPath, pageIndex, Infinity],
            true, false));
        });

        // Build a rollback page entry, which contains the page index,
        // the page data, and the page checksum.
        // https://www.sqlite.org/fileformat.html#the_rollback_journal
        const nonce = journalHeaderView.getUint32(12);
        const pageSize = dbFile.block0.data.length;
        this.cachedPageIndex = pageIndex;
        this.cachedPageEntry = new Int8Array(entrySize);
        const cachedPageView = new DataView(this.cachedPageEntry.buffer);
        cachedPageView.setUint32(0, pageIndex);
        this.cachedPageEntry.set(block.data, 4);
        cachedPageView.setUint32(entrySize - 4, this.#checksum(block.data, nonce, pageSize));
      }
    
      // Transfer the requested portion of the page entry.
      const skip = (iOffset - sectorSize) % entrySize;
      pData.value.set(this.cachedPageEntry.subarray(skip, skip + pData.value.length));
    } else {
      // Read journal header.
      pData.value.set(file.block0.data.subarray(iOffset, iOffset + pData.size));
    }

    // for (let i = 0; i < pData.value.length; ++i) {
    //   if (pData.value[i] !== jResult[i]) {
    //     debugger;
    //   }
    // }
    return VFS.SQLITE_OK;
  }

  xWrite(fileId, pData, iOffset) {
    // Special handling for journal files.
    const file = this.#mapIdToFile.get(fileId);
    if (this.#isJournal(file)) {
      return this.#xWriteJournal(file, pData, iOffset);
    }

    // Check if read-modify-write path is needed.
    const blockSize = file.block0.data.byteLength;
    const blockIndex = (iOffset / blockSize) | 0;
    if (iOffset !== blockIndex * blockSize ||
        (iOffset < file.block0.fileSize && pData.size !== blockSize)) {
      return this.#xWriteGeneral(file, pData, iOffset);
    }

    log(`xWrite ${file.path} ${pData.size} ${iOffset}`);

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

    // Mark the block as changed.
    file.changed?.add(blockIndex);
    return VFS.SQLITE_OK;
  }

  /**
   * @param {OpenedFileEntry} file 
   * @param {*} pData 
   * @param {number} iOffset 
   */
  #xWriteGeneral(file, pData, iOffset) {
    return this.handleAsync(async () => {
      log(`xWrite (slow path) ${file.path} ${pData.size} ${iOffset}`);

      let bufferOffset = 0;
      let fileOffset = iOffset;
      let bytesRemaining = pData.value.length;
      const blockSize = file.block0.data.byteLength;
      const lastBlockIndex = Math.floor(file.block0.fileSize / blockSize);
      while (bytesRemaining) {
        const blockIndex = Math.floor(fileOffset / blockSize);
        const blockOffset = fileOffset % blockSize;
        const blockBytes = Math.min(blockSize - blockOffset, bytesRemaining);

        // Read.
        /** @type {FileBlock} */ let block;
        if (blockIndex === 0) {
          block = file.block0;
        } else if (blockIndex <= lastBlockIndex && blockBytes < blockSize) {
          block = await this.#idb.run('readonly', ({blocks}) => {
            return blocks.get(IDBKeyRange.bound(
              [file.path, blockIndex],
              [file.path, blockIndex, Infinity]
            ));
          });
        } else {
          block = {
            name: file.block0.name,
            index: blockIndex,
            version: file.block0.version,
            data: new Int8Array(file.block0.data.length)
          };
        }

        // Modify.
        block.data.set(
          pData.value.subarray(bufferOffset, bufferOffset + blockBytes),
          blockOffset);
        
        // Write (except block 0).
        if (blockIndex) {
          this.#idb.run('readwrite', ({blocks}) => {
            blocks.put(block);
          });
        }

        bufferOffset += blockBytes;
        fileOffset += blockBytes;
        bytesRemaining -= blockBytes;
      }
      
      file.block0.fileSize = Math.max(file.block0.fileSize, iOffset + pData.size);
      return VFS.SQLITE_OK;
    });
  }

  /**
   * @param {OpenedFileEntry} file 
   * @param {*} pData 
   * @param {number} iOffset 
   */
  #xWriteJournal(file, pData, iOffset) {
    return this.handleAsync(async () => {
      log(`xWrite (journal) ${file.path} ${pData.size} ${iOffset}`);

      const dbPath = this.#getJournalDatabasePath(file);
      const dbFile = this.#mapPathToFile.get(dbPath);
      if (iOffset === 0) {
        // Writing the journal header. This is the only journal data saved.
        console.assert(pData.value.length <= file.block0.data.length, 'unexpected write');
        file.block0.data.set(pData.value.subarray(0, file.block0.data.length));

        if (file.block0.data[0]) {
          // This begins a new journalled transaction.
          file.pageList = [];
          file.cachedPageIndex = -1;
          file.cachedPageEntry = null;

          // Decrement the database block0 version (lower number is newer).
          // Subsequent writes to the database will have this version.
          dbFile.block0.version--;
          dbFile.changed = new Set([0]);
        }
      } else {
        // Extract and store page indices.
        // See https://www.sqlite.org/fileformat.html#the_rollback_journal
        const view = new DataView(file.block0.data.buffer);
        const sectorSize = view.getUint32(20);
        const entrySize = dbFile.block0.data.length + 8;
        if ((iOffset - sectorSize) % entrySize === 0) {
          // Store the page index for this page entry. The data is discarded.
          const entryIndex = (iOffset - sectorSize) / entrySize;
          const pageIndex = new DataView(pData.value.buffer, pData.value.byteOffset).getUint32(0);
          file.pageList[entryIndex] = pageIndex;
        }
      }

      file.block0.fileSize = Math.max(file.block0.fileSize, iOffset + pData.size);
      return VFS.SQLITE_OK;
    });
  }

  xTruncate(fileId, iSize) {
    const file = this.#mapIdToFile.get(fileId);
    log(`xTruncate ${file.path} ${iSize}`);

    file.block0.fileSize = iSize;

    // Update metadata and delete all blocks beyond the file size. SQLite
    // calls this on a database file outside of any journal lifetime so it
    // shouldn't remove that the journal might need.
    const block0 = Object.assign({}, file.block0);
    const lastBlockIndex = Math.floor(file.block0.fileSize / file.block0.data.length);
    this.#idb.run('readwrite', ({blocks})=> {
      blocks.put(block0);
      blocks.delete(IDBKeyRange.bound(
        [file.path, lastBlockIndex, Infinity],
        [file.path, Infinity, Infinity]));
    });
    return VFS.SQLITE_OK;
  }

  xSync(fileId, flags) {
    return this.handleAsync(async () => {
      const file = this.#mapIdToFile.get(fileId);
      log(`xSync ${file.path} ${flags}`);

      const version = file.block0.version;
      if (!this.#isJournal(file)) {
        this.#idb.run('readwrite', ({blocks})=> {
          blocks.put(file.block0);
        });

        // TODO: Consider a flag to optionally skip this sync to favor
        // performance over durability. This would be safe only when
        // using an exclusive lock.
        await this.#idb.sync();
      }

      if (file.changed?.size) {
        // Purge superceded blocks.
        const changed = file.changed;
        file.changed = null;
        const purge = () => {
          this.#idb.run('readwrite', ({blocks}) => {
            for (const index of changed) {
              blocks.delete(IDBKeyRange.bound(
                [file.path, index, version],
                [file.path, index, Infinity],
                true, false));
            }
          });
        }
        if (globalThis.requestIdleCallback) {
          globalThis.requestIdleCallback(purge);
        } else {
          purge();
        }
      }
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

      // Acquire the lock.
      const result = this.#webLocks.lock(file.path, flags);
      if (flags === VFS.SQLITE_LOCK_RESERVED) {
        // Clear blocks from abandoned transactions, i.e. blocks with
        // lower (newer) versions than block 0. This is done on reserved
        // locking which is after changes by other connections can be made,
        // and before a journal file is initialized.
        this.#idb.run('readwrite', async ({blocks}) => {
          const dbPath = this.#getJournalDatabasePath(file);
          const dbFile = this.#mapPathToFile.get(dbPath);
          const keys = await blocks.index('version').getAllKeys(IDBKeyRange.bound(
            [dbPath],
            [dbPath, dbFile.block0.version],
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
          [path, 0],
          [path, Infinity, Infinity]));
      });
      if (syncDir) {
        await complete;
      }
      return VFS.SQLITE_OK;
    });
  }

  /**
   * @param {OpenedFileEntry} file 
   */
  #isJournal(file) {
    return file.flags & (VFS.SQLITE_OPEN_MAIN_JOURNAL | VFS.SQLITE_OPEN_TEMP_JOURNAL)
  }

  /**
   * @param {OpenedFileEntry} file 
   */
  #getJournalDatabasePath(file) {
    return file.path.replace(/-journal$/, '');
  }

  /**
   * @param {Int8Array} data 
   * @param {number} nonce 
   * @param {number} pageSize 
   * @returns {number}
   */
  #checksum(data, nonce, pageSize) {
    let result = nonce;
    let x = pageSize - 200;
    while (x > 0) {
      const value = data[x];
      result += value >= 0 ? value : value + 256;
      x -= 200;
    }
    return result;
  }
}
