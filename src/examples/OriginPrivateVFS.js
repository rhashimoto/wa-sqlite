// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
import { FacadeVFS } from '../FacadeVFS.js';
import * as VFS from '../VFS.js';
import { WebLocksExclusive as WebLocksMixin } from '../WebLocksMixins.js';

const LOCK_NOTIFY_INTERVAL = 1000;

const hasUnsafeAccessHandle =
  globalThis.FileSystemSyncAccessHandle.prototype.hasOwnProperty('mode');

function log(...args) {
  // console.log(...args);
}

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

class File {
  /** @type {string} */ pathname;
  /** @type {number} */ flags;
  /** @type {FileSystemFileHandle} */ fileHandle;
  /** @type {FileSystemSyncAccessHandle} */ accessHandle;

  // The rest of the properties are for platforms without readwrite-unsafe
  // access handles. Only one connection can have an open access handle
  // so coordination is needed in addition to the SQLite locking model.
  //
  // Opening and closing the access handle is expensive so we leave the
  // handle open unless another connection signals on BroadcastChannel.
  /** @type {BroadcastChannel} */ handleRequestChannel;
  /** @type {function} */ handleLockReleaser = null;
  /** @type {boolean} */ isHandleRequested = false;
  /** @type {boolean} */ isFileLocked = false;

  // SQLite makes one read on file open that is not protected by a lock.
  // This needs to be handled as a special case.
  /** @type {function} */ openLockReleaser = null;

  constructor(pathname, flags) {
    this.pathname = pathname;
    this.flags = flags;
  }
}

export class OriginPrivateVFS extends WebLocksMixin(FacadeVFS) {
  /** @type {Map<number, File>} */ mapIdToFile = new Map();
  lastError = null;

  static async create(name, module) {
    const vfs = new OriginPrivateVFS(name, module);
    await vfs.isReady();
    return vfs;
  }

  constructor(name, module) {
    super(name, module);
  }
  
  // log(...args) {
  //   console.log(...args);
  // }

