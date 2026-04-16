import { FacadeVFS } from "../FacadeVFS.js";
import * as VFS from '../VFS.js';
import { LazyLock } from "./LazyLock.js";
import { WriteAhead } from "./WriteAhead.js";

const LIBRARY_FILES_ROOT = '.wa-sqlite';
const DEFAULT_TEMP_FILES = 6;

const finalizationRegistry = new FinalizationRegistry((/** @type {() => void} */ f) => f());

/**
 * @typedef FileEntry
 * @property {string} zName
 * @property {number} flags
 * @property {FileSystemSyncAccessHandle} [accessHandle]

 * Main database file properties:
 * @property {*} [retryResult]
 * @property {FileSystemSyncAccessHandle[]} [waHandles]
 * 
 * @property {'reserved'|'exclusive'|null} [writeHint]
 * @property {'normal'|'exclusive'} [lockingMode]
 * @property {number} [lockState] SQLITE_LOCK_*
 * @property {LazyLock} [readLock]
 * @property {LazyLock} [writeLock]
 * @property {'none'|'read'|'write'|'readwrite'} [useLazyLock]
 * @property {number} [timeout]
 * @property {0|1|2|3} [synchronous]
 * @property {number?} [pageSize]
 * @property {boolean} [overwrite]
 * 
 * @property {WriteAhead} [writeAhead]
 */

/**
 * @typedef OPFSWriteAheadOptions
 * @property {number} [nTmpFiles]
 * @property {number} [autoCheckpoint]
 * @property {number} [backstopInterval]
 */

export class OPFSWriteAheadVFS extends FacadeVFS {
  lastError = null;
  log = null;
  
  /** @type {Map<number, FileEntry>} */ mapIdToFile = new Map();
  /** @type {Map<string, FileEntry>} */ mapPathToFile = new Map();

  /** @type {Map<string, FileSystemSyncAccessHandle>} */ boundTempFiles = new Map();
  /** @type {Set<FileSystemSyncAccessHandle>} */ unboundTempFiles = new Set();
  /** @type {OPFSWriteAheadOptions} */ options = {
    nTmpFiles: DEFAULT_TEMP_FILES
  };

  _ready;

  static async create(name, module, options) {
    const vfs = new OPFSWriteAheadVFS(name, module);
    Object.assign(vfs.options, options);
    await vfs.isReady();
    return vfs;
  }

  constructor(name, module) {
    super(name, module);
    this._ready = (async () => {
      // Ensure the library files root directory exists.
      let dirHandle = await navigator.storage.getDirectory();
      dirHandle = await dirHandle.getDirectoryHandle(LIBRARY_FILES_ROOT, { create: true });

      // Clean up any stale session directories.
      // @ts-ignore
      for await (const name of dirHandle.keys()) {
        if (name.startsWith('.session-')) {
          // Acquire a lock on the session directory to ensure it is not in use.
          await navigator.locks.request(name, { ifAvailable: true }, async lock => {
            if (lock) {
              // This directory is not in use.
              try {
                await dirHandle.removeEntry(name, { recursive: true });
              } catch (e) {
                // Ignore errors, will try again next time.
              }
            }
          });
        }
      }

      // Create our session directory.
      const dirName = `.session-${Math.random().toString(16).slice(2)}`;
      await new Promise(resolve => {
        navigator.locks.request(dirName, () => {
          // @ts-ignore
          resolve();
          return new Promise(release => {
            // @ts-ignore
            finalizationRegistry.register(this, release);
          });
        });
      });
      dirHandle = await dirHandle.getDirectoryHandle(dirName, { create: true });

      // Create temporary files.
      for (let i = 0; i < this.options.nTmpFiles; i++) {
        const fileHandle= await dirHandle.getFileHandle(i.toString(), { create: true });
        const accessHandle = await fileHandle.createSyncAccessHandle();
        finalizationRegistry.register(this, () => accessHandle.close());
        this.unboundTempFiles.add(accessHandle);
      }
    })();
  }

  isReady() {
    return Promise.all([super.isReady(), this._ready]).then(() => true);
  }

