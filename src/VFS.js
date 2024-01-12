// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
import * as VFS from './sqlite-constants.js';
export * from './sqlite-constants.js';

const DEFAULT_SECTOR_SIZE = 512;

// Base class for a VFS.
export class Base {
  name;
  mxPathname = 64;
  _module;

  /**
   * @param {string} name 
   * @param {object} module 
   */
  constructor(name, module) {
    this.name = name;
    this._module = module;
  }

  /**
   * Overload in subclasses to indicate which methods are asynchronous.
   * @param {string} methodName 
   * @returns {boolean}
   */
  hasAsyncMethod(methodName) {
    return false;
  }

  /**
   * @param {number} vfs 
   * @param {number} zName 
   * @param {number} file 
   * @param {number} flags 
   * @param {number} pOutFlags 
   * @returns {number|Promise<number>}
   */
  xOpen(vfs, zName, file, flags, pOutFlags) {
    return VFS.SQLITE_CANTOPEN;
  }

  /**
   * @param {number} vfs 
   * @param {number} zName 
   * @param {number} syncDir 
   * @returns {number|Promise<number>}
   */
  xDelete(vfs, zName, syncDir) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} vfs 
   * @param {number} zName 
   * @param {number} flags 
   * @param {number} pResOut 
   * @returns {number|Promise<number>}
   */
  xAccess(vfs, zName, flags, pResOut) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} vfs 
   * @param {number} zName 
   * @param {number} nOut 
   * @param {number} zOut 
   * @returns {number|Promise<number>}
   */
  xFullPathname(vfs, zName, nOut, zOut) {
    // Just copy to the output buffer.
    this._module.HEAPU8.subarray(zOut, zOut + nOut)
      .set(this._module.HEAPU8.subarray(zName, zName + nOut));
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} vfs 
   * @param {number} nBuf 
   * @param {number} zBuf 
   * @returns {number|Promise<number>}
   */
  xGetLastError(vfs, nBuf, zBuf) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} file 
   * @returns {number|Promise<number>}
   */
  xClose(file) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} file 
   * @param {number} pData 
   * @param {number} iAmt 
   * @param {number} iOffsetLo 
   * @param {number} iOffsetHi 
   * @returns {number|Promise<number>}
   */
  xRead(file, pData, iAmt, iOffsetLo, iOffsetHi) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} file 
   * @param {number} pData 
   * @param {number} iAmt 
   * @param {number} iOffsetLo 
   * @param {number} iOffsetHi 
   * @returns {number|Promise<number>}
   */
  xWrite(file, pData, iAmt, iOffsetLo, iOffsetHi) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} file 
   * @param {number} sizeLo 
   * @param {number} sizeHi 
   * @returns {number|Promise<number>}
   */
  xTruncate(file, sizeLo, sizeHi) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} file 
   * @param {number} flags 
   * @returns {number|Promise<number>}
   */
  xSync(file, flags) {
    return VFS.SQLITE_OK;
  }

  /**
   * 
   * @param {number} file 
   * @param {number} pSize 
   * @returns {number|Promise<number>}
   */
  xFileSize(file, pSize) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} file 
   * @param {number} lockType 
   * @returns {number|Promise<number>}
   */
  xLock(file, lockType) {
    console.log('xLock', file, lockType);
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} file 
   * @param {number} lockType 
   * @returns {number|Promise<number>}
   */
  xUnlock(file, lockType) {
    return VFS.SQLITE_OK;
  } 

  /**
   * @param {number} file 
   * @param {number} pResOut 
   * @returns {number|Promise<number>}
   */
  xCheckReservedLock(file, pResOut) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} file 
   * @param {number} op 
   * @param {number} pArg 
   * @returns {number|Promise<number>}
   */
  xFileControl(file, op, pArg) {
    return VFS.SQLITE_NOTFOUND;
  }

  /**
   * @param {number} file 
   * @returns {number|Promise<number>}
   */
  xSectorSize(file) {
    return DEFAULT_SECTOR_SIZE;
  }

  /**
   * @param {number} file 
   * @returns {number|Promise<number>}
   */
  xDeviceCharacteristics(file) {
    return 0;
  }
}

export const FILE_TYPE_MASK = [
  VFS.SQLITE_OPEN_MAIN_DB,
  VFS.SQLITE_OPEN_MAIN_JOURNAL,
  VFS.SQLITE_OPEN_TEMP_DB,
  VFS.SQLITE_OPEN_TEMP_JOURNAL,
  VFS.SQLITE_OPEN_TRANSIENT_DB,
  VFS.SQLITE_OPEN_SUBJOURNAL,
  VFS.SQLITE_OPEN_SUPER_JOURNAL
].reduce((mask, element) => mask | element);