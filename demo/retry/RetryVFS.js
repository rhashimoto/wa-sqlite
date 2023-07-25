// Copyright 2023 Roy T. Hashimoto. All Rights Reserved.
import * as VFS from '../../src/VFS.js';

const SECTOR_SIZE = 4096;

function log(...args) {
  console.debug(...args);
}

class FileEntry {
  static getByPath(path) {
    return FileEntry.#mapPathToEntry.get(path);
  }

  static async isReady() {
    const pending = FileEntry.#pending;
    FileEntry.#pending = [];
    return Promise.all(pending);
  }

  /** @type {Promise[]} */ static #pending = [];
  /** @type {Map<string,FileEntry>} */ static #mapPathToEntry = new Map();

  /** @type {string} */ path;
  /** @type {number} */ flags;
  /** @type {FileSystemFileHandle} */ fileHandle;
  /** @type {FileSystemSyncAccessHandle} */ accessHandle = null;

  /** @type {(...args: any) => void} */ #lockRelease = null;

  constructor(path, flags) {
    FileEntry.#mapPathToEntry.set(path, this);
    this.path = path;
    this.flags = flags;
    FileEntry.#pending.push(this.#initialize());
  }

  async acquireAccessHandle() {
    // SQLite can read a database file outside the scope of a lock,
    // so keep trying to get the access handle until successful.
    while (true) {
      try {
        this.accessHandle = await this.fileHandle.createSyncAccessHandle();
        return;
      } catch (e) {
        if (e.name !== 'NoModificationAllowedError') throw e;
        console.warn(`contention for ${this.path}`);
        await new Promise(resolve => setTimeout(resolve, 2500));
      }     
    }
  }

  releaseAccessHandle() {
    this.accessHandle?.close();
    this.accessHandle = null;
  }

  xRead(pData, iOffset) {
    log(`xRead ${this.path} ${pData.byteLength} ${iOffset}`);

    if (!this.accessHandle) {
      // This is a read without a lock. Acquire an access handle just
      // for this read, and have the application retry it.
      FileEntry.#pending.push(this.acquireAccessHandle());
      return VFS.SQLITE_IOERR;
    }

    const nBytes = this.accessHandle.read(pData, { at: iOffset });

    if ((this.flags & VFS.SQLITE_OPEN_MAIN_DB) && !this.#lockRelease) {
      // This was a read without a lock, so don't keep the access handle.
      // This happens when SQLite opens a database file and checks the
      // header to verify it is a database file.
      this.releaseAccessHandle();
    }

    if (nBytes < pData.byteLength) {
      pData.fill(0, nBytes, pData.byteLength);
      return VFS.SQLITE_IOERR_SHORT_READ;
    }
    return VFS.SQLITE_OK;
  }

  xWrite(pData, iOffset) {
    log(`xWrite ${this.path} ${pData.byteLength} ${iOffset}`);
    const nBytes = this.accessHandle.write(pData, { at: iOffset });
    return nBytes === pData.byteLength ? VFS.SQLITE_OK : VFS.SQLITE_IOERR;
  }

  xTruncate(iSize) {
    log(`xTruncate ${this.path} ${iSize}`);
    this.accessHandle.truncate(iSize);
    return VFS.SQLITE_OK;
  }

  xSync(flags) {
    log(`xSync ${this.path} ${flags}`);
    this.accessHandle.flush();
    return VFS.SQLITE_OK;
  }

  xFileSize(pSize64) {
    const size = this.accessHandle.getSize();
    log(`xFileSize ${this.path} ${size}`);
    pSize64.setBigInt64(0, BigInt(size), true);
    return VFS.SQLITE_OK;
  }

  xLock(flags) {
    log(`xLock ${this.path} ${flags}`);
    if (!this.#lockRelease) {
      // Get an exclusive Web Lock *and* acquire access handles.
      FileEntry.#pending.push(new Promise(resolve => {
        navigator.locks.request(this.path, () => new Promise(lockRelease => {
          // Resolving the inner Promise releases the Web Lock.
          this.#lockRelease = lockRelease;

          // Resolving the outer Promise completes the task.
          resolve(Promise.all([
            this.acquireAccessHandle(),
            this.#getJournal().acquireAccessHandle()
          ]));
        }));
      }));
      log('RetryVFS returns SQLITE_BUSY to acquire Web Lock');
      return VFS.SQLITE_BUSY;      
    }
    return VFS.SQLITE_OK;
  }

  xUnlock(flags) {
    log(`xUnlock ${this.path} ${flags}`);
    if (flags === VFS.SQLITE_LOCK_NONE) {
      this.releaseAccessHandle();
      this.#getJournal().releaseAccessHandle();

      this.#lockRelease?.();
      this.#lockRelease = null;
    }
    return VFS.SQLITE_OK;
  }

  async #initialize() {
    if (this.flags & VFS.SQLITE_OPEN_MAIN_DB) {
      // Preemptively open/create the journal file.
      this.#getJournal();
    }

    const components = this.path.split('/').filter(s => s);
    const filename = components.pop();

    let dirHandle = await navigator.storage.getDirectory();
    const create = !!(this.flags & VFS.SQLITE_OPEN_CREATE);
    for (const component of components) {
      dirHandle = await dirHandle.getDirectoryHandle(component, { create });
    }
    this.fileHandle = await dirHandle.getFileHandle(filename, { create });

    if (this.flags & VFS.SQLITE_OPEN_MAIN_DB) {
      // When SQLite opens a database file, it starts by reading the header
      // (without a lock). Get the access handle so this initial read will
      // succeed.
      await this.acquireAccessHandle();
    }
  }

  #getJournal() {
    if (!(this.flags & VFS.SQLITE_OPEN_MAIN_DB)) throw new Error('not a db file');

    const journalPath = `${this.path}-journal`;
    return FileEntry.getByPath(journalPath) ??
      new FileEntry(
        journalPath,
        VFS.SQLITE_OPEN_MAIN_JOURNAL | VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE);
  }
}

