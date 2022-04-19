// Copyright 2022 Roy T. Hashimoto. All Rights Reserved.
import * as VFS from '../VFS.js';
import { WebLocksMixin } from './WebLocksMixin.js';

const BLOCK_SIZE = 4096;

function log(...args) {
  // console.debug(...args);
}

/**
 * @typedef OpenedFileEntry
 * @property {string} name
 * @property {number} flags
 * @property {FileSystemFileHandle} fileHandle
 * @property {FileSystemAccessHandle} accessHandle
 */

// @ts-ignore
export class OriginPrivateFileSystemVFS extends WebLocksMixin(VFS.Base) {
  #root = null;
  #rootReady = navigator.storage.getDirectory().then(handle => {
    this.root = handle;
    return handle;
  });

  /** @type {Map<number, OpenedFileEntry>} */ #mapIdToFile = new Map();

  get name() { return 'opfs'; }

  xOpen(name, fileId, flags, pOutFlags) {
    return this.handleAsync(async () => {
      log(`xOpen ${name} ${fileId} 0x${flags.toString(16)}`);

      try {
        const root = this.#root ?? await this.#rootReady;
        const create = (flags & VFS.SQLITE_OPEN_CREATE) ? true : false;
        const fileHandle = await root.getFileHandle(name, { create });

        const fileEntry = {
          name,
          flags,
          fileHandle,
          accessHandle: null,
        };
        this.#mapIdToFile.set(fileId, fileEntry);

        if (!(flags & VFS.SQLITE_OPEN_MAIN_DB)) {
          // Get an access handle for files that SQLite does not lock.
          await this.#getAccessHandle(fileEntry);
        }
        pOutFlags.set(0);
        return VFS.SQLITE_OK;
      } catch (e) {
        return VFS.SQLITE_CANTOPEN;
      }
    });
  }

  xClose(fileId) {
    return this.handleAsync(async () => {
      const fileEntry = this.#mapIdToFile.get(fileId);
      log(`xClose ${fileEntry.name}`);

      this.#mapIdToFile.delete(fileId);
      await fileEntry.accessHandle?.close();

      if (fileEntry.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
        const root = this.#root ?? await this.#rootReady;
        await root.removeEntry(fileEntry.name).catch(() => {});
      }
      return VFS.SQLITE_OK;
    });
  }

  xRead(fileId, pData, iOffset) {
    return this.handleAsync(async () => {
      const fileEntry = this.#mapIdToFile.get(fileId);
      log(`xRead ${fileEntry.name} ${pData.size} ${iOffset}`);

      let nBytesRead;
      if (fileEntry.accessHandle) {
        nBytesRead = fileEntry.accessHandle.read(pData.value, { at: iOffset });
      } else {
        // Not using an access handle is slower but allows multiple readers.
        const file = await fileEntry.fileHandle.getFile()
        const blob = file.slice(iOffset, iOffset + pData.value.byteLength);
        const buffer = await blob.arrayBuffer();
        pData.value.set(new Int8Array(buffer));
        nBytesRead = Math.min(pData.value.byteLength, blob.size);
      }

      if (nBytesRead < pData.size) {
        pData.value.fill(0, nBytesRead, pData.size);
        return VFS.SQLITE_IOERR_SHORT_READ;
      }
      return VFS.SQLITE_OK;
    });
  }

  xWrite(fileId, pData, iOffset) {
    const fileEntry = this.#mapIdToFile.get(fileId);
    log(`xWrite ${fileEntry.name} ${pData.size} ${iOffset}`);

    const nBytes = fileEntry.accessHandle.write(pData.value, { at: iOffset });
    return nBytes === pData.size ? VFS.SQLITE_OK : VFS.SQLITE_IOERR;
  }

  xTruncate(fileId, iSize) {
    return this.handleAsync(async () => {
      const fileEntry = this.#mapIdToFile.get(fileId);
      log(`xTruncate ${fileEntry.name} ${iSize}`);

      const accessHandle = await this.#getAccessHandle(fileEntry);
      await accessHandle.truncate(iSize);
      return VFS.SQLITE_OK;
    });
  }

  xSync(fileId, flags) {
    return this.handleAsync(async () => {
      const fileEntry = this.#mapIdToFile.get(fileId);
      log(`xSync ${fileEntry.name} ${flags}`);
      
      await fileEntry.accessHandle?.flush();
      return VFS.SQLITE_OK;
    });
  }

  xFileSize(fileId, pSize64) {
    return this.handleAsync(async () => {
      const fileEntry = this.#mapIdToFile.get(fileId);
      log(`xFileSize ${fileEntry.name}`);

      let size;
      if (fileEntry.accessHandle) {
        size = await fileEntry.accessHandle.getSize();
      } else {
        size = (await fileEntry.fileHandle.getFile()).size;
      }
      pSize64.set(size)
      return VFS.SQLITE_OK;
    });
  }

  xLock(fileId, flags) {
    return this.handleAsync(async () => {
      const fileEntry = this.#mapIdToFile.get(fileId);
      log(`xLock ${fileEntry.name} ${flags}`);
      await super.xLock(fileId, flags);

      if (flags === VFS.SQLITE_LOCK_EXCLUSIVE) {
        await this.#getAccessHandle(fileEntry);
      }
      return VFS.SQLITE_OK;
    });
  }

  xUnlock(fileId, flags) {
    return this.handleAsync(async () => {
      const fileEntry = this.#mapIdToFile.get(fileId);
      log(`xUnlock ${fileEntry.name} ${flags}`);

      if (flags === VFS.SQLITE_LOCK_NONE) {
        await fileEntry.accessHandle?.close();
        fileEntry.accessHandle = null;
      }

      await super.xUnlock(fileId, flags);
      return VFS.SQLITE_OK;
    });
  }

  xSectorSize(fileId) {
    log('xSectorSize', BLOCK_SIZE);
    return BLOCK_SIZE;
  }

  xDeviceCharacteristics(fileId) {
    log('xDeviceCharacteristics');
    return VFS.SQLITE_IOCAP_SAFE_APPEND |
           VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN;
  }

  xAccess(name, flags, pResOut) {
    return this.handleAsync(async () => {
      log(`xAccess ${name} ${flags}`);
      try {
        const root = this.#root ?? await this.#rootReady;
        await root.getFileHandle(name);
        pResOut.set(1);
      } catch (e) {
        pResOut.set(0);
      }
      return VFS.SQLITE_OK;
    });
  }

  xDelete(name, syncDir) {
    return this.handleAsync(async () => {
      log(`xDelete ${name} ${syncDir}`);
      const root = this.#root ?? await this.#rootReady;
      await root.removeEntry(name).catch(() => {});
      return VFS.SQLITE_OK;
    });
  }

  async #getAccessHandle(fileEntry) {
    if (!fileEntry.accessHandle) {
      fileEntry.accessHandle = await fileEntry.fileHandle.createSyncAccessHandle();
    }
    return fileEntry.accessHandle;
  }
}