// @ts-ignore
import * as Comlink from "https://unpkg.com/comlink/dist/esm/comlink.mjs";
import * as SQLite from '../src/sqlite-api.js';

import GOOG from '../test/GOOG.js';
import { createTag } from "../src/examples/tag.js";
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

  // Create the query interface.
  const tag = createTag(sqlite3, db);
  return Comlink.proxy(tag);
}
Comlink.expose(open);

