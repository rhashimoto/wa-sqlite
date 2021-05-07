/**
 *  Javascript types that SQLite can use
 * 
 * C integer and floating-point types both map to/from Javascript `number`.
 * Blob data can be provided to SQLite as `Int8Array` or `number[]` (with
 * each element converted to a byte); SQLite always returns blob data as
 * `Int8Array`
 */
type SQLiteCompatibleType = number|string|Int8Array|Array<number>;

/**
 * SQLite Virtual File System object
 * 
 * Objects with this interface can be passed to {@link SQLiteAPI.vfs_register}
 * to define a new filesystem.
 * 
 * @see https://sqlite.org/vfs.html
 */
declare interface SQLiteVFS {
  /** Maximum length of a file path (default 64) */
  mxPathName?: number;

  xClose(fileId: number): number|Promise<number>;

  xRead(
    fileId: number,
    pData: { size: number, value: Int8Array},
    iOffset: number
  ): number|Promise<number>;

  xWrite(
    fileId: number,
    pData: { size: number, value: Int8Array},
    iOffset: number
  ): number|Promise<number>;

  xTruncate(fileId: number, iSize: number): number|Promise<number>;

  xSync(fileId: number, flags: number): number|Promise<number>;

  xFileSize(
    fileId: number,
    pSize64: { set(value: number): void }
  ): number|Promise<number>;

  xLock(fileId: number, flags: number): number|Promise<number>;

  xUnlock(fileId: number, flags: number): number|Promise<number>;

  xCheckReservedLock(
    fileId: number,
    pResOut: { set(value: number): void }
  ): number|Promise<number>;

  xFileControl(
    fileId: number,
    flags: number,
    pOut: { value: Int8Array }
  ): number|Promise<number>;

  xDeviceCharacteristics(fileId: number): number|Promise<number>;

  xOpen(
    name: string|null,
    fileId: number,
    flags: number,
    pOutFlags: { set(value: number): void }
  ): number|Promise<number>;

  xDelete(name: string, syncDir: number): number|Promise<number>;

  xAccess(
    name: string,
    flags: number,
    pResOut: { set(value): void }
  ): number|Promise<number>;
}

/**
 * SQLite Module object
 * 
 * Objects with this interface can be passed to {@link SQLiteAPI.create_module}
 * to define a module for virtual tables.
 * 
 * @see https://sqlite.org/vtab.html
 */
 declare interface SQLiteModule {
  xCreate?(
    db: number,
    appData,
    argv: string[],
    pVTab: number,
    pzErr: { set(value: string): void }
  ): number|Promise<number>;

  xConnect(
    db: number,
    appData,
    argv: string[],
    pVTab: number,
    pzErr: { set(value: string): void }
  ): number|Promise<number>;

  xBestIndex(pVTab: number, indexInfo: object): number|Promise<number>;

  xDisconnect(pVTab: number): number|Promise<number>;

  xDestroy(pVTab: number): number|Promise<number>;

  xOpen(pVTab: number, pCursor: number): number|Promise<number>;

  xClose(pCursor: number): number|Promise<number>;

  xFilter(
    pCursor: number,
    idxNum: number,
    idxString: string|null,
    values: number[]
  ): number|Promise<number>;

  xNext(pCursor: number): number|Promise<number>;

  xEof(pCursor: number): number|Promise<number>;

  xColumn(pCursor: number, pContext: number, iCol: number): number|Promise<number>;

  xRowid(pCursor: number, pRowid: { set(value: number): void }): number|Promise<number>;

  xUpdate(
    pVTab: number,
    values: number[],
    pRowId: { set(value: number): void }): number|Promise<number>;

  xBegin?(pVTab: number): number|Promise<number>;

  xSync?(pVTab: number): number|Promise<number>;

  xCommit?(pVTab: number): number|Promise<number>;

  xRollback?(pVTab: number): number|Promise<number>;

  xRename?(pVTab: number, zNew: string): number|Promise<number>;
}

/**
 * Javascript wrappers for the SQLite C API (plus a
 * few convenience functions)
 * 
 * Function signatures have been slightly
 * modified to be more Javascript-friendly. For the C functions that
 * return an error code, the corresponding Javascript wrapper will
 * throw an exception with a `code` property on an error.
 * 
 * Note that a few functions return a Promise in order to accomodate
 * either a synchronous or asynchronous SQLite build, generally those
 * involved with opening/closing a database or executing a statement.
 */
declare interface SQLiteAPI {
  /**
   * Bind a collection (array or object) of values to a statement
   * @param stmt prepared statement pointer
   * @param bindings 
   */
  bind_collection(
    stmt: number,
    bindings: {[index: string]: SQLiteCompatibleType|null}|Array<SQLiteCompatibleType|null>
  ): number;

