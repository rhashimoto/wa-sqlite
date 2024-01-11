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

  xRead(file, pData, iAmt, iOffset) {
    console.log('xRead', file, pData, iAmt, iOffset);
    return SQLITE_OK;
  }

  xWrite(file, pData, iAmt, iOffset) {
    console.log('xWrite', file, pData, iAmt, iOffset);
    return SQLITE_OK;
  }

  xTruncate(file, size) {
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

  xShmMap(file, iRegion, szRegion, isWrite, pp) {
    console.log('xShmMap', file, iRegion, szRegion, isWrite, pp);
    return SQLITE_OK;
  }

  xShmLock(file, offset, n, flags) {
    console.log('xShmLock', file, offset, n, flags);
    return SQLITE_OK;
  }

  xShmBarrier(file) {
    console.log('xShmBarrier', file);
    return SQLITE_OK;
  }

  xShmUnmap(file, deleteFlag) {
    console.log('xShmUnmap', file, deleteFlag);
    return SQLITE_OK;
  }  
}