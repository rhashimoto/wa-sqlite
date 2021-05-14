import { ArrayModule } from './ArrayModule.js';

// This is an asynchronous subclass of ArrayModule used for testing
// asynchronous virtual tables.
export class ArrayAsyncModule extends ArrayModule {
  /**
   * @param {number} db 
   * @param {*} appData Application data passed to `SQLiteAPI.create_module`.
   * @param {Array<string>} argv 
   * @param {number} pVTab 
   * @param {{ set: function(string): void}} pzErr 
   * @returns {number|Promise<number>}
   */
  xCreate(db, appData, argv, pVTab, pzErr) {
    return this.handleAsync(async () => {
      // Calling super.xConnect here is not a typo. The superclass method
      // calls this.xConnect, which would improperly nest handleAsync
      // calls, so we just call the superclass xConnect directly.
      return super.xConnect(db, appData, argv, pVTab, pzErr);
    });
  }

  /**
   * @param {number} db 
   * @param {*} appData Application data passed to `SQLiteAPI.create_module`.
   * @param {Array<string>} argv 
   * @param {number} pVTab 
   * @param {{ set: function(string): void}} pzErr 
   */
  xConnect(db, appData, argv, pVTab, pzErr) {
    return this.handleAsync(async () => {
      return super.xConnect(db, appData, argv, pVTab, pzErr);
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
    return this.handleAsync(async () => {
      return super.xDestroy(pVTab);
    });
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