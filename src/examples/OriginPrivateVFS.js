// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
import { FacadeVFS } from '../FacadeVFS.js';
import * as VFS from '../VFS.js';
import { WebLocksShared as WebLocksMixin } from '../WebLocksMixins.js';
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
  /** @type {FileSystemSyncAccessHandle} */ accessHandle;

  constructor(pathname, flags, accessHandle) {
    this.pathname = pathname;
    this.flags = flags;
    this.accessHandle = accessHandle;
  }

  static async open(pathname, flags) {
    const create = !!(flags & VFS.SQLITE_OPEN_CREATE);
    const [directoryHandle, filename] = await getPathComponents(pathname, create);
    const fileHandle = await directoryHandle.getFileHandle(filename, { create });
    // @ts-ignore
    const accessHandle = await fileHandle.createSyncAccessHandle({
      mode: 'readwrite-unsafe'
    });
    return new File(pathname, flags, accessHandle);
  }
}

export class OriginPrivateVFS extends WebLocksMixin(FacadeVFS) {
  /** @type {Map<number, File>} */ mapIdToFile = new Map();
  lastError = null;

  constructor(name, module) {
    super(name, module);
  }
  
  getLockName(fileId) {
    const pathname = this.mapIdToFile.get(fileId).pathname;
    return `OPFS: ${pathname}`
  }

  async jOpen(filename, fileId, flags, pOutFlags) {
    try {
      const url = new URL(filename || Math.random().toString(36).slice(2), 'file://');
      const pathname = url.pathname;

      const file = await File.open(pathname, flags);
      this.mapIdToFile.set(fileId, file);
      pOutFlags.setInt32(0, flags, true);
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_CANTOPEN;
    }
  }

  async jDelete(filename, syncDir) {
    try {
      const url = new URL(filename || Math.random().toString(36).slice(2), 'file://');
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

  async jAccess(filename, flags, pResOut) {
    try {
      const url = new URL(filename || Math.random().toString(36).slice(2), 'file://');
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
      const bytesRead = file.accessHandle.read(pData, { at: iOffset });
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
      file.accessHandle.write(pData, { at: iOffset });
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