 /**
   * @param {string?} zName 
   * @param {number} fileId 
   * @param {number} flags 
   * @param {DataView} pOutFlags 
   * @returns {number}
   */
  jOpen(zName, fileId, flags, pOutFlags) {
    try {
      if (zName === null) {
        // Generate a temporary filename. This will only be used as a
        // key to map to a pre-opened temporary file access handle.
        zName = Math.random().toString(16).slice(2);
      }

      const file = this.mapPathToFile.get(zName) ?? {
        zName,
        flags,
        retryResult: null,
      };
      this.mapPathToFile.set(zName, file);

      if (flags & VFS.SQLITE_OPEN_MAIN_DB) {
        // Open database and journal files with a retry operation.
        if (file.retryResult === null) {
          // This is the initial open attempt. Start the asynchronous task
          // and return SQLITE_BUSY to force a retry.
          this._module.retryOps.push(this.#retryOpen(zName, flags, fileId, pOutFlags));
          return VFS.SQLITE_BUSY;
        } else if (file.retryResult instanceof Error) {
          const e = file.retryResult;
          file.retryResult = null;
          throw e;
        }

        // Initialize database file state.
        file.accessHandle = file.retryResult.accessHandle;
        file.waHandles = file.retryResult.waHandles;
        file.writeAhead = file.retryResult.writeAhead;
        file.retryResult = null;

        file.lockState = VFS.SQLITE_LOCK_NONE;
        file.lockingMode = 'normal';
        file.readLock = new LazyLock(`${zName}#read`);
        file.writeLock = new LazyLock(`${zName}#write`);
        file.useLazyLock = 'readwrite';
        file.timeout = -1;
        file.synchronous = 1; // NORMAL
        file.writeHint = null;
        file.pageSize = null;
        file.overwrite = false;
      } else if (flags & (VFS.SQLITE_OPEN_WAL | VFS.SQLITE_OPEN_SUPER_JOURNAL)) {
        throw new Error('WAL and super-journal files are not supported');
      } else if (file.accessHandle) {
        // This temporary file already has an access handle, which happens
        // only for tests. Just use it as is.
      } else {
        // This is a temporary file. Use an unbound pre-opened accessHandle.
        if (!(flags & VFS.SQLITE_OPEN_CREATE)) throw new Error('file not found');
        file.accessHandle = this.#openTemporaryFile(zName);
      }

      this.mapIdToFile.set(fileId, file);
      pOutFlags.setInt32(0, flags, true);
      return VFS.SQLITE_OK;
    } catch (e) {
      console.error(e.stack);
      this.lastError = e;
      this.mapPathToFile.delete(zName);
      return VFS.SQLITE_CANTOPEN;
    }
  }

  /**
   * @param {string} zName 
   * @param {number} syncDir 
   * @returns {number}
   */
  jDelete(zName, syncDir) {
    try {
      if (this.boundTempFiles.has(zName)) {
        const file = this.mapPathToFile.get(zName);
        this.#deleteTemporaryFile(file);
      } else {
        throw new Error(`unexpected file deletion: ${zName}`);
      }
      return VFS.SQLITE_OK;
    } catch (e) {
      console.error(e.stack);
      this.lastError = e;
      return VFS.SQLITE_IOERR_DELETE;
    }
  }

  /**
   * @param {string} zName 
   * @param {number} flags 
   * @param {DataView} pResOut 
   * @returns {number}
   */
  jAccess(zName, flags, pResOut) {
    try {
      const file = this.mapPathToFile.get(zName);
      pResOut.setInt32(0, file ? 1 : 0, true);
      return VFS.SQLITE_OK;
    } catch (e) {
      console.error(e.stack);
      this.lastError = e;
      return VFS.SQLITE_IOERR_ACCESS;
    }
  }

  /**
   * @param {number} fileId 
   * @returns {number}
   */
  jClose(fileId) {
    try {
      const file = this.mapIdToFile.get(fileId);
      if (file?.flags & VFS.SQLITE_OPEN_MAIN_DB) {
        file.writeAhead.close();
        file.accessHandle.close();
        file.waHandles.forEach(handle => handle.close());
        this.mapPathToFile.delete(file?.zName);

        file.readLock.close();
        file.writeLock.close();
      } else if (file?.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
        this.#deleteTemporaryFile(file);
      }

      // Disassociate fileId from file entry.
      this.mapIdToFile.delete(fileId);
      return VFS.SQLITE_OK;
    } catch (e) {
      console.error(e.stack);
      this.lastError = e;
      return VFS.SQLITE_IOERR_CLOSE;
    }
  }

  /**
   * @param {number} fileId 
   * @param {Uint8Array} pData 
   * @param {number} iOffset
   * @returns {number}
   */
  jRead(fileId, pData, iOffset) {
    try {
      const file = this.mapIdToFile.get(fileId);

      let bytesRead = null;
      if (file.flags & VFS.SQLITE_OPEN_MAIN_DB) {
        // Try reading from the write-ahead overlays first. A read on the
        // database file is always a complete page, except when reading
        // from the 100-byte header.
        const pageOffset = iOffset < 100 ? iOffset : 0;
        const page = file.writeAhead.read(iOffset - pageOffset);
        if (page) {
          const readData = page.subarray(pageOffset, pageOffset + pData.byteLength);
          pData.set(readData);
          bytesRead = readData.byteLength;
        }
      }

      if (bytesRead === null) {
        // Read directly from the OPFS file.

        // On Chrome (at least), passing pData to accessHandle.read() is
        // an error because pData is a Proxy of a Uint8Array. Calling
        // subarray() produces a real Uint8Array and that works.
        bytesRead = file.accessHandle.read(pData.subarray(), { at: iOffset });
      }

      if (bytesRead < pData.byteLength) {
        pData.fill(0, bytesRead);
        return VFS.SQLITE_IOERR_SHORT_READ;
      }
      return VFS.SQLITE_OK;
    } catch (e) {
      console.error(e.stack);
      this.lastError = e;
      return VFS.SQLITE_IOERR_READ;
    }
  }

  /**
   * @param {number} fileId 
   * @param {Uint8Array} pData 
   * @param {number} iOffset
   * @returns {number}
   */
  jWrite(fileId, pData, iOffset) {
    try {
      const file = this.mapIdToFile.get(fileId);
      if (file.flags & VFS.SQLITE_OPEN_MAIN_DB) {
        // Write to the write-ahead overlay.
        const isPageResize = file.overwrite && file.pageSize !== pData.byteLength;
        file.writeAhead.write(iOffset, pData, {
          dstPageSize: isPageResize ? file.pageSize : null
        });
        return VFS.SQLITE_OK;
      }

      // On Chrome (at least), passing pData to accessHandle.write() is
      // an error because pData is a Proxy of a Uint8Array. Calling
      // subarray() produces a real Uint8Array and that works.
      file.accessHandle.write(pData.subarray(), { at: iOffset });
      return VFS.SQLITE_OK;
    } catch (e) {
      console.error(e.stack);
      this.lastError = e;
      return VFS.SQLITE_IOERR_WRITE;
    }
  }

  /**
   * @param {number} fileId 
   * @param {number} iSize 
   * @returns {number}
   */
  jTruncate(fileId, iSize) {
    try {
      const file = this.mapIdToFile.get(fileId);
      if (file.flags & VFS.SQLITE_OPEN_MAIN_DB) {
        file.writeAhead.truncate(iSize);
        return VFS.SQLITE_OK;
      }
      file.accessHandle.truncate(iSize);
      return VFS.SQLITE_OK;
    } catch (e) {
      console.error(e.stack);
      this.lastError = e;
      return VFS.SQLITE_IOERR_TRUNCATE;
    }
  }

  /**
   * @param {number} fileId 
   * @param {number} flags 
   * @returns {number}
   */
  jSync(fileId, flags) {
    try {
      const file = this.mapIdToFile.get(fileId);
      if (file.flags & VFS.SQLITE_OPEN_MAIN_DB) {
        const durability = file.synchronous > 1 ? 'strict' : 'relaxed';
        file.writeAhead.sync({ durability });
      } else {
        // This is a temporary file so sync is not needed.
        // Temporary journals are only used for rollback by the
        // connection that created them, not for recovery.
      }
      return VFS.SQLITE_OK;
    } catch (e) {
      console.error(e.stack);
      this.lastError = e;
      return VFS.SQLITE_IOERR_FSYNC;
    }
  }

  /**
   * @param {number} fileId 
   * @param {DataView} pSize64 
   * @returns {number}
   */
  jFileSize(fileId, pSize64) {
    try {
      const file = this.mapIdToFile.get(fileId);

      let size;
      if (file.flags & VFS.SQLITE_OPEN_MAIN_DB) {
        size = file.writeAhead.getFileSize() || file.accessHandle.getSize();
      } else {
        size = file.accessHandle.getSize();
      }
      pSize64.setBigInt64(0, BigInt(size), true);
      return VFS.SQLITE_OK;
    } catch (e) {
      console.error(e.stack);
      this.lastError = e;
      return VFS.SQLITE_IOERR_FSTAT;
    }
  }

  /**
   * @param {number} pFile 
   * @param {number} lockType 
   * @returns {number|Promise<number>}
   */
  jLock(pFile, lockType) {
    try {
      const file = this.mapIdToFile.get(pFile);
      if (file.lockState === VFS.SQLITE_LOCK_NONE && lockType === VFS.SQLITE_LOCK_SHARED) {
        // We do all our locking work in this transition.
        if (file.retryResult === null) {
          if (file.lockingMode === 'exclusive') {
            // Exclusive locking mode is treated as a write, and the
            // read lock is also acquired to block readers.
            file.retryResult = {};
            this._module.retryOps.push(this.#retryLockWrite(file));
            return VFS.SQLITE_BUSY;
          }

          // With WAL, read and write transactions use separate locks. In
          // each case if the required lock is already held then we can
          // proceed synchronously. Otherwise we need to acquire state
          // asynchronously and retry.
          if (file.writeHint) {
            // Write transaction.
            if (!file.writeLock.acquireIfHeld('exclusive')) {
              file.retryResult = {};
              this._module.retryOps.push(this.#retryLockWrite(file));
              return VFS.SQLITE_BUSY;
            } else {
              file.writeAhead.isolateForWrite();
            }
          } else {
            // Read transaction.
            if (!file.readLock.acquireIfHeld('shared')) {
              file.retryResult = {};
              this._module.retryOps.push(this.#retryLockRead(file));
              return VFS.SQLITE_BUSY;
            } else {
              file.writeAhead.isolateForRead();
            }
          }
        } else if (file.retryResult instanceof Error) {
          const e = file.retryResult;
          file.retryResult = null;
          throw e;
        }

        // We have acquired the needed locks, either synchronously or
        // via retry.
        file.retryResult = null;
      } else if (lockType >= VFS.SQLITE_LOCK_RESERVED && !file.writeLock.mode) {
        // This is a write transaction but we don't already have the write
        // lock. This happens when the write hint was not used, which this
        // VFS treats as an error.
        throw new Error('Write transaction cannot use BEGIN DEFERRED');
      }
      file.lockState = lockType;
      return VFS.SQLITE_OK;
    } catch (e) {
      if (e.name === 'TimeoutError') {
        return VFS.SQLITE_BUSY;
      }

      console.error(e.stack);
      this.lastError = e;
      return VFS.SQLITE_IOERR_LOCK;
    }
  }

  /**
   * @param {number} pFile 
   * @param {number} lockType 
   * @returns {number}
   */
  jUnlock(pFile, lockType) {
    try {
      const file = this.mapIdToFile.get(pFile);

      // If retryResult is non-null, an asynchronous lock operation is in
      // progress. In that case, don't change any locks.
      if (!file.retryResult && lockType === VFS.SQLITE_LOCK_NONE) {
        // In this VFS, this is the only unlock transition that matters.
        // Exit write-ahead isolation.
        file.writeAhead.rejoin();

        // Release any locks.
        switch (file.useLazyLock) {
          case 'none':
            file.writeLock.release();
            file.readLock.release();
            break;
          case 'read':
            file.writeLock.release();
            file.readLock.releaseLazy();
            break;
          case 'write':
            file.writeLock.releaseLazy();
            file.readLock.release();
            break;
          case 'readwrite':
            file.writeLock.releaseLazy();
            file.readLock.releaseLazy();
            break;
        }

        // Reset state for the next transaction.
        file.writeHint = null;
      }
      file.lockState = lockType;
    } catch (e) {
      console.error(e.stack);
      this.lastError = e;
      return VFS.SQLITE_IOERR_UNLOCK;
    }
  }

  /**
   * @param {number} pFile 
   * @param {DataView} pResOut 
   * @returns {number}
   */
  jCheckReservedLock(pFile, pResOut) {
    // A hot journal cannot exist so this method should never be called.
    console.assert(false, 'unexpected');
    pResOut.setInt32(0, 0, true);
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} pFile
   * @param {number} op
   * @param {DataView} pArg
   * @returns {number}
   */
  jFileControl(pFile, op, pArg) {
    try {
      const file = this.mapIdToFile.get(pFile);
      switch (op) {
        case VFS.SQLITE_FCNTL_PRAGMA:
          const key = this._module.UTF8ToString(pArg.getUint32(4, true));
          const valueAddress = pArg.getUint32(8, true);
          const value = valueAddress ? this._module.UTF8ToString(valueAddress) : null;
          this.log?.(`PRAGMA ${key} ${value}`);
          switch (key.toLowerCase()) {
            case 'experimental_pragma_20251114':
              // After entering the SHARED locking state on the next
              // transaction, SQLite intends to immediately transition to
              // RESERVED if value is '1', or EXCLUSIVE if value is '2'.
              switch (value) {
                case '1':
                  file.writeHint = 'reserved';
                  break;
                case '2':
                  file.writeHint = 'exclusive';
                  break;
                default:
                  throw new Error(`unexpected write hint value: ${value}`);
              }
              break;
            case 'backstop_interval':
              if (value !== null) {
                const millis = parseInt(value);
                file.writeAhead.setBackstopInterval(millis);
              } else {
                // Return current interval.
                const s = file.writeAhead.options.backstopInterval.toString();
                const ptr = this._module._sqlite3_malloc64(s.length + 1);
                this._module.stringToUTF8(s, ptr, s.length + 1);
                pArg.setUint32(0, ptr, true);
              }
              return VFS.SQLITE_OK;
            case 'busy_timeout':
              // Override SQLite's handling of busy timeouts with our
              // blocking lock timeouts.
              if (value !== null) {
                file.timeout = parseInt(value);
              } else {
                // Return current timeout.
                const s = file.timeout.toString();
                const ptr = this._module._sqlite3_malloc64(s.length + 1);
                this._module.stringToUTF8(s, ptr, s.length + 1);
                pArg.setUint32(0, ptr, true);
              }
              return VFS.SQLITE_OK;
            case 'journal_size_limit':
              if (value !== null) {
                const nPages = parseInt(value);
                file.writeAhead.options.journalSizeLimit = nPages;
              }
              break;
            case 'locking_mode':
              // Track SQLite locking mode. Exclusive mode requires a
              // write lock.
              switch (value?.toLowerCase()) {
                case 'normal':
                  file.lockingMode = 'normal';
                  break;
                case 'exclusive':
                  file.lockingMode = 'exclusive';
                  break;
              }
              break;
            case 'page_size':
              if (value !== null) {
                // Valid page sizes are 1 (which maps to 65536) or powers of
                // two from 512 to 32768.
                const n = parseInt(value);
                if (n === 1 || (n >= 512 && n <= 32768 && (n & (n - 1)) === 0)) {
                  file.pageSize = n === 1 ? 65536 : n;
                }
              }
              break;
            case 'synchronous':
              // Track SQLite synchronous mode. Write-ahead transactions
              // trade durability for performance on values 1 (NORMAL) or
              // lower.
              if (value !== null) {
                switch (value.toLowerCase()) {
                  case 'off':
                  case '0':
                    file.synchronous = 0;
                    break;
                  case 'normal':
                  case '1':
                    file.synchronous = 1;
                    break;
                  case 'full':
                  case '2':
                    file.synchronous = 2;
                    break;
                  case 'extra':
                  case '3':
                    file.synchronous = 3;
                    break;
                  default:
                    throw new Error(`unexpected synchronous value: ${value}`);
                }
              }
              break;
            case 'vfs_trace':
              // This is a trace feature for debugging only.
              if (value !== null) {
                this.log = parseInt(value) !== 0 ? console.debug : null;
                file.writeAhead.log = this.log;
              }
              return VFS.SQLITE_OK;
            case 'wal_autocheckpoint':
              // A setting greater than zero enables automatic checkpoints
              // with this connection (enabled by default).
              if (value !== null) {
                file.writeAhead.options.autoCheckpoint = parseInt(value);
              }
              break;
            case 'wal_checkpoint':
              const checkpointMode = (value ?? 'passive').toLowerCase();
              switch (checkpointMode) {
                case 'passive':
                  this._module.pendingOps.push(this.#pendingCheckpoint(file, checkpointMode));
                  break;
                case 'full':
                case 'restart':
                case 'truncate':
                  if (file.writeAhead.isTransactionPending()) {
                    throw new Error('invalid while a transaction is in progress');
                  }
                  this._module.pendingOps.push(this.#pendingCheckpoint(file, checkpointMode));
                  break;
                case 'noop':
                  break;
                default:
                  throw new Error(`unexpected wal_checkpoint mode: ${value}`);
              }

              // Return the approximate number of pages in the WAL before
              // checkpointing. SQLite returns different information, but
              // that is not feasible from a VFS.
              {
                const s = file.writeAhead.getWriteAheadSize().toString();
                const ptr = this._module._sqlite3_malloc64(s.length + 1);
                this._module.stringToUTF8(s, ptr, s.length + 1);
                pArg.setUint32(0, ptr, true);
              }
              return VFS.SQLITE_OK;
            case 'lazy_lock':
              // Lazy locks don't actually release their Web Lock until
              // they receive a message requesting it. Typically a setting
              // of 'readwrite' (default) or 'read' is best.
              if (value !== null) {
                const useLazyLock = value.toLowerCase();
                switch (useLazyLock) {
                  case 'read':
                  case 'write':
                  case 'readwrite':
                  case 'none':
                    file.useLazyLock = useLazyLock;
                    break;
                  default:
                    throw new Error(`unexpected value for lazy_lock: ${value}`);
                }
              }
              {
                const s = file.useLazyLock;
                const ptr = this._module._sqlite3_malloc64(s.length + 1);
                this._module.stringToUTF8(s, ptr, s.length + 1);
                pArg.setUint32(0, ptr, true);
              }
              return VFS.SQLITE_OK;
          }
          break;

        // Support SQLite batch atomic write transactions.
        case VFS.SQLITE_FCNTL_BEGIN_ATOMIC_WRITE:
        case VFS.SQLITE_FCNTL_COMMIT_ATOMIC_WRITE:
          if (file.flags & VFS.SQLITE_OPEN_MAIN_DB) {
            return VFS.SQLITE_OK;
          }
          break;
        case VFS.SQLITE_FCNTL_ROLLBACK_ATOMIC_WRITE:
          if (file.flags & VFS.SQLITE_OPEN_MAIN_DB) {
            file.writeAhead.rollback();
            return VFS.SQLITE_OK;
          }
          break;

        case VFS.SQLITE_FCNTL_SYNC:
          if (file.flags & VFS.SQLITE_OPEN_MAIN_DB) {
            file.writeAhead.commit();
          }
          break;

        case VFS.SQLITE_FCNTL_OVERWRITE:
          file.overwrite = true;
          break;
      }
    } catch (e) {
      console.error(e.stack);
      this.lastError = e;
      return VFS.SQLITE_IOERR;
    }
    return VFS.SQLITE_NOTFOUND;
  }

  /**
   * @param {number} pFile
   * @returns {number}
   */
  jDeviceCharacteristics(pFile) {
    return VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN
      | VFS.SQLITE_IOCAP_BATCH_ATOMIC;
  }

  /**
   * @param {Uint8Array} zBuf 
   * @returns {number}
   */
  jGetLastError(zBuf) {
    if (this.lastError) {
      console.error(this.lastError);
      const outputArray = zBuf.subarray(0, zBuf.byteLength - 1);
      const { written } = new TextEncoder().encodeInto(this.lastError.message, outputArray);
      zBuf[written] = 0;
    }
    return VFS.SQLITE_OK
  }

  /**
   * @param {string} zName 
   * @returns {FileSystemSyncAccessHandle}
   */
  #openTemporaryFile(zName) {
    if (this.unboundTempFiles.size === 0) {
      throw new Error('no temporary files available');
    }

    // Bind an access handle from the temporary pool.
    const accessHandle = this.unboundTempFiles.values().next().value;
    this.unboundTempFiles.delete(accessHandle);
    this.boundTempFiles.set(zName, accessHandle);
    return accessHandle;
  }

  /**
   * @param {FileEntry} file 
   */
  #deleteTemporaryFile(file) {
    file.accessHandle.truncate(0);

    // Temporary files are not actually deleted, just returned to the pool.
    this.mapPathToFile.delete(file.zName);
    this.unboundTempFiles.add(file.accessHandle);
    this.boundTempFiles.delete(file.zName);
  }

  /**
   * @param {string} dbName 
   * @param {number} i 
   * @returns {string}
   */
  #getWriteAheadNameFromDbName(dbName, i) {
    // Our WAL file is not compatible with SQLite WAL, so use a distinct name.
    return `${dbName}-wa${i}`;
  }

  /**
   * Asynchronous PRAGMA operation to checkpoint the write-ahead log.
   * @param {FileEntry} file 
   * @param {'passive'|'full'|'restart'|'truncate'} mode 
   */
  async #pendingCheckpoint(file, mode) {
    const onFinally = [];
    try {
      if (mode !== 'passive' && file.lockState === VFS.SQLITE_LOCK_NONE) {
        await file.writeLock.acquire('exclusive');
        onFinally.push(() => file.writeLock.release());

        file.writeAhead.isolateForWrite();
        onFinally.push(() => file.writeAhead.rejoin());
      }
      
      await file.writeAhead.checkpoint({ isPassive: mode === 'passive' });
    } catch (e) {
      if (e.name === 'AbortError') {
        e.code = VFS.SQLITE_BUSY;
      }
      throw e;
    } finally {
      while (onFinally.length) {
        onFinally.pop()();
      }
    }
  }

  /**
   * @param {FileEntry} file 
   */
  async #retryLockRead(file) {
    const onError = [];
    try {
      await file.readLock.acquire('shared', file.timeout);
      onError.push(() => file.readLock.release());

      file.writeAhead.isolateForRead();
      file.retryResult = {};
    } catch (e) {
      while (onError.length) {
        onError.pop()();
      }
      file.retryResult = e;
    }
  }

  /**
   * @param {FileEntry} file 
   */
  async #retryLockWrite(file) {
    const onError = [];
    try {
      // Exclusive locking mode requires both read and write locks.
      // Otherwise, only the write lock is needed.
      if (file.lockingMode === 'exclusive') {
        await file.readLock.acquire('exclusive', file.timeout);
        onError.push(() => file.readLock.release());
      }

      await file.writeLock.acquire('exclusive', file.timeout);
      onError.push(() => file.writeLock.release());

      file.writeAhead.isolateForWrite();
      file.retryResult = {};
    } catch (e) {
      while (onError.length) {
        onError.pop()();
      }
      file.retryResult = e;
    }
  }

