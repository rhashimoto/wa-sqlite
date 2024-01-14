// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
import * as VFS from './VFS.js';

const isLogging = false;
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

  /**
   * Override to indicate which methods are asynchronous.
   * @param {string} methodName 
   * @returns {boolean}
   */
  hasAsyncMethod(methodName) {
    // The input argument is a string like "xOpen", so convert to "jOpen".
    // Then check if the method exists and is async.
    const jMethodName = `j${methodName.slice(1)}`;
    return this[jMethodName] instanceof AsyncFunction;
  }
  
  /**
   * Return the lock name for a file to be used by locking mixins.
   * @param {number} pFile 
   * @returns {string}
   */
  getLockName(pFile) {
    throw new Error('unimplemented');
  }

  /**
   * @param {string?} filename 
   * @param {number} pFile 
   * @param {number} flags 
   * @param {DataView} pOutFlags 
   * @returns {number|Promise<number>}
   */
  jOpen(filename, pFile, flags, pOutFlags) {
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
   * @param {number} pFile 
   * @returns {number|Promise<number>}
   */
  jClose(pFile) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} pFile 
   * @param {Uint8Array} pData 
   * @param {number} iOffset 
   * @returns {number|Promise<number>}
   */
  jRead(pFile, pData, iOffset) {
    pData.fill(0);
    return VFS.SQLITE_IOERR_SHORT_READ;
  }

  /**
   * @param {number} pFile 
   * @param {Uint8Array} pData 
   * @param {number} iOffset 
   * @returns {number|Promise<number>}
   */
  jWrite(pFile, pData, iOffset) {
    return VFS.SQLITE_IOERR_WRITE;
  }

  /**
   * @param {number} pFile 
   * @param {number} size 
   * @returns {number|Promise<number>}
   */
  jTruncate(pFile, size) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} pFile 
   * @param {number} flags 
   * @returns {number|Promise<number>}
   */
  jSync(pFile, flags) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} pFile 
   * @param {DataView} pSize
   * @returns {number|Promise<number>}
   */
  jFileSize(pFile, pSize) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} pFile 
   * @param {number} lockType 
   * @returns {number|Promise<number>}
   */
  jLock(pFile, lockType) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} pFile 
   * @param {number} lockType 
   * @returns {number|Promise<number>}
   */
  jUnlock(pFile, lockType) {
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} pFile 
   * @param {DataView} pResOut 
   * @returns {number|Promise<number>}
   */
  jCheckReservedLock(pFile, pResOut) {
    pResOut.setInt32(0, 0, true);
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} pFile
   * @param {number} op
   * @param {DataView} pArg
   * @returns {number|Promise<number>}
   */
  jFileControl(pFile, op, pArg) {
    return VFS.SQLITE_NOTFOUND;
  }

  /**
   * @param {number} pFile
   * @returns {number|Promise<number>}
   */
  jSectorSize(pFile) {
    return super.xSectorSize(pFile);
  }

  /**
   * @param {number} pFile
   * @returns {number|Promise<number>}
   */
  jDeviceCharacteristics(pFile) {
    return 0;
  }

  /**
   * @param {number} pVfs 
   * @param {number} zName 
   * @param {number} pFile 
   * @param {number} flags 
   * @param {number} pOutFlags 
   * @returns {number|Promise<number>}
   */
  xOpen(pVfs, zName, pFile, flags, pOutFlags) {
    const filename = this.#decodeFilename(zName, flags);
    const pOutFlagsView = this.#makeTypedDataView('Int32', pOutFlags);
    if (isLogging) console.debug('xOpen', filename, pFile, flags, pOutFlagsView);
    return this.jOpen(filename, pFile, flags, pOutFlagsView);
  }

  /**
   * @param {number} pVfs 
   * @param {number} zName 
   * @param {number} syncDir 
   * @returns {number|Promise<number>}
   */
  xDelete(pVfs, zName, syncDir) {
    const filename = this._module.UTF8ToString(zName);
    if (isLogging) console.debug('xDelete', filename, syncDir);
    return this.jDelete(filename, syncDir);
  }

  /**
   * @param {number} pVfs 
   * @param {number} zName 
   * @param {number} flags 
   * @param {number} pResOut 
   * @returns {number|Promise<number>}
   */
  xAccess(pVfs, zName, flags, pResOut) {
    const filename = this._module.UTF8ToString(zName);
    const pResOutView = this.#makeTypedDataView('Int32', pResOut);
    if (isLogging) console.debug('xAccess', filename, flags, pResOutView);
    return this.jAccess(filename, flags, pResOutView);
  }

  /**
   * @param {number} pVfs 
   * @param {number} zName 
   * @param {number} nOut 
   * @param {number} zOut 
   * @returns {number|Promise<number>}
   */
  xFullPathname(pVfs, zName, nOut, zOut) {
    const filename = this._module.UTF8ToString(zName);
    const zOutArray = this._module.HEAPU8.subarray(zOut, zOut + nOut);
    if (isLogging) console.debug('xFullPathname', filename, nOut, zOutArray);
    return this.jFullPathname(filename, zOutArray);
  }

  /**
   * @param {number} pVfs 
   * @param {number} nBuf 
   * @param {number} zBuf 
   * @returns {number|Promise<number>}
   */
  xGetLastError(pVfs, nBuf, zBuf) {
    const zBufArray = this._module.HEAPU8.subarray(zBuf, zBuf + nBuf);
    if (isLogging) console.debug('xGetLastError', nBuf, zBufArray);
    return this.jGetLastError(zBufArray);
  }

  /**
   * @param {number} pFile 
   * @returns {number|Promise<number>}
   */
  xClose(pFile) {
    if (isLogging) console.debug('xClose', pFile);
    return this.jClose(pFile);
  }

  /**
   * @param {number} pFile 
   * @param {number} pData 
   * @param {number} iAmt 
   * @param {number} iOffsetLo 
   * @param {number} iOffsetHi 
   * @returns {number|Promise<number>}
   */
  xRead(pFile, pData, iAmt, iOffsetLo, iOffsetHi) {
    const pDataArray = this._module.HEAPU8.subarray(pData, pData + iAmt);
    const iOffset = delegalize(iOffsetLo, iOffsetHi);
    if (isLogging) console.debug('xRead', pFile, pDataArray, iOffset);
    return this.jRead(pFile, pDataArray, iOffset);
  }

  /**
   * @param {number} pFile 
   * @param {number} pData 
   * @param {number} iAmt 
   * @param {number} iOffsetLo 
   * @param {number} iOffsetHi 
   * @returns {number|Promise<number>}
   */
  xWrite(pFile, pData, iAmt, iOffsetLo, iOffsetHi) {
    const pDataArray = this._module.HEAPU8.subarray(pData, pData + iAmt);
    const iOffset = delegalize(iOffsetLo, iOffsetHi);
    if (isLogging) console.debug('xWrite', pFile, pDataArray, iOffset);
    return this.jWrite(pFile, pDataArray, iOffset);
  }

  /**
   * @param {number} pFile 
   * @param {number} sizeLo 
   * @param {number} sizeHi 
   * @returns {number|Promise<number>}
   */
  xTruncate(pFile, sizeLo, sizeHi) {
    const size = delegalize(sizeLo, sizeHi);
    if (isLogging) console.debug('xTruncate', pFile, size);
    return this.jTruncate(pFile, size);
  }

  /**
   * @param {number} pFile 
   * @param {number} flags 
   * @returns {number|Promise<number>}
   */
  xSync(pFile, flags) {
    if (isLogging) console.debug('xSync', pFile, flags);
    return this.jSync(pFile, flags);
  }

  /**
   * 
   * @param {number} pFile 
   * @param {number} pSize 
   * @returns {number|Promise<number>}
   */
  xFileSize(pFile, pSize) {
    const pSizeView = this.#makeTypedDataView('BigInt64', pSize);
    if (isLogging) console.debug('xFileSize', pFile, pSizeView);
    return this.jFileSize(pFile, pSizeView);
  }

  /**
   * @param {number} pFile 
   * @param {number} lockType 
   * @returns {number|Promise<number>}
   */
  xLock(pFile, lockType) {
    if (isLogging) console.debug('xLock', pFile, lockType);
    return this.jLock(pFile, lockType);
  }

  /**
   * @param {number} pFile 
   * @param {number} lockType 
   * @returns {number|Promise<number>}
   */
  xUnlock(pFile, lockType) {
    if (isLogging) console.debug('xUnlock', pFile, lockType);
    return this.jUnlock(pFile, lockType);
  } 

  /**
   * @param {number} pFile 
   * @param {number} pResOut 
   * @returns {number|Promise<number>}
   */
  xCheckReservedLock(pFile, pResOut) {
    const pResOutView = this.#makeTypedDataView('Int32', pResOut);
    if (isLogging) console.debug('xCheckReservedLock', pFile, pResOutView);
    return this.jCheckReservedLock(pFile, pResOutView);
  }

  /**
   * @param {number} pFile 
   * @param {number} op 
   * @param {number} pArg 
   * @returns {number|Promise<number>}
   */
  xFileControl(pFile, op, pArg) {
    const pArgView = new DataView(
      this._module.HEAPU8.buffer,
      this._module.HEAPU8.byteOffset + pArg);
    if (isLogging) console.debug('xFileControl', pFile, op, pArgView);
    return this.jFileControl(pFile, op, pArgView);
  }

  /**
   * @param {number} pFile 
   * @returns {number|Promise<number>}
   */
  xSectorSize(pFile) {
    if (isLogging) console.debug('xSectorSize', pFile);
    return this.jSectorSize(pFile);
  }

  /**
   * @param {number} pFile 
   * @returns {number|Promise<number>}
   */
  xDeviceCharacteristics(pFile) {
    if (isLogging) console.debug('xDeviceCharacteristics', pFile);
    return this.jDeviceCharacteristics(pFile);
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

  #decodeFilename(zName, flags) {
    if (flags & VFS.SQLITE_OPEN_URI) {
      // The first null-terminated string is the URI path. Subsequent
      // strings are query parameter keys and values.
      // https://www.sqlite.org/c3ref/open.html#urifilenamesinsqlite3open
      let pName = zName;
      let state = 1;
      const charCodes = [];
      while (state) {
        const charCode = this._module.HEAPU8[pName++];
        if (charCode) {
          charCodes.push(charCode);
        } else {
          if (!this._module.HEAPU8[pName]) state = null;
          switch (state) {
            case 1: // path
              charCodes.push('?'.charCodeAt(0));
              state = 2;
              break;
            case 2: // key
              charCodes.push('='.charCodeAt(0));
              state = 3;
              break;
            case 3: // value
              charCodes.push('&'.charCodeAt(0));
              state = 2;
              break;
          }
        }
      }
      return  new TextDecoder().decode(new Uint8Array(charCodes));
    }
    return zName ? this._module.UTF8ToString(zName) : null;
  }
}

// Emscripten "legalizes" 64-bit integer arguments by passing them as
// two 32-bit signed integers.
function delegalize(lo32, hi32) {
  return (hi32 * 0x100000000) + lo32 + (lo32 < 0 ? 2**32 : 0);
}