  /**
   * Bind value to prepared statement
   * 
   * This convenience function calls the appropriate `bind_*` function
   * based on the type of `value`.
   * @param stmt prepared statement pointer
   * @param i binding index
   * @param value 
   */
  bind(stmt: number, i: number, value: SQLiteCompatibleType|null): number;

  /**
   * Bind blob to prepared statement parameter
   * @see https://www.sqlite.org/c3ref/bind_blob.html
   * @param stmt prepared statement pointer
   * @param i binding index
   * @param value 
   */
  bind_blob(stmt: number, i: number, value: Int8Array|Array<number>): number;

  /**
   * Bind number to prepared statement parameter
   * @see https://www.sqlite.org/c3ref/bind_blob.html
   * @param stmt prepared statement pointer
   * @param i binding index
   * @param value 
   */
   bind_double(stmt: number, i: number, value: number): number;

   /**
   * Bind number to prepared statement parameter
   * @see https://www.sqlite.org/c3ref/bind_blob.html
   * @param stmt prepared statement pointer
   * @param i binding index
   * @param value 
   */
  bind_int(stmt: number, i: number, value: number): number;

   /**
   * Bind null to prepared statement
   * @see https://www.sqlite.org/c3ref/bind_blob.html
   * @param stmt prepared statement pointer
   * @param value 
   */
  bind_null(stmt: number, i: number): number;

  /**
   * Get number of bound parameters
   * @see https://www.sqlite.org/c3ref/bind_parameter_count.html
   * @param stmt prepared statement pointer
   * @returns number of statement binding locations
   */
  bind_parameter_count(stmt: number): number;

  /**
   * Get name of bound parameter
   * @see https://www.sqlite.org/c3ref/bind_parameter_name.html
   * @param stmt prepared statement pointer
   * @param i binding index
   * @returns binding name
   */
  bind_parameter_name(stmt: number, i: number): string;

   /**
   * Bind string to prepared statement
   * @see https://www.sqlite.org/c3ref/bind_blob.html
   * @param stmt prepared statement pointer
   * @param i binding index
   * @param value 
   */
  bind_text(stmt: number, i: number, value: string): number;

  /**
   * Get count of rows modified by last insert/update
   * @see https://www.sqlite.org/c3ref/changes.html
   * @param db database pointer
   * @returns number of rows modified
   */
  changes(db): number;

  /**
   * Close database connection
   * @see https://www.sqlite.org/c3ref/close.html
   * @param db database pointer
   */
  close(db): Promise<number>;

  /**
   * Call the appropriate `column_*` function based on the column type
   * @param stmt prepared statement pointer
   * @param i column index
   * @returns column value
   */
  column(stmt: number, i: number): SQLiteCompatibleType;

  /**
   * Extract a column value from a row after a prepared statment {@link step}
   * 
   * The contents of the returned buffer may be invalid after the
   * next SQLite call. Make a copy of the data (e.g. with `.slice()`)
   * if longer retention is required.
   * @see https://www.sqlite.org/c3ref/column_blob.html
   * @param stmt prepared statement pointer
   * @param i column index
   * @returns column value
   */
  column_blob(stmt: number, i: number): Int8Array;

  /**
   * Get storage size for column text or blob
   * @see https://www.sqlite.org/c3ref/column_blob.html
   * @param stmt prepared statement pointer
   * @param i column index
   * @returns number of bytes in column text or blob
   */
  column_bytes(stmt: number, i: number): number;

  /**
   * Get number of columns for a prepared statement
   * @see https://www.sqlite.org/c3ref/column_blob.html
   * @param stmt prepared statement pointer
   * @returns number of columns
   */
  column_count(stmt: number): number;

  /**
   * Extract a column value from a row after a prepared statment {@link step}
   * @see https://www.sqlite.org/c3ref/column_blob.html
   * @param stmt prepared statement pointer
   * @param i column index
   * @returns column value
   */
  column_double(stmt: number, i: number): number;

  /**
   * Extract a column value from a row after a prepared statment {@link step}
   * @see https://www.sqlite.org/c3ref/column_blob.html
   * @param stmt prepared statement pointer
   * @param i column index
   * @returns column value
   */
  column_int(stmt: number, i: number): number;

  /**
   * Get a column name for a prepared statement
   * @see https://www.sqlite.org/c3ref/column_blob.html
   * @param stmt prepared statement pointer
   * @param i column index
   */
  column_name(stmt: number, i: number): string;

  /**
   * Get names for all columns of a prepared statement
   * @param stmt 
   * @returns array of column names
   */
  column_names(stmt: number): Array<string>;

