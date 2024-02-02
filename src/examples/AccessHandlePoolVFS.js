// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
import { FacadeVFS } from '../FacadeVFS.js';
import * as VFS from '../VFS.js';

const DEFAULT_TEMPORARY_FILES = 10;

const hasUnsafeAccessHandle =
  globalThis.FileSystemSyncAccessHandle.prototype.hasOwnProperty('mode');
const finalizationRegistry = new FinalizationRegistry(releaser => releaser());

class File {
  /** @type {string} */ path
  /** @type {number} */ flags;
  /** @type {FileSystemSyncAccessHandle} */ accessHandle;

  constructor(path, flags) {
    this.path = path;
    this.flags = flags;
  }
}

export class AccessHandlePoolVFS extends FacadeVFS {
  /** @type {Map<number, File>} */ mapIdToFile = new Map();
  lastError = null;

  /** @type {FileSystemDirectoryHandle} */ rootDirectory;
  /** @type {Map<string, FileSystemSyncAccessHandle>} */ persistentHandles = new Map();
  /** @type {Map<string, FileSystemSyncAccessHandle>} */ boundHandles = new Map();
  /** @type {Set<FileSystemSyncAccessHandle>} */ unboundHandles = new Set();
  /** @type {Set<string>} */ accessiblePaths = new Set();
  releaser = null;

  static async create(rootDirectoryPath, module) {
    const vfs = new AccessHandlePoolVFS(rootDirectoryPath, module);
    await Promise.all([
      vfs.isReady(),
      vfs.#initialize(rootDirectoryPath, DEFAULT_TEMPORARY_FILES),
    ]);
    return vfs;
  }

  constructor(name, module) {
    super(name, module);
  }

  async #initialize(rootDirectoryPath, nTemporaryFiles) {
    // Find the root directory, which must already exist.
    this.rootDirectory = await navigator.storage.getDirectory();
    for (const directory of rootDirectoryPath.split('/')) {
      if (directory) {
        try {
          this.rootDirectory = await this.rootDirectory.getDirectoryHandle(directory);
        } catch (e) {
          if (e.name === 'NotFoundError') {
            console.warn(`Creating directory ${directory}`);
            this.rootDirectory = await this.rootDirectory.getDirectoryHandle(directory, {
              create: true,
            });
            continue;
          }
          throw e;
        }
      }
    }

    // Traverse the tree to find files and temporary directories.
    const traverseTree = async (/** @type {FileSystemHandle} */ entry) => {
      if (entry instanceof FileSystemFileHandle) {
        // Add persistent file.
        // @ts-ignore
        const accessHandle = await entry.createSyncAccessHandle({ mode: 'readwrite-unsafe' });
        const relativePath = await this.rootDirectory.resolve(entry);
        const path = `/${relativePath.join('/')}`;
        this.persistentHandles.set(path, accessHandle);
        if (accessHandle.getSize()) {
          this.accessiblePaths.add(path);
        }
      } else {
        // @ts-ignore
        for await (const child of entry.values()) {
          traverseTree(child);
        }
      }
    }
    // @ts-ignore
    for await (const entry of this.rootDirectory.values()) {
      if (entry.kind === 'directory' && entry.name.startsWith('.ahp-')) {
        // Delete temporary directory if not protected by lock.
        const isLocked = await navigator.locks.request(
          entry.name,
          { ifAvailable: true },
          lock => !lock);
  
        if (!isLocked) {
          this.log(`Deleting temporary directory ${entry.name}`);
          await this.rootDirectory.removeEntry(entry.name, { recursive: true });
        } else {
          this.log(`Temporary directory ${entry.name} is locked`);
        }
      } else {
        await traverseTree(entry);
      }
    }

    // Create temporary directory.
    const tmpDirName = `.ahp-${Math.random().toString(36).slice(2)}`;
    this.releaser = await new Promise(resolve => {
      navigator.locks.request(tmpDirName, () => {
        return new Promise(release => {
          resolve(release);
        });
      });
    });
    finalizationRegistry.register(this, this.releaser);
    const tmpDir = await this.rootDirectory.getDirectoryHandle(tmpDirName, { create: true });

