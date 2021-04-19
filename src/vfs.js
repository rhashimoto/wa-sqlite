const methods = {
  $method_support__postset: 'method_support();',
  $method_support: function() {
    const mapIdToVFS = new Map();
    const mapFileToVFS = new Map();

    Module['registerVFS'] = function(name, vfs) {
      const vfsAlreadyRegistered = ccall('sqlite3_vfs_find', 'number', ['string'], [vfs]);
      if (vfsAlreadyRegistered) {
        throw Error(`VFS '${vfs}' already registered`);
      }

      const mxPathName = vfs.mxPathName ?? 64;
      const id = ccall('register_vfs', 'number', ['string', 'number'], [name, mxPathName]);
      mapIdToVFS.set(id, vfs);
    };

#if ASYNCIFY
    const closedFiles = new Set();
    Module['handleAsync'] = function(f) {
      return Asyncify.handleAsync(f);
    }

    Module['purgeClosedFiles'] = function() {
      for (const file of closedFiles) {
        mapFileToVFS.delete(file);
      }
    }
#endif

    // int xClose(sqlite3_file* file);
    _vfsClose = function(file) {
      const vfs = mapFileToVFS.get(file);

#if ASYNCIFY
      // Normally we would delete the mapFileToVFS entry here as it is not
      // needed once the file is closed. But if the close implementation
      // uses Asyncify then the function can be called again with the same
      // state expected. So instead we just remember keys that should be
      // removed at some point.
      closedFiles.add(file);
#else
      mapFileToVFS.delete(file);
#endif
      return vfs['close'](file);
    }
    
    // int xRead(sqlite3_file* file, void* pData, int iAmt, sqlite3_int64 iOffset);
    _vfsRead = function(file, pData, iAmt, iOffset) {
      const vfs = mapFileToVFS.get(file);
      return vfs['read'](file, pData, iAmt, getValue(iOffset, 'i64'));
    }

    // int xWrite(sqlite3_file* file, const void* pData, int iAmt, sqlite3_int64 iOffset);
    _vfsWrite = function(file, pData, iAmt, iOffset) {
      const vfs = mapFileToVFS.get(file);
      return vfs['write'](file, pData, iAmt, getValue(iOffset, 'i64'));
    }

    // int xTruncate(sqlite3_file* file, sqlite3_int64 size);
    _vfsTruncate = function(file, iSize) {
      const vfs = mapFileToVFS.get(file);
      return vfs['truncate'](file, getValue(iSize, 'i64'));
    }

    // int xSync(sqlite3_file* file, int flags);
    _vfsSync = function(file, flags) {
      const vfs = mapFileToVFS.get(file);
      return vfs['sync'](file, flags);
    }

    // int xFileSize(sqlite3_file* file, sqlite3_int64* pSize);
    _vfsFileSize = function(file, pSize) {
      const vfs = mapFileToVFS.get(file);
      return vfs['fileSize'](file, pSize);
    }

    // int xLock(sqlite3_file* file, int flags);
    _vfsLock = function(file, flags) {
      const vfs = mapFileToVFS.get(file);
      return vfs['lock'](file, flags);
    }

    // int xUnlock(sqlite3_file* file, int flags);
    _vfsUnlock = function(file, flags) {
      const vfs = mapFileToVFS.get(file);
      return vfs['unlock'](file, flags);
    }

    // int xCheckReservedLock(sqlite3_file* file, int* pResOut);
    _vfsCheckReservedLock = function(file, pResOut) {
      const vfs = mapFileToVFS.get(file);
      return vfs['checkReservedLock'](file, pResOut);
    }

    // int xFileControl(sqlite3_file* file, int flags, void* pOut);
    _vfsFileControl = function(file, flags, pOut) {
      const vfs = mapFileToVFS.get(file);
      return vfs['fileControl'](file, flags, pOut);
    }

    // int xSectorSize(sqlite3_file* file);
    _vfsSectorSize = function(file) {
      const vfs = mapFileToVFS.get(file);
      return vfs['sectorSize'](file);
    }

    // int xDeviceCharacteristics(sqlite3_file* file);
    _vfsDeviceCharacteristics = function(file) {
      const vfs = mapFileToVFS.get(file);
      return vfs['deviceCharacteristics'](file);
    }
    
    // int xOpen(sqlite3_vfs* vfs, const char *zName, sqlite3_file* file, int flags, int *pOutFlags);
    _vfsOpen = function(vfsId, zName, file, flags, pOutFlags) {
      const vfs = mapIdToVFS.get(vfsId);
      mapFileToVFS.set(file, vfs);
#if ASYNCIFY
      closedFiles.delete(file);
#endif
      return vfs['open'](zName ? UTF8ToString(zName) : null, file, flags, pOutFlags);
    }

    // int xDelete(sqlite3_vfs* vfs, const char *zName, int syncDir);
    _vfsDelete = function(vfsId, zName, syncDir) {
      const vfs = mapIdToVFS.get(vfsId);
      return vfs['delete'](UTF8ToString(zName), syncDir);
    }

    // int xAccess(sqlite3_vfs* vfs, const char *zName, int flags, int *pResOut);
    _vfsAccess = function(vfsId, zName, flags, pResOut) {
      const vfs = mapIdToVFS.get(vfsId);
      return vfs['access'](UTF8ToString(zName), flags, pResOut);
    }
  }
};

const METHOD_NAMES = [
  "vfsClose",
  "vfsRead",
  "vfsWrite",
  "vfsTruncate",
  "vfsSync",
  "vfsFileSize",
  "vfsLock",
  "vfsUnlock",
  "vfsCheckReservedLock",
  "vfsFileControl",
  "vfsSectorSize",
  "vfsDeviceCharacteristics",
  
  "vfsOpen",
  "vfsDelete",
  "vfsAccess",
];
for (const method of METHOD_NAMES) {
  methods[method] = function() {};
  methods[`${method}__deps`] = ['$method_support'];
}
mergeInto(LibraryManager.library, methods);
