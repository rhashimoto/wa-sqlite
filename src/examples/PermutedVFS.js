// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
import { FacadeVFS } from '../FacadeVFS.js';
import * as VFS from '../VFS.js';

const BATCH_SIZE = 1;

const INSTANCE = new URLSearchParams(location.search).get('index');

/**
 * @param {string} pathname 
 * @param {boolean} create 
 * @returns {Promise<[FileSystemDirectoryHandle, string]>}
 */
async function getPathComponents(pathname, create) {
  const [_, directories, filename] = pathname.match(/[/]?(.*)[/](.*)$/);

  let directoryHandle = await navigator.storage.getDirectory();
  for (const directory of directories.split('/')) {
    if (directory) {
      directoryHandle = await directoryHandle.getDirectoryHandle(directory, { create });
    }
  }
  return [directoryHandle, filename];
};

/**
 * @typedef {Object} Pending
 * @property {number} tx
 * @property {[pageIndex: number, offset: number][]} pages
 * @property {number} fileSize
 */

class File {
  /** @type {string} */ path;
  /** @type {number} */ flags;
  /** @type {FileSystemSyncAccessHandle} */ accessHandle;

  // Members below are only used for SQLITE_OPEN_MAIN_DB.

  /** @type {number} */ lockState;
  /** @type {number} */ pageSize;
  /** @type {number} */ fileSize;

  /** @type {number} */ txCurrent;
  /** @type {BroadcastChannel} */ broadcastChannel;

  /** @type {Map<number, number>} */ mapPageToOffset;
  /** @type {Map<number, Pending>} */ mapTxToPending;
  /** @type {Map<number, number[]>} */ mapTxToReclaim;
  /** @type {Set<number>} */ freeOffsets;

  /** @type {Map<number, { offset: number, digest: Uint32Array }>} */ txPageData;
  /** @type {number} */ txFileSize;

  /** @type {function} */ lockRelease;
  /** @type {function} */ txRelease;

  /** @type {Promise} */ pendingOps;

  constructor(pathname, flags) {
    this.path = pathname;
    this.flags = flags;
  }
}

export class PermutedVFS extends FacadeVFS {
  /** @type {Map<number, File>} */ mapIdToFile = new Map();
  lastError = null;

  log = (...args) => console.log(`[${INSTANCE}]`, ...args);

  /** @type {IDBDatabase} */ db;

  #isReady;

  static async create(name, module) {
    const vfs = new PermutedVFS(name, module);
    await vfs.isReady();
    return vfs;
  }

