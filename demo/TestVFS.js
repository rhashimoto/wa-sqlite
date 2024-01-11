import { SQLITE_NOTFOUND, SQLITE_OK } from "wa-sqlite/src/sqlite-constants.js";

const SECTOR_SIZE = 4096;

export class TestVFS {
  name;
  mxPathname = 512;

  #module;

  constructor(name, module) {
    this.name = name;
    this.#module = module;
  }

  xOpen(vfs, zName, file, flags, pOutFlags) {
    console.log('xOpen', vfs, zName, file, flags, pOutFlags);
    return SQLITE_OK;
  }

  xDelete(vfs, zName, syncDir) {
    console.log('xDelete', vfs, zName, syncDir);
    return SQLITE_OK;
  }

  xAccess(vfs, zName, flags, pResOut) {
    console.log('xAccess', vfs, zName, flags, pResOut);
    return SQLITE_OK;
  }

  async xFullPathname(vfs, zName, nOut, zOut) {
    console.log('xFullPathname', vfs, zName, nOut, zOut);
    this.#module.HEAPU8.subarray(zOut, zOut + nOut)
      .set(this.#module.HEAPU8.subarray(zName, zName + nOut));
    return SQLITE_OK;
  }

  xGetLastError(vfs, nBuf, zBuf) {
    console.log('xGetLastError', vfs, nBuf, zBuf);
    return SQLITE_OK;
  }

  xClose(file) {
    console.log('xClose', file);
    return SQLITE_OK;
  }

  xRead(file, pData, iAmt, iOffsetLo, iOffsetHi) {
    const iOffset = joinInt64(iOffsetLo, iOffsetHi);
    console.log('xRead', file, pData, iAmt, iOffset);
    return SQLITE_OK;
  }

  xWrite(file, pData, iAmt, iOffsetLo, iOffsetHi) {
    const iOffset = joinInt64(iOffsetLo, iOffsetHi);
    console.log('xWrite', file, pData, iAmt, iOffset);
    return SQLITE_OK;
  }

  xTruncate(file, sizeLo, sizeHi) {
    const size = joinInt64(sizeLo, sizeHi);
    console.log('xTruncate', file, size);
    return SQLITE_OK;
  }

  xSync(file, flags) {
    console.log('xSync', file, flags);
    return SQLITE_OK;
  }

  xFileSize(file, pSize) {
    console.log('xFileSize', file, pSize);
    return SQLITE_OK;
  }

  xLock(file, lock) {
    console.log('xLock', file, lock);
    return SQLITE_OK;
  }

  xUnlock(file, lock) {
    console.log('xUnlock', file, lock);
    return SQLITE_OK;
  } 

  xCheckReservedLock(file, pResOut) {
    console.log('xCheckReservedLock', file, pResOut);
    return SQLITE_OK;
  }

  xFileControl(file, op, pArg) {
    console.log('xFileControl', file, op, pArg);
    return SQLITE_NOTFOUND;
  }

  xSectorSize(file) {
    console.log('xSectorSize', file);
    return SECTOR_SIZE;
  }

  xDeviceCharacteristics(file) {
    console.log('xDeviceCharacteristics', file);
    return 0;
  }
}

// Emscripten passes an int64_t value as two 32-bit *signed* integers
// (if not using -sWASM_BIGINT). This function reassembles them into a
// single JavaScript number.
// https://emscripten.org/docs/getting_started/FAQ.html?highlight=legalize#how-do-i-pass-int64-t-and-uint64-t-values-from-js-into-wasm-functions
function joinInt64(lo, hi) {
  // TODO: Handle negative numbers.
  if (hi < 0) throw new Error('Negative int64 value not supported');

  if (lo < 0) lo += 2**32;
  if (hi >= 2 ** 21) throw new Error('int64 value exceeds MAX_SAFE_INTEGER');
  return lo + (hi * 2**32);
}