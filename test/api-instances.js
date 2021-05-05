// @ts-ignore
import SQLiteModuleFactory from '../dist/wa-sqlite.mjs';
// @ts-ignore
import SQLiteAsyncModuleFactory from '../dist/wa-sqlite-async.mjs';
import * as SQLite from '../src/sqlite-api.js';

export const getSQLite = (function() {
  const sqlite3 = SQLiteModuleFactory().then(module => {
    return SQLite.Factory(module);
  });
  return () => sqlite3;
})();

export const getSQLiteAsync = (function() {
  const sqlite3 = SQLiteAsyncModuleFactory().then(module => {
    return SQLite.Factory(module);
  });
  return () => sqlite3;
})();