    // Populate temporary directory.
    for (let i = 0; i < nTemporaryFiles; i++) {
      const tmpFile = await tmpDir.getFileHandle(`${i}.tmp`, { create: true });
      // @ts-ignore
      const tmpAccessHandle = await tmpFile.createSyncAccessHandle({ mode: 'readwrite-unsafe' });
      this.unboundHandles.add(tmpAccessHandle);
    }
  }

  log(...args) {
    // console.log(...args);
  }

  getLockName(fileId) {
    const path = this.mapIdToFile.get(fileId).path;
    return `AHP:${path}`
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
      const url = new URL(zName || Math.random().toString(36).slice(2), 'file://');
      const path = url.pathname;

      if (!this.accessiblePaths.has(path) &&
          !(flags & VFS.SQLITE_OPEN_CREATE)) {
        throw new Error(`File ${path} not found`);
      }

      const file = new File(path, flags);
      this.mapIdToFile.set(fileId, file);
      if (this.persistentHandles.has(path)) {
        file.accessHandle = this.persistentHandles.get(path);
      } else if (this.boundHandles.has(path)) {
        // Temporary file has been created and closed. Reopen the
        // same access handle.
        file.accessHandle = this.boundHandles.get(path);
      } else if (this.unboundHandles.size) {
        // Associate an unbound access handle to this file.
        if (flags & VFS.SQLITE_OPEN_MAIN_DB) {
          console.warn(`Opening ${path} with temporary file handle`);
        } else if (flags & VFS.SQLITE_OPEN_MAIN_JOURNAL) {
          const dbPath = path.replace(/-journal$/, '');
          if (this.persistentHandles.has(dbPath)) {
            throw new Error(`journal for ${dbPath} should be persistent`);
          }
        }
        file.accessHandle = this.unboundHandles.values().next().value;
        file.accessHandle.truncate(0);
        this.unboundHandles.delete(file.accessHandle);
        this.boundHandles.set(path, file.accessHandle);
      }
      this.accessiblePaths.add(path);
  
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
   * @returns {number}
   */
  jDelete(zName, syncDir) {
    try {
      const url = new URL(zName, 'file://');
      const path = url.pathname;
      const accessHandle =
        this.persistentHandles.get(path) ??
        this.boundHandles.get(path);
      accessHandle?.truncate(0);
      this.accessiblePaths.delete(path);
      return VFS.SQLITE_OK;
    } catch (e) {
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
      const url = new URL(zName, 'file://');
      const path = url.pathname;
      pResOut.setInt32(0, this.accessiblePaths.has(path) ? 1 : 0, true);
      return VFS.SQLITE_OK;
    } catch (e) {
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
      this.mapIdToFile.delete(fileId);

      if (file.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
        file.accessHandle.truncate(0);
        this.accessiblePaths.delete(file.path);
        if (!this.persistentHandles.has(file.path)) {
          this.boundHandles.delete(file.path);
          this.unboundHandles.add(file.accessHandle);
        }
      }
      return VFS.SQLITE_OK;
    } catch (e) {
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

      // On Chrome (at least), passing pData to accessHandle.read() is
      // an error because pData is a Proxy of a Uint8Array. Calling
      // subarray() produces a real Uint8Array and that works.
      const bytesRead = file.accessHandle.read(pData.subarray(), { at: iOffset });
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

  /**
   * @param {number} fileId 
   * @param {number} iSize 
   * @returns {number}
   */
  jTruncate(fileId, iSize) {
    try {
      const file = this.mapIdToFile.get(fileId);
      file.accessHandle.truncate(iSize);
      return VFS.SQLITE_OK;
    } catch (e) {
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
      file.accessHandle.flush();
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
      const size = file.accessHandle.getSize();
      pSize64.setBigInt64(0, BigInt(size), true);
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