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

    // Delete all tables.
    const tables = await sql`SELECT name FROM sqlite_master WHERE type='table'`;
    for (const row of tables[0].rows) {
      await sql`DROP TABLE ${row[0]}`;
    }
  });

  afterEach(async function() {
    await sqlite3.close(db);
  });

  it('prepare', async function() {
    const str = sqlite3.str_new(db);
    sqlite3.str_appendall(str, 'SELECT 1 + 1');
    const prepared = await sqlite3.prepare_v2(db, sqlite3.str_value(str));
    expect(typeof prepared.stmt).toBe('number');
    expect(sqlite3.column_name(prepared.stmt, 0)).toBe('1 + 1');
    await sqlite3.finalize(prepared.stmt);
    sqlite3.str_finish(str);
  });

  it('exec', async function() {
    const rows = [];
    await sqlite3.exec(
      db, `
      CREATE TABLE tableA (x, y);
      INSERT INTO tableA VALUES (1, 2);
      CREATE TABLE tableB (a, b, c);
      INSERT INTO tableB VALUES ('foo', 'bar', 'baz');
      INSERT INTO tableB VALUES ('how', 'now', 'brown');
      SELECT * FROM tableA;
      SELECT * FROM tableB;
      `,
      function(userData, n, row, columns) {
        rows.push(row);
      });

      expect(rows).toEqual([
        [1, 2],
        ['foo', 'bar', 'baz'],
        ['how', 'now', 'brown']
      ]);
  });

  it('tag', async function() {
    const result = await sql`
      DROP TABLE IF EXISTS abc; -- doesn't produce output
      SELECT 6 * 7
    `;
    expect(result[0].rows[0][0]).toBe(42);
  });
});