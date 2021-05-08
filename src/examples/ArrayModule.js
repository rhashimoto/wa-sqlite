// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
import * as SQLite from '../sqlite-api.js';

// This is an example implementation of a SQLite module (for virtual
// tables). It lets SQLite access a Javascript array as a table.
// See https://sqlite.org/vtab.html for details.
export class ArrayModule {
  mapCursorToState = new Map();

  /**
   * @param {SQLiteAPI} sqlite3 
   * @param {number} db 
   * @param {Array<Array>} rows Table data.
   * @param {Array<string>} columns Column names.
   */
  constructor(sqlite3, db, rows, columns) {
    this.sqlite3 = sqlite3;
    this.db = db;
    this.rows = rows;
    this.columns = columns;
  }

  /**
   * @param {number} db 
   * @param {*} appData Application data passed to `SQLiteAPI.create_module`.
   * @param {Array<string>} argv 
   * @param {number} pVTab 
   * @param {{ set: function(string): void}} pzErr 
   */
  xCreate(db, appData, argv, pVTab, pzErr) {
    return this.xConnect(db, appData, argv, pVTab, pzErr);
  }

  /**
   * @param {number} db 
   * @param {*} appData Application data passed to `SQLiteAPI.create_module`.
   * @param {Array<string>} argv 
   * @param {number} pVTab 
   * @param {{ set: function(string): void}} pzErr 
   */
  xConnect(db, appData, argv, pVTab, pzErr) {
    // All virtual tables in this module will use the same array. If
    // different virtual tables could have separate backing stores then
    // we would handle that association using pVTab.

    const sql = `CREATE TABLE any (${this.columns.join(',')})`;
    return this.sqlite3.declare_vtab(db, sql);
  }

  /**
   * @param {number} pVTab 
   * @param {SQLiteModuleIndexInfo} indexInfo 
   */
  xBestIndex(pVTab, indexInfo) {
    // A module capable of returning subsets rows based on constraints
    // would read the input fields of indexInfo and write the appropriate
    // output fields.
    return SQLite.SQLITE_OK;
  }

  /**
   * @param {number} pVTab 
   */
  xDisconnect(pVTab) {
    return SQLite.SQLITE_OK;
  }

  /**
   * @param {number} pVTab 
   */
  xDestroy(pVTab) {
    return SQLite.SQLITE_OK;
  }

  /**
   * @param {number} pVTab 
   * @param {number} pCursor 
   */
  xOpen(pVTab, pCursor) {
    this.mapCursorToState.set(pCursor, {});
    return SQLite.SQLITE_OK;
  }

  /**
   * @param {number} pCursor 
   */
  xClose(pCursor) {
    this.mapCursorToState.delete(pCursor);
    return SQLite.SQLITE_OK;
  }

  /**
   * @param {number} pCursor 
   * @param {number} idxNum 
   * @param {string?} idxStr 
   * @param {Array<number>} values 
   */
  xFilter(pCursor, idxNum, idxStr, values) {
    // If we had set idxNum or idxStr in indexInfo in xBestIndex(),
    // we would get them back here. If we had expressed interest in
    // constraint values by setting argvIndex in indexInfo.aConstraintUsage,
    // values would contain sqlite3_value pointers.

    // The cursor should always be at a valid row or EOF, so start with
    // the first non-null row.
    const cursorState = this.mapCursorToState.get(pCursor);
    cursorState.index = this.rows.findIndex(element => element);
    return SQLite.SQLITE_OK;
  }

  /**
   * @param {number} pCursor 
   */
  xNext(pCursor) {
    // Advance to the next valid row or EOF.
    const cursorState = this.mapCursorToState.get(pCursor);
    while (++cursorState.index < this.rows.length && !this.rows[cursorState.index]) {
      // intentionally empty
    }
    return SQLite.SQLITE_OK;
  }

  /**
   * @param {number} pCursor 
   */
  xEof(pCursor) {
    const cursorState = this.mapCursorToState.get(pCursor);
    return this.rows[cursorState.index] ? 0 : 1;
  }

  /**
   * @param {number} pCursor 
   * @param {number} pContext 
   * @param {number} iCol 
   */
  xColumn(pCursor, pContext, iCol) {
    const cursorState = this.mapCursorToState.get(pCursor);
    const value = this.rows[cursorState.index][iCol];
    this.sqlite3.result(pContext, value);
    return SQLite.SQLITE_OK;
  }

  /**
   * @param {number} pCursor 
   * @param {{ set: function(number): void}} pRowid 
   */
  xRowid(pCursor, pRowid) {
    const cursorState = this.mapCursorToState.get(pCursor);
    pRowid.set(cursorState.index);
    return SQLite.SQLITE_OK;
  }

  // All "x" methods beyond this point are optional.

  /**
   * @param {number} pVTab 
   * @param {Array<number>} values sqlite3_value pointers
   * @param {{ set: function(number): void}} pRowid 
   */
  xUpdate(pVTab, values, pRowid) {
    let index = this.sqlite3.value_type(values[0]) === SQLite.SQLITE_NULL ?
      null :
      this.sqlite3.value_int(values[0]);
    if (values.length === 1) {
      // Delete row.
      const index = this.sqlite3.value_int(values[0]);
      this.rows[index] = null;
    } else {
      const row = [];
      for (let i = 2; i < values.length; ++i) {
        row.push(this.sqlite3.value(values[i]));
      }

      if (index === null) {
        // Insert row.
        pRowid.set(this.rows.length);
        this.rows.push(row);
      } else {
        // Update row.
        this.rows[index] = null;
        this.rows[this.sqlite3.value_int(values[1])] = row;
      }
    }
    return SQLite.SQLITE_OK;
  }

  // xBegin(pVTab) { return SQLite.SQLITE_OK; }
  // xSync(pVTab) { return SQLite.SQLITE_OK; }
  // xCommit(pVTab) { return SQLite.SQLITE_OK; }
  // xRollback(pVTab) { return SQLite.SQLITE_OK; }
  // xRename(pVTab, zNew) { return SQLite.SQLITE_OK; }
}
