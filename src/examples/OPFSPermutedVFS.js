// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
import { FacadeVFS } from 'wa-sqlite/src/FacadeVFS.js';
import * as VFS from 'wa-sqlite/src/VFS.js';

// Options for navigator.locks.request().
/** @type {LockOptions} */ const SHARED = { mode: 'shared' };
/** @type {LockOptions} */ const POLL_SHARED = { ifAvailable: true, mode: 'shared' };
/** @type {LockOptions} */ const POLL_EXCLUSIVE = { ifAvailable: true, mode: 'exclusive' };

const contextId = Math.random().toString(36).slice(2);

/**
 * @typedef {Object} Transaction
 * @property {number} txId
 * @property {Map<number, { offset: number, digest: Uint32Array }>} [pages]
 * @property {number} [fileSize]
 * @property {number} [oldestTxId]
 * @property {number[]} [reclaimable]
 */

/**
 * @typedef {Object} AccessRequest
 * @property {boolean} exclusive
 */

class File {
  /** @type {string} */ path;
  /** @type {number} */ flags;
  /** @type {FileSystemSyncAccessHandle} */ accessHandle;

  // Members below are only used for SQLITE_OPEN_MAIN_DB.

  /** @type {number} */ pageSize;
  /** @type {number} */ fileSize;

  /** @type {IDBDatabase} */ idb;

  /** @type {Transaction} */ viewTx;
  /** @type {function?} */ viewReleaser;

  /** @type {BroadcastChannel} */ broadcastChannel;
  /** @type {(Transaction|AccessRequest)[]} */ broadcastReceived;

  /** @type {Map<number, number>} */ mapPageToOffset;
  /** @type {Map<number, Transaction>} */ mapTxToPending;
  /** @type {Set<number>} */ freeOffsets;

  /** @type {number} */ lockState;
  /** @type {{read?: function, write?: function, reserved?: function}} */ locks;

  /** @type {Transaction?} */ txActive;
  /** @type {boolean} */ txIsOverwrite;

  constructor(pathname, flags) {
    this.path = pathname;
    this.flags = flags;
  }

