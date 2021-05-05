// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
import * as SQLite from '../sqlite-api.js';

// Back a read-only virtual table with a 2D array.
export class ArrayModule {
  mapCursorToState = new Map();

  /**
   * @param {SQLite.SQLiteAPI} sqlite3 
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
   * @param {*} appData 
   * @param {Array<string>} argv 
   * @param {number} pVTab 
   * @param {{ set: function(string): void}} pzErr 
   */
  xCreate(db, appData, argv, pVTab, pzErr) {
    return this.xConnect(db, appData, argv, pVTab, pzErr);
  }

  /**
   * @param {number} db 
   * @param {*} appData 
   * @param {Array<string>} argv 
   * @param {number} pVTab 
   * @param {{ set: function(string): void}} pzErr 
   */
  xConnect(db, appData, argv, pVTab, pzErr) {
    // All virtual tables in this module will use the same array. If
    // different virtual tables could have separate backing stores then
    // we would associate them using pVTab.

    const sql = `CREATE TABLE any (${this.columns.join(',')})`;
    return this.sqlite3.declare_vtab(db, sql);
  }

  /**
   * @param {number} pVTab 
   * @param {object} indexInfo 
   */
  xBestIndex(pVTab, indexInfo) {
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
    this.mapCursorToState.set(pCursor, { index: 0 });
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
    const cursorState = this.mapCursorToState.get(pCursor);
    cursorState.index = 0;
    return SQLite.SQLITE_OK;
  }

  /**
   * @param {number} pCursor 
   */
   xNext(pCursor) {
    const cursorState = this.mapCursorToState.get(pCursor);
    cursorState.index++;
    return SQLite.SQLITE_OK;
  }

  /**
   * @param {number} pCursor 
   */
   xEof(pCursor) {
    const cursorState = this.mapCursorToState.get(pCursor);
    return cursorState.index >= this.rows.length ? 1 : 0;
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
    if (cursorState.index < this.rows.length) {
      pRowid.set(cursorState.index);
      return SQLite.SQLITE_OK;
    }
    return SQLite.SQLITE_ERROR;
  }
}