  /**
   * Extract a column value from a row after a prepared statment {@link step}
   * @see https://www.sqlite.org/c3ref/column_blob.html
   * @param stmt prepared statement pointer
   * @param i column index
   * @returns column value
   */
  column_text(stmt: number, i: number): string;

  /**
   * Get column type for a prepared statement.
   * @see https://www.sqlite.org/c3ref/column_blob.html
   * @param stmt prepared statement pointer
   * @param i column index
   * @returns enumeration value for type
   */
  column_type(stmt: number, i: number): number;

  /**
   * Create or redefine SQL functions.
   * @see https://sqlite.org/c3ref/create_function.html
   * @param db database pointer
   * @param zFunctionName 
   * @param nArg number of function arguments
   * @param eTextRep text encoding (and other flags)
   * @param pApp application data
   * @param xFunc 
   * @param xStep 
   * @param xFinal 
   */
  create_function(
    db: number,
    zFunctionName: string,
    nArg: number,
    eTextRep: number,
    pApp: number,
    xFunc?: (context: number, values: Uint32Array) => void,
    xStep?: (context: number, values: Uint32Array) => void,
    xFinal?: (context: number) => void): number;

  /**
   * Create a SQLite module for virtual tables.
   * 
   * https://www.sqlite.org/c3ref/create_module.html
   * @param db database pointer
   * @param zName 
   * @param module 
   * @param appData 
   */
  create_module(db: number, zName: string, module: SQLiteModule, appData?): number;

  /**
   * Get number of columns in current row of a prepared statement
   * @see https://www.sqlite.org/c3ref/data_count.html
   * @param stmt prepared statement pointer
   * @returns number of columns
   */
  data_count(stmt: number): number;

  /**
   * Declare the schema of a virtual table in module
   * {@link SQLiteModule.xCreate} or {@link SQLiteModule.xConnect}
   * methods
   * @see https://www.sqlite.org/c3ref/declare_vtab.html
   * @param db database pointer
   * @param zSQL schema declaration
   */
  declare_vtab(db: number, zSQL: string): number;

  /**
   * One-step query execution interface
   * @see https://www.sqlite.org/c3ref/exec.html
   * @param db database pointer
   * @param zSQL queries
   * @param callback called for each output row
   */
  exec(
    db: number,
    zSQL: string,
    callback?: (row: Array<SQLiteCompatibleType|null>, columns: string[]) => void
  ): Promise<number>;

  /**
   * Destroy a prepared statement object
   * @see https://www.sqlite.org/c3ref/finalize.html
   * @param stmt prepared statement pointer
   */
  finalize(stmt: number): Promise<number>;

  /**
   * Get SQLite library version
   * @see https://www.sqlite.org/c3ref/libversion.html
   * @returns version string, e.g. '3.35.5'
   */
  libversion(): string;

  /**
   * Get SQLite library version
   * @see https://www.sqlite.org/c3ref/libversion.html
   * @returns version number, e.g. 3035005
   */
  libversion_number(): number

  /**
   * Opening a new database connection.
   * @see https://sqlite.org/c3ref/open.html
   * @param zFilename 
   * @param iFlags default `SQLite.CREATE | SQLite.READWRITE` (0x6)
   * @param zVfs VFS name
   * @returns Promise-wrapped database pointer.
   */
  open_v2(
    zFilename: string,
    iFlags?: number,
    zVfs?: string    
  ): Promise<number>;

  /**
   * Compile an SQL statement
   * 
   * SQL is provided as a pointer in WASM memory, so the utility functions
   * {@link str_new} and {@link str_value} should be used. The returned
   * object provides both the prepared statement and a pointer to the
   * still uncompiled SQL that can be used with the next call to this
   * function. A null value is returned when no statement remains.
   * @see https://www.sqlite.org/c3ref/prepare.html
   * @param db database pointer
   * @param sql SQL pointer
   * @returns Promise-wrapped object containing the prepared statement
   * pointer and next SQL pointer, `null` when no statement remains
   */
  prepare_v2(db: number, sql: number): Promise<{ stmt: number, sql: number}|null>;

  /**
   * Reset a prepared statement object
   * @see https://www.sqlite.org/c3ref/reset.html
   * @param stmt prepared statement pointer
   */
  reset(stmt: number): number;

  /**
   * Convenience function to call `result_*` based of the type of `value`
   * @param context context pointer
   * @param value 
   */
  result(context: number, value: (SQLiteCompatibleType|number[])|null): void;

  /**
   * Set the result of a function or vtable column
   * @see https://sqlite.org/c3ref/result_blob.html
   * @param context context pointer
   * @param value 
   */
  result_blob(context: number, value: Int8Array|number[]): void;