  /**
   * Handle asynchronous jOpen() tasks.
   * @param {string} zName 
   * @param {number} flags 
   * @param {number} fileId 
   * @param {DataView} pOutFlags 
   * @returns {Promise<void>}
   */
  async #retryOpen(zName, flags, fileId, pOutFlags) {
    /** @type {(() => void)[]} */ const onError = [];
    const file = this.mapPathToFile.get(zName);
    try {
      await navigator.locks.request(`${zName}#ckpt`, async lock => {
        // Parse the path components.
        const directoryNames = zName.split('/').filter(d => d);
        const dbName = directoryNames.pop();

        // Get the OPFS directory handle.
        let dirHandle = await navigator.storage.getDirectory();
        const create = !!(flags & VFS.SQLITE_OPEN_CREATE);
        for (const directoryName of directoryNames) {
          dirHandle = await dirHandle.getDirectoryHandle(directoryName, { create });
        }

        const isNewDatabase = create && await (async function() {
          try {
            await dirHandle.getFileHandle(dbName);
            return false;
          } catch (e) {
            if (e.name === 'NotFoundError') {
              return true;
            }
            throw e;
          }
        })();

        // Convenience function for opening access handles.
        async function openFile(
          /** @type {string} */ filename,
          /** @type {FileSystemGetFileOptions} */ options) {
          const fileHandle = await dirHandle.getFileHandle(filename, options);
          // @ts-ignore
          const accessHandle = await fileHandle.createSyncAccessHandle({
            mode: 'readwrite-unsafe'
          });
          onError.push(() => {
            accessHandle.close();
            if (isNewDatabase) {
              dirHandle.removeEntry(filename);
            }
          });
          return accessHandle;
        }

        // Open the main database OPFS file.
        const accessHandle = await openFile(dbName, { create });

        // Open WAL files.
        const waHandles = await Promise.all([0, 1].map(async i => {
          const waName = this.#getWriteAheadNameFromDbName(dbName, i);
          const waHandle = await openFile(waName, { create: true });
          if (isNewDatabase) {
            waHandle.truncate(0);
          }
          return waHandle;
        }));

        // Create the write-ahead manager.
        const writeAhead = new WriteAhead(zName, accessHandle, waHandles);
        await writeAhead.ready();

        file.retryResult = { accessHandle, waHandles, writeAhead };
      });
    } catch (e) {
      while (onError.length) {
        onError.pop()();
      }
      file.retryResult = e;
    }
  }
}
