// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
import { FacadeVFS } from '../FacadeVFS.js';
import * as VFS from '../VFS.js';
import { WebLocksMixin } from '../WebLocksMixin.js';

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
  /** @type {Blob?} */ blob;
  /** @type {FileSystemWritableFileStream?} */ writable;
  /** @type {number} */ writableSize;
  /** @type {boolean} */ overwrite = false;

  constructor(pathname, flags) {
    this.pathname = pathname;
    this.flags = flags;
  }
}

export class OPFSAnyContextVFS extends WebLocksMixin(FacadeVFS) {
  /** @type {Map<number, File>} */ mapIdToFile = new Map();
  lastError = null;

  log = null;

  static async create(name, module, options) {
    const vfs = new OPFSAnyContextVFS(name, module, options);
    await vfs.isReady();
    return vfs;
  }

  constructor(name, module, options = {}) {
    super(name, module, options);
  }
  
  getFilename(fileId) {
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

      await file.writable?.close();
      if (file?.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
        const [directoryHandle, name] = await getPathComponents(file.pathname, false);
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
   * @returns {Promise<number>}
   */
  async jRead(fileId, pData, iOffset) {
    try {
      const file = this.mapIdToFile.get(fileId);

      if (file.writable) {
        await file.writable.close();
        file.writable = null;
        file.blob = null;
      }
      if (!file.blob) {
        file.blob = await file.fileHandle.getFile();
      }

      const bytesRead = await file.blob.slice(iOffset, iOffset + pData.byteLength)
        .arrayBuffer()
        .then(arrayBuffer => {
          pData.set(new Uint8Array(arrayBuffer));
          return arrayBuffer.byteLength;
        });

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
   * @returns {Promise<number>}
   */
  async jWrite(fileId, pData, iOffset) {
    try {
      const file = this.mapIdToFile.get(fileId);

      if (!file.writable) {
        await this.#openWritable(file);
      }
      await file.writable.seek(iOffset);
      // TODO: restore the subarray() call below once WebKit honors a view's
      // byteOffset and byteLength instead of writing the whole ArrayBuffer,
      // which here is the WASM heap: https://bugs.webkit.org/show_bug.cgi?id=302733
      // await file.writable.write(pData.subarray());
      await file.writable.write(pData.slice());
      file.writableSize = Math.max(file.writableSize, iOffset + pData.byteLength);
      file.blob = null;

      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_WRITE;
    }
  }

  /**
   * @param {number} fileId 
   * @param {number} iSize 
   * @returns {Promise<number>}
   */
  async jTruncate(fileId, iSize) {
    try {
      const file = this.mapIdToFile.get(fileId);

      if (!file.writable) {
        await this.#openWritable(file);
      }
      await file.writable.truncate(iSize);
      file.writableSize = iSize;
      file.blob = null;
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_TRUNCATE;
    }
  }

  /**
   * @param {number} fileId 
   * @param {number} flags 
   * @returns {Promise<number>}
   */
  async jSync(fileId, flags) {
    try {
      const file = this.mapIdToFile.get(fileId);
      if (!file.overwrite) {
        // An overwritten database is published by
        // SQLITE_FCNTL_COMMIT_PHASETWO instead, after its truncation.
        await this.#closeWritable(file);
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
   * @returns {Promise<number>}
   */
  async jFileSize(fileId, pSize64) {
    try {
      const file = this.mapIdToFile.get(fileId);

      // Answer from the open writable rather than close it, which would
      // copy the whole file once more.
      if (file.writable) {
        pSize64.setBigInt64(0, BigInt(file.writableSize), true);
        return VFS.SQLITE_OK;
      }
      if (!file.blob) {
        file.blob = await file.fileHandle.getFile();
      }
      pSize64.setBigInt64(0, BigInt(file.blob.size), true);
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
    if (lockType === VFS.SQLITE_LOCK_SHARED) {
      // Make sure to get a current readable view of the file.
      const file = this.mapIdToFile.get(fileId);
      file.blob = null;
    }

    // Call the actual unlock implementation.
    return super.jLock(fileId, lockType);
  }

  /**
   * @param {number} fileId 
   * @param {number} lockType 
   * @returns {Promise<number>}
   */
  async jUnlock(fileId, lockType) {
    // Never hand the lock over with changes still unpublished, which an I/O
    // error can leave behind.
    let rc = VFS.SQLITE_OK;
    const file = this.mapIdToFile.get(fileId);
    if (file?.writable) {
      try {
        await this.#closeWritable(file);
      } catch (e) {
        this.lastError = e;
        rc = VFS.SQLITE_IOERR_UNLOCK;
      }
      file.writable = null;
      file.blob = null;
    }

    const unlockResult = await super.jUnlock(fileId, lockType);
    return rc === VFS.SQLITE_OK ? unlockResult : rc;
  }

  /**
   * @param {number} fileId
   * @param {number} op
   * @param {DataView} pArg
   * @returns {Promise<number>}
   */
  async jFileControl(fileId, op, pArg) {
    // Changes in an open writable are not visible to other contexts until
    // it is closed, so close it where SQLite ends its writes.
    const file = this.mapIdToFile.get(fileId);
    try {
      switch (op) {
        case VFS.SQLITE_FCNTL_OVERWRITE:
          // A VACUUM: wait for its truncation before publishing.
          file.overwrite = true;
          break;
        case VFS.SQLITE_FCNTL_SYNC:
          if (!file.overwrite) {
            await this.#closeWritable(file);
          }
          break;
        case VFS.SQLITE_FCNTL_COMMIT_PHASETWO:
          await this.#closeWritable(file);
          file.overwrite = false;
          break;
      }
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR;
    }
    return super.jFileControl(fileId, op, pArg);
  }

  /**
   * @param {File} file
   */
  async #openWritable(file) {
    file.writableSize = (file.blob ?? await file.fileHandle.getFile()).size;
    file.writable = await file.fileHandle.createWritable({ keepExistingData: true });
  }

  /**
   * @param {File} file
   */
  async #closeWritable(file) {
    await file.writable?.close();
    file.writable = null;
    file.blob = null;
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