  /**
   * Set the result of a function or vtable column
   * @see https://sqlite.org/c3ref/result_blob.html
   * @param context context pointer
   * @param value 
   */
  result_double(context: number, value: number): void;

  /**
   * Set the result of a function or vtable column
   * @see https://sqlite.org/c3ref/result_blob.html
   * @param context context pointer
   * @param value 
   */
  result_int(context: number, value: number): void;

  /**
   * Set the result of a function or vtable column
   * @see https://sqlite.org/c3ref/result_blob.html
   * @param context context pointer
   */
  result_null(context: number): void;

  /**
   * Set the result of a function or vtable column
   * @see https://sqlite.org/c3ref/result_blob.html
   * @param context context pointer
   * @param value 
   */
   result_text(context: number, value: string): void;

   /**
    * Get all column data for a row from a prepared statement step
    * @param stmt prepared statement pointer
    * @returns row data
    */
  row(stmt: number): Array<SQLiteCompatibleType|null>;

  /**
   * Get statement SQL
   * @param stmt prepared statement pointer
   * @returns SQL
   */
  sql(stmt: number): string;

  /**
   * Evaluate an SQL statement
   * 
   * @see https://www.sqlite.org/c3ref/step.html
   * @param stmt prepared statement pointer
   */
  step(stmt: number): Promise<number>;

  /**
   * Create a new dynamic string object
   * 
   * An optional initialization argument has been added for convenience
   * which is functionally equivalent to (but slightly more efficient):
   *  ```javascript
   *  const str = sqlite3.str_new(db);
   *  sqlite3.str_appendall(str, s);
   *  ```
   *  See https://www.sqlite.org/c3ref/str_append.html
   * @param db database pointer
   * @param s optional initialization string
   * @returns sqlite3_str pointer
   */
  str_new(db: number, s?:string): number;

  /**
   * Add content to a dynamic string
   * 
   * Not recommended for building strings; prefer using Javascript and
   * {@link str_new} with initialization.
   * @see https://www.sqlite.org/c3ref/str_append.html
   * @param str sqlite3_str pointer
   * @param s string to append
   */
  str_appendall(str: number, s: string): void;

  /**
   * Get pointer to dynamic string content
   * 
   * Use as input to {@link prepare_v2}.
   * @param str sqlite3_str pointer
   * @returns pointer to string data
   */
  str_value(str: number): number;

  /**
   * Finalize a dynamic string
   * @see https://www.sqlite.org/c3ref/str_append.html
   * @param str sqlite3_str pointer
   */
  str_finish(str: number): void;

  /**
   * Get application data in custom function implementation
   * @see https://sqlite.org/c3ref/user_data.html
   * @param context context pointer
   * @returns application data
   */
  user_data(context: number): any;

  /**
   * Extract a value from sqlite3_value
   * 
   * This is a convenience function that calls the appropriate `value_*`
   * function based on its type.
   * @param pValue `sqlite3_value` pointer
   * @returns value
   */
  value(pValue: number): SQLiteCompatibleType|null;

  /**
   * Extract a value from sqlite3_value
   * @see https://sqlite.org/c3ref/value_blob.html
   * @param pValue `sqlite3_value` pointer
   * @returns value
   */
  value_blob(pValue: number): Int8Array;

  /**
   * Get blob or text size for value
   * @see https://sqlite.org/c3ref/value_blob.html
   * @param pValue `sqlite3_value` pointer
   * @returns size
   */
  value_bytes(pValue: number): number;

  /**
   * Extract a value from sqlite3_value
   * @see https://sqlite.org/c3ref/value_blob.html
   * @param pValue `sqlite3_value` pointer
   * @returns value
   */
  value_double(pValue: number): number;

  /**
   * Extract a value from sqlite3_value
   * @see https://sqlite.org/c3ref/value_blob.html
   * @param pValue `sqlite3_value` pointer
   * @returns value
   */
  value_int(pValue: number): number;

  /**
   * Extract a value from sqlite3_value
   * @see https://sqlite.org/c3ref/value_blob.html
   * @param pValue `sqlite3_value` pointer
   * @returns value
   */
  value_text(pValue: number): string;

  /**
   * Get type of sqlite3_value
   * @see https://sqlite.org/c3ref/value_blob.html
   * @param pValue `sqlite3_value` pointer
   * @returns enumeration value for type
   */
  value_type(pValue: number): number;
  
  /**
   * Register a new Virtual File System.
   * 
   * @see https://www.sqlite.org/c3ref/str_append.html
   * @param vfs VFS object
   * @param makeDefault 
   */
  vfs_register(vfs: SQLiteVFS, makeDefault?: boolean): number;
}