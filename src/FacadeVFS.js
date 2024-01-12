// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
import * as VFS from './VFS.js';

const isLogging = true;
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

// Convenience base class for a JavaScript VFS.
// The raw xOpen, xRead, etc. function signatures receive only C primitives
// which aren't easy to work with. This class provides corresponding calls
// like jOpen, jRead, etc., which receive JavaScript-friendlier arguments
// such as string, Uint8Array, and DataView.
export class FacadeVFS extends VFS.Base {
  /**
   * @param {string} name 
   * @param {object} module 
   */
  constructor(name, module) {
    super(name, module);
  }

  // Override to indicate which methods are asynchronous.
  hasAsyncMethod(methodName) {
    // The input argument is a string like "xOpen", so convert to "jOpen".
    // Then check if the method exists and is async.
    const jMethodName = `j${methodName.slice(1)}`;
    return this[jMethodName] instanceof AsyncFunction;
  }
  
  /**
   * @param {string?} filename 
   * @param {number} file 
   * @param {number} flags 
   * @param {DataView} pOutFlags 
   * @returns {number|Promise<number>}
   */
  jOpen(filename, file, flags, pOutFlags) {
    return VFS.SQLITE_CANTOPEN;
  }

  /**
   * @param {string} filename 
   * @param {number} syncDir 
   * @returns {number|Promise<number>}
   */
  jDelete(filename, syncDir) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {string} filename 
   * @param {number} flags 
   * @param {DataView} pResOut 
   * @returns {number|Promise<number>}
   */
  jAccess(filename, flags, pResOut) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {string} filename 
   * @param {Uint8Array} zOut 
   * @returns {number|Promise<number>}
   */
  jFullPathname(filename, zOut) {
    // Copy the filename to the output buffer.
    const { read, written } = new TextEncoder().encodeInto(filename, zOut);
    if (read < filename.length) return VFS.SQLITE_IOERR;
    if (written >= zOut.length) return VFS.SQLITE_IOERR;
    zOut[written] = 0;
    return VFS.SQLITE_OK;
  }

