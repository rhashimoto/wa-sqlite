// Copyright 2023 Roy T. Hashimoto. All Rights Reserved.

import SQLiteESMFactory from '../../dist/wa-sqlite.mjs';
import * as SQLite from '../../src/sqlite-api.js';
import { RetryVFS } from './RetryVFS.js'

import GOOG from '../../test/GOOG.js';
import { ArrayModule } from "../../src/examples/ArrayModule.js";

// @ts-ignore
const Comlink = await import(location.hostname.endsWith('localhost') ?
  '/.yarn/unplugged/comlink-npm-4.4.1-b05bb2527d/node_modules/comlink/dist/esm/comlink.min.js' :
  'https://unpkg.com/comlink/dist/esm/comlink.mjs');

const OPFS_PATH = 'retry.db';

const sqlite3Ready = SQLiteESMFactory().then(module => {
  return SQLite.Factory(module);
});

class DatabaseService {
  #chain;
  #query;

  constructor() {
    this.#chain = this.#initialize();
  }

  query(sql) {
    const result = this.#chain.then(async () => this.#query(sql));
    this.#chain = result.catch(() => {});
    return result;
  }

  async #initialize() {
    // Create the database.
    const sqlite3 = await sqlite3Ready;
    const vfs = new RetryVFS(OPFS_PATH);
    await vfs.isReady;
    sqlite3.vfs_register(vfs, true);
    const db = await sqlite3.open_v2(OPFS_PATH);

    // Add an example module with an array back-end.
    // @ts-ignore
    sqlite3.create_module(db, 'array', new ArrayModule(sqlite3, db, GOOG.rows, GOOG.columns));

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

    this.#query = async sql => {
      const results = [];
      for await (const stmt of statements(sql)) {
        let failed = false;
        do {
          try {
            // sqlite3_reset() will return an error if the previous step
            // caused an error. RetryVFS intentionally causes SQLITE_BUSY
            // so these errors are ignored.
            await sqlite3.reset(stmt).catch(() => {});

            const rows = [];
            while (await sqlite3.step(stmt) === SQLite.SQLITE_ROW) {
              const row = sqlite3.row(stmt);
              rows.push(row);
            }

            const columns = sqlite3.column_names(stmt);
            if (columns.length) {
              results.push({ columns, rows });
            }
            failed = false;
          } catch (e) {
            if (e.code === SQLite.SQLITE_BUSY) {
              // Let the VFS complete asynchronous operations.
              await vfs.isReady;
              failed = true;
            } else {
              throw e;
            }
          }
        } while (failed);
      }
      return results;
    };

    // Reimplement sqlite3.statements with VFS retry.
    async function* statements(sql) {
      const str = sqlite3.str_new(db, sql);
      let prepared = { stmt: null, sql: sqlite3.str_value(str) };
      try {
        // Call the retrying prepare helper.
        while (prepared = await prepare(prepared.sql)) {
          yield prepared.stmt;
          sqlite3.finalize(prepared.stmt);
          prepared.stmt = null;
        }
      } finally {
        if (prepared?.stmt) {
          sqlite3.finalize(prepared.stmt);
        }
        sqlite3.str_finish(str);
      }
    };

    // If the database schema is not yet loaded when a statement is
    // prepared, then SQLite will read the schema under a read lock.
    // The RetryVFS will return SQLITE_BUSY to get the lock, so that
    // must be handled and prepare retried.
    async function prepare(sql) {
      while (true) {
        try {
          const result = await sqlite3.prepare_v2(db, sql);
          return result;
        } catch (e) {
          if (e.code === SQLite.SQLITE_BUSY) {
            // Let the VFS complete asynchronous operations.
            await vfs.isReady;
            continue;
          }
          throw e;
        }
      }
    }

    // The default journal mode DELETE is not compatible with the
    // RetryVFS. Use TRUNCATE instead.
    this.query('PRAGMA journal_mode=TRUNCATE;');
  }
}

Comlink.expose(new DatabaseService(), self);