  constructor(name, module) {
    super(name, module);
    this.#isReady = Promise.all([
      this.#openIndexedDB()
    ]);
  }
  
  isReady() {
    return this.#isReady.then(() => true);
  }

  /**
   * @param {File} file 
   * @returns 
   */
  #getLockName(file) {
    return `permuted:${file.path}`;
  }

  /**
   * @param {string?} zName 
   * @param {number} fileId 
   * @param {number} flags 
   * @param {DataView} pOutFlags 
   * @returns {Promise<number>}
   */
  async jOpen(zName, fileId, flags, pOutFlags) {
    try {
      const url = new URL(zName || Math.random().toString(36).slice(2), 'file://');
      const path = url.pathname;

      const file = new File(path, flags);
      this.mapIdToFile.set(fileId, file);

      const create = !!(flags & VFS.SQLITE_OPEN_CREATE);
      const [directoryHandle, filename] = await getPathComponents(path, create);
      const fileHandle = await directoryHandle.getFileHandle(filename, { create });
      // @ts-ignore
      file.accessHandle = await fileHandle.createSyncAccessHandle({
        mode: 'readwrite-unsafe'
      });
  
      if (flags & VFS.SQLITE_OPEN_MAIN_DB) {
        file.lockState = VFS.SQLITE_LOCK_NONE;
        file.pageSize = 0;
        file.fileSize = 0;
        file.pendingOps = Promise.resolve();

        file.txCurrent = 0;
        file.broadcastChannel = new BroadcastChannel(`permuted:${path}`);

        file.mapPageToOffset = new Map();
        file.mapTxToPending = new Map();
        file.mapTxToReclaim = new Map();
        file.freeOffsets = new Set();
        
        file.txPageData = null;

        await navigator.locks.request(this.#getLockName(file), async () => {
          // Get metadata and last verified transaction. from IndexedDB.
          this.log?.(`acquired open lock ${this.#getLockName(file)}`);
          const tx = this.db.transaction(['pages', 'verified'], 'readwrite');
          const verified = await idb(tx.objectStore('verified').get(file.path));
          if (verified === undefined) {
            await idb(tx.objectStore('verified').put(0, file.path));
          }

          // Initialize reclaimable offsets.
          const reclaimable = new Set();
          if (file.pageSize) {
            const nSlots = Math.trunc(file.accessHandle.getSize() / file.pageSize);
            for (let i = 0; i < nSlots; i++) {
              reclaimable.add(i * file.pageSize);
            }
          }

          // Get the page map from IndexedDB. Also check digests past the
          // previously verified transaction.
          let maxIndex = 0;
          let pages = [];
          do {
            const range = IDBKeyRange.bound([file.path, maxIndex + 1], [file.path, Infinity]);
            pages = await idb(tx.objectStore('pages').getAll(range, BATCH_SIZE));
            for (const page of pages) {
              if (page.t > verified) {
                // TODO: Verify the page digest.
              }
              file.mapPageToOffset.set(page.i, page.o);
              file.txCurrent = Math.max(file.txCurrent, page.t);
              maxIndex = Math.max(maxIndex, page.i);

              // This offset holds a current page, so it's not reclaimable.
              reclaimable.delete(page.o);
            }
          } while (pages.length === BATCH_SIZE);

          // Compute the file size.
          const pageSizeBuffer = new DataView(new ArrayBuffer(2));
          if (file.accessHandle.read(pageSizeBuffer, { at: 16 }) === 2) {
            file.pageSize = pageSizeBuffer.getUint16(0);
            if (file.pageSize === 1) {
              file.pageSize = 65536;
            }
          }
          file.fileSize = Math.max(file.fileSize, maxIndex * file.pageSize);

          // Set the reclaimable offsets. When all connections reach this
          // transaction, these offsets can be moved to the free list.
          file.mapTxToReclaim.set(file.txCurrent, Array.from(reclaimable));

          // Listen for posted transactions.
          file.broadcastChannel.onmessage = event => {
            /** @type {Pending} */ const pending = event.data;
            this.log?.(`received pending ${pending.tx}`, pending);
            if (pending.tx > file.txCurrent) {
              file.mapTxToPending.set(pending.tx, pending);

              // Defer processing if we are in a transaction.
              if (file.lockState === VFS.SQLITE_LOCK_NONE) {
                // Apply pending transactions in sequence order.
                let needsSharing = false;
                while (file.mapTxToPending.has(file.txCurrent + 1)) {
                  const pending = file.mapTxToPending.get(file.txCurrent + 1);
                  file.mapTxToPending.delete(file.txCurrent + 1);
                  this.#processPending(file, pending);
                  needsSharing = true;
                }

                // Publish our transaction id if changed.
                if (needsSharing) {
                  this.#shareTxId(file);
                }

                // Asynchronously update the free list.
                this.#reclaimOffsets(file);
              }
            }
          };

          await this.#shareTxId(file);
        });
        this.log?.(`released open lock ${this.#getLockName(file)}`);
      }

      pOutFlags.setInt32(0, flags, true);
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_CANTOPEN;
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
      const fileHandle = await directoryHandle.getFileHandle(dbName, { create: false });
      pResOut.setInt32(0, 1, true);
      return VFS.SQLITE_OK;
    } catch (e) {
      if (e.name === 'NotFoundError') {
        pResOut.setInt32(0, 0, true);
        return VFS.SQLITE_OK;
      }
      this.lastError = e;
      return VFS.SQLITE_IOERR_ACCESS;
    }
  }

  /**
   * @param {number} fileId 
   * @returns {Promise<number>}
   */
  async jClose(fileId) {
    try {
      const file = this.mapIdToFile.get(fileId);
      this.mapIdToFile.delete(fileId);
      await file?.accessHandle?.close();

      if (file?.flags & VFS.SQLITE_OPEN_MAIN_DB) {
        await file.pendingOps;
        file.broadcastChannel.close();
        file.lockRelease?.();
        file.txRelease?.();
      }

      if (file?.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
        const [directoryHandle, name] = await getPathComponents(file.path, false);
        await directoryHandle.removeEntry(name, { recursive: false });
      }
      return VFS.SQLITE_OK;
    } catch (e) {
      return VFS.SQLITE_IOERR_DELETE;
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

      let bytesRead = 0;
      if (file.flags & VFS.SQLITE_OPEN_MAIN_DB) {
        // Look up the page location in the file.
        const pageIndex = file.pageSize ?
          Math.trunc(iOffset / file.pageSize) + 1:
          1;
        const pageOffset = file.mapPageToOffset.get(pageIndex);
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
        if (!file.pageSize) {
          this.log?.(`set page size ${pData.byteLength}`)
          file.pageSize = pData.byteLength;
        }

        if (!file.txPageData) {
          // Start a new transaction.
          this.log?.(`begin transaction ${file.txCurrent + 1}`);
          file.txPageData = new Map();
          file.txFileSize = file.fileSize;
        }

        let pageOffset;
        const pageIndex = Math.trunc(iOffset / file.pageSize) + 1;
        if (file.txPageData.has(pageIndex)) {
          // This page has already been written in this transaction.
          // Use the same offset.
          const pageData = file.txPageData.get(pageIndex);
          pageOffset = pageData.offset;
          this.log?.(`overwrite page ${pageIndex} at ${pageOffset}`);
        } else if (pageIndex === 1 && file.freeOffsets.delete(0)) {
          // Offset 0 is available for page 1.
          pageOffset = 0;
          this.log?.(`write page ${pageIndex} at ${pageOffset}`);
        } else {
            // Use the first non-zero offset.
            for (const maybeOffset of file.freeOffsets) {
            if (maybeOffset) {
              pageOffset = maybeOffset;
              file.freeOffsets.delete(pageOffset);
              this.log?.(`write page ${pageIndex} at ${pageOffset}`);
              break;
            }
          }

          if (pageOffset === undefined) {
            // Write to the end of the file.
            // TODO: avoid i/o here
            pageOffset = file.accessHandle.getSize();
            this.log?.(`append page ${pageIndex} at ${pageOffset}`);
          }
        }

        file.txPageData.set(pageIndex, {
          offset: pageOffset,
          digest: null // TODO: compute digest
        });
        file.accessHandle.write(pData.subarray(), { at: pageOffset });
        file.txFileSize = Math.max(file.txFileSize, iOffset + pData.byteLength);
      } else {
        // On Chrome (at least), passing pData to accessHandle.write() is
        // an error because pData is a Proxy of a Uint8Array. Calling
        // subarray() produces a real Uint8Array and that works.
        file.accessHandle.write(pData.subarray(), { at: iOffset });
      }
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_WRITE;
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
        // TODO
      } else {
        file.accessHandle.flush();
      }
      return VFS.SQLITE_OK;
    } catch (e) {
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
        size = file.fileSize;
      } else {
        size = file.accessHandle.getSize();
      }

      pSize64.setBigInt64(0, BigInt(size), true);
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_FSTAT;
    }
  }

  /**
   * @param {number} fileId 
   * @param {number} lockType 
   * @returns {Promise<number>}
   */
  async jLock(fileId, lockType) {
    const file = this.mapIdToFile.get(fileId);
    if (file.lockState === lockType) return VFS.SQLITE_OK;

    // Only the reserved lock requires a Web Lock.
    if (file.lockState === VFS.SQLITE_LOCK_RESERVED) {
      // Attempt to get the lock.
      file.lockRelease = await new Promise(resolve => {
        const lockName = this.#getLockName(file);
        navigator.locks.request(lockName, { ifAvailable: true }, lock => {
          if (lock) return new Promise(resolve);
          resolve(null);
        });
      });
      if (!file.lockRelease) {
        return VFS.SQLITE_BUSY;
      }

      // Check that we are on the latest transaction. This might not
      // be the case if we haven't received and processed all pending
      // transaction messages.
      const objectStore = this.db.transaction('recent', 'readwrite').objectStore('recent');
      const range = IDBKeyRange.bound([file.path, file.txCurrent], [file.path, Infinity], true);
      const recent = await idb(objectStore.getAll(range));
      if (recent.length) {
        // TODO: Bring state up to date (but still return busy). Retransmit
        // pending transactions in case the original sender failed.
        return VFS.SQLITE_BUSY;
      }
    }
    file.lockState = lockType;
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} fileId 
   * @param {number} lockType 
   * @returns {Promise<number>}
   */
  async jUnlock(fileId, lockType) {
    const file = this.mapIdToFile.get(fileId);
    if (file.lockState === lockType) return VFS.SQLITE_OK;

    if (lockType < VFS.SQLITE_LOCK_RESERVED) {
      file.lockRelease?.();
    }

    file.lockState = lockType;
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} fileId
   * @param {number} op
   * @param {DataView} pArg
   * @returns {number|Promise<number>}
   */
  jFileControl(fileId, op, pArg) {
    try {
      const file = this.mapIdToFile.get(fileId);
      switch (op) {
        case VFS.SQLITE_FCNTL_PRAGMA:
          const key = extractString(pArg, 4);
          const value = extractString(pArg, 8);
          this.log?.('xFileControl', file.path, 'PRAGMA', key, value);
          switch (key.toLowerCase()) {
            case 'page_size':
              // TODO
              break;
            case 'cache_size':
              // TODO
              break;
          }
          break;
        case VFS.SQLITE_FCNTL_BEGIN_ATOMIC_WRITE:
        case VFS.SQLITE_FCNTL_COMMIT_ATOMIC_WRITE:
          return VFS.SQLITE_OK;
        case VFS.SQLITE_FCNTL_ROLLBACK_ATOMIC_WRITE:
          // TODO: Return used offsets to the free list.
          file.txPageData = null;
          return VFS.SQLITE_OK;
        case VFS.SQLITE_FCNTL_SYNC:
          this.log?.('xFileControl', 'SYNC', file.path);
          if (file.txPageData) {
            const pending = {
              tx: file.txCurrent + 1,
              pages: [],
              fileSize: file.txFileSize
            };
            const tx = this.db.transaction(['pages', 'recent'], 'readwrite');
            const pages = tx.objectStore('pages');
            for (const [pageIndex, { offset, digest }] of file.txPageData) {
              // Update IndexedDB page map.
              pages.put({
                p: file.path,
                t: file.txCurrent + 1,
                i: pageIndex,
                o: offset,
                d: digest
              });

              pending.pages.push([pageIndex, offset]);
            }

            // Save the transaction details to IndexedDB.
            tx.objectStore('recent').put(Object.assign({
              path: file.path
            }, pending));

            // When the IndexedDB transaction commits, post the SQLite
            // transaction details to the broadcast channel.
            const txComplete = new Promise((resolve, reject) => {
              tx.oncomplete = resolve;
              tx.onerror = () => reject(tx.error);
            }).then(() => {
              file.broadcastChannel.postMessage(Object.assign({
                path: file.path
              }, pending));
              this.log?.(`posted pending ${pending.tx}`, pending);
            });
            file.pendingOps = Promise.all([file.pendingOps, txComplete]);

            // Apply the transaction ourselves.
            this.#processPending(file, pending);
            this.#shareTxId(file);

            // Asynchronously update the free list.
            this.#reclaimOffsets(file);

            file.txPageData = null;
          }
          break;
      }
    } catch (e) {
      this.lastError = e;
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
    if (this.lastError) {
      console.error(this.lastError);
      const outputArray = zBuf.subarray(0, zBuf.byteLength - 1);
      const { written } = new TextEncoder().encodeInto(this.lastError.message, outputArray);
      zBuf[written] = 0;
    }
    return VFS.SQLITE_OK
  }

  /**
   * @returns {Promise<IDBDatabase>}
   */
  async #openIndexedDB() {
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(`permuted`, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('verified');
        db.createObjectStore('pages', { keyPath: ['p', 'i'] });
        db.createObjectStore('recent', { keyPath: ['path', 'tx'] });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.db;
  }

  /**
   * @param {File} file 
   */
  async #shareTxId(file) {
    // Acquire the new lock.
    const releaser = await new Promise(resolve => {
      const lockName = this.#getLockName(file) + `[${file.txCurrent}]`;
      navigator.locks.request(lockName, { mode: 'shared' }, () => {
        this.log?.(`acquired shared lock ${lockName}`);
        return new Promise(resolve);
      });
    });

    // Release the old lock.
    file.txRelease?.();
    file.txRelease = releaser;
  }

  /**
   * @param {File} file 
   * @returns 
   */
  async #reclaimOffsets(file) {
    let txInUse = file.txCurrent;
    const pattern = new RegExp(`^${this.#getLockName(file)}\\[(\\d+)\\]$`);
    const locks = await navigator.locks.query();
    for (const lock of locks.held) {
      const match = lock.name.match(pattern);
      if (match) {
        txInUse = Math.min(txInUse, Number(match[1]));
      }
    }
    this.log?.(`reclaiming up to tx ${txInUse}`);

    for (const [txId, reclaimable] of file.mapTxToReclaim) {
      if (txId > txInUse) return;
      for (const offset of reclaimable) {
        this.log?.(`reclaiming offset ${offset}`);
        file.freeOffsets.add(offset);
      }
      file.mapTxToReclaim.delete(txId);
    }
  }

  /**
   * @param {File} file 
   * @param {Pending} pending
   */
  #processPending(file, pending) {
    console.assert(pending.tx === file.txCurrent + 1, `mis-ordered transaction ${pending.tx}`);
    this.log?.(`applying tx ${pending.tx}`, pending);
    const reclaimable = [];
    for (const [pageIndex, offset] of pending.pages) {
      this.log?.(`page ${pageIndex} -> offset ${offset}`)
      const oldOffset = file.mapPageToOffset.get(pageIndex);
      if (oldOffset >= 0) {
        this.log?.(`reclaimable offset ${oldOffset}`);
        reclaimable.push(oldOffset);
      }

      file.mapPageToOffset.set(pageIndex, offset);
      file.fileSize = pending.fileSize;
    }
    file.mapTxToReclaim.set(pending.tx, reclaimable);
    file.txCurrent = pending.tx;
  }
}

/**
 * @param {IDBRequest} request 
 */
function idb(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function extractString(dataView, offset) {
  const p = dataView.getUint32(offset, true);
  if (p) {
    const chars = new Uint8Array(dataView.buffer, p);
    return new TextDecoder().decode(chars.subarray(0, chars.indexOf(0)));
  }
  return null;
}