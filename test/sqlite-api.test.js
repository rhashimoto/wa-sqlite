// @ts-ignore
import SQLiteModuleFactory from '../dist/wa-sqlite-async.mjs';
import * as SQLite from '../src/sqlite-api.js';

describe('sqlite-api', function() {
  /** @type {SQLite.SQLiteAPI} */ let sqlite3;
  beforeAll(async function() {
    const SQLiteModule = await SQLiteModuleFactory();
    sqlite3 = SQLite.Factory(SQLiteModule);
  });

  let db;
  let sql;
  beforeEach(async function() {
    db = await sqlite3.open_v2('foo');
    sql = SQLite.tag(sqlite3, db);
  });

  afterEach(async function() {
    await sqlite3.close(db);
  });

  it('prepare', async function() {
    const prepared = await sqlite3.prepare_v2(db, 'SELECT 1 + 1');
    expect(typeof prepared.stmt).toBe('number');
    expect(sqlite3.column_name(prepared.stmt, 0)).toBe('1 + 1');
    await sqlite3.finalize(prepared.stmt);
  });

  it('tag', async function() {
    const result = await sql`
      DROP TABLE IF EXISTS abc; -- doesn't produce output
      SELECT 6 * 7
    `;
    expect(result[0].rows[0][0]).toBe(42);
  });
});