// @ts-ignore
import SQLiteModuleFactory from '../dist/wa-sqlite.mjs';
import * as SQLite from '../src/sqlite-api.js';
import { tag } from '../src/examples/tag.js';

describe('tag', function() {
  /** @type {SQLite.SQLiteAPI} */ let sqlite3;
  beforeAll(async function() {
    const SQLiteModule = await SQLiteModuleFactory();
    sqlite3 = SQLite.Factory(SQLiteModule);
  });

  let db;
  let sql;
  beforeEach(async function() {
    db = await sqlite3.open_v2('foo');

    // Delete all tables.
    const tables = [];
    await sqlite3.exec(db, `
      SELECT name FROM sqlite_master WHERE type='table';
    `, row => {
      tables.push(row[0]);
    });
    for (const table of tables) {
      await sqlite3.exec(db, `DROP TABLE ${table}`);
    }

    sql = tag(sqlite3, db);
  });

  afterEach(async function() {
    await sqlite3.close(db);
  });

  it('returns rows', async function() {
    const result = await sql`
      DROP TABLE IF EXISTS abc; -- doesn't produce output
      SELECT 6 * 7
    `;
    expect(result[0].rows[0][0]).toBe(42);
  });
});