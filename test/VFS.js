// Useful result codes.
// https://www.sqlite.org/rescode.html
export const SQLITE_OK = 0;
export const SQLITE_ERROR = 1;
export const SQLITE_BUSY = 5;
export const SQLITE_NOMEM = 7;
export const SQLITE_READONLY = 8;
export const SQLITE_IOERR = 10;
export const SQLITE_IOERR_SHORT_READ = 522;
export const SQLITE_NOTFOUND = 12;
export const SQLITE_CANTOPEN = 14;
export const SQLITE_NOTADB = 26;
export const SQLITE_ROW = 100;
export const SQLITE_DONE = 101;

// Open flags.
// https://www.sqlite.org/c3ref/c_open_autoproxy.html
export const SQLITE_OPEN_READONLY = 0x00000001;
export const SQLITE_OPEN_READWRITE = 0x00000002;
export const SQLITE_OPEN_CREATE = 0x00000004;
export const SQLITE_OPEN_DELETEONCLOSE = 0x00000008;
export const SQLITE_OPEN_EXCLUSIVE = 0x00000010;
export const SQLITE_OPEN_AUTOPROXY = 0x00000020;
export const SQLITE_OPEN_URI = 0x00000040;
export const SQLITE_OPEN_MEMORY = 0x00000080;
export const SQLITE_OPEN_MAIN_DB = 0x00000100;
export const SQLITE_OPEN_TEMP_DB = 0x00000200;
export const SQLITE_OPEN_TRANSIENT_DB = 0x00000400;
export const SQLITE_OPEN_MAIN_JOURNAL = 0x00000800;
export const SQLITE_OPEN_TEMP_JOURNAL = 0x00001000;
export const SQLITE_OPEN_SUBJOURNAL = 0x00002000;
export const SQLITE_OPEN_SUPER_JOURNAL = 0x00004000;
export const SQLITE_OPEN_NOMUTEX = 0x00008000;
export const SQLITE_OPEN_FULLMUTEX = 0x00010000;
export const SQLITE_OPEN_SHAREDCACHE = 0x00020000;
export const SQLITE_OPEN_PRIVATECACHE = 0x00040000;
export const SQLITE_OPEN_WAL = 0x00080000;
export const SQLITE_OPEN_NOFOLLOW = 0x01000000;

// Device characteristics.
// https://www.sqlite.org/c3ref/c_iocap_atomic.html
export const SQLITE_IOCAP_ATOMIC = 0x00000001;
export const SQLITE_IOCAP_ATOMIC512 = 0x00000002;
export const SQLITE_IOCAP_ATOMIC1K = 0x00000004;
export const SQLITE_IOCAP_ATOMIC2K = 0x00000008;
export const SQLITE_IOCAP_ATOMIC4K = 0x00000010;
export const SQLITE_IOCAP_ATOMIC8K = 0x00000020;
export const SQLITE_IOCAP_ATOMIC16K = 0x00000040;
export const SQLITE_IOCAP_ATOMIC32K = 0x00000080;
export const SQLITE_IOCAP_ATOMIC64K = 0x00000100;
export const SQLITE_IOCAP_SAFE_APPEND = 0x00000200;
export const SQLITE_IOCAP_SEQUENTIAL = 0x00000400;
export const SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN = 0x00000800;
export const SQLITE_IOCAP_POWERSAFE_OVERWRITE = 0x00001000;
export const SQLITE_IOCAP_IMMUTABLE = 0x00002000;
export const SQLITE_IOCAP_BATCH_ATOMIC = 0x00004000;

export class Base {
  mxPathName = 64;

  constructor(Module) {
    this.Module = Module;
    this.handleAsync = Module.handleAsync;
  }

  /**
   * @param {number} fileId 
   */
  xClose(fileId) {
    return SQLITE_IOERR;
  }

  /**
   * @param {number} fileId 
   * @param {object} pData 
   * @param {number} iOffset
   */
  xRead(fileId, pData, iOffset) {
    return SQLITE_IOERR;
  }

  /**
   * @param {number} fileId 
   * @param {object} pData
   * @param {number} iOffset
   */
  xWrite(fileId, pData, iOffset) {
    return SQLITE_IOERR;
  }

  /**
   * @param {number} fileId 
   * @param {number} iSize 
   * @returns 
   */
  xTruncate(fileId, iSize) {
    return SQLITE_IOERR;
  }

  /**
   * @param {number} fileId 
   * @param {*} flags 
   * @returns 
   */
  xSync(fileId, flags) {
    return SQLITE_OK;
  }

  /**
   * @param {number} fileId 
   * @param {object} pSize64 
   * @returns 
   */
  xFileSize(fileId, pSize64) {
    return SQLITE_IOERR;
  }

  /**
   * @param {number} fileId 
   * @param {number} flags 
   * @returns 
   */
  xLock(fileId, flags) {
    return SQLITE_OK;
  }

  /**
   * @param {number} fileId 
   * @param {number} flags 
   * @returns 
   */
  xUnlock(fileId, flags) {
    return SQLITE_OK;
  }

  /**
   * @param {number} fileId 
   * @param {object} pResOut 
   */
  xCheckReservedLock(fileId, pResOut) {
    pResOut.set(0);
    return SQLITE_OK;
  }

  /**
   * @param {number} fileId 
   * @param {number} flags 
   * @param {object} pOut 
   * @returns 
   */
  xFileControl(fileId, flags, pOut) {
    return SQLITE_NOTFOUND;
  }

  /**
   * @param {number} fileId 
   * @returns 
   */
  xSectorSize(fileId) {
    return 0;
  }

  /**
   * @param {number} fileId 
   * @returns 
   */
  xDeviceCharacteristics(fileId) {
    return 0;
  }

  /**
   * @param {string?} name 
   * @param {number} fileId 
   * @param {number} flags 
   * @param {object} pOutFlags 
   * @returns 
   */
  xOpen(name, fileId, flags, pOutFlags) {
    return SQLITE_CANTOPEN;
  }

  /**
   * 
   * @param {string} name 
   * @param {number} syncDir 
   * @returns 
   */
  xDelete(name, syncDir) {
    return SQLITE_IOERR;
  }

  /**
   * @param {string} name 
   * @param {number} flags 
   * @param {object} pResOut 
   * @returns 
   */
  xAccess(name, flags, pResOut) {
    return SQLITE_IOERR;
  }
}
