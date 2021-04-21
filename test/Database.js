// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
let Module;

const SQLITE_OK = 0;
const SQLITE_ROW = 100;
const SQLITE_DONE = 101;
const SQLITE_INTEGER = 1;
const SQLITE_FLOAT = 2;
const SQLITE_TEXT = 3;
const SQLITE_BLOB = 4;
const SQLITE_OPEN_READWRITE = 0x0002;
const SQLITE_OPEN_CREATE = 0x0004;

// Create SQLite API wrappers.
const api = {};
function initialize(module) {
  Module = module;

  // Define functions.
  const isAsync = true;
  fn('bind_blob', ['number', 'number', 'number', 'number', 'number']);
  fn('bind_double', ['number', 'number', 'number']);
  fn('bind_int', ['number', 'number', 'number']);
  fn('bind_null', ['number', 'number']);
  fn('bind_text', ['number', 'number', 'number', 'number', 'number']);
  fn('bind_parameter_count', ['number']);
  fn('close', ['number'], isAsync);
  fn('column_blob', ['number', 'number']);
  fn('column_bytes', ['number', 'number']);
  fn('column_count', ['number']);
  fn('column_double', ['number', 'number']);
  fn('column_type', ['number', 'number']);
  fn('data_count', ['number']);
  fn('finalize', ['number'], isAsync);
  fn('open_v2', ['string', 'number', 'number', 'string'], isAsync);
  fn('prepare_v2', ['number', 'number', 'number', 'number', 'number'], isAsync);
  fn('reset', ['number']);
  fn('step', ['number'], isAsync);

  fs('bind_parameter_name', ['number', 'number']);
  fs('column_name', ['number', 'number']);
  fs('column_text', ['number', 'number']);
  fs('errmsg', ['number']);
}

// Helper to wrap a typical SQLite API function that returns a number.
function fn(name, argTypes, async = false) {
  const fname = `sqlite3_${name}`;
  const f = Module.cwrap(fname, 'number', argTypes, { async });
  api[fname] = function(...args) {
    const result = f(...args);
    if (result.then) {
      trace(fname);
      return result.then(result => checkResult(this, name, result));
    }
    return checkResult(this, name, result);
  };
}

// Helper to wrap a typical SQLite API function that returns a string.
function fs(name, argTypes, async = false) {
  const fname = `sqlite3_${name}`;
  api[fname] = Module.cwrap(fname, 'string', argTypes, { async });
}

// Helper for the wrapper to throw an exception on unexpected return value.
function checkResult(database, name, result) {
  trace(`sqlite3_${name}`, result);
  switch (name) {
    case 'bind_parameter_count':
    case 'column_blob':
    case 'column_bytes':
    case 'column_double':
    case 'column_count':
    case 'column_type':
    case 'data_count':
    case 'finalize':
      return result;
    case 'step':
      if (result === SQLITE_ROW || result === SQLITE_DONE) {
        return result;
      }
    default:
      if (result !== SQLITE_OK) {
        // Get detailed error if the database is open.
        if (typeof database._ready === 'number') {
          throw new Error(api.sqlite3_errmsg(database._ready));
        }
        throw new Error(`${name} ${result}`);
      }
      return result;
  }
}

function trace(...args) {
  // const date = new Date();
  // const t = date.getHours().toString().padStart(2, '0') + ':' +
  //           date.getMinutes().toString().padStart(2, '0') + ':' +
  //           date.getSeconds().toString().padStart(2, '0') + '.' +
  //           date.getMilliseconds().toString().padStart(3, '0');
  // console.debug(t, ...args);
}

export class Database {
  /**
   * This is a Promise until the db is open, afterwards the db pointer.
   * @type {Promise<void>|number}
   */
  _ready;

  // Scratch space in WASM memory for SQLite API output.
  /** @type {Array<number>} */ _tmpPtr = [];
  _tmp = new Proxy([], {
    get: (_, index) => {
      return Module.getValue(this._tmpPtr[index], '*');
    }
  });
  
  /**
   * @param {string} name filename
   * @param {string} [vfs] optional filesystem name
   */
  constructor(name, vfs) {
    if (!Module) {
      throw new Error('Database.initialize() not called with Module');
    }
    this._ready = this._createDB(name, vfs);
  }
  
  /**
   * Template literal tag for SQL query.
   * @param {TemplateStringsArray} strings 
   * @param  {...any} keys 
   * @returns Promise<Array> array of statement results
   */
  async sql(strings, ...keys) {
    if (typeof this._ready !== 'number') {
      await this._ready;
    }

    // Tagged template usage.
    let interleaved = [];
    strings.forEach((s, i) => {
      interleaved.push(s, keys[i]);
    });
    const source = interleaved.join('');
    return this._run(source);
  }
  
  /**
   * Close database. Subsequent method calls produce undefined results.
   */
  async close() {
    const db = typeof this._ready === 'number' ? this._ready : await this._ready;
    await this._call('sqlite3_close', db);
    Module._free(this._tmpPtr[0]);
  }
   
  // Invoke SQLite API function.
  _call(fname, ...args) {
    return api[fname].call(this, ...args);
  }

  // Helper for constructor. 
  async _createDB(name, vfs = 'unix') {
    // Allocate space for C output variables.
    const tmpBuffer = Module._malloc(8);
    this._tmpPtr = [tmpBuffer, tmpBuffer + 4];
   
    const flags = SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE;
    await this._call('sqlite3_open_v2', name, this._tmpPtr[0], flags, vfs);

    const db = this._tmp[0];
    Module.ccall('RegisterExtensionFunctions', 'void', ['number'], [db]);
    this._ready = db;
  }
  
  // Execute all SQL statements in the provided string.
  async _run(sql) {
    // Convert query to C string.
    const sqlAddress = createArrayFromString(sql);
    let sqlOffset = 0;
    
    // Loop over the statements in the string.
    let results = [];
    let prepared;
    do {
      try {
        // Parse the next statement.
        prepared = await this._prepare(sqlAddress + sqlOffset);
        if (prepared) {
          // Execute statement.
          const rows = await this._processRows(prepared.statement);
          this._call('sqlite3_reset', prepared.statement);
          if (prepared.columns?.length) {
            results.push({ rows, columns: prepared.columns });
          }
          sqlOffset += prepared.consumed;
        }
      } finally {
        if (prepared?.statement) {
          await this._call('sqlite3_finalize', prepared.statement);
          prepared.statement = null;
        }
      }
    } while (prepared);
    destroyArray(sqlAddress);
    return results;
  }
  
  async _prepare(address) {
    // Prepare one statement at the WASM address. The wrapper throws an
    // exception on any error (e.g. invalid SQL). Input that is only
    // whitespace or comments is not an error and returns a null statement.
    const db = this._ready;
    await this._call('sqlite3_prepare_v2', db, address, -1, this._tmpPtr[0], this._tmpPtr[1]);
    
    const statement = this._tmp[0];
    if (statement) {
      // Get column names.
      const columns = [];
      const nColumns = this._call('sqlite3_column_count', statement);
      for (let i = 0; i < nColumns; ++i) {
        const name = this._call('sqlite3_column_name', statement, i);
        columns.push(name);
      }
      
      return {
        statement,
        columns,
        consumed: this._tmp[1] - address // SQL bytes parsed
      };
    }
    return null;
  }

  async _processRows(statement) {
    let row;
    const rows = [];
    while (row = await this._processRow(statement)) {
      rows.push(row);
    }
    return rows;
  }
  
  async _processRow(statement) {
    const status = await this._call('sqlite3_step', statement);
    if (status !== SQLITE_ROW) return null;
    
    const row = [];
    const nColumns = this._call('sqlite3_data_count', statement);
    for (let i = 0; i < nColumns; ++i) {
      const type = this._call('sqlite3_column_type', statement, i);
      switch (type) {
      case SQLITE_INTEGER:
      case SQLITE_FLOAT:
        row.push(this._call('sqlite3_column_double', statement, i));
        break;
      case SQLITE_TEXT:
        row.push(this._call('sqlite3_column_text', statement, i));
        break;
      case SQLITE_BLOB:
        const blobSize = this._call('sqlite3_column_bytes', statement, i);
        const buffer = new ArrayBuffer(blobSize);
        if (blobSize) {
          const blobData = this._call('sqlite3_column_blob', statement, i);
          new Int8Array(buffer).set(Module.HEAP8.subarray(blobData, blobData + blobSize));
        }
        row.push(buffer);
        break;
      default:
        row.push(null);
        break;
      }
    }
    return row;
  }
}
Database.initialize = initialize;
 
function createArrayFromString(s) {
  const length = Module.lengthBytesUTF8(s);
  const address = Module._sqlite3_malloc(length + 1);
  Module.stringToUTF8(s, address, length + 1);
  return address;
}

function destroyArray(address) {
  Module._sqlite3_free(address);
}