  /**
   * @param {Uint8Array} zBuf 
   * @returns {number|Promise<number>}
   */
  jGetLastError(zBuf) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} file 
   * @returns {number|Promise<number>}
   */
  jClose(file) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} file 
   * @param {Uint8Array} pData 
   * @param {number} iOffset 
   * @returns {number|Promise<number>}
   */
  jRead(file, pData, iOffset) {
    pData.fill(0);
    return VFS.SQLITE_IOERR_SHORT_READ;
  }

  /**
   * @param {number} file 
   * @param {Uint8Array} pData 
   * @param {number} iOffset 
   * @returns {number|Promise<number>}
   */
  jWrite(file, pData, iOffset) {
    return VFS.SQLITE_IOERR_WRITE;
  }

  /**
   * @param {number} file 
   * @param {number} size 
   * @returns {number|Promise<number>}
   */
  jTruncate(file, size) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} file 
   * @param {number} flags 
   * @returns {number|Promise<number>}
   */
  jSync(file, flags) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} file 
   * @param {DataView} pSize
   * @returns {number|Promise<number>}
   */
  jFileSize(file, pSize) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} file 
   * @param {number} lock 
   * @returns {number|Promise<number>}
   */
  jLock(file, lock) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} file 
   * @param {number} lock 
   * @returns {number|Promise<number>}
   */
  jUnlock(file, lock) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} file 
   * @param {DataView} pResOut 
   * @returns {number|Promise<number>}
   */
  jCheckReservedLock(file, pResOut) {
    pResOut.setInt32(0, 0, true);
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} file
   * @param {number} op
   * @param {DataView} pArg
   * @returns {number|Promise<number>}
   */
  jFileControl(file, op, pArg) {
    return VFS.SQLITE_NOTFOUND;
  }

  /**
   * @param {number} file
   * @returns {number|Promise<number>}
   */
  jSectorSize(file) {
    return super.xSectorSize(file);
  }

  /**
   * @param {number} file
   * @returns {number|Promise<number>}
   */
  jDeviceCharacteristics(file) {
    return 0;
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
    // TODO: Restore URI.
    const filename = zName ? this._module.UTF8ToString(zName) : null;
    const pOutFlagsView = this.#makeTypedDataView('Int32', pOutFlags);
    if (isLogging) console.debug('xOpen', filename, file, flags, pOutFlagsView);
    return this.jOpen(filename, file, flags, pOutFlagsView);
  }

  /**
   * @param {number} vfs 
   * @param {number} zName 
   * @param {number} syncDir 
   * @returns {number|Promise<number>}
   */
  xDelete(vfs, zName, syncDir) {
    const filename = this._module.UTF8ToString(zName);
    if (isLogging) console.debug('xDelete', filename, syncDir);
    return this.jDelete(filename, syncDir);
  }

  /**
   * @param {number} vfs 
   * @param {number} zName 
   * @param {number} flags 
   * @param {number} pResOut 
   * @returns {number|Promise<number>}
   */
  xAccess(vfs, zName, flags, pResOut) {
    const filename = this._module.UTF8ToString(zName);
    const pResOutView = this.#makeTypedDataView('Int32', pResOut);
    if (isLogging) console.debug('xAccess', filename, flags, pResOutView);
    return this.jAccess(filename, flags, pResOutView);
  }

  /**
   * @param {number} vfs 
   * @param {number} zName 
   * @param {number} nOut 
   * @param {number} zOut 
   * @returns {number|Promise<number>}
   */
  xFullPathname(vfs, zName, nOut, zOut) {
    const filename = this._module.UTF8ToString(zName);
    const zOutArray = this._module.HEAPU8.subarray(zOut, zOut + nOut);
    if (isLogging) console.debug('xFullPathname', filename, nOut, zOutArray);
    return this.jFullPathname(filename, zOutArray);
  }

  /**
   * @param {number} vfs 
   * @param {number} nBuf 
   * @param {number} zBuf 
   * @returns {number|Promise<number>}
   */
  xGetLastError(vfs, nBuf, zBuf) {
    const zBufArray = this._module.HEAPU8.subarray(zBuf, zBuf + nBuf);
    if (isLogging) console.debug('xGetLastError', nBuf, zBufArray);
    return this.jGetLastError(zBufArray);
  }

  /**
   * @param {number} file 
   * @returns {number|Promise<number>}
   */
  xClose(file) {
    if (isLogging) console.debug('xClose', file);
    return this.jClose(file);
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
    const pDataArray = this._module.HEAPU8.subarray(pData, pData + iAmt);
    const iOffset = delegalize(iOffsetLo, iOffsetHi);
    if (isLogging) console.debug('xRead', file, pDataArray, iOffset);
    return this.jRead(file, pDataArray, iOffset);
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
    const pDataArray = this._module.HEAPU8.subarray(pData, pData + iAmt);
    const iOffset = delegalize(iOffsetLo, iOffsetHi);
    if (isLogging) console.debug('xWrite', file, pDataArray, iOffset);
    return this.jWrite(file, pDataArray, iOffset);
  }

  /**
   * @param {number} file 
   * @param {number} sizeLo 
   * @param {number} sizeHi 
   * @returns {number|Promise<number>}
   */
  xTruncate(file, sizeLo, sizeHi) {
    const size = delegalize(sizeLo, sizeHi);
    if (isLogging) console.debug('xTruncate', file, size);
    return this.jTruncate(file, size);
  }

  /**
   * @param {number} file 
   * @param {number} flags 
   * @returns {number|Promise<number>}
   */
  xSync(file, flags) {
    if (isLogging) console.debug('xSync', file, flags);
    return this.jSync(file, flags);
  }

  /**
   * 
   * @param {number} file 
   * @param {number} pSize 
   * @returns {number|Promise<number>}
   */
  xFileSize(file, pSize) {
    const pSizeView = this.#makeTypedDataView('BigInt64', pSize);
    if (isLogging) console.debug('xFileSize', file, pSizeView);
    return this.jFileSize(file, pSizeView);
  }

  /**
   * @param {number} file 
   * @param {number} lock 
   * @returns {number|Promise<number>}
   */
  xLock(file, lock) {
    if (isLogging) console.debug('xLock', file, lock);
    return this.jLock(file, lock);
  }

  /**
   * @param {number} file 
   * @param {number} lock 
   * @returns {number|Promise<number>}
   */
  xUnlock(file, lock) {
    if (isLogging) console.debug('xUnlock', file, lock);
    return this.jUnlock(file, lock);
  } 

  /**
   * @param {number} file 
   * @param {number} pResOut 
   * @returns {number|Promise<number>}
   */
  xCheckReservedLock(file, pResOut) {
    const pResOutView = this.#makeTypedDataView('Int32', pResOut);
    if (isLogging) console.debug('xCheckReservedLock', file, pResOutView);
    return this.jCheckReservedLock(file, pResOutView);
  }

  /**
   * @param {number} file 
   * @param {number} op 
   * @param {number} pArg 
   * @returns {number|Promise<number>}
   */
  xFileControl(file, op, pArg) {
    const pArgView = new DataView(
      this._module.HEAPU8.buffer,
      this._module.HEAPU8.byteOffset + pArg);
    if (isLogging) console.debug('xFileControl', file, op, pArgView);
    return this.jFileControl(file, op, pArgView);
  }

  /**
   * @param {number} file 
   * @returns {number|Promise<number>}
   */
  xSectorSize(file) {
    if (isLogging) console.debug('xSectorSize', file);
    return this.jSectorSize(file);
  }

  /**
   * @param {number} file 
   * @returns {number|Promise<number>}
   */
  xDeviceCharacteristics(file) {
    if (isLogging) console.debug('xDeviceCharacteristics', file);
    return this.jDeviceCharacteristics(file);
  }

  /**
   * Wrapped DataView for pointer arguments.
   * Pointers to a single value are passed using DataView. A Proxy
   * wrapper prevents use of incorrect type or endianness.
   * @param {'Int32'|'BigInt64'} type 
   * @param {number} byteOffset 
   * @returns {DataView}
   */
  #makeTypedDataView(type, byteOffset) {
    const byteLength = type === 'Int32' ? 4 : 8;
    const getter = `get${type}`;
    const setter = `set${type}`;
    const dataView = new DataView(
      this._module.HEAPU8.buffer,
      this._module.HEAPU8.byteOffset + byteOffset,
      byteLength);
    return new Proxy(dataView, {
      get(target, prop) {
        if (prop === getter) {
          return function(byteOffset, littleEndian) {
            if (!littleEndian) throw new Error('must be little endian');
            return target[prop](byteOffset, littleEndian);
          }
        }
        if (prop === setter) {
          return function(byteOffset, value, littleEndian) {
            if (!littleEndian) throw new Error('must be little endian');
            return target[prop](byteOffset, value, littleEndian);
          }
        }
        if (typeof prop === 'string' && (prop.match(/^(get)|(set)/))) {
          throw new Error('invalid type');
        }
        return target[prop];
      }
    });
  }

}

// Emscripten "legalizes" 64-bit integer arguments by passing them as
// two 32-bit signed integers.
function delegalize(lo32, hi32) {
  return (hi32 * 0x100000000) + lo32 + (lo32 < 0 ? 2**32 : 0);
}
