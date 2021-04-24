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

export const SQLITE_INTEGER = 1;
export const SQLITE_FLOAT = 2;
export const SQLITE_TEXT = 3;
export const SQLITE_BLOB = 4;

export class SQLiteError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const async = true;

function trace(fname, result) {
  // const date = new Date();
  // const t = date.getHours().toString().padStart(2, '0') + ':' +
  //           date.getMinutes().toString().padStart(2, '0') + ':' +
  //           date.getSeconds().toString().padStart(2, '0') + '.' +
  //           date.getMilliseconds().toString().padStart(3, '0');
  // console.debug(t, fname, result);
}

/**
 * @typedef {Object} SQLiteAPI
 * 
 * @property {(
 *  db: number) => Promise<number>} close
 * 
 * @property {(
 *  stmt: number,
 *  iCol: number) => Int8Array} column_blob
 * 
 * @property {(
 *  stmt: number,
 *  iCol: number) => number} column_bytes
 * 
 * @property {(
 *  stmt: number) => number} column_count
 * 
 * @property {(
 *  stmt: number,
 *  iCol: number) => number} column_double
 * 
 * @property {(
 *  stmt: number,
 *  iCol: number) => number} column_int
 * 
 * @property {(
 *  stmt: number,
 *  iCol: number) => string} column_name
 * 
 * @property {(
 *  stmt: number,
 *  iCol: number) => string} column_text
 * 
 * @property {(
 *  stmt: number,
 *  iCol: number) => number} column_type
 * 
 * @property {(
 *  stmt: number) => number} data_count
 * 
 * @property {(
 *  stmt: number) => Promise<number>} finalize
 * 
 * @property {(
 *  zFilename: string,
 *  iFlags?: number,
 *  zVfs?: string) => Promise<number>} open_v2
 * 
 * @property {(
 *  db: number,
 *  sql: string|number) => Promise<{ stmt: number, sql: number }?>} prepare_v2
 * 
 * @property {(
 *  stmt: number) => number} reset Reset a prepared statement object.
 * 
 * @property {(
 *  stmt: number) => Promise<number>} step Evaluate an SQL statement.
 */

/**
 * 
 * @param {*} Module SQLite module
 * @returns {SQLiteAPI}
 */
export function Factory(Module) {
  const api = {};

  // Allocate some space for 32-bit returned values.
  const tmp = Module._malloc(8);
  const tmpPtr = [tmp, tmp + 4];

  // Manage temporary strings.
  function createUTF8(s) {
    if (typeof s !== 'string') return 0;
    const n = Module.lengthBytesUTF8(s);
    const zts = Module._malloc(n + 1);
    Module.stringToUTF8(s, zts, n + 1);
    return zts;
  }
  function destroyUTF8(utf8) {
    if (utf8) Module._free(utf8);
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
      const result = new Int8Array(Module.HEAP8, address, nBytes);
      trace(fname, result);
      return result;
    }
  })();

  api.column_bytes = (function() {
    const fname = 'sqlite3_column_bytes';
    const f = Module.cwrap(fname, ...decl('nn:n'));
    return function(stmt, iCol) {
      verifyStatement(stmt);
      const result = f(stmt, iCol);
      trace(fname, result);
      return result;
    }
  })();

  api.column_count = (function() {
    const fname = 'sqlite3_column_count';
    const f = Module.cwrap(fname, ...decl('n:n'));
    return function(stmt) {
      verifyStatement(stmt);
      const result = f(stmt);
      trace(fname, result);
      return result;
    };
  })();

  api.column_double = (function() {
    const fname = 'sqlite3_column_double';
    const f = Module.cwrap(fname, ...decl('nn:n'));
    return function(stmt, iCol) {
      verifyStatement(stmt);
      const result = f(stmt, iCol);
      trace(fname, result);
      return result;
    }
  })();

  api.column_int = (function() {
    const fname = 'sqlite3_column_int';
    const f = Module.cwrap(fname, ...decl('nn:n'));
    return function(stmt, iCol) {
      verifyStatement(stmt);
      const result = f(stmt, iCol);
      trace(fname, result);
      return result;
    }
  })();

  api.column_name = (function() {
    const fname = 'sqlite3_column_name';
    const f = Module.cwrap(fname, ...decl('nn:s'));
    return function(stmt, iCol) {
      verifyStatement(stmt);
      const result = f(stmt, iCol);
      trace(fname, result);
      return result;
    };
  })();

  api.column_text = (function() {
    const fname = 'sqlite3_column_text';
    const f = Module.cwrap(fname, ...decl('nn:s'));
    return function(stmt, iCol) {
      verifyStatement(stmt);
      const result = f(stmt, iCol);
      trace(fname, result);
      return result;
    }
  })();

  api.column_type = (function() {
    const fname = 'sqlite3_column_type';
    const f = Module.cwrap(fname, ...decl('nn:n'));
    return function(stmt, iCol) {
      verifyStatement(stmt);
      const result = f(stmt, iCol);
      trace(fname, result);
      return result;
    };
  })();

  api.data_count = (function() {
    const fname = 'sqlite3_data_count';
    const f = Module.cwrap(fname, ...decl('n:n'));
    return function(stmt) {
      verifyStatement(stmt);
      const result = f(stmt);
      trace(fname, result);
      return result;
    };
  })();

  api.finalize = (function() {
    const fname = 'sqlite3_finalize';
    const f = Module.cwrap(fname, ...decl('n:n'), { async });
    return async function(stmt) {
      verifyStatement(stmt);
      const result = await f(stmt);

      const statement = statements.get(stmt);
      statements.delete(stmt)
      if (statement.allocated) {
        destroyUTF8(statement.allocated);
      }
      return check(fname, result, statement.db);
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
      destroyUTF8(zVfs);

      Module.ccall('RegisterExtensionFunctions', 'void', ['number'], [db]);
      check(fname, result);
      return db;
    };
  })();

  api.prepare_v2 = (function() {
    const fname = 'sqlite3_prepare_v2';
    const f = Module.cwrap(fname, ...decl('nnnnn:n'), { async });
    return async function(db, sql) {
      let allocated;
      if (typeof sql === 'string') {
        allocated = createUTF8(sql);
        sql = allocated;
      }

      const result = await f(db, sql, -1, tmpPtr[0], tmpPtr[1]);
      const stmt = Module.getValue(tmpPtr[0], 'i32');
      sql = Module.getValue(tmpPtr[1], 'i32');

      statements.set(stmt, { db, allocated });

      check(fname, result, db);
      return stmt ? { stmt, sql } : null;
    };
  })();

  api.reset = (function() {
    const fname = 'sqlite3_reset';
    const f = Module.cwrap(fname, ...decl('n:n'));
    return function(stmt) {
      verifyStatement(stmt);
      const result = f(stmt);
      return check(fname, result, statements.get(stmt).db);
    };
  })();

  api.step = (function() {
    const fname = 'sqlite3_step';
    const f = Module.cwrap(fname, ...decl('n:n'), { async });
    return async function(stmt) {
      verifyStatement(stmt);
      const result = await f(stmt);
      return check(fname, result, statements.get(stmt).db, [SQLITE_ROW, SQLITE_DONE]);
    };
  })();

  function check(fname, result, db = null, allowed = [SQLITE_OK]) {
    trace(fname, result);
    if (allowed.includes(result)) return result;
    const message = db ?
      Module.ccall('sqlite3_errmsg', 'string', ['number'], [db]) :
      fname;
    throw new SQLiteError(message || fname, result);
  }

  return api;
}

/**
 * Template tag builder.
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

    /** @type {*} */ let prepared = { sql: interleaved.join('') };
    let results = [];
    while (true) {
      if (!(prepared = await sqlite3.prepare_v2(db, prepared.sql))) {
        break;
      }
      try {
        const columns = [];
        const nColumns = sqlite3.column_count(prepared.stmt);
        for (let i = 0; i < nColumns; ++i) {
          columns.push(sqlite3.column_name(prepared.stmt, i));
        }

        const rows = [];
        while (await sqlite3.step(prepared.stmt) === SQLITE_ROW) {
          const row = [];
          for (let i = 0; i < nColumns; ++i) {
            const type = sqlite3.column_type(prepared.stmt, i);
            switch (type) {
            case SQLITE_INTEGER:
              row.push(sqlite3.column_int(prepared.stmt, i));
              break;
            case SQLITE_FLOAT:
              row.push(sqlite3.column_double(prepared.stmt, i));
              break;
            case SQLITE_TEXT:
              row.push(sqlite3.column_text(prepared.stmt, i));
              break;
            case SQLITE_BLOB:
              row.push(sqlite3.column_blob(prepared.stmt, i));
              break;
            default:
              row.push(null);
              break;
            }      
          }
          rows.push(row);
        }
        if (nColumns) {
          results.push({ columns, rows });
        }
      } finally {
        sqlite3.finalize(prepared.stmt);
      }
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