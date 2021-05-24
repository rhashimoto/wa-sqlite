import * as VFS from './sqlite-constants.js';
export * from './sqlite-constants.js';

// Base class for a VFS.
export class Base {
  mxPathName = 64;

  /**
   * @param {number} fileId 
   * @returns {number|Promise<number>}
   */
  xClose(fileId) {
    return VFS.SQLITE_IOERR;
  }

  /**
   * @param {number} fileId 
   * @param {{ size: number, value: Int8Array }} pData 
   * @param {number} iOffset
   * @returns {number|Promise<number>}
   */
  xRead(fileId, pData, iOffset) {
    return VFS.SQLITE_IOERR;
  }

  /**
   * @param {number} fileId 
   * @param {{ size: number, value: Int8Array }} pData 
   * @param {number} iOffset
   * @returns {number|Promise<number>}
   */
  xWrite(fileId, pData, iOffset) {
    return VFS.SQLITE_IOERR;
  }

  /**
   * @param {number} fileId 
   * @param {number} iSize 
   * @returns {number|Promise<number>}
   */
  xTruncate(fileId, iSize) {
    return VFS.SQLITE_IOERR;
  }

  /**
   * @param {number} fileId 
   * @param {*} flags 
   * @returns {number|Promise<number>}
   */
  xSync(fileId, flags) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} fileId 
   * @param {{ set: function(number): void }} pSize64 
   * @returns {number|Promise<number>}
   */
  xFileSize(fileId, pSize64) {
    return VFS.SQLITE_IOERR;
  }

  /**
   * @param {number} fileId 
   * @param {number} flags 
   * @returns {number|Promise<number>}
   */
  xLock(fileId, flags) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} fileId 
   * @param {number} flags 
   * @returns {number|Promise<number>}
   */
  xUnlock(fileId, flags) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} fileId 
   * @param {{ set: function(number): void }} pResOut 
   * @returns {number|Promise<number>}
   */
  xCheckReservedLock(fileId, pResOut) {
    pResOut.set(0);
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} fileId 
   * @param {number} flags 
   * @param {{ value: Int8Array }} pOut 
   * @returns {number|Promise<number>}
   */
  xFileControl(fileId, flags, pOut) {
    return VFS.SQLITE_NOTFOUND;
  }

  /**
   * @param {number} fileId 
   * @returns {number|Promise<number>}
   */
  xSectorSize(fileId) {
    return 0;
  }

  /**
   * @param {number} fileId 
   * @returns {number|Promise<number>}
   */
  xDeviceCharacteristics(fileId) {
    return 0;
  }

  /**
   * @param {string?} name 
   * @param {number} fileId 
   * @param {number} flags 
   * @param {{ set: function(number): void }} pOutFlags 
   * @returns {number|Promise<number>}
   */
  xOpen(name, fileId, flags, pOutFlags) {
    return VFS.SQLITE_CANTOPEN;
  }

  /**
   * 
   * @param {string} name 
   * @param {number} syncDir 
   * @returns {number|Promise<number>}
   */
  xDelete(name, syncDir) {
    return VFS.SQLITE_IOERR;
  }

  /**
   * @param {string} name 
   * @param {number} flags 
   * @param {{ set: function(number): void }} pResOut 
   * @returns {number|Promise<number>}
   */
  xAccess(name, flags, pResOut) {
    return VFS.SQLITE_IOERR;
  }

  /**
   * Handle asynchronous operation. This implementation will be overriden on
   * registration by an Asyncify build.
   * @param {function(): Promise<number>} f 
   * @returns {Promise<number>}
   */
  handleAsync(f) {
    throw new Error('No Asyncify runtime');
  }
}