export class RetryVFS extends VFS.Base {
  /** @type {Map<number,FileEntry>} */ #mapFileIdToEntry = new Map();

  constructor(dbPath) {
    super();
    const url = new URL(dbPath, 'file:///');
    new FileEntry(
      url.pathname,
      VFS.SQLITE_OPEN_MAIN_DB | VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE);
  }

  get name() { return 'Retry'; }
  get isReady() {
    return FileEntry.isReady();
  }

  /**
   * @param {string?} path 
   * @param {number} fileId 
   * @param {number} flags 
   * @param {DataView} pOutFlags 
   * @returns {number}
   */
  xOpen(path, fileId, flags, pOutFlags) {
    log(`xOpen ${path} ${fileId} 0x${flags.toString(16)}`);
    if (!path) throw new Error('filename generation not supported')

    const url = new URL(path, 'file:///');
    const entry = FileEntry.getByPath(url.pathname) ?? new FileEntry(url.pathname, flags);
    if (!entry) return VFS.SQLITE_CANTOPEN;

    this.#mapFileIdToEntry.set(fileId, entry);
    pOutFlags.setInt32(0, flags, true);
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} fileId 
   * @returns {number}
   */
  xClose(fileId) {
    const entry = this.#mapFileIdToEntry.get(fileId);
    log(`xClose ${entry.path}`);
    this.#mapFileIdToEntry.delete(fileId);
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} fileId 
   * @param {Uint8Array} pData 
   * @param {number} iOffset
   * @returns {number}
   */
  xRead(fileId, pData, iOffset) {
    const entry = this.#mapFileIdToEntry.get(fileId);
    return entry.xRead(pData, iOffset);
  }
  
  /**
   * @param {number} fileId 
   * @param {Uint8Array} pData 
   * @param {number} iOffset
   * @returns {number}
   */
  xWrite(fileId, pData, iOffset) {
    const entry = this.#mapFileIdToEntry.get(fileId);
    return entry.xWrite(pData, iOffset);
  }

  /**
   * @param {number} fileId 
   * @param {number} iSize 
   * @returns {number}
   */
  xTruncate(fileId, iSize) {
    const entry = this.#mapFileIdToEntry.get(fileId);
    return entry.xTruncate(iSize);
  }

  /**
   * @param {number} fileId 
   * @param {*} flags 
   * @returns {number}
   */
  xSync(fileId, flags) {
    const entry = this.#mapFileIdToEntry.get(fileId);
    return entry.xSync(flags);
  }

  /**
   * @param {number} fileId 
   * @param {DataView} pSize64 
   * @returns {number}
   */
  xFileSize(fileId, pSize64) {
    const entry = this.#mapFileIdToEntry.get(fileId);
    return entry.xFileSize(pSize64);
  }

  /**
   * @param {number} fileId 
   * @param {number} flags 
   * @returns {number}
   */
  xLock(fileId, flags) {
    const entry = this.#mapFileIdToEntry.get(fileId);
    return entry.xLock(flags);
  }

  /**
   * @param {number} fileId 
   * @param {number} flags 
   * @returns {number}
   */
  xUnlock(fileId, flags) {
    const entry = this.#mapFileIdToEntry.get(fileId);
    return entry.xUnlock(flags);
  }

  /**
   * @param {string} name 
   * @param {number} flags 
   * @param {DataView} pResOut 
   * @returns {number}
   */
  xAccess(name, flags, pResOut) {
    log(`xAccess ${name} ${flags}`);
    pResOut.setInt32(0, FileEntry.getByPath(name) ? 1 : 0, true);
    return VFS.SQLITE_OK;
  }

  /**
   * @param {string} name 
   * @param {number} syncDir 
   * @returns {number}
   */
  xDelete(name, syncDir) {
    log(`xDelete ${name} ${syncDir}`);

    // This VFS does not support deleting files. That means that the
    // default journal_mode=DELETE cannot be used and temporary files
    // must be kept in memory.
    return VFS.SQLITE_IOERR_DELETE;
  }

  /**
   * @param {number} fileId 
   * @returns {number}
   */
  xSectorSize(fileId) {
    log('xSectorSize', SECTOR_SIZE);
    return SECTOR_SIZE;
  }

  /**
   * @param {number} fileId 
   * @returns {number}
   */
  xDeviceCharacteristics(fileId) {
    log('xDeviceCharacteristics');
    return VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN;
  }
}