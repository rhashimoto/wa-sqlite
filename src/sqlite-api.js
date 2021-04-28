// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.

// Useful result codes.
// https://www.sqlite.org/rescode.html
export const SQLITE_OK = 0;
export const SQLITE_ERROR = 1;
export const SQLITE_BUSY = 5;
export const SQLITE_NOMEM = 7;
export const SQLITE_READONLY = 8;
export const SQLITE_IOERR = 10;
export const SQLITE_IOERR_SHORT_READ = 522;
export const SQLITE_NOTFOUND = 12;
export const SQLITE_CANTOPEN = 14;
export const SQLITE_MISUSE = 21;
export const SQLITE_NOTADB = 26;
export const SQLITE_ROW = 100;
export const SQLITE_DONE = 101;

// Open flags.
// https://www.sqlite.org/c3ref/c_open_autoproxy.html
export const SQLITE_OPEN_READONLY = 0x00000001;
export const SQLITE_OPEN_READWRITE = 0x00000002;
export const SQLITE_OPEN_CREATE = 0x00000004;
export const SQLITE_OPEN_DELETEONCLOSE = 0x00000008;
export const SQLITE_OPEN_EXCLUSIVE = 0x00000010;
export const SQLITE_OPEN_AUTOPROXY = 0x00000020;
export const SQLITE_OPEN_URI = 0x00000040;
export const SQLITE_OPEN_MEMORY = 0x00000080;
export const SQLITE_OPEN_MAIN_DB = 0x00000100;
export const SQLITE_OPEN_TEMP_DB = 0x00000200;
export const SQLITE_OPEN_TRANSIENT_DB = 0x00000400;
export const SQLITE_OPEN_MAIN_JOURNAL = 0x00000800;
export const SQLITE_OPEN_TEMP_JOURNAL = 0x00001000;
export const SQLITE_OPEN_SUBJOURNAL = 0x00002000;
export const SQLITE_OPEN_SUPER_JOURNAL = 0x00004000;
export const SQLITE_OPEN_NOMUTEX = 0x00008000;
export const SQLITE_OPEN_FULLMUTEX = 0x00010000;
export const SQLITE_OPEN_SHAREDCACHE = 0x00020000;
export const SQLITE_OPEN_PRIVATECACHE = 0x00040000;
export const SQLITE_OPEN_WAL = 0x00080000;
export const SQLITE_OPEN_NOFOLLOW = 0x01000000;

// Device characteristics.
// https://www.sqlite.org/c3ref/c_iocap_atomic.html
export const SQLITE_IOCAP_ATOMIC = 0x00000001;
export const SQLITE_IOCAP_ATOMIC512 = 0x00000002;
export const SQLITE_IOCAP_ATOMIC1K = 0x00000004;
export const SQLITE_IOCAP_ATOMIC2K = 0x00000008;
export const SQLITE_IOCAP_ATOMIC4K = 0x00000010;
export const SQLITE_IOCAP_ATOMIC8K = 0x00000020;
export const SQLITE_IOCAP_ATOMIC16K = 0x00000040;
export const SQLITE_IOCAP_ATOMIC32K = 0x00000080;
export const SQLITE_IOCAP_ATOMIC64K = 0x00000100;
export const SQLITE_IOCAP_SAFE_APPEND = 0x00000200;
export const SQLITE_IOCAP_SEQUENTIAL = 0x00000400;
export const SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN = 0x00000800;
export const SQLITE_IOCAP_POWERSAFE_OVERWRITE = 0x00001000;
export const SQLITE_IOCAP_IMMUTABLE = 0x00002000;
export const SQLITE_IOCAP_BATCH_ATOMIC = 0x00004000;

// Fundamental datatypes.
// https://www.sqlite.org/c3ref/c_blob.html
export const SQLITE_INTEGER = 1;
export const SQLITE_FLOAT = 2;
export const SQLITE_TEXT = 3;
export const SQLITE_BLOB = 4;
export const SQLITE_NULL = 5;

// Special destructor behavior.
// https://www.sqlite.org/c3ref/c_static.html
export const SQLITE_STATIC = 0;
export const SQLITE_TRANSIENT = -1;

export class SQLiteError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const async = true;

function trace(...args) {
  // const date = new Date();
  // const t = date.getHours().toString().padStart(2, '0') + ':' +
  //           date.getMinutes().toString().padStart(2, '0') + ':' +
  //           date.getSeconds().toString().padStart(2, '0') + '.' +
  //           date.getMilliseconds().toString().padStart(3, '0');
  // console.debug(t, ...args);
}

/**
 * @typedef {Object} SQLiteAPI
 * 
 * @property {(
 *  stmt: number,
 *  bindings: object|Array<null|number|string|Int8Array|Array<number>>) => number} bind
 *  Binds a collection of values to a statement. This is a convenience
 *  function for Javascript.
 * 
 * @property {(
 *  stmt: number,
 *  i: number,
 *  value: Int8Array|Array<number>) => number} bind_blob Bind blob to
 *  prepared statement. Arguments are modified from C API for Javascript.
 *  See https://www.sqlite.org/c3ref/bind_blob.html
 * 
 * @property {(
 *  stmt: number,
 *  i: number,
 *  value: number) => number} bind_double
 *  See https://www.sqlite.org/c3ref/bind_blob.html
 * 
 * @property {(
 *  stmt: number,
 *  i: number,
 *  value: number) => number} bind_int
 *  See https://www.sqlite.org/c3ref/bind_blob.html
 * 
 * @property {(
 *  stmt: number,
 *  value: number) => number} bind_null
 *  See https://www.sqlite.org/c3ref/bind_blob.html
 * 
 * @property {(
 *  stmt: number) => number} bind_parameter_count Number of SQL Parameters.
 *  See https://www.sqlite.org/c3ref/bind_parameter_count.html
 * 
 * @property {(
 *  stmt: number,
 *  i: number) => string} bind_parameter_name Name of a host parameter.
 *  See https://www.sqlite.org/c3ref/bind_parameter_name.html
 * 
 * @property {(
 *  stmt: number,
 *  i: number,
 *  value: string) => number} bind_text Bind string to
 *  prepared statement. Arguments are modified from C API for Javascript.
 *  See https://www.sqlite.org/c3ref/bind_blob.html
 * 
 * @property {(
 *  db: number) => Promise<number>} close
 *  See https://www.sqlite.org/c3ref/close.html
 * 
 * @property {(
 *  stmt: number,
 *  iCol: number) => Int8Array} column_blob Result values from a query.
 *  Note that the result will be valid until the next SQLite call. For
 *  longer retention, make a copy.
 *  See https://www.sqlite.org/c3ref/column_blob.html
 * 
 * @property {(
 *  stmt: number,
 *  iCol: number) => number} column_bytes Result values from a query.
 *  See https://www.sqlite.org/c3ref/column_blob.html
 * 
 * @property {(
 *  stmt: number) => number} column_count Result values from a query.
 *  See https://www.sqlite.org/c3ref/column_blob.html
 * 
 * @property {(
 *  stmt: number,
 *  iCol: number) => number} column_double Result values from a query.
 *  See https://www.sqlite.org/c3ref/column_blob.html
 * 
 * @property {(
 *  stmt: number,
 *  iCol: number) => number} column_int Result values from a query.
 *  See https://www.sqlite.org/c3ref/column_blob.html
 * 
 * @property {(
 *  stmt: number,
 *  iCol: number) => string} column_name Result values from a query.
 *  See https://www.sqlite.org/c3ref/column_blob.html
 * 
 * @property {(
 *  stmt: number) => string[]} column_names Returns an array of column
 *  names for the prepared statement. This is a convenience function
 *  for Javascript.
 * 
 * @property {(
 *  stmt: number,
 *  iCol: number) => string} column_text Result values from a query.
 *  See https://www.sqlite.org/c3ref/column_blob.html
 * 
 * @property {(
 *  stmt: number,
 *  iCol: number) => number} column_type Result values from a query.
 *  See https://www.sqlite.org/c3ref/column_blob.html
 * 
 * @property {(
 *  stmt: number) => number} data_count Number of columns in a result set.
 *  See https://www.sqlite.org/c3ref/data_count.html
 * 
 * @property {(
 *  db: number,
 *  sql: string,
 *  callback?: function(*, number, *[], string[]): any,
 *  userData?: any) => Promise<number>} exec One-step query execution interface.
 *  The optional callback is called for each output row with arguments
 *  `userData`, `nColumns`, `rowValues`, `columnNames`.
 *  See https://www.sqlite.org/c3ref/exec.html
 * 
 * @property {(
 *  stmt: number) => Promise<number>} finalize Destroy a prepared statement
 *  object. See https://www.sqlite.org/c3ref/finalize.html
 * 
 * @property {() => string} libversion Run-time library version numbers.
 * https://www.sqlite.org/c3ref/libversion.html
 * 
 * @property {() => number} libversion_number Run-time library version numbers.
 * https://www.sqlite.org/c3ref/libversion.html
 *
 * @property {(
 *  zFilename: string,
 *  iFlags?: number,
 *  zVfs?: string) => Promise<number>} open_v2 Opening a new database
 *  connection. SQLite open flags can optionally be provided or omitted
 *  for the default (CREATE + READWRITE). A VFS name can optionally be
 *  provided. The opaque database id is returned.
 *  See https://www.sqlite.org/c3ref/open.html
 * 
 * @property {(
 *  db: number,
 *  sql: number) => Promise<{ stmt: number, sql: number }?>} prepare_v2
 *  Compiling an SQL statement. SQL is provided as a pointer in WASM
 *  memory, so the utility functions `str_new()` and `str_value()` may
 *  be helpful. The returned object provides both the prepared statement
 *  and a pointer to the still uncompiled SQL that can be used with the
 *  next call to this function. A null value is returned when no
 *  statement remains.
 *  See https://www.sqlite.org/c3ref/prepare.html
 * 
 * @property {(
 *  stmt: number) => number} reset Reset a prepared statement object.
 *  See https://www.sqlite.org/c3ref/reset.html
 * 
 * @property {(
 *  stmt: number) => Array<any>} row Returns row data for a prepared
 *  statement. This is a convenience function for Javascript.
 * 
 * @property {(
 *  stmt: number) => Promise<number>} step Evaluate an SQL statement.
 *  See https://www.sqlite.org/c3ref/step.html
 * 
 * @property {(db: number, s?: string) => number} str_new Create a new
 *  dynamic string object. An optional initialization argument has
 *  been added for convenience which is functionally equivalent to (but
 *  slightly more efficient):
 *  ```
 *  const str = sqlite3.str_new(db);
 *  sqlite3.str_appendall(str, s);
 *  ```
 *  See https://www.sqlite.org/c3ref/str_append.html
 * 
 * @property {(str: number, s: string) => void} str_appendall Add content
 *  to a dynamic string. Not recommended for building strings; prefer
 *  using Javascript and `str_new` with initialization.
 *  See https://www.sqlite.org/c3ref/str_append.html
 * 
 * @property {(str: number) => number} str_value Get pointer to dynamic
 *  string content.
 *  See https://www.sqlite.org/c3ref/str_append.html
 * 
 * @property {(str: number) => void} str_finish Finalize a dynamic string.
 *  See https://www.sqlite.org/c3ref/str_append.html
 * 
 * @property {(vfs: any, makeDefault?: boolean) => number} vfs_register
 *  Register a new Virtual File System.
 *  See https://www.sqlite.org/c3ref/str_append.html
 */

/**
 * Builds a Javascript API from the Emscripten module. This API is still
 * low-level and closely corresponds to the C API exported by the module,
 * but differs in some specifics like throwing exceptions on errors.
 * @param {*} Module SQLite module
 * @returns {SQLiteAPI}
 */
export function Factory(Module) {
  const api = {};

  const sqliteFreeAddress = Module._getSqliteFree();

  // Allocate some space for 32-bit returned values.
  const tmp = Module._malloc(8);
  const tmpPtr = [tmp, tmp + 4];

  // Convert a JS string to a C string. sqlite3_malloc is used to allocate
  // memory (use sqlite3_free to deallocate).
  function createUTF8(s) {
    if (typeof s !== 'string') return 0;
    const n = Module.lengthBytesUTF8(s);
    const zts = Module._sqlite3_malloc(n + 1);
    Module.stringToUTF8(s, zts, n + 1);
    return zts;
  }

  const databases = new Set();
  function verifyDatabase(db) {
    if (!databases.has(db)) {
      throw new SQLiteError('not a database', SQLITE_MISUSE);
    }
  }

  const statements = new Map();
  function verifyStatement(stmt) {
    if (!statements.has(stmt)) {
      throw new SQLiteError('not a statement', SQLITE_MISUSE);
    }
  }

  api.bind = function(stmt, bindings) {
    verifyStatement(stmt);
    const isArray = Array.isArray(bindings);
    const nBindings = api.bind_parameter_count(stmt);
    for (let i = 1; i <= nBindings; ++i) {
      const key = isArray ? i - 1 : api.bind_parameter_name(stmt, i);
      const value = bindings[key];
      switch (typeof value) {
        case 'number':
          if (value === (value | 0)) {
            api.bind_int(stmt, i, value);
          } else {
            api.bind_double(stmt, i, value);
          }
          break;
        case 'string':
          api.bind_text(stmt, i, value);
          break;
        default:
          if (value instanceof Int8Array || Array.isArray(value)) {
            api.bind_blob(stmt, i, value);
          } else if (value === null) {
            api.bind_null(stmt, i);
          } else {
            console.warn('unknown binding converted to null', value);
            api.bind_null(stmt, i);
          }
          break;
      }
    }
    return SQLITE_OK;
  };

  api.bind_blob = (function() {
    const fname = 'sqlite3_bind_blob';
    const f = Module.cwrap(fname, ...decl('nnnnn:n'));
    return function(stmt, i, value) {
      verifyStatement(stmt);
      const ptr = Module._sqlite3_malloc(value.byteLength);
      Module.HEAP8.subarray(ptr).set(value);
      const result = f(stmt, i, ptr, value.byteLength, sqliteFreeAddress);
      // trace(fname, result);
      return result;
    };
  })();

  api.bind_parameter_count = (function() {
    const fname = 'sqlite3_bind_parameter_count';
    const f = Module.cwrap(fname, ...decl('n:n'));
    return function(stmt) {
      verifyStatement(stmt);
      const result = f(stmt);
      // trace(fname, result);
      return result;
    };
  })();

  api.bind_double = (function() {
    const fname = 'sqlite3_bind_double';
    const f = Module.cwrap(fname, ...decl('nnn:n'));
    return function(stmt, i, value) {
      verifyStatement(stmt);
      const result = f(stmt, i, value);
      // trace(fname, result);
      return result;
    };
  })();

  api.bind_int = (function() {
    const fname = 'sqlite3_bind_int';
    const f = Module.cwrap(fname, ...decl('nnn:n'));
    return function(stmt, i, value) {
      verifyStatement(stmt);
      const result = f(stmt, i, value);
      // trace(fname, result);
      return result;
    };
  })();

  api.bind_null = (function() {
    const fname = 'sqlite3_bind_null';
    const f = Module.cwrap(fname, ...decl('nn:n'));
    return function(stmt, i) {
      verifyStatement(stmt);
      const result = f(stmt, i);
      // trace(fname, result);
      return result;
    };
  })();

  api.bind_parameter_name = (function() {
    const fname = 'sqlite3_bind_parameter_name';
    const f = Module.cwrap(fname, ...decl('n:s'));
    return function(stmt, i) {
      verifyStatement(stmt);
      const result = f(stmt, i);
      // trace(fname, result);
      return result;
    };
  })();

  api.bind_text = (function() {
    const fname = 'sqlite3_bind_text';
    const f = Module.cwrap(fname, ...decl('nnnnn:n'));
    return function(stmt, i, value) {
      verifyStatement(stmt);
      const ptr = createUTF8(value);
      const result = f(stmt, i, ptr, -1, sqliteFreeAddress);
      // trace(fname, result);
      return result;
    };
  })();

  api.close = (function() {
    const fname = 'sqlite3_close';
    const f = Module.cwrap(fname, ...decl('n:n'), { async });
    return async function(db) {
      verifyDatabase(db);
      const result = await f(db);
      databases.delete(db);
      return check(fname, result, db);
    };
  })();

  api.column_blob = (function() {
    const fname = 'sqlite3_column_blob';
    const f = Module.cwrap(fname, ...decl('nn:n'));
    return function(stmt, iCol) {
      verifyStatement(stmt);
      const nBytes = api.column_bytes(stmt, iCol);
      const address = f(stmt, iCol);
      const result = Module.HEAP8.subarray(address, address + nBytes);
      // trace(fname, result);
      return result;
    };
  })();

  api.column_bytes = (function() {
    const fname = 'sqlite3_column_bytes';
    const f = Module.cwrap(fname, ...decl('nn:n'));
    return function(stmt, iCol) {
      verifyStatement(stmt);
      const result = f(stmt, iCol);
      // trace(fname, result);
      return result;
    };
  })();

  api.column_count = (function() {
    const fname = 'sqlite3_column_count';
    const f = Module.cwrap(fname, ...decl('n:n'));
    return function(stmt) {
      verifyStatement(stmt);
      const result = f(stmt);
      // trace(fname, result);
      return result;
    };
  })();

  api.column_double = (function() {
    const fname = 'sqlite3_column_double';
    const f = Module.cwrap(fname, ...decl('nn:n'));
    return function(stmt, iCol) {
      verifyStatement(stmt);
      const result = f(stmt, iCol);
      // trace(fname, result);
      return result;
    };
  })();

  api.column_int = (function() {
    const fname = 'sqlite3_column_int';
    const f = Module.cwrap(fname, ...decl('nn:n'));
    return function(stmt, iCol) {
      verifyStatement(stmt);
      const result = f(stmt, iCol);
      // trace(fname, result);
      return result;
    };
  })();

  api.column_name = (function() {
    const fname = 'sqlite3_column_name';
    const f = Module.cwrap(fname, ...decl('nn:s'));
    return function(stmt, iCol) {
      verifyStatement(stmt);
      const result = f(stmt, iCol);
      // trace(fname, result);
      return result;
    };
  })();

  api.column_names = function(stmt) {
    const columns = [];
    const nColumns = api.column_count(stmt);
    for (let i = 0; i < nColumns; ++i) {
      columns.push(api.column_name(stmt, i));
    }
    return columns;
  }

  api.column_text = (function() {
    const fname = 'sqlite3_column_text';
    const f = Module.cwrap(fname, ...decl('nn:s'));
    return function(stmt, iCol) {
      verifyStatement(stmt);
      const result = f(stmt, iCol);
      // trace(fname, result);
      return result;
    };
  })();

  api.column_type = (function() {
    const fname = 'sqlite3_column_type';
    const f = Module.cwrap(fname, ...decl('nn:n'));
    return function(stmt, iCol) {
      verifyStatement(stmt);
      const result = f(stmt, iCol);
      // trace(fname, result);
      return result;
    };
  })();

  api.data_count = (function() {
    const fname = 'sqlite3_data_count';
    const f = Module.cwrap(fname, ...decl('n:n'));
    return function(stmt) {
      verifyStatement(stmt);
      const result = f(stmt);
      // trace(fname, result);
      return result;
    };
  })();

  api.exec = async function(db, sql, callback, userData) {
    const str = api.str_new(db, sql);
    try {
      // Initialize the prepared statement state that will evolve
      // as we progress through the SQL.
      /** @type {*} */ let prepared = { sql: api.str_value(str) };
      while (true) {
        // Prepare the next statement. Another try-finally goes here
        // to ensure that each prepared statement is finalized.
        if (!(prepared = await api.prepare_v2(db, prepared.sql))) {
          break;
        }
        try {
          // Step through the rows.
          const columns = api.column_names(prepared.stmt);
          while (await api.step(prepared.stmt) === SQLITE_ROW) {
            const row = api.row(prepared.stmt);
            if (callback) {
              await callback(userData, row.length, row, columns);
            }
          }
        } finally {
          api.finalize(prepared.stmt);
        }
      }
    } finally {
      api.str_finish(str);
    }
    return SQLITE_OK;
  };

  api.finalize = (function() {
    const fname = 'sqlite3_finalize';
    const f = Module.cwrap(fname, ...decl('n:n'), { async });
    return async function(stmt) {
      verifyStatement(stmt);
      const result = await f(stmt);

      const statement = statements.get(stmt);
      statements.delete(stmt)
      return check(fname, result, statement);
    };
  })();

  api.libversion = (function() {
    const fname = 'sqlite3_libversion';
    const f = Module.cwrap(fname, ...decl(':s'));
    return function() {
      const result = f();
      return result;
    };
  })();

  api.libversion_number = (function() {
    const fname = 'sqlite3_libversion_number';
    const f = Module.cwrap(fname, ...decl(':n'));
    return function() {
      const result = f();
      return result;
    };
  })();

  api.open_v2 = (function() {
    const fname = 'sqlite3_open_v2';
    const f = Module.cwrap(fname, ...decl('snnn:n'), { async });
    return async function(zFilename, flags, zVfs) {
      flags = flags || SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE;
      zVfs = createUTF8(zVfs);
      const result = await f(zFilename, tmpPtr[0], flags, zVfs);

      const db = Module.getValue(tmpPtr[0], 'i32');
      databases.add(db);
      Module._sqlite3_free(zVfs);

      Module.ccall('RegisterExtensionFunctions', 'void', ['number'], [db]);
      check(fname, result);
      return db;
    };
  })();

  api.prepare_v2 = (function() {
    const fname = 'sqlite3_prepare_v2';
    const f = Module.cwrap(fname, ...decl('nnnnn:n'), { async });
    return async function(db, sql) {
      const result = await f(db, sql, -1, tmpPtr[0], tmpPtr[1]);
      check(fname, result, db);

      const stmt = Module.getValue(tmpPtr[0], 'i32');
      if (stmt) {
        statements.set(stmt, db);
        return { stmt, sql: Module.getValue(tmpPtr[1], 'i32') };
      }
      return null;
    };
  })();

  api.reset = (function() {
    const fname = 'sqlite3_reset';
    const f = Module.cwrap(fname, ...decl('n:n'));
    return function(stmt) {
      verifyStatement(stmt);
      const result = f(stmt);
      return check(fname, result, statements.get(stmt));
    };
  })();

  api.row = function(stmt) {
    const row = [];
    const nColumns = api.data_count(stmt);
    for (let i = 0; i < nColumns; ++i) {
      const type = api.column_type(stmt, i);
      switch (type) {
      case SQLITE_INTEGER:
        row.push(api.column_int(stmt, i));
        break;
      case SQLITE_FLOAT:
        row.push(api.column_double(stmt, i));
        break;
      case SQLITE_TEXT:
        row.push(api.column_text(stmt, i));
        break;
      case SQLITE_BLOB:
        row.push(api.column_blob(stmt, i));
        break;
      default:
        row.push(null);
        break;
      }      
    }
    return row;
  }

  api.step = (function() {
    const fname = 'sqlite3_step';
    const f = Module.cwrap(fname, ...decl('n:n'), { async });
    return async function(stmt) {
      verifyStatement(stmt);
      const result = await f(stmt);
      return check(fname, result, statements.get(stmt), [SQLITE_ROW, SQLITE_DONE]);
    };
  })();

  // Duplicate some of the SQLite dynamic string API but without
  // calling SQLite (except for memory allocation). We need some way
  // to transfer Javascript strings and might as well use an API
  // that mimics the SQLite API.
  let stringId = 0;
  const strings = new Map();

  api.str_new = function(db, s = '') {
    const sBytes = Module.lengthBytesUTF8(s);
    const str = stringId++ & 0xffffffff;
    const data = {
      offset: Module._sqlite3_malloc(sBytes + 1),
      bytes: sBytes
    };
    strings.set(str, data);
    Module.stringToUTF8(s, data.offset, data.bytes + 1);
    return str;
  };

  api.str_appendall = function(str, s) {
    if (!strings.has(str)) {
      throw new SQLiteError('not a string', SQLITE_MISUSE);
    }
    const data = strings.get(str);

    const sBytes = Module.lengthBytesUTF8(s);
    const newBytes = data.bytes + sBytes;
    const newOffset = Module._sqlite3_malloc(newBytes + 1);
    const newArray = Module.HEAP8.subarray(newOffset, newOffset + newBytes + 1);
    newArray.set(Module.HEAP8.subarray(data.offset, data.offset + data.bytes));
    Module.stringToUTF8(s, newOffset + data.bytes, sBytes + 1)

    Module._sqlite3_free(data.offset);
    data.offset = newOffset;
    data.bytes = newBytes;
    strings.set(str, data);
  };

  api.str_value = function(str) {
    if (!strings.has(str)) {
      throw new SQLiteError('not a string', SQLITE_MISUSE);
    }
    return strings.get(str).offset;
  };

  api.str_finish = function(str) {
    if (!strings.has(str)) {
      throw new SQLiteError('not a string', SQLITE_MISUSE);
    }
    const data = strings.get(str);
    strings.delete(str);
    Module._sqlite3_free(data.offset);
  };

  api.vfs_register = function(vfs, makeDefault) {
    Module.registerVFS(vfs, makeDefault);
    return SQLITE_OK;
  };

  function check(fname, result, db = null, allowed = [SQLITE_OK]) {
    // trace(fname, result);
    if (allowed.includes(result)) return result;
    const message = db ?
      Module.ccall('sqlite3_errmsg', 'string', ['number'], [db]) :
      fname;
    throw new SQLiteError(message || fname, result);
  }

  return api;
}

/**
 * Template tag builder. This function creates a tag with an API and
 * database from the same module, then the tag can be used like this:
 * ```
 * const sql = SQLiteAPI.tag(sqlite3, db);
 * const results = await sql`SELECT 1 + 1; SELECT 6 * 7;`;
 * ```
 * The returned Promise value contains an array of results for each
 * SQL statement that produces output.
 * @param {SQLiteAPI} sqlite3 
 * @param {number} db
 * @returns {function(TemplateStringsArray, ...any): Promise<object>}
 */
export function tag(sqlite3, db) {
  return async function(strings, ...values) {
    let interleaved = [];
    strings.forEach((s, i) => {
      interleaved.push(s, values[i]);
    });

    // Transfer the SQL to WASM memory. We set up a try-finally block
    // to ensure that the memory is always freed.
    let results = [];
    const str = sqlite3.str_new(db, interleaved.join(''));
    try {
      // Initialize the prepared statement state that will evolve
      // as we progress through the SQL.
      /** @type {*} */ let prepared = { sql: sqlite3.str_value(str) };
      while (true) {
        // Prepare the next statement. Another try-finally goes here
        // to ensure that each prepared statement is finalized.
        if (!(prepared = await sqlite3.prepare_v2(db, prepared.sql))) {
          break;
        }
        try {
          // Step through the rows.
          const rows = [];
          const columns = sqlite3.column_names(prepared.stmt)
          while (await sqlite3.step(prepared.stmt) === SQLITE_ROW) {
            // Collect row elements.
            const row = sqlite3.row(prepared.stmt);
            rows.push(row);
          }
          if (columns.length) {
            results.push({ columns, rows });
          }
        } finally {
          sqlite3.finalize(prepared.stmt);
        }
      }
    } finally {
      sqlite3.str_finish(str);
    }
    return results;
  }
}

// Helper function to use a more compact signature specification.
function decl(s) {
  const result = [];
  const m = s.match(/([ns]*):([ns])/);
  switch (m[2]) {
    case 'n': result.push('number'); break;
    case 's': result.push('string'); break;
  }

  const args = [];
  for (let c of m[1]) {
    switch (c) {
      case 'n': args.push('number'); break;
      case 's': args.push('string'); break;
    }
  }
  result.push(args);
  return result;
}
