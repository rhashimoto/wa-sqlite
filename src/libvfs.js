// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
const methods = {
  $method_support__postset: 'method_support();',
  $method_support: function() {
    const hasAsyncify = typeof Asyncify === 'object';

    const mapIdToVFS = new Map();
    const mapFileToVFS = new Map();

    Module['registerVFS'] = function(vfs, makeDefault) {
      const vfsAlreadyRegistered = ccall('sqlite3_vfs_find', 'number', ['string'],
        [vfs.name]);
      if (vfsAlreadyRegistered) {
        throw Error(`VFS '${vfs}' already registered`);
      }

      if (hasAsyncify) {
        // Inject Asyncify method.
        vfs['handleAsync'] = Asyncify.handleAsync;
      }

      const mxPathName = vfs.mxPathName ?? 64;
      const out = Module['_malloc'](4);
      const result = ccall('register_vfs', 'number', ['string', 'number', 'number', 'number'],
        [vfs.name, mxPathName, makeDefault ? 1 : 0, out]);
      if (!result) {
        const id = getValue(out, 'i32');
        mapIdToVFS.set(id, vfs);
      }
      Module['_free'](out);
      return result;
    };

    const closedFiles = hasAsyncify ? new Set() : null;

    class Value {
      constructor(ptr, type) {
        this.ptr = ptr;
        this.type = type;
      }

      set(v) {
        setValue(this.ptr, v, this.type);
      }
    }

    class Array {
      constructor(ptr, size) {
        this.ptr = ptr;
        this.size = size;
      }

      get value() {
        return new Int8Array(HEAP8.buffer, this.ptr, this.size);
      }
    }

    // int xClose(sqlite3_file* file);
    _vfsClose = function(file) {
      const vfs = mapFileToVFS.get(file);

      if (hasAsyncify) {
        // Normally we would delete the mapFileToVFS entry here as it is not
        // needed once the file is closed. But if the close implementation
        // uses Asyncify then the function can be called again with the same
        // state expected. So instead we just remember keys that should be
        // removed at some point.
        closedFiles.add(file);
      } else {
        mapFileToVFS.delete(file);
      }
      return vfs['xClose'](file);
    }
    
    // int xRead(sqlite3_file* file, void* pData, int iAmt, sqlite3_int64 iOffset);
    _vfsRead = function(file, pData, iAmt, iOffset) {
      const vfs = mapFileToVFS.get(file);
      return vfs['xRead'](file, new Array(pData, iAmt), getValue(iOffset, 'i64'));
    }

    // int xWrite(sqlite3_file* file, const void* pData, int iAmt, sqlite3_int64 iOffset);
    _vfsWrite = function(file, pData, iAmt, iOffset) {
      const vfs = mapFileToVFS.get(file);
      return vfs['xWrite'](file, new Array(pData, iAmt), getValue(iOffset, 'i64'));
    }

    // int xTruncate(sqlite3_file* file, sqlite3_int64 size);
    _vfsTruncate = function(file, iSize) {
      const vfs = mapFileToVFS.get(file);
      return vfs['xTruncate'](file, getValue(iSize, 'i64'));
    }

    // int xSync(sqlite3_file* file, int flags);
    _vfsSync = function(file, flags) {
      const vfs = mapFileToVFS.get(file);
      return vfs['xSync'](file, flags);
    }

    // int xFileSize(sqlite3_file* file, sqlite3_int64* pSize);
    _vfsFileSize = function(file, pSize) {
      const vfs = mapFileToVFS.get(file);
      return vfs['xFileSize'](file, new Value(pSize, 'i64'));
    }

    // int xLock(sqlite3_file* file, int flags);
    _vfsLock = function(file, flags) {
      const vfs = mapFileToVFS.get(file);
      return vfs['xLock'](file, flags);
    }

    // int xUnlock(sqlite3_file* file, int flags);
    _vfsUnlock = function(file, flags) {
      const vfs = mapFileToVFS.get(file);
      return vfs['xUnlock'](file, flags);
    }

    // int xCheckReservedLock(sqlite3_file* file, int* pResOut);
    _vfsCheckReservedLock = function(file, pResOut) {
      const vfs = mapFileToVFS.get(file);
      return vfs['xCheckReservedLock'](file, new Value(pResOut, 'i32'));
    }

    // int xFileControl(sqlite3_file* file, int flags, void* pOut);
    _vfsFileControl = function(file, flags, pOut) {
      const vfs = mapFileToVFS.get(file);
      return vfs['xFileControl'](file, flags, new Array(pOut));
    }

    // int xSectorSize(sqlite3_file* file);
    _vfsSectorSize = function(file) {
      const vfs = mapFileToVFS.get(file);
      return vfs['xSectorSize'](file);
    }

    // int xDeviceCharacteristics(sqlite3_file* file);
    _vfsDeviceCharacteristics = function(file) {
      const vfs = mapFileToVFS.get(file);
      return vfs['xDeviceCharacteristics'](file);
    }
    
    // int xOpen(sqlite3_vfs* vfs, const char *zName, sqlite3_file* file, int flags, int *pOutFlags);
    _vfsOpen = function(vfsId, zName, file, flags, pOutFlags) {
      const vfs = mapIdToVFS.get(vfsId);
      mapFileToVFS.set(file, vfs);

      if (hasAsyncify) {
        closedFiles.delete(file);
        for (const file of closedFiles) {
          mapFileToVFS.delete(file);
        }
      }
      
      return vfs['xOpen'](
        zName ? UTF8ToString(zName) : null,
        file,
        flags,
        new Value(pOutFlags, 'i32'));
    }

    // int xDelete(sqlite3_vfs* vfs, const char *zName, int syncDir);
    _vfsDelete = function(vfsId, zName, syncDir) {
      const vfs = mapIdToVFS.get(vfsId);
      return vfs['xDelete'](UTF8ToString(zName), syncDir);
    }

    // int xAccess(sqlite3_vfs* vfs, const char *zName, int flags, int *pResOut);
    _vfsAccess = function(vfsId, zName, flags, pResOut) {
      const vfs = mapIdToVFS.get(vfsId);
      return vfs['xAccess'](UTF8ToString(zName), flags, new Value(pResOut, 'i32'));
    }

    const mapIdToFunction = new Map();
    const mapContextToAppData = new Map();

    Module['createFunction'] =
      function(db, zFunctionName, nArg, eTextRep, pAppData, f) {
        const key = mapIdToFunction.size;
        mapIdToFunction.set(key, {
          f: f,
          appData: pAppData
        });
        return ccall(
          'create_function',
          'number',
          ['number', 'string', 'number', 'number', 'number', 'number'],
          [db, zFunctionName, nArg, eTextRep, key, 0]);
      }

    Module['createAggregate'] =
      function(db, zFunctionName, nArg, eTextRep, pAppData, fStep, fFinal) {
        const key = mapIdToFunction.size;
        mapIdToFunction.set(key, {
          step: fStep,
          final: fFinal,
          appData: pAppData
        });
        return ccall(
          'create_function',
          'number',
          ['number', 'string', 'number', 'number', 'number', 'number'],
          [db, zFunctionName, nArg, eTextRep, key, 1]);
      }

    Module['getFunctionUserData'] = function(pContext) {
      return mapContextToAppData.get(pContext);
    }

    _jsFunc = function(pApp, pContext, iCount, ppValues) {
      const f = mapIdToFunction.get(pApp);
      mapContextToAppData.set(pContext, f.appData);
      f.f(pContext, new Uint32Array(HEAP8.buffer, ppValues, iCount));
      mapContextToAppData.delete(pContext);
    }

    _jsStep = function(pApp, pContext, iCount, ppValues) {
      const f = mapIdToFunction.get(pApp);
      mapContextToAppData.set(pContext, f.appData);
      f.step(pContext, new Uint32Array(HEAP8.buffer, ppValues, iCount));
      mapContextToAppData.delete(pContext);
    }

    _jsFinal = function(pApp, pContext) {
      const f = mapIdToFunction.get(pApp);
      mapContextToAppData.set(pContext, f.appData);
      f.final(pContext);
      mapContextToAppData.delete(pContext);
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

  "jsFunc",
  "jsStep",
  "jsFinal"
];
for (const method of METHOD_NAMES) {
  methods[method] = function() {};
  methods[`${method}__deps`] = ['$method_support'];
}
mergeInto(LibraryManager.library, methods);