  getLockName(fileId) {
    const pathname = this.mapIdToFile.get(fileId).pathname;
    return `OPFS:${pathname}`
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
      const pathname = url.pathname;

      const file = new File(pathname, flags);
      this.mapIdToFile.set(fileId, file);

      const create = !!(flags & VFS.SQLITE_OPEN_CREATE);
      const [directoryHandle, filename] = await getPathComponents(pathname, create);
      file.fileHandle = await directoryHandle.getFileHandle(filename, { create });

      if ((flags & VFS.SQLITE_OPEN_MAIN_DB) && !hasUnsafeAccessHandle) {
        file.handleRequestChannel = new BroadcastChannel(this.getLockName(fileId));
        file.handleRequestChannel.onmessage = event => {
          if (file.handleLockReleaser) {
            if(!file.isFileLocked) {
              // We have the access handle but the file is not locked.
              // Release the access handle for the requester.
              file.accessHandle.close();
              file.accessHandle = null;
              file.handleLockReleaser();
              file.handleLockReleaser = null;
              log('access handle requested and released');
            } else {
              // We're still using the access handle, so mark it to be
              // released when we're done.
              file.isHandleRequested = true;
              log('access handle requested');
            }
          }
        };

        // Acquire the access handle lock. The first read of a database
        // file is done outside xLock/xUnlock so we get that lock here.
        function notify() {
          file.handleRequestChannel.postMessage(null);
        }
        const notifyId = setInterval(notify, LOCK_NOTIFY_INTERVAL);
        setTimeout(notify);

        file.openLockReleaser = await new Promise((resolve, reject) => {
          navigator.locks.request(this.getLockName(fileId), lock => {
            clearInterval(notifyId);
            if (!lock) return reject();
            return new Promise(release => {
              resolve(release);
            });
          });
        });
        log('access handle acquired for open');
      }

      // @ts-ignore
      file.accessHandle = await file.fileHandle.createSyncAccessHandle({
        mode: 'readwrite-unsafe'
      });
  
      pOutFlags.setInt32(0, flags, true);
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_CANTOPEN;
    }
  }

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

  async jClose(fileId) {
    try {
      const file = this.mapIdToFile.get(fileId);
      this.mapIdToFile.delete(fileId);
      await file?.accessHandle?.close();

      if (file?.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
        const [directoryHandle, name] = await getPathComponents(file.pathname, false);
        await directoryHandle.removeEntry(name, { recursive: false });
      }
      return VFS.SQLITE_OK;
    } catch (e) {
      return VFS.SQLITE_IOERR_DELETE;
    }
  }

  jRead(fileId, pData, iOffset) {
    try {
      const file = this.mapIdToFile.get(fileId);

      // On Chrome (at least), passing pData to accessHandle.read() is
      // an error because pData is a Proxy of a Uint8Array. Calling
      // subarray() produces a real Uint8Array and that works.
      const bytesRead = file.accessHandle.read(pData.subarray(), { at: iOffset });
      if (file.openLockReleaser) {
        // We obtained the access handle on file open.
        file.accessHandle.close();
        file.accessHandle = null;
        file.openLockReleaser();
        file.openLockReleaser = null;
        log('access handle released for open');
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

  jWrite(fileId, pData, iOffset) {
    try {
      const file = this.mapIdToFile.get(fileId);

      // On Chrome (at least), passing pData to accessHandle.write() is
      // an error because pData is a Proxy of a Uint8Array. Calling
      // subarray() produces a real Uint8Array and that works.
      file.accessHandle.write(pData.subarray(), { at: iOffset });
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_WRITE;
    }
  }

  jTruncate(fileId, size) {
    try {
      const file = this.mapIdToFile.get(fileId);
      file.accessHandle.truncate(size);
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_TRUNCATE;
    }
  }

  jSync(fileId, flags) {
    try {
      const file = this.mapIdToFile.get(fileId);
      file.accessHandle.flush();
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_FSYNC;
    }
  }

  jFileSize(fileId, pSize) {
    try {
      const file = this.mapIdToFile.get(fileId);
      const size = file.accessHandle.getSize();
      pSize.setBigInt64(0, BigInt(size), true);
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
    if (hasUnsafeAccessHandle) return super.jLock(fileId, lockType);

    const file = this.mapIdToFile.get(fileId);
    if (!file.isFileLocked) {
      if (!file.handleLockReleaser) {
        // We don't have the access handle. First acquire the lock.
        file.handleLockReleaser = await new Promise((resolve, reject) => {
          // Tell everyone we want the access handle.
          function notify() {
            file.handleRequestChannel.postMessage(null);
          }
          const notifyId = setInterval(notify, LOCK_NOTIFY_INTERVAL);
          setTimeout(notify);

          navigator.locks.request(this.getLockName(fileId), lock => {
            clearInterval(notifyId);
            if (!lock) return reject();
            return new Promise(release => {
              resolve(release);
            });
          });
        });

        // The access handle should now be available.
        file.accessHandle = await file.fileHandle.createSyncAccessHandle();
        log('access handle acquired');
      }

      file.isFileLocked = true;
    }
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} fileId 
   * @param {number} lockType 
   * @returns {Promise<number>}
   */
  async jUnlock(fileId, lockType) {
    if (hasUnsafeAccessHandle) return super.jUnlock(fileId, lockType);

    if (lockType === VFS.SQLITE_LOCK_NONE) {
      const file = this.mapIdToFile.get(fileId);
      if (file.isHandleRequested) {
        // Another connection wants the access handle.
        file.accessHandle.close();
        file.accessHandle = null;
        file.handleLockReleaser();
        file.handleLockReleaser = null;
        file.isHandleRequested = false;
        log('access handle released');
      }
      file.isFileLocked = false;
    }
    return VFS.SQLITE_OK;
  }

  jGetLastError(zBuf) {
    if (this.lastError) {
      console.error(this.lastError);
      const outputArray = zBuf.subarray(0, zBuf.byteLength - 1);
      const { written } = new TextEncoder().encodeInto(this.lastError.message, outputArray);
      zBuf[written] = 0;
    }
    return VFS.SQLITE_OK
  }
}