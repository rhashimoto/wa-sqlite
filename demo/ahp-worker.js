// Copyright 2023 Roy T. Hashimoto. All Rights Reserved.

import SQLiteESMFactory from '../dist/wa-sqlite.mjs';
import * as SQLite from '../src/sqlite-api.js';
import { OPFSCoopSyncVFS } from '../src/examples/OPFSCoopSyncVFS.js';

import { createSharedServicePort } from './SharedService/SharedService.js';

import { createTag } from "../src/examples/tag.js";

class DatabaseService {
  #chain;
  #isTransactionPending;
  #tag;

  constructor() {
    this.#chain = this.#initialize();
  }

  query(...args) {
    const result = this.#chain.then(async () => {
      if (this.#isTransactionPending()) {
        await this.#tag('ROLLBACK').catch(() => {});
      }
      return this.#tag(...args);
    });
    this.#chain = result.catch(() => {});
    return result;
  }

  async #initialize() {
    // Create the database.
    const module = await SQLiteESMFactory();
    const sqlite3 = await SQLite.Factory(module);

    const vfs = await OPFSCoopSyncVFS.create('/demo-OPFSCoopSyncVFS', module);
    sqlite3.vfs_register(vfs, true);
    
    const db = await sqlite3.open_v2('demo');

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
    this.#tag = createTag(sqlite3, db);
    this.#isTransactionPending = () => !sqlite3.get_autocommit(db);

    this.query(`
      PRAGMA locking_mode=exclusive;
      PRAGMA journal_mode=truncate;
    `);
  }
}

addEventListener('message', () => {
  const databaseService = new DatabaseService();
  const providerPort = createSharedServicePort(databaseService)
  postMessage(null, [providerPort]);
});
