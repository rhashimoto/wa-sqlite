// @ts-ignore
import * as Comlink from "https://unpkg.com/comlink/dist/esm/comlink.mjs";
import * as SQLite from '../src/sqlite-api.js';

import GOOG from '../test/GOOG.js';
import { ArrayModule } from "../src/examples/ArrayModule.js";
import { ArrayAsyncModule } from "../src/examples/ArrayAsyncModule.js";

// For a typical application, the Emscripten module would be imported
// statically, but we want to be able to select between the Asyncify
// and non-Asyncify builds so dynamic import is done later.
const WA_SQLITE = '../dist/wa-sqlite.mjs';
const WA_SQLITE_ASYNC = '../dist/wa-sqlite-async.mjs';

/**
 * @typedef Config
 * @property {boolean} isAsync use WebAssembly build with/without Asyncify
 * @property {string} [dbName] name of the SQLite database
 * @property {string} [vfsModule] path of the VFS module
 * @property {string} [vfsClass] name of the VFS class
 * @property {Array<*>} [vfsArgs] VFS constructor arguments
 */

/**
 * @param {Config} config
 * @returns {Promise<Function>}
 */
async function open(config) {
  // Instantiate the SQLite API, choosing between Asyncify and non-Asyncify.
  const { default: moduleFactory } = await import(config.isAsync ? WA_SQLITE_ASYNC : WA_SQLITE);
  const module = await moduleFactory();
  const sqlite3 = SQLite.Factory(module);

  if (config.vfsModule) {
    // Create the VFS and register it as the default file system.
    const namespace = await import(config.vfsModule);
    const vfs = new namespace[config.vfsClass](...config.vfsArgs ?? []);
    sqlite3.vfs_register(vfs, true);
  }

  // Open the database;
  const db = await sqlite3.open_v2(config.dbName ?? 'demo');

  // Add an example module with an array back-end.
  // @ts-ignore
  sqlite3.create_module(db, 'array', new ArrayModule(sqlite3, db, GOOG.rows, GOOG.columns));
  if (config.isAsync) {
    // @ts-ignore
    sqlite3.create_module(
      db,
      'arrayasync',
      // @ts-ignore
      new ArrayAsyncModule(sqlite3, db, GOOG.rows, GOOG.columns));
  }

  // Add example functions regex and regex_replace.
  sqlite3.create_function(
    db,
    'regexp', 2,
    SQLite.SQLITE_UTF8 | SQLite.SQLITE_DETERMINISTIC, 0,
    function(context, values) {
      const pattern = new RegExp(sqlite3.value_text(values[0]))
      const s = sqlite3.value_text(values[1]);
      sqlite3.result(context, pattern.test(s) ? 1 : 0);
    },
    null, null);

  sqlite3.create_function(
    db,
    'regexp_replace', -1,
    SQLite.SQLITE_UTF8 | SQLite.SQLITE_DETERMINISTIC, 0,
    function(context, values) {
      // Arguments are
      // (pattern, s, replacement) or
      // (pattern, s, replacement, flags).
      if (values.length < 3) {
        sqlite3.result(context, '');
        return;  
      }
      const pattern = sqlite3.value_text(values[0]);
      const s = sqlite3.value_text(values[1]);
      const replacement = sqlite3.value_text(values[2]);
      const flags = values.length > 3 ? sqlite3.value_text(values[3]) : '';
      sqlite3.result(context, s.replace(new RegExp(pattern, flags), replacement));
    },
    null, null);

  // Helper function for the query() interface.
  async function execute(sql, bindings) {
    const results = [];
    for await (const stmt of sqlite3.statements(db, sql)) {
      let columns;
      for (const binding of bindings ?? [[]]) {
        sqlite3.reset(stmt);
        if (bindings) {
          sqlite3.bind_collection(stmt, binding);
        }

        const rows = [];
        while (await sqlite3.step(stmt) === SQLite.SQLITE_ROW) {
          const row = sqlite3.row(stmt);
          rows.push(row);
        }
  
        columns = columns ?? sqlite3.column_names(stmt)
        if (columns.length) {
          results.push({ columns, rows });
        }
      }
  
      // When binding parameters, only a single statement is executed.
      if (bindings) {
        return results;
      }
    }
    return results;
  }
  
  // Exposed query function. This function can be used either as a template
  // tag for multiple statements, e.g.:
  //
  // query`
  //  SELECT * FROM ${tableName} WHERE ROWID=${index};
  //  SELECT * FROM anotherTable;
  // `;
  //
  // ...or as a function passed a single statement with bindings, e.g.:
  //
  // query('INSERT INTO table VALUES (?, ?)', [
  //   ['foo', 42],
  //   ['bar', 17]
  // ]);
  //
  // With both usages, an array of statement results is returned (in a
  // Promise) where each statement result is an Object with properties
  // "columns" (array of column names) and "rows" (array of value arrays).
  async function query(sql, ...values) {
    if (Array.isArray(sql)) {
      // Tag usage.
      const interleaved = [];
      sql.forEach((s, i) => {
        interleaved.push(s, values[i]);
      });
      return execute(interleaved.join(''));
    } else {
      // Binding usage.
      return execute(sql, values[0]);
    }
  }
  return Comlink.proxy(query);
}
Comlink.expose(open);

