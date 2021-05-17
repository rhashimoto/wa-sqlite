// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
// @ts-ignore
const mod_methods = {
  $mod_method_support__postset: 'mod_method_support();',
  $mod_method_support: function() {
    const hasAsyncify = typeof Asyncify === 'object';

    const mapIdToModule = new Map();
    const mapVTabToModule = new Map();
    const mapCursorToModule = new Map();

    const closedVTabs = hasAsyncify ? new Set() : null;
    const closedCursors = hasAsyncify ? new Set() : null;

    class Value {
      constructor(ptr, type) {
        this.ptr = ptr;
        this.type = type;
      }

      set(v) {
        switch (this.type) {
          case 's':
            const length = lengthBytesUTF8(v);
            const p = ccall('sqlite3_malloc', 'number', ['number'], [length + 1]);
            stringToUTF8(v, p, length + 1);
            setValue(this.ptr, p, 'i32');
            break;
          default:
            setValue(this.ptr, v, this.type);
            break;
        }
      }
    }

    /** Field offsets within SQLite C structs.
     *  @type {Map<string, { size: number, offsets: Array<number>}>}
     */
    const mapStructToLayout = new Map();
    _modStruct = function(zName, iSize, nFields, pOffsets) {
      mapStructToLayout.set(UTF8ToString(zName), {
        size: iSize,
        offsets: Array.from(new Uint32Array(HEAP8.buffer, pOffsets, nFields))
      });
    };

    function unpack_sqlite3_index_info(p) {
      const layout = mapStructToLayout.get('sqlite3_index_info');
      const offset = layout.offsets;
      const struct = {};
      struct['nConstraint'] = getValue(p + offset[0], 'i32');
      struct['aConstraint'] = [];
      const constraintPtr = getValue(p + offset[1], 'i32');
      const constraintSize = mapStructToLayout.get('sqlite3_index_constraint').size;
      for (let i = 0; i < struct['nConstraint']; ++i) {
        struct['aConstraint'].push(
          unpack_sqlite3_index_constraint(constraintPtr + i * constraintSize));
      }
      struct['nOrderBy'] = getValue(p + offset[2], 'i32');
      struct['aOrderBy'] = [];
      const orderPtr = getValue(p + offset[3], 'i32');
      const orderSize = mapStructToLayout.get('sqlite3_index_orderby').size;
      for (let i = 0; i < struct['nOrderBy']; ++i) {
        struct['aOrderBy'].push(
          unpack_sqlite3_index_orderby(orderPtr + i * orderSize));
      }
      
      struct['aConstraintUsage'] = [];
      for (let i = 0; i < struct['nConstraint']; ++i) {
        struct['aConstraintUsage'].push({
          'argvIndex': 0,
          'omit': false
        });
      }
      struct['idxNum'] = getValue(p + offset[5], 'i32');
      struct['idxStr'] = null;
      struct['orderByConsumed'] = !!getValue(p + offset[8], 'i8');
      struct['estimatedCost'] = getValue(p + offset[9], 'double');
      struct['estimatedRows'] = getValue(p + offset[10], 'i64');
      struct['idxFlags'] = getValue(p + offset[11], 'i32');
      struct['colUsed'] = getValue(p + offset[12], 'i64');
      return struct;
    }

    function unpack_sqlite3_index_constraint(p) {
      const layout = mapStructToLayout.get('sqlite3_index_constraint');
      const offset = layout.offsets;
      const struct = {};
      struct['iColumn'] = getValue(p + offset[0], 'i32');
      struct['op'] = getValue(p + offset[1], 'i8');
      struct['usable'] = !!getValue(p + offset[2], 'i8');
      return struct;
    }

    function unpack_sqlite3_index_orderby(p) {
      const layout = mapStructToLayout.get('sqlite3_index_orderby');
      const offset = layout.offsets;
      const struct = {};
      struct['iColumn'] = getValue(p + offset[0], 'i32');
      struct['desc'] = !!getValue(p + offset[1], 'i8');
      return struct;
    }

    function pack_sqlite3_index_info(p, struct) {
      const layout = mapStructToLayout.get('sqlite3_index_info');
      const offset = layout.offsets;
      const usagePtr = getValue(p + offset[4], 'i32');
      const usageSize = mapStructToLayout.get('sqlite3_index_constraint_usage').size;
      for (let i = 0; i < struct['nConstraint']; ++i) {
        pack_sqlite_index_constraint_usage(
          usagePtr + i * usageSize,
          struct['aConstraintUsage'][i]);
      }
      setValue(p + offset[5], struct['idxNum'], 'i32');
      if (typeof struct['idxStr'] === 'string') {
        const length = lengthBytesUTF8(struct['idxStr']);
        const z = ccall('sqlite3_malloc', 'number', ['number'], [length + 1]);
        stringToUTF8(struct['idxStr'], z, length + 1);
        setValue(p + offset[6], z, 'i32');
        setValue(p + offset[7], 1, 'i32');
      }
      setValue(p + offset[8], struct['orderByConsumed'], 'i32');
      setValue(p + offset[9], struct['estimatedCost'], 'double');
      setValue(p + offset[10], struct['estimatedRows'], 'i64');
      setValue(p + offset[11], struct['idxFlags'], 'i32');
    }

    function pack_sqlite_index_constraint_usage(p, struct) {
      const layout = mapStructToLayout.get('sqlite3_index_constraint_usage');
      const offset = layout.offsets;
      setValue(p + offset[0], struct['argvIndex'], 'i32');
      setValue(p + offset[1], struct['omit'] ? 1 : 0, 'i8');
    }

    Module['createModule'] = function(db, zName, module, appData) {
      if (hasAsyncify) {
        // Inject Asyncify method.
        module['handleAsync'] = Asyncify.handleAsync;
      }

      const key = mapIdToModule.size;
      mapIdToModule.set(key, {
        module: module,
        appData: appData
      });

      // Set bits for the provided functions.
      let flags = 0;
      if (module['xCreate']) flags |= 1 << 0;
      if (module['xConnect']) flags |= 1 << 1;
      if (module['xBestIndex']) flags |= 1 << 2;
      if (module['xDisconnect']) flags |= 1 << 3;
      if (module['xDestroy']) flags |= 1 << 4;
      if (module['xOpen']) flags |= 1 << 5;
      if (module['xClose']) flags |= 1 << 6;
      if (module['xFilter']) flags |= 1 << 7;
      if (module['xNext']) flags |= 1 << 8;
      if (module['xEof']) flags |= 1 << 9;
      if (module['xColumn']) flags |= 1 << 10;
      if (module['xRowid']) flags |= 1 << 11;
      if (module['xUpdate']) flags |= 1 << 12;
      if (module['xBegin']) flags |= 1 << 13;
      if (module['xSync']) flags |= 1 << 14;
      if (module['xCommit']) flags |= 1 << 15;
      if (module['xRollback']) flags |= 1 << 16;
      if (module['xFindFunction']) flags |= 1 << 17;
      if (module['xRename']) flags |= 1 << 18;

      return ccall(
        'create_module',
        'number',
        ['number', 'string', 'number', 'number'],
        [db, zName, key, flags]);
    };

    _modCreate = function(db, pModuleId, argc, argv, pVTab, pzErr) {
      const m = mapIdToModule.get(pModuleId);
      mapVTabToModule.set(pVTab, m);
      if (hasAsyncify) {
        closedVTabs.delete(pVTab);
        for (const vTab of closedVTabs) {
          mapVTabToModule.delete(vTab);
        }
      }
      argv = Array.from(new Uint32Array(HEAP8.buffer, argv, argc))
        .map(p => UTF8ToString(p));
      return m.module['xCreate'](db, m.appData, argv, pVTab, new Value(pzErr, 's'));
    };

    _modConnect = function(db, pModuleId, argc, argv, pVTab, pzErr) {
      const m = mapIdToModule.get(pModuleId);
      mapVTabToModule.set(pVTab, m);
      if (hasAsyncify) {
        closedVTabs.delete(pVTab);
        for (const vTab of closedVTabs) {
          mapVTabToModule.delete(vTab);
        }
      }
      argv = Array.from(new Uint32Array(HEAP8.buffer, argv, argc))
        .map(p => UTF8ToString(p));
      return m.module['xConnect'](db, m.appData, argv, pVTab, new Value(pzErr, 's'));
    };

    _modBestIndex = function(pVTab, pIndexInfo) {
      const m = mapVTabToModule.get(pVTab);
      const indexInfo = unpack_sqlite3_index_info(pIndexInfo);
      const result = m.module['xBestIndex'](pVTab, indexInfo);
      pack_sqlite3_index_info(pIndexInfo, indexInfo);
      return result;
    };

    _modDisconnect = function(pVTab) {
      const m = mapVTabToModule.get(pVTab);
      if (hasAsyncify) {
        closedVTabs.add(pVTab);
      } else {
        mapVTabToModule.delete(pVTab);
      }
      return m.module['xDisconnect'](pVTab);
    };

    _modDestroy = function(pVTab) {
      const m = mapVTabToModule.get(pVTab);
      if (hasAsyncify) {
        closedVTabs.add(pVTab);
      } else {
        mapVTabToModule.delete(pVTab);
      }
      return m.module['xDestroy'](pVTab);
    };

    _modOpen = function(pVTab, pCursor) {
      const m = mapVTabToModule.get(pVTab);
      mapCursorToModule.set(pCursor, m);
      if (hasAsyncify) {
        closedCursors.delete(pCursor);
        for (const cursor of closedCursors) {
          mapCursorToModule.delete(cursor);
        }
      }
      return m.module['xOpen'](pVTab, pCursor);
    };

    _modClose = function(pCursor) {
      const m = mapCursorToModule.get(pCursor);
      if (hasAsyncify) {
        closedCursors.add(pCursor);
      } else {
        mapCursorToModule.delete(pCursor);
      }
      return m.module['xClose'](pCursor);
    };

    _modEof = function(pCursor) {
      const m = mapCursorToModule.get(pCursor);
      return m.module['xEof'](pCursor) ? 1 : 0;
    };

    _modFilter = function(pCursor, idxNum, idxStr, argc, argv) {
      const m = mapCursorToModule.get(pCursor);
      idxStr = idxStr ? UTF8ToString(idxStr) : null;
      argv = new Uint32Array(HEAP8.buffer, argv, argc);
      return m.module['xFilter'](pCursor, idxNum, idxStr, argv);
    };

    _modNext = function(pCursor) {
      const m = mapCursorToModule.get(pCursor);
      return m.module['xNext'](pCursor);
    };

    _modColumn = function(pCursor, pContext, iCol) {
      const m = mapCursorToModule.get(pCursor);
      return m.module['xColumn'](pCursor, pContext, iCol);
    };

    _modRowid = function(pCursor, pRowid) {
      const m = mapCursorToModule.get(pCursor);
      return m.module['xRowid'](pCursor, new Value(pRowid, 'i64'));
    };

    _modUpdate = function(pVTab, argc, argv, pRowid) {
      const m = mapVTabToModule.get(pVTab);
      argv = new Uint32Array(HEAP8.buffer, argv, argc);
      return m.module['xUpdate'](pVTab, argv, new Value(pRowid, 'i64'));
    };

    _modBegin = function(pVTab) {
      const m = mapVTabToModule.get(pVTab);
      return m.module['xBegin'](pVTab);
    };

    _modSync = function(pVTab) {
      const m = mapVTabToModule.get(pVTab);
      return m.module['xSync'](pVTab);
    };

    _modCommit = function(pVTab) {
      const m = mapVTabToModule.get(pVTab);
      return m.module['xCommit'](pVTab);
    };

    _modRollback = function(pVTab) {
      const m = mapVTabToModule.get(pVTab);
      return m.module['xRollback'](pVTab);
    };

    _modRename = function(pVTab, zNew) {
      const m = mapVTabToModule.get(pVTab);
      zNew = UTF8ToString(zNew);
      return m.module['xRename'](pVTab, zNew);
    }
  }
};

// @ts-ignore
const MOD_METHOD_NAMES = [
  "modStruct",
  "modCreate",
  "modConnect",
  "modBestIndex",
  "modDisconnect",
  "modDestroy",
  "modOpen",
  "modClose",
  "modFilter",
  "modNext",
  "modEof",
  "modColumn",
  "modRowid",

  // Optional methods.
  "modUpdate",
  "modBegin",
  "modSync",
  "modCommit",
  "modRollback",
  "modFindFunction",
  "modRename",
];
for (const method of MOD_METHOD_NAMES) {
  mod_methods[method] = function() {};
  mod_methods[`${method}__deps`] = ['$mod_method_support'];
}
mergeInto(LibraryManager.library, mod_methods);