  static async create(pathname, flags) {
    const file = new File(pathname, flags);

    const create = !!(flags & VFS.SQLITE_OPEN_CREATE);
    const [directory, filename] = await getPathComponents(pathname, create);
    const handle = await directory.getFileHandle(filename, { create });
    // @ts-ignore
    file.accessHandle = await handle.createSyncAccessHandle({ mode: 'readwrite-unsafe' });

    if (flags & VFS.SQLITE_OPEN_MAIN_DB) {
      file.idb = await new Promise((resolve, reject) => {
        const request = indexedDB.open(pathname);
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore('pages', { keyPath: 'i' });
          db.createObjectStore('pending', { keyPath: 'txId'});
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return file;
  }
}

export class OPFSPermutedVFS extends FacadeVFS {
  /** @type {Map<number, File>} */ #mapIdToFile = new Map();
  #lastError = null;

  /** @type{IDBDatabase|Promise<IDBDatabase>} */ #idb;

  log = (...args) => console.debug(contextId, ...args);

  static async create(name, module) {
    const vfs = new OPFSPermutedVFS(name, module);
    await vfs.isReady();
    return vfs;
  }

  /**
   * @param {string?} zName 
   * @param {number} fileId 
   * @param {number} flags 
   * @param {DataView} pOutFlags 
   * @returns {Promise<number>}
   */
  async jOpen(zName, fileId, flags, pOutFlags) {
    /** @type {(() => void)[]} */ const onFinally = [];
    try {
      const url = new URL(zName || Math.random().toString(36).slice(2), 'file://');
      const path = url.pathname;

      const file = await File.create(path, flags);
      this.#mapIdToFile.set(fileId, file);

      if (flags & VFS.SQLITE_OPEN_MAIN_DB) {
        file.pageSize = 0;
        file.fileSize = 0;
        file.viewTx = { txId: 0 };
        file.broadcastChannel = new BroadcastChannel(`permuted:${path}`);
        file.broadcastReceived = [];
        file.mapPageToOffset = new Map();
        file.mapTxToPending = new Map();
        file.freeOffsets = new Set();
        file.lockState = VFS.SQLITE_LOCK_NONE;
        file.locks = {};
        file.txIsOverwrite = false;
        file.txActive = null;

        // Take the write lock so no other connection changes state
        // during our initialization.
        await this.#lock(file, 'write');
        onFinally.push(() => file.locks.write());

        // Load the initial page map from the database.
        const tx = file.idb.transaction(['pages', 'pending']);
        const pageData = await idbX(tx.objectStore('pages').getAll());
        file.mapPageToOffset = new Map(pageData.map(({ i, o }) => [i, o]));

        // Get the page size.
        if (file.mapPageToOffset.has(1)) {
          // Find page 1 and read the page size from the header.
          // https://sqlite.org/fileformat.html#page_size
          const header = new DataView(new ArrayBuffer(2));
          const n = file.accessHandle.read(header, { at: 16 });
          if (n !== header.byteLength) throw new Error('Failed to read page size');
          file.pageSize = header.getUint16(0);
          if (file.pageSize === 1) {
            file.pageSize = 65536;
          }
        }
        file.fileSize = pageData.length * file.pageSize;
        
        // Initialize free offsets.
        const fileSize = file.accessHandle.getSize();
        for (let i = 0; i < fileSize; i += file.pageSize) {
          if (!file.mapPageToOffset.has(i)) {
            file.freeOffsets.add(i);
          }
        }

        // Incorporate pending transactions.
        try {
          /** @type {Transaction[]} */
          const transactions = await idbX(tx.objectStore('pending').getAll());
          for (const transaction of transactions) {
            // A transaction entry can be empty, containing only the tx id.
            // This is a placeholder so new connections start with a valid
            // id.
            if (transaction.pages) {
              // Verify checksums for all pages in this transaction.
              for (const [index, { offset }] of transaction.pages) {
                // TODO: Implement checksum verification.
                if (false) {
                  throw Object.assign(new Error('checksum error'), { txId: transaction.txId });
                }
              }
              this.#acceptTx(file, transaction);
            }
            file.viewTx = transaction;
          }
        } catch (e) {
          if (e.message === 'checksum error') {
            console.warn(`Checksum error, removing tx ${e.tx}+`)
            const range = IDBKeyRange.lowerBound(e.tx);
            await idbX(tx.objectStore('pending').delete(range));
          } else {
            throw e;
          }
        }

        // Publish our view of the database.
        await this.#setView(file, file.viewTx);

        // Listen for broadcasts.
        file.broadcastChannel.addEventListener('message', event => {
          file.broadcastReceived.push(event.data);
          if (file.lockState === VFS.SQLITE_LOCK_NONE) {
            this.#processBroadcasts(file);
          }
        });

        await this.#lock(file, 'read', SHARED)
      }

      pOutFlags.setInt32(0, flags, true);
      return VFS.SQLITE_OK;
    } catch (e) {
      this.#lastError = e;
      return VFS.SQLITE_CANTOPEN;
    } finally {
      while (onFinally.length) {
        await onFinally.pop()();
      }
    }
  }

  /**
   * @param {string} zName 
   * @param {number} syncDir 
   * @returns {Promise<number>}
   */
  async jDelete(zName, syncDir) {
    try {
      const url = new URL(zName, 'file://');
      const pathname = url.pathname;
   
      const [directoryHandle, name] = await getPathComponents(pathname, false);
      const result = directoryHandle.removeEntry(name, { recursive: false });
      if (syncDir) {
        await result;
      }
      return VFS.SQLITE_OK;
    } catch (e) {
      return VFS.SQLITE_IOERR_DELETE;
    }
  }

  /**
   * @param {string} zName 
   * @param {number} flags 
   * @param {DataView} pResOut 
   * @returns {Promise<number>}
   */
  async jAccess(zName, flags, pResOut) {
    try {
      const url = new URL(zName, 'file://');
      const pathname = url.pathname;

      const [directoryHandle, dbName] = await getPathComponents(pathname, false);
      await directoryHandle.getFileHandle(dbName, { create: false });
      pResOut.setInt32(0, 1, true);
      return VFS.SQLITE_OK;
    } catch (e) {
      if (e.name === 'NotFoundError') {
        pResOut.setInt32(0, 0, true);
        return VFS.SQLITE_OK;
      }
      this.#lastError = e;
      return VFS.SQLITE_IOERR_ACCESS;
    }
  }

  /**
   * @param {number} fileId 
   * @returns {Promise<number>}
   */
  async jClose(fileId) {
    try {
      const file = this.#mapIdToFile.get(fileId);
      this.#mapIdToFile.delete(fileId);
      file?.accessHandle?.close();

      if (file?.flags & VFS.SQLITE_OPEN_MAIN_DB) {
        file.broadcastChannel.close();
        file.viewReleaser?.();
      }

      if (file?.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
        const [directoryHandle, name] = await getPathComponents(file.path, false);
        await directoryHandle.removeEntry(name, { recursive: false });
      }
      return VFS.SQLITE_OK;
    } catch (e) {
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
      const file = this.#mapIdToFile.get(fileId);

      let bytesRead = 0;
      if (file.flags & VFS.SQLITE_OPEN_MAIN_DB) {
        // Look up the page location in the file.
        const pageIndex = file.pageSize ?
          Math.trunc(iOffset / file.pageSize) + 1:
          1;
        const pageOffset = file.txActive?.pages.has(pageIndex) ?
          file.txActive.pages.get(pageIndex).offset :
          file.mapPageToOffset.get(pageIndex);
        if (pageOffset >= 0) {
          this.log?.(`read page ${pageIndex} at ${pageOffset}`);
          bytesRead = file.accessHandle.read(
            pData.subarray(),
            { at: pageOffset + (file.pageSize ? iOffset % file.pageSize : 0) });
        }

        // Get page size if not already known.
        if (!file.pageSize && iOffset <= 16 && iOffset + bytesRead >= 18) {
          const dataView = new DataView(pData.slice(16 - iOffset, 18 - iOffset).buffer);
          file.pageSize = dataView.getUint16(0);
          if (file.pageSize === 1) {
            file.pageSize = 65536;
          }
          this.log?.(`set page size ${file.pageSize}`);
        }
      } else {
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
      this.#lastError = e;
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
      const file = this.#mapIdToFile.get(fileId);

      if (file.flags & VFS.SQLITE_OPEN_MAIN_DB) {
        if (!file.pageSize) {
          this.log?.(`set page size ${pData.byteLength}`)
          file.pageSize = pData.byteLength;
        }

        if (!file.txActive) {
          this.#beginTx(file);
        }

        let pageOffset;
        const pageIndex = Math.trunc(iOffset / file.pageSize) + 1;
        if (file.txIsOverwrite) {
          // For VACUUM, use the identity mapping to write each page
          // at its canonical offset.
          pageOffset = iOffset;
        } else if (file.txActive.pages.has(pageIndex)) {
          // This page has already been written in this transaction.
          // Use the same offset.
          pageOffset = file.txActive.pages.get(pageIndex).offset;
          this.log?.(`overwrite page ${pageIndex} at ${pageOffset}`);
        } else if (pageIndex === 1 && file.freeOffsets.delete(0)) {
          // Offset 0 is available for page 1.
          pageOffset = 0;
          this.log?.(`write page ${pageIndex} at ${pageOffset}`);
        } else {
          // Use the first non-zero offset within the file.
          const opfsFileSize = file.accessHandle.getSize();
          for (const maybeOffset of file.freeOffsets) {
            if (maybeOffset && maybeOffset < opfsFileSize) {
              pageOffset = maybeOffset;
              file.freeOffsets.delete(pageOffset);
              this.log?.(`write page ${pageIndex} at ${pageOffset}`);
              break;
            }
          }

          if (pageOffset === undefined) {
            // Write to the end of the file.
            pageOffset = opfsFileSize;
            this.log?.(`append page ${pageIndex} at ${pageOffset}`);
          }
        }

        file.txActive.pages.set(pageIndex, {
          offset: pageOffset,
          digest: null // TODO: compute digest
        });
        file.accessHandle.write(pData.subarray(), { at: pageOffset });
        file.txActive.fileSize = Math.max(file.txActive.fileSize, pageIndex * file.pageSize);
      } else {
        // On Chrome (at least), passing pData to accessHandle.write() is
        // an error because pData is a Proxy of a Uint8Array. Calling
        // subarray() produces a real Uint8Array and that works.
        file.accessHandle.write(pData.subarray(), { at: iOffset });
      }
      return VFS.SQLITE_OK;
    } catch (e) {
      this.#lastError = e;
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
      const file = this.#mapIdToFile.get(fileId);
      if ((file.flags & VFS.SQLITE_OPEN_MAIN_DB) && !file.txIsOverwrite) {
        file.txActive.fileSize = iSize;

        // Remove now obsolete pages from file.txActive.pages
        for (const [index, { offset }] of file.txActive.pages) {
          if (index * file.pageSize >= iSize) {
            file.txActive.pages.delete(index);
            file.freeOffsets.add(offset);
          }
        }
        return VFS.SQLITE_OK;
      }
      file.accessHandle.truncate(iSize);
      file.fileSize = iSize;
      return VFS.SQLITE_OK;
    } catch (e) {
      console.error(e);
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
      // Main DB sync is handled by SQLITE_FCNTL_SYNC.
      const file = this.#mapIdToFile.get(fileId);
      if (!(file.flags & VFS.SQLITE_OPEN_MAIN_DB)) {
        file.accessHandle.flush();
      }
      return VFS.SQLITE_OK;
    } catch (e) {
      this.#lastError = e;
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
      const file = this.#mapIdToFile.get(fileId);

      let size;
      if (file.flags & VFS.SQLITE_OPEN_MAIN_DB) {
        size = file.txActive ? file.txActive.fileSize : file.fileSize;
      } else {
        size = file.accessHandle.getSize();
      }

      pSize64.setBigInt64(0, BigInt(size), true);
      return VFS.SQLITE_OK;
    } catch (e) {
      this.#lastError = e;
      return VFS.SQLITE_IOERR_FSTAT;
    }
  }

  /**
   * @param {number} fileId 
   * @param {number} lockType 
   * @returns {Promise<number>}
   */
  async jLock(fileId, lockType) {
    const file = this.#mapIdToFile.get(fileId);
    if (lockType <= file.lockState) return VFS.SQLITE_OK;
    switch (lockType) {
      case VFS.SQLITE_LOCK_SHARED:
        if (!file.locks.read) {
          await this.#lock(file, 'read', SHARED);

          // Remove free list offsets that are beyond the end of the file.
          const opfsFileSize = file.accessHandle.getSize();
          file.freeOffsets =
            new Set([...file.freeOffsets].filter(offset => offset < opfsFileSize));
        }
        break;
      case VFS.SQLITE_LOCK_RESERVED:
        if (!await this.#lock(file, 'reserved', POLL_EXCLUSIVE)) {
          return VFS.SQLITE_BUSY;
        }

        // In order to write, our view of the database must be up to date.
        // This is tricky because transactions are published in two ways:
        // via BroadcastChannel and written to IndexeDB. We must handle
        // the rare cases where a transaction is in one but not the other
        // because of latency or crash.
        //
        // First fetch all transactions in IndexedDB equal to or greater
        // than our view.
        const tx = file.idb.transaction(['pending']);
        const range = IDBKeyRange.lowerBound(file.viewTx.txId);

        /** @type {Transaction[]} */
        const entries = await idbX(tx.objectStore('pending').getAll(range));
        if (entries[0]?.txId !== file.viewTx.txId) {
          // IndexedDB doesn't contain our current view transaction. This
          // could happen if the connection that wrote the transaction
          // crashed before it committed to IndexedDB. To fix this, add
          // the transaction to IndexedDB ourselves.
          if (file.viewTx.txId) {
            console.warn(`adding missing tx ${file.viewTx.txId} to IndexedDB`);
          }
          file.idb.transaction('pending', 'readwrite', { durability: 'relaxed' })
            .objectStore('pending')
            .put(file.viewTx);
          entries.unshift({ txId: file.viewTx.txId });
        }

        if (entries.at(-1).txId > file.viewTx.txId) {
          // There are newer transactions in IndexedDB that we haven't
          // seen via broadcast. Ensure that they are incorporated on unlock,
          // and force the application to retry.
          file.broadcastReceived.push(...entries);
          file.locks.reserved();
          return VFS.SQLITE_BUSY
        }
        break;
      case VFS.SQLITE_LOCK_EXCLUSIVE:
        await this.#lock(file, 'write');
        break;
    }
    file.lockState = lockType;
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} fileId 
   * @param {number} lockType 
   * @returns {number}
   */
  jUnlock(fileId, lockType) {
    const file = this.#mapIdToFile.get(fileId);
    if (lockType >= file.lockState) return VFS.SQLITE_OK;
    switch (lockType) {
      case VFS.SQLITE_LOCK_SHARED:
        file.locks.write?.();
        file.locks.reserved?.();
        break;
      case VFS.SQLITE_LOCK_NONE:
        // Don't release the read lock here. It will be released on demand
        // when a broadcast notifies us that another connections wants to
        // VACUUM.
        this.#processBroadcasts(file);
        break;
    }
    file.lockState = lockType;
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} fileId
   * @param {DataView} pResOut 
   * @returns {Promise<number>}
   */
  async jCheckReservedLock(fileId, pResOut) {
    try {
      const file = this.#mapIdToFile.get(fileId);
      if (await this.#lock(file, 'reserved', POLL_SHARED)) {
        // This looks backwards, but if we get the lock then no one
        // else had it.
        pResOut.setInt32(0, 0, true);
        file.locks.reserved();
      } else {
        pResOut.setInt32(0, 1, true);
      }
      return VFS.SQLITE_OK;
    } catch (e) {
      console.error(e);
      this.lastError = e;
      return VFS.SQLITE_IOERR_LOCK;
    }
  }

  /**
   * @param {number} fileId
   * @param {number} op
   * @param {DataView} pArg
   * @returns {Promise<number>}
   */
  async jFileControl(fileId, op, pArg) {
    try {
      const file = this.#mapIdToFile.get(fileId);
      switch (op) {
        case VFS.SQLITE_FCNTL_PRAGMA:
          const key = cvtString(pArg, 4);
          const value = cvtString(pArg, 8);
          this.log?.('xFileControl', file.path, 'PRAGMA', key, value);
          switch (key.toLowerCase()) {
            case 'page_size':
              // Don't allow changing the page size.
              if (value && file.pageSize && Number(value) !== file.pageSize) {
                return VFS.SQLITE_ERROR;
              }
              break;
          }
          break;
        case VFS.SQLITE_FCNTL_BEGIN_ATOMIC_WRITE:
          this.log?.('xFileControl', 'BEGIN_ATOMIC_WRITE', file.path);
          return VFS.SQLITE_OK;
        case VFS.SQLITE_FCNTL_COMMIT_ATOMIC_WRITE:
          this.log?.('xFileControl', 'COMMIT_ATOMIC_WRITE', file.path);
          return VFS.SQLITE_OK;
        case VFS.SQLITE_FCNTL_ROLLBACK_ATOMIC_WRITE:
          this.log?.('xFileControl', 'ROLLBACK_ATOMIC_WRITE', file.path);
          this.#rollbackTx(file);
          return VFS.SQLITE_OK;
        case VFS.SQLITE_FCNTL_SYNC:
          this.log?.('xFileControl', 'SYNC', file.path);
          await this.#commitTx(file);
          break;
        case VFS.SQLITE_FCNTL_OVERWRITE:
          // This is a VACUUM. Get exclusive access to the database. Try
          // polling first.
          this.log?.('xFileControl', 'OVERWRITE', file.path);
          await this.#prepareOverwrite(file);
          break;
      }
    } catch (e) {
      this.#lastError = e;
      return VFS.SQLITE_IOERR;
    }
    return VFS.SQLITE_NOTFOUND;
  }

  /**
   * @param {number} fileId
   * @returns {number|Promise<number>}
   */
  jDeviceCharacteristics(fileId) {
    return 0
    | VFS.SQLITE_IOCAP_BATCH_ATOMIC
    | VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN;
  }

  /**
   * @param {Uint8Array} zBuf 
   * @returns {number}
   */
  jGetLastError(zBuf) {
    if (this.#lastError) {
      console.error(this.#lastError);
      const outputArray = zBuf.subarray(0, zBuf.byteLength - 1);
      const { written } = new TextEncoder().encodeInto(this.#lastError.message, outputArray);
      zBuf[written] = 0;
    }
    return VFS.SQLITE_OK
  }

  /**
   * @param {File} file 
   * @param {'read'|'write'|'reserved'} name 
   * @param {LockOptions} options 
   * @returns {Promise<boolean>}
   */
  #lock(file, name, options = {}) {
    // TODO: Implement optional timeout.

    return new Promise(resolve => {
      const lockName = `${file.path}@@${name}`;
      navigator.locks.request(lockName, options, lock => {
        if (lock) {
          return new Promise(release => {
            file.locks[name] = () => {
              release();
              file.locks[name] = null;
            };
            resolve(true);
          });
        } else {
          file.locks[name] = null;
          resolve(false);
        }
      }).catch(e => {
        if (e.name !== 'AbortError') throw e;
      });
    });
  }

  /**
   * @param {File} file 
   * @param {Transaction} tx 
   */
  async #setView(file, tx) {
    // Publish our view of the database with a lock name that includes
    // the transaction id. As long as we hold the lock, no other connection
    // will overwrite data we are using.
    file.viewTx = tx;
    const lockName = `${file.path}@@[${tx.txId}]`;
    const newReleaser = await new Promise(resolve => {
      navigator.locks.request(lockName, SHARED, lock => {
        return new Promise(release => {
          resolve(release);
        });
      });
    });

    // The new lock is acquired so release the old one.
    file.viewReleaser?.();
    file.viewReleaser = newReleaser;
  }

  /**
   * @param {File} file 
   */
  #processBroadcasts(file) {
    // Sort transaction messages by id. Move other messages to the front.
    // @ts-ignore
    file.broadcastReceived.sort((a, b) => (a.txId ?? -1) - (b.txId ?? -1));

    let nHandled = 0;
    let newTx = file.viewTx;
    for (const message of file.broadcastReceived) {
      if (Object.hasOwn(message, 'txId')) {
        const messageTx = /** @type {Transaction} */ (message)
        if (messageTx.txId <= newTx.txId) {
          // This transaction is already incorporated into our view.
        } else if (messageTx.txId === newTx.txId + 1) {
          // This is the next expected transaction.
          this.log?.(`accept tx ${messageTx.txId}`);
          this.#acceptTx(file, messageTx);
          newTx = messageTx;
        } else {
          // There is a gap in the transaction sequence.
          console.warn(`missing tx ${newTx.txId + 1} (got ${messageTx.txId})`);
          break;
        }
      } else if (Object.hasOwn(message, 'exclusive')) {
        // Release the read lock if we have it.
        console.assert(file.lockState === VFS.SQLITE_LOCK_NONE);
        file.locks.read?.();
      }
      nHandled++;
    }

    // Remove handled messages from the list.
    file.broadcastReceived.splice(0, nHandled);

    // Tell other connections about a change in our view.
    if (newTx.txId > file.viewTx.txId) {
      // No need to await here.
      this.#setView(file, newTx);
    }
  }

  /**
   * @param {File} file 
   * @param {Transaction} message 
   */
  #acceptTx(file, message) {
    // Add list of pages made obsolete by this transaction. These pages
    // can be moved to the free list when all connections have reached
    // this point.
    message.reclaimable = [];

    // Update page mapping with transaction pages.
    for (const [index, { offset }] of message.pages) {
      if (file.mapPageToOffset.has(index)) {
        // Remember overwritten pages that can be reused when all
        // connections have seen this transaction.
        message.reclaimable.push(file.mapPageToOffset.get(index));
      }
      file.mapPageToOffset.set(index, offset);
      file.freeOffsets.delete(offset);
    }

    // Remove mappings for truncated pages.
    const oldPageCount = file.fileSize / file.pageSize;
    const newPageCount = message.fileSize / file.pageSize;
    for (let index = newPageCount + 1; index <= oldPageCount; index++) {
      message.reclaimable.push(file.mapPageToOffset.get(index));
      file.mapPageToOffset.delete(index);
    }

    file.fileSize = message.fileSize;
    file.mapTxToPending.set(message.txId, message);
    if (message.oldestTxId) {
      // Finalize pending transactions that are no longer needed.
      for (const tx of file.mapTxToPending.values()) {
        if (tx.txId > message.oldestTxId) break;

        // Return no longer referenced pages to the free list.
        for (const offset of tx.reclaimable) {
          this.log?.(`reclaim offset ${offset}`);
          file.freeOffsets.add(offset);
        }
        file.mapTxToPending.delete(tx.txId);
      }
    }
  }

  /**
   * @param {File} file 
   */
  #beginTx(file) {
    // Start a new transaction.
    file.txActive = {
      txId: file.viewTx.txId + 1,
      pages: new Map(),
      fileSize: file.fileSize
    };
    this.log?.(`begin transaction ${file.txActive.txId}`);
  }

  /**
   * @param {File} file 
   */
  async #commitTx(file) {
    // TODO: Decide whether to finalize pending transactions.
    if (true || file.txIsOverwrite) {
      file.txActive.oldestTxId = await this.#getOldestTxInUse(file);
    }

    const tx = file.idb.transaction(
      ['pages', 'pending'],
      'readwrite',
      { durability: 'relaxed' });

    if (file.txActive.oldestTxId) {
      // Ensure that all pending data is safely on storage.
      if (file.txIsOverwrite) {
        file.accessHandle.truncate(file.txActive.fileSize);
      }
      file.accessHandle.flush();
      
      // Transfer page mappings to the pages store for all pending
      // transactions that are no longer in use.
      const pageStore = tx.objectStore('pages');
      for (const tx of file.mapTxToPending.values()) {
        if (tx.txId > file.txActive.oldestTxId) break;

        for (const [index, { offset }] of tx.pages) {
          pageStore.put({ i: index, o: offset });
        }
      }

      // Delete pending store entries that are no longer needed.
      tx.objectStore('pending')
        .delete(IDBKeyRange.upperBound(file.txActive.oldestTxId));      
    }

    // Publish the transaction via broadcast and IndexedDB.
    this.log?.(`commit transaction ${file.txActive.txId}`);
    file.broadcastChannel.postMessage(file.txActive);
    file.idb.transaction('pending', 'readwrite')
      .objectStore('pending')
      .put(file.txActive);

    // Advance our own view. Even if we received our own broadcasts (we
    // don't), we want our view to be updated synchronously.
    this.#acceptTx(file, file.txActive);
    this.#setView(file, file.txActive);
    file.txActive = null;

    if (file.txIsOverwrite) {
      // Wait until all connections have seen the transaction.
      while (file.viewTx.txId !== await this.#getOldestTxInUse(file)) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Downgrade the exclusive read lock to a shared lock.
      file.locks.read();
      await this.#lock(file, 'read', SHARED);

      // There should be no extra space in the file now.
      file.freeOffsets.clear();

      file.txIsOverwrite = false;
    }
  }

  /**
   * @param {File} file 
   */
  #rollbackTx(file) {
    // Return offsets to the free list.
    this.log?.(`rollback transaction ${file.txActive.txId}`);
    for (const { offset } of file.txActive.pages.values()) {
      file.freeOffsets.add(offset);
    }
    file.txActive = null;
  }

