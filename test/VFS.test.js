// @ts-ignore
import SQLiteModuleFactory from '../dist/wa-sqlite.mjs';
// @ts-ignore
import SQLiteAsyncModuleFactory from '../dist/wa-sqlite-async.mjs';
import * as SQLite from '../src/sqlite-api.js';
import { MemoryAsyncVFS } from '../src/examples/MemoryAsyncVFS.js';
import { MemoryVFS } from '../src/examples/MemoryVFS.js';

import GOOG from './GOOG.js';

/**
 * @param {SQLite.SQLiteAPI} sqlite3 
 * @param {number} db 
 */
async function loadSampleTable(sqlite3, db) {
  await sqlite3.exec(db, `
    PRAGMA journal_mode = MEMORY;
    DROP TABLE IF EXISTS goog;
    CREATE TABLE goog (${GOOG.columns.join(',')});
    BEGIN TRANSACTION;
  `);
  for (const row of GOOG.rows) {
    await sqlite3.exec(db, `
      INSERT INTO goog VALUES (${row.join(',')})
    `);
  }
  await sqlite3.exec(db, `
    COMMIT;
  `);
}

function shared(ready) {
  /** @type {SQLite.SQLiteAPI} */ let sqlite3, vfs;
  let db, sql;
  beforeEach(async function() {
    ({ sqlite3, vfs} = await ready);
    db = await sqlite3.open_v2('foo', 0x06, vfs.name);

    sql = async function(strings, ...values) {
      let interleaved = [];
      strings.forEach((s, i) => {
        interleaved.push(s, values[i]);
      });

      const results = [];
      await sqlite3.exec(db, interleaved.join(''), (row, columns) => {
        results.push(row);
      });
      return results;
    }
  });

  afterEach(async function() {
    await sqlite3.close(db);
  });

  it('persists', async function() {
    // Load data into the database.
    await loadSampleTable(sqlite3, db);
    const resultA = await sql`SELECT COUNT(*) FROM goog`;
    expect(resultA[0][0]).toBeGreaterThan(0);

    // Close and reopen the database.
    await sqlite3.close(db);
    db = await sqlite3.open_v2('foo', 0x06, vfs.name);

    const resultB = await sql`SELECT COUNT(*) FROM goog`;
    expect(resultB[0][0]).toBe(resultA[0][0]);
  });
}

describe('VFS', function() {
  let resolveReady;
  let ready = new Promise(resolve => {
    resolveReady = resolve;
  });
  beforeAll(async function() {
    const SQLiteModule = await SQLiteModuleFactory();

    const sqlite3 = SQLite.Factory(SQLiteModule);
    const vfs = new MemoryVFS();
    sqlite3.vfs_register(vfs, false);
    resolveReady({ sqlite3 , vfs });
  });

  shared(ready);
});

describe('VFS async', function() {
  let resolveReady;
  let ready = new Promise(resolve => {
    resolveReady = resolve;
  });
  beforeAll(async function() {
    const SQLiteModule = await SQLiteAsyncModuleFactory();

    const sqlite3 = SQLite.Factory(SQLiteModule);
    const vfs = new MemoryAsyncVFS();
    sqlite3.vfs_register(vfs, false);
    resolveReady({ sqlite3 , vfs });
  });

  shared(ready);
});
