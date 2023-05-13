// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
const vfs_methods = {
  $vfs_method_support__postset: 'vfs_method_support();',
  $vfs_method_support: function() {
    const hasAsyncify = typeof Asyncify === 'object';

    const mapIdToVFS = new Map();
    const mapFileToVFS = new Map();

    Module['registerVFS'] = function(vfs, makeDefault) {
      const vfsAlreadyRegistered = ccall('sqlite3_vfs_find', 'number', ['string'],
        [vfs.name]);
      if (vfsAlreadyRegistered) {
        throw Error(`VFS '${vfs.name}' already registered`);
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
        const id = getValue(out, '*');
        mapIdToVFS.set(id, vfs);
      }
      Module['_free'](out);
      return result;
    };

    /**
     * Wrapped DataView for pointer arguments.
     * Pointers to a single value are passed using DataView. A Proxy
     * wrapper prevents use of incorrect type or endianness.
     * @param {'Int32'|'BigInt64'} type 
     * @param {number} byteOffset 
     * @returns {DataView}
     */
    function makeTypedDataView(type, byteOffset) {
      const byteLength = type === 'Int32' ? 4 : 8;
      const getter = `get${type}`;
      const setter = `set${type}`;
      return new Proxy(new DataView(HEAPU8.buffer, byteOffset, byteLength), {
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

    // Convert 64-bit unsigned int in WASM memory to Number. The unsigned
    // int is assumed to be <= Number.MAX_SAFE_INTEGER;
    function u64(ptr) {
      const index = ptr >> 2;
      return HEAPU32[index] + (HEAPU32[index + 1] * (2**32));
    }

    const closedFiles = hasAsyncify ? new Set() : null;

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
      const pDataArray = HEAPU8.subarray(pData, pData + iAmt);
      return vfs['xRead'](file, pDataArray, u64(iOffset));
    }

    // int xWrite(sqlite3_file* file, const void* pData, int iAmt, sqlite3_int64 iOffset);
    _vfsWrite = function(file, pData, iAmt, iOffset) {
      const vfs = mapFileToVFS.get(file);
      const pDataArray = HEAPU8.subarray(pData, pData + iAmt);
      return vfs['xWrite'](file, pDataArray, u64(iOffset));
    }

    // int xTruncate(sqlite3_file* file, sqlite3_int64 size);
    _vfsTruncate = function(file, iSize) {
      const vfs = mapFileToVFS.get(file);
      return vfs['xTruncate'](file, u64(iSize));
    }

    // int xSync(sqlite3_file* file, int flags);
    _vfsSync = function(file, flags) {
      const vfs = mapFileToVFS.get(file);
      return vfs['xSync'](file, flags);
    }

    // int xFileSize(sqlite3_file* file, sqlite3_int64* pSize);
    _vfsFileSize = function(file, pSize) {
      const vfs = mapFileToVFS.get(file);
      const pSizeView = makeTypedDataView('BigInt64', pSize);
      return vfs['xFileSize'](file, pSizeView);
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
      const pResOutView = makeTypedDataView('Int32', pResOut);
      return vfs['xCheckReservedLock'](file, pResOutView);
    }

    // int xFileControl(sqlite3_file* file, int flags, void* pOut);
    _vfsFileControl = function(file, flags, pOut) {
      const vfs = mapFileToVFS.get(file);
      const pOutView = new DataView(HEAPU8.buffer, pOut);
      return vfs['xFileControl'](file, flags, pOutView);
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
      
      // If zName is a URI, then the null-terminated name is followed by
      // additional key and value strings. Reassemble it into a single
      // string.
      let name = null;
      if (flags & 64) {
        let pName = zName;
        let state = 1;
        const charCodes = [];
        while (state) {
          const charCode = HEAPU8[pName++];
          if (charCode) {
            charCodes.push(charCode);
          } else {
            if (!HEAPU8[pName]) state = null;
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
        name = new TextDecoder().decode(new Uint8Array(charCodes));
      } else if (zName) {
        name = UTF8ToString(zName);
      }

      const pOutFlagsView = makeTypedDataView('Int32', pOutFlags);
      return vfs['xOpen'](name, file, flags, pOutFlagsView);
    }

    // int xDelete(sqlite3_vfs* vfs, const char *zName, int syncDir);
    _vfsDelete = function(vfsId, zName, syncDir) {
      const vfs = mapIdToVFS.get(vfsId);
      return vfs['xDelete'](UTF8ToString(zName), syncDir);
    }

    // int xAccess(sqlite3_vfs* vfs, const char *zName, int flags, int *pResOut);
    _vfsAccess = function(vfsId, zName, flags, pResOut) {
      const vfs = mapIdToVFS.get(vfsId);
      const pResOutView = makeTypedDataView('Int32', pResOut);
      return vfs['xAccess'](UTF8ToString(zName), flags, pResOutView);
    }
  }
};

const VFS_METHOD_NAMES = [
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
for (const method of VFS_METHOD_NAMES) {
  vfs_methods[method] = function() {};
  vfs_methods[`${method}__deps`] = ['$vfs_method_support'];
}
mergeInto(LibraryManager.library, vfs_methods);
