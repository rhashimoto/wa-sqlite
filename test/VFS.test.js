// @ts-ignore
import SQLiteModuleFactory from '../dist/wa-sqlite-async.mjs';
import * as SQLite from '../src/sqlite-api.js';
import { MemoryAsyncVFS } from './MemoryAsyncVFS.js';
import { MemoryVFS } from './MemoryVFS.js';

import GOOG from './GOOG.js';

async function loadSampleTable(sql) {
  await sql`
    PRAGMA journal_mode = MEMORY;
    DROP TABLE IF EXISTS goog;
    CREATE TABLE goog (${GOOG.columns.join(',')});
    BEGIN TRANSACTION;
  `;
  for (const row of GOOG.rows) {
    await sql`INSERT INTO goog VALUES (${row.join(',')})`;
  }
  await sql`
    COMMIT;
  `;
}

describe('VFS', function() {
  /** @type {SQLite.SQLiteAPI} */ let sqlite3;
  let vfs;
  beforeAll(async function() {
    const SQLiteModule = await SQLiteModuleFactory();

    sqlite3 = SQLite.Factory(SQLiteModule);

    vfs = new MemoryAsyncVFS();
    sqlite3.vfs_register(vfs, false);
  });

  let db, sql;
  beforeEach(async function() {
    db = await sqlite3.open_v2('foo', 0x06, vfs.name);
    sql = SQLite.tag(sqlite3, db);
  });

  afterEach(async function() {
    await sqlite3.close(db);
  });

  it('persists', async function() {
    // Load data into the database.
    await loadSampleTable(sql);
    const resultA = await sql`SELECT COUNT(*) FROM goog`;
    expect(resultA[0].rows[0][0]).toBeGreaterThan(0);

    // Close and reopen the database.
    await sqlite3.close(db);
    db = await sqlite3.open_v2('foo', 0x06, vfs.name);
    sql = SQLite.tag(sqlite3, db);

    const resultB = await sql`SELECT COUNT(*) FROM goog`;
    expect(resultB[0].rows[0][0]).toBe(resultA[0].rows[0][0]);
  });

  xit('timing', async function() {
    const VFS_NAME = 'mem';
    const N = 10;

    const timestamp = Date.now();
    for (let i = 0; i < N; ++i) {
      let db = await sqlite3.open_v2('foobar', 0x06, VFS_NAME);
      let sql = SQLite.tag(sqlite3, db);
      await loadSampleTable(sql);
      const resultA = await sql`SELECT SUM(Volume) FROM goog`;
      expect(resultA[0].rows[0][0]).toBeGreaterThan(0);

      await sqlite3.close(db);
      db = await sqlite3.open_v2('foobar', 0x06, VFS_NAME);
      sql = SQLite.tag(sqlite3, db);
  
      const resultB = await sql`SELECT SUM(Volume) FROM goog`;
      expect(resultB[0].rows[0][0]).toBe(resultA[0].rows[0][0]);

      await sqlite3.close(db);
    }
    console.log('elapsed', (Date.now() - timestamp) / N);
  });
});
