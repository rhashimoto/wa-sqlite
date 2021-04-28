// @ts-ignore
import SQLiteModuleFactory from '../dist/wa-sqlite.mjs';
// @ts-ignore
import SQLiteAsyncModuleFactory from '../dist/wa-sqlite-async.mjs';
import * as SQLite from '../src/sqlite-api.js';
import { SQLITE_DONE, SQLITE_OK } from '../src/VFS.js';

const LIBVERSION = '3.33.0';
const LIBVERSION_NUMBER = 3033000;

// Shared test definitions for sync and async.
function shared(sqlite3Ready) {
  /** @type {SQLite.SQLiteAPI} */ let sqlite3;
  let db;
  beforeEach(async function() {
    sqlite3 = await sqlite3Ready;
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
  });

  afterEach(async function() {
    await sqlite3.close(db);
  });

  it('version', async function() {
    const sVersion = sqlite3.libversion();
    expect(sVersion).toBe(LIBVERSION);

    const nVersion = sqlite3.libversion_number();
    expect(nVersion).toBe(LIBVERSION_NUMBER);
  });

  it('prepare', async function() {
    const str = sqlite3.str_new(db);
    sqlite3.str_appendall(str, 'SELECT 1 + 1');
    const prepared = await sqlite3.prepare_v2(db, sqlite3.str_value(str));
    expect(typeof prepared.stmt).toBe('number');
    expect(sqlite3.column_name(prepared.stmt, 0)).toBe('1 + 1');
    expect(sqlite3.sql(prepared.stmt)).toBe('SELECT 1 + 1');
    await sqlite3.finalize(prepared.stmt);
    sqlite3.str_finish(str);
  });

  it('bind', async function() {
    await sqlite3.exec(db, `
      CREATE TABLE tbl (id, cBlob, cDouble, cInt, cNull, cText);
    `);

    const str = sqlite3.str_new(db);
    sqlite3.str_appendall(str, `
      INSERT INTO tbl VALUES (:Id, :cBlob, :cDouble, :cInt, :cNull, :cText);
    `);
    const prepared = await sqlite3.prepare_v2(db, sqlite3.str_value(str));

    let result;
    const cBlob = new Int8Array([8, 6, 7, 5, 3, 0, 9]);
    const cDouble = Math.PI;
    const cInt = 42;
    const cNull = null;
    const cText = 'foobar';

    result = sqlite3.bind(prepared.stmt, [
      'array', cBlob, cDouble, cInt, cNull, cText
    ]);
    expect(result).toBe(SQLITE_OK);
    result = await sqlite3.step(prepared.stmt);
    expect(result).toBe(SQLITE_DONE);
    result = sqlite3.reset(prepared.stmt);
    expect(result).toBe(SQLITE_OK);

    result = sqlite3.bind(prepared.stmt, {
      ':Id': 'object',
      ':cBlob': cBlob,
      ':cDouble': cDouble,
      ':cInt': cInt,
      ':cNull': cNull,
      ':cText': cText
    });
    expect(result).toBe(SQLITE_OK);
    result = await sqlite3.step(prepared.stmt);
    expect(result).toBe(SQLITE_DONE);
    result = sqlite3.reset(prepared.stmt);
    expect(result).toBe(SQLITE_OK);

    result = await sqlite3.finalize(prepared.stmt);
    expect(result).toBe(SQLITE_OK);

    const results = [];
    await sqlite3.exec(
      db, `
        SELECT cBlob, cDouble, cInt, cNull, cText FROM tbl;
      `,
      function(rowData, columnNames) {
        rowData = rowData.map(value => {
          // Blob results do not remain valid so copy to retain.
          return value instanceof Int8Array ? Array.from(value) : value;
        });
        results.push(rowData);
      });

    const expected = [Array.from(cBlob), cDouble, cInt, cNull, cText];
    expect(results[0]).toEqual(expected);
    expect(results[1]).toEqual(expected);
  });

  it('exec', async function() {
    // Without callback.
    await sqlite3.exec(
      db, `
      CREATE TABLE tableA (x, y);
      INSERT INTO tableA VALUES (1, 2);
    `);

    // With callback.
    const rows = [];
    await sqlite3.exec(
      db, `
      CREATE TABLE tableB (a, b, c);
      INSERT INTO tableB VALUES ('foo', 'bar', 'baz');
      INSERT INTO tableB VALUES ('how', 'now', 'brown');
      SELECT * FROM tableA;
      SELECT * FROM tableB;
      `,
      function(row, columns) {
        switch (columns.length) {
          case 2:
            expect(columns).toEqual(['x', 'y']);
            break;
          case 3:
            expect(columns).toEqual(['a', 'b', 'c']);
            break;
          default:
            fail();
            break;
        }
        rows.push(row);
      });

      expect(rows).toEqual([
        [1, 2],
        ['foo', 'bar', 'baz'],
        ['how', 'now', 'brown']
      ]);
  });

  it('reset', async function() {
    await sqlite3.exec(
      db, `
      CREATE TABLE tbl (x);
      INSERT INTO tbl VALUES ('a'), ('b'), ('c');
    `);
    expect(sqlite3.changes(db)).toBe(3);

    const str = sqlite3.str_new(db, 'SELECT x FROM tbl ORDER BY x');
    const prepared = await sqlite3.prepare_v2(db, sqlite3.str_value(str));
    await sqlite3.step(prepared.stmt);
    expect(sqlite3.column(prepared.stmt, 0)).toBe('a');
    await sqlite3.step(prepared.stmt);
    expect(sqlite3.column(prepared.stmt, 0)).toBe('b');

    sqlite3.reset(prepared.stmt);
    await sqlite3.step(prepared.stmt);
    expect(sqlite3.column(prepared.stmt, 0)).toBe('a');

    sqlite3.finalize(prepared.stmt);
    sqlite3.str_finish(str);
  });
}

describe('sqlite-api', function() {
  let resolveSQLite;
  let sqlite3Ready = new Promise(resolve => {
    resolveSQLite = resolve;
  });
  beforeAll(async function() {
    const SQLiteModule = await SQLiteModuleFactory();
    resolveSQLite(SQLite.Factory(SQLiteModule));
  });

  shared(sqlite3Ready);
});

describe('sqlite-api async', function() {
  let resolveSQLite;
  let sqlite3Ready = new Promise(resolve => {
    resolveSQLite = resolve;
  });
  beforeAll(async function() {
    const SQLiteModule = await SQLiteAsyncModuleFactory();
    resolveSQLite(SQLite.Factory(SQLiteModule));
  });

  shared(sqlite3Ready);
});