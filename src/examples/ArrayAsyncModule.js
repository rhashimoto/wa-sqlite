// Copyright 2022 Roy T. Hashimoto. All Rights Reserved.
import { ArrayModule } from './ArrayModule.js';

// This is an asynchronous subclass of ArrayModule used for testing
// asynchronous virtual tables.
export class ArrayAsyncModule extends ArrayModule {
  /**
   * @param {number} db 
   * @param {*} appData Application data passed to `SQLiteAPI.create_module`.
   * @param {Array<string>} argv 
   * @param {number} pVTab 
   * @param {{ allocate: function(number): number, set: function(string): void }} pzString 
   * @returns {number|Promise<number>}
   */
  xCreate(db, appData, argv, pVTab, pzString) {
    return this.xConnect(db, appData, argv, pVTab, pzString);
  }

  /**
   * @param {number} db 
   * @param {*} appData Application data passed to `SQLiteAPI.create_module`.
   * @param {Array<string>} argv 
   * @param {number} pVTab 
   * @param {{ allocate: function(number): number, set: function(string): void }} pzString 
   */
  xConnect(db, appData, argv, pVTab, pzString) {
    // Allocate space for CREATE TABLE string. SQLite functions cannot be
    // called within handleAsync, so this allocation must be outside the
    // asynchronous call. It must be larger than the UTF8 representation
    // of the string passed to pzString.set() or undefined behavior will
    // result.
    pzString.allocate(1024);

    return this.handleAsync(async () => {
      return super.xConnect(db, appData, argv, pVTab, pzString);
    });
  }

  /**
   * @param {number} pVTab 
   * @param {SQLiteModuleIndexInfo} indexInfo 
   */
  xBestIndex(pVTab, indexInfo) {
    return this.handleAsync(async () => {
      return super.xBestIndex(pVTab, indexInfo);
    });
  }

  /**
   * @param {number} pVTab 
   */
  xDisconnect(pVTab) {
    return this.handleAsync(async () => {
      return super.xDisconnect(pVTab);
    });
  }

  /**
   * @param {number} pVTab 
   */
  xDestroy(pVTab) {
    return this.xDisconnect(pVTab);
  }

  /**
   * @param {number} pVTab 
   * @param {number} pCursor 
   */
  xOpen(pVTab, pCursor) {
    return this.handleAsync(async () => {
      return super.xOpen(pVTab, pCursor);
    });
  }

  /**
   * @param {number} pCursor 
   */
  xClose(pCursor) {
    return this.handleAsync(async () => {
      return super.xClose(pCursor);
    });
  }

  /**
   * @param {number} pCursor 
   * @param {number} idxNum 
   * @param {string?} idxStr 
   * @param {Array<number>} values 
   */
  xFilter(pCursor, idxNum, idxStr, values) {
    return this.handleAsync(async () => {
      return super.xFilter(pCursor, idxNum, idxStr, values);
    });
  }

  /**
   * @param {number} pCursor 
   */
  xNext(pCursor) {
    return this.handleAsync(async () => {
      return super.xNext(pCursor);
    });
  }

  /**
   * @param {number} pCursor 
   */
  xEof(pCursor) {
    return this.handleAsync(async () => {
      return super.xEof(pCursor);
    });
  }

  /**
   * @param {number} pCursor 
   * @param {number} pContext 
   * @param {number} iCol 
   */
  xColumn(pCursor, pContext, iCol) {
    return this.handleAsync(async () => {
      return super.xColumn(pCursor, pContext, iCol);
    });
  }

  /**
   * @param {number} pCursor 
   * @param {{ set: function(number): void}} pRowid 
   */
  xRowid(pCursor, pRowid) {
    return this.handleAsync(async () => {
      return super.xRowid(pCursor, pRowid);
    });
  }

  // All "x" methods beyond this point are optional.

  /**
   * @param {number} pVTab 
   * @param {Array<number>} values sqlite3_value pointers
   * @param {{ set: function(number): void}} pRowid 
   */
  xUpdate(pVTab, values, pRowid) {
    return this.handleAsync(async () => {
      return super.xUpdate(pVTab, values, pRowid);
    });
  }

  /**
   * @param {function} f 
   * @returns {Promise<number>}
   */
  async handleAsync(f) {
    // When sqlite3.create_module is called on an asynchronous build,
    // it injects a handleAsync method into the module that will shadow
    // this implementation.
    throw new Error('requires an asynchronous build');
  }
}