  /**
   * @param {File} file 
   */
  async #prepareOverwrite(file) {
    file.locks.read?.();
    if (!await this.#lock(file, 'read', POLL_EXCLUSIVE)) {
      // We didn't get the read lock because other connections have
      // it. Notify them that we want the lock and wait.
      const lockRequest = this.#lock(file, 'read');
      file.broadcastChannel.postMessage({ exclusive: true });
      await lockRequest;
    }

    // Create a intermediate transaction to copy all current page data to
    // an offset past fileSize. 
    file.txActive = {
      txId: file.viewTx.txId + 1,
      pages: new Map(),
      fileSize: file.fileSize
    };

    const pageBuffer = new Uint8Array(file.pageSize);
    for (let offset = 0; offset < file.fileSize; offset += file.pageSize) {
      const pageIndex = offset / file.pageSize + 1;
      const oldOffset = file.mapPageToOffset.get(pageIndex);
      if (oldOffset < file.fileSize) {
        // This page is stored below fileSize. Read it into memory.
        if (file.accessHandle.read(pageBuffer, { at: oldOffset }) !== file.pageSize) {
          throw new Error('Failed to read page');
        }
        
        // Find a place above fileSize to copy the page.
        let newOffset = -1;
        while (newOffset < file.fileSize) {
          newOffset = file.freeOffsets.values().next().value ?? file.accessHandle.getSize();
          file.freeOffsets.delete(newOffset);
        }

        // Perform the copy.
        if (file.accessHandle.write(pageBuffer, { at: newOffset }) !== file.pageSize) {
          throw new Error('Failed to write page');
        }

        // TODO: add digest
        file.txActive.pages.set(pageIndex, { offset: newOffset, digest: null });
      }
    }
    file.accessHandle.flush();

    // Publish transaction for others.
    file.broadcastChannel.postMessage(file.txActive);
    file.idb.transaction('pending', 'readwrite')
      .objectStore('pending')
      .put(file.txActive);

    // Incorporate the transaction into our view.
    this.#acceptTx(file, file.txActive);
    this.#setView(file, file.txActive);
    file.txActive = null;

    file.txIsOverwrite = true;
  }

  /**
   * @param {File} file 
   * @returns {Promise<number>}
   */
  async #getOldestTxInUse(file) {
    const TX_LOCK_REGEX = /^(.*)@@\[(\d+)\]$/;
    let oldestTxId = file.viewTx.txId;
    const locks = await navigator.locks.query();
    for (const { name } of locks.held) {
      const m = TX_LOCK_REGEX.exec(name);
      if (m && m[1] === file.path) {
        oldestTxId = Math.min(oldestTxId, Number(m[2]));
      }
    }
    return oldestTxId;
  }
}

/**
 * @param {IDBRequest} request 
 * @returns 
 */
function idbX(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * @param {string} path 
 * @param {boolean} create 
 * @returns {Promise<[FileSystemDirectoryHandle, string]>}
 */
async function getPathComponents(path, create) {
  const components = path.split('/');
  const filename = components.pop();
  let directory = await navigator.storage.getDirectory();
  for (const component of components.filter(s => s)) {
    directory = await directory.getDirectoryHandle(component, { create });
  }
  return [directory, filename];
}

function cvtString(dataView, offset) {
  const p = dataView.getUint32(offset, true);
  if (p) {
    const chars = new Uint8Array(dataView.buffer, p);
    return new TextDecoder().decode(chars.subarray(0, chars.indexOf(0)));
  }
  return null;
}