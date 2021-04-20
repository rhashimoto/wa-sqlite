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
const SQLITE_STATIC = 0;
const SQLITE_TRANSIENT = -1;

// Dummy base class to get rid of Intellisense warnings.
class SQLite3 {
  sqlite3_bind_blob(a0, a1, a2, a3, a4) { return 0; }
  sqlite3_bind_double(a0, a1, a2) { return 0; }
  sqlite3_bind_int(a0, a1, a2) { return 0; }
  sqlite3_bind_null(a0, a1) { return 0; }
  sqlite3_bind_text(a0, a1, a2, a3, a4) { return 0; }
  sqlite3_bind_parameter_count(a0) { return 0; }
  sqlite3_close(a0) { return 0; }
  sqlite3_column_blob(a0, a1) { return 0; }
  sqlite3_column_bytes(a0, a1) { return 0; }
  sqlite3_column_count(a0) { return 0; }
  sqlite3_column_double(a0, a1) { return 0; }
  sqlite3_column_type(a0, a1) { return 0; }
  sqlite3_data_count(a0) { return 0; }
  sqlite3_finalize(a0) { return 0; }
  sqlite3_open_v2(a0, a1, a2, a3) {}
  sqlite3_prepare_v2(a0, a1, a2, a3, a4) {}
  sqlite3_reset(a0) { return 0; }
  sqlite3_step(a0) { return 0; }
  sqlite3_bind_parameter_name(a0, a1) { return ''; }
  sqlite3_column_name(a0, a1) { return ''; }
  sqlite3_column_text(a0, a1) { return ''; }
  sqlite3_errmsg(a0) { return ''; }
}

export class Database extends SQLite3 {
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
    * @param {string} name 
    * @param {string} [vfs] 
    */
   constructor(name, vfs) {
     super();
     if (!Module) {
       throw new Error('Database.initialize() not called with Module');
     }
     this._ready = this._createDB(name, vfs);
   }
 
   async sql(strings, ...keys) {
     if (typeof this._ready !== 'number') {
       await this._ready;
     }

     if (Array.isArray(strings)) {
       // Tagged template usage.
       let interleaved = [];
       strings.forEach((s, i) => {
         interleaved.push(s, keys[i]);
       });
       const source = interleaved.join('');
       return this._run(source);
     } else {
       // Repeated statement with native bindings usage.
       return this._runRepeated(strings, keys[0] ?? [[]]);
     }
   }
 
   async close() {
     const db = typeof this._ready === 'number' ? this._ready : await this._ready;
     await this.sqlite3_close(db);
     Module._sqlite3_free(this._tmpPtr[0]);
   }
   
   async _createDB(name, vfs = 'unix') {
     // Allocate space for C output variables.
     const tmpBuffer = Module._malloc(8);
     this._tmpPtr = [tmpBuffer, tmpBuffer + 4];
   
     const flags = SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE;
     await this.sqlite3_open_v2(name, this._tmpPtr[0], flags, vfs);

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
           this.sqlite3_reset(prepared.statement);
           if (prepared.columns?.length) {
             results.push({ rows, columns: prepared.columns });
           }
           sqlOffset += prepared.consumed;
         }
       } finally {
         if (prepared?.statement) {
           this.sqlite3_finalize(prepared.statement);
           prepared.statement = null;
         }
       }
     } while (prepared);
     destroyArray(sqlAddress);
     return results;
   }
 
   /**
    * Execute a single SQL statement with multiple parameter bindings.
    * @param {string} sql 
    * @param {Array<object|Array>} params 
    * @returns 
    */
   async _runRepeated(sql, params) {
     // Copy the SQL to WASM memory.
     const sqlAddress = createArrayFromString(sql);
   
     let results = [];
     let prepared;
     try {
       // Parse a single statement.
       prepared = await this._prepare(sqlAddress);
       if (prepared) {
         // Execute statement with each set of parameters.
         for (const bindings of params) {
           // Save malloc-ed binding pointers to be freed at completion.
           const allocations = [];
           try {
             this._bind(prepared.statement, bindings, allocations);
       
             const rows = await this._processRows(prepared.statement);
             this.sqlite3_reset(prepared.statement);
             if (prepared.columns?.length) {
               results.push({ rows, columns: prepared.columns });
             }
           } finally {
             // Free malloc-ed binding pointers.
             for (const ptr of allocations) {
               Module._sqlite3_free(ptr);
             }
           }
         }
       }
     } finally {
       if (prepared?.statement) {
         this.sqlite3_finalize(prepared.statement);
         prepared.statement = null;
       }
       destroyArray(sqlAddress);
     }
     return results;
   }
   
   /**
    * @param {number} address 
    * @returns 
    */
   async _prepare(address) {
     // Prepare one statement at the WASM address. The wrapper throws an
     // exception on any error (e.g. invalid SQL). Input that is only
     // whitespace or comments is not an error and returns a null statement.
     const db = this._ready;
     await this.sqlite3_prepare_v2(db, address, -1, this._tmpPtr[0], this._tmpPtr[1]);
 
     const statement = this._tmp[0];
     if (statement) {
       // Get column names.
       const columns = [];
       const nColumns = this.sqlite3_column_count(statement);
       for (let i = 0; i < nColumns; ++i) {
         const name = this.sqlite3_column_name(statement, i);
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
   
   /**
    * Bind parameters to statement. Bindings can be provided with an object
    * or an array. See https://www.sqlite.org/lang_expr.html#varparam for
    * details on binding by index or name.
    * @param {number} statement 
    * @param {object|Array} bindings 
    * @param {Array<number>} allocations array for malloc-ed addresses
    */
   _bind(statement, bindings, allocations) {
     // Note that the SQLite API uses 1-based indexing for bindings.
     const isArray = Array.isArray(bindings);
     const nBindings = this.sqlite3_bind_parameter_count(statement);
     for (let i = 1; i <= nBindings; ++i) {
       const key = isArray ? i - 1 : this.sqlite3_bind_parameter_name(statement, i);
       const value = bindings[key];
       switch (typeof value) {
         case 'number':
           // @ts-ignore
           if (value === value | 0) {
             this.sqlite3_bind_int(statement, i, value);
           } else {
             this.sqlite3_bind_double(statement, i, value);
           }
           break;
         case 'string':
           const len = Module.lengthBytesUTF8(value);
           const ptr = Module._sqlite3_malloc(len + 1);
           allocations.push(ptr);
           Module.stringToUTF8(value, ptr, len + 1);
           this.sqlite3_bind_text(statement, i, ptr, len, SQLITE_STATIC);
           break;
         case 'object':
           if (typeof value.byteLength === 'number') {
             // Assumed to be ArrayBuffer.
             const ptr = Module._sqlite3_malloc(value.byteLength);
             allocations.push(ptr);
             Module.HEAP8.subarray(ptr).set(new Int8Array(value));
             this.sqlite3_bind_blob(statement, i, ptr, value.byteLength, SQLITE_STATIC);
           } else {
             console.warn('unrecognized binding type converted to null', value);
             this.sqlite3_bind_null(statement, i);
           }
           break;
         default:
           this.sqlite3_bind_null(statement, i);
           break;
       }
     }
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
     const status = await this.sqlite3_step(statement);
     if (status !== SQLITE_ROW) return null;
 
     const row = [];
     const nColumns = this.sqlite3_data_count(statement);
     for (let i = 0; i < nColumns; ++i) {
       const type = this.sqlite3_column_type(statement, i);
       switch (type) {
         case SQLITE_INTEGER:
         case SQLITE_FLOAT:
           row.push(this.sqlite3_column_double(statement, i));
           break;
         case SQLITE_TEXT:
           row.push(this.sqlite3_column_text(statement, i));
           break;
         case SQLITE_BLOB:
           const blobSize = this.sqlite3_column_bytes(statement, i);
           const buffer = new ArrayBuffer(blobSize);
           if (blobSize) {
             const blobData = this.sqlite3_column_blob(statement, i);
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

function createArrayFromString(s) {
  const length = Module.lengthBytesUTF8(s);
  const address = Module._sqlite3_malloc(length + 1);
  Module.stringToUTF8(s, address, length + 1);
  return address;
}

function destroyArray(address) {
  Module._sqlite3_free(address);
}

Database.initialize = function(module) {
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
  fn('finalize', ['number']);
  fn('open_v2', ['string', 'number', 'number', 'string'], isAsync);
  fn('prepare_v2', ['number', 'number', 'number', 'number', 'number'], isAsync);
  fn('reset', ['number']);
  fn('step', ['number'], isAsync);

  // Custom definitions for functions that don't return an int.
  /** @type {any} */ const proto = Database.prototype;
  proto.sqlite3_bind_parameter_name = Module.cwrap('sqlite3_bind_parameter_name', 'string', ['number', 'number']);
  proto.sqlite3_column_name = Module.cwrap('sqlite3_column_name', 'string', ['number', 'number']);
  proto.sqlite3_column_text = Module.cwrap('sqlite3_column_text', 'string', ['number', 'number']);
  proto.sqlite3_errmsg = Module.cwrap('sqlite3_errmsg', 'string', ['number']);
}

// Helper to wrap a typical SQLite API function that returns a number.
function fn(name, argTypes, async = false) {
  const fname = `sqlite3_${name}`;
  const f = Module.cwrap(fname, 'number', argTypes, { async });
  Database.prototype[fname] = function(...args) {
    const result = f(...args);
    if (result.then) {
      console.debug(ts(), fname);
      return result.then(result => checkResult(this, name, result));
    }
    return checkResult(this, name, result);
  };
}

// Helper for the wrapper to throw an exception on unexpected return value.
function checkResult(database, name, result) {
  console.debug(ts(), `sqlite3_${name}`, result);
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
        if (typeof database.ready === 'number') {
          throw new Error(database.sqlite3_errmsg(database.ready));
        }
        throw new Error(`${name} ${result}`);
      }
      return result;
  }
}

// Timestamp string for debug logging.
function ts() {
  const date = new Date();
  return date.getHours().toString().padStart(2, '0') + ':' +
         date.getMinutes().toString().padStart(2, '0') + ':' +
         date.getSeconds().toString().padStart(2, '0') + '.' +
         date.getMilliseconds().toString().padStart(3, '0');
}