import { getSQLite, getSQLiteAsync } from './api-instances.js';
import * as SQLite from '../src/sqlite-api.js';

const LIBVERSION = '3.35.5';
const LIBVERSION_NUMBER = 3035005;

// Shared test definitions for sync and async.
function shared(sqlite3Ready) {
  /** @type {SQLiteAPI} */ let sqlite3;
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

    result = sqlite3.bind_collection(prepared.stmt, [
      'array', cBlob, cDouble, cInt, cNull, cText
    ]);
    expect(result).toBe(SQLite.SQLITE_OK);
    result = await sqlite3.step(prepared.stmt);
    expect(result).toBe(SQLite.SQLITE_DONE);
    result = await sqlite3.reset(prepared.stmt);
    expect(result).toBe(SQLite.SQLITE_OK);

    result = sqlite3.bind_collection(prepared.stmt, {
      ':Id': 'object',
      ':cBlob': cBlob,
      ':cDouble': cDouble,
      ':cInt': cInt,
      ':cNull': cNull,
      ':cText': cText
    });
    expect(result).toBe(SQLite.SQLITE_OK);
    result = await sqlite3.step(prepared.stmt);
    expect(result).toBe(SQLite.SQLITE_DONE);
    result = await sqlite3.reset(prepared.stmt);
    expect(result).toBe(SQLite.SQLITE_OK);

    result = await sqlite3.finalize(prepared.stmt);
    expect(result).toBe(SQLite.SQLITE_OK);

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

    await sqlite3.reset(prepared.stmt);
    await sqlite3.step(prepared.stmt);
    expect(sqlite3.column(prepared.stmt, 0)).toBe('a');

    sqlite3.finalize(prepared.stmt);
    sqlite3.str_finish(str);
  });

  it('function', async function() {
    // Populate a table with each value type, one value per row.
    await sqlite3.exec(db, `CREATE TABLE tbl (value)`);
    const str = sqlite3.str_new(db, `
      INSERT INTO tbl VALUES (?), (?), (?), (?), (?);
    `);
    const prepared = await sqlite3.prepare_v2(db, sqlite3.str_value(str));

    let result;
    const vBlob = new Int8Array([8, 6, 7, 5, 3, 0, 9]);
    const vDouble = Math.PI;
    const vInt = 42;
    const vNull = null;
    const vText = 'foobar';
    result = sqlite3.bind_collection(prepared.stmt, [
      vBlob, vDouble, vInt, vNull, vText
    ]);
    expect(result).toBe(SQLite.SQLITE_OK);
    result = await sqlite3.step(prepared.stmt);
    expect(result).toBe(SQLite.SQLITE_DONE);
    result = await sqlite3.finalize(prepared.stmt);
    expect(result).toBe(SQLite.SQLITE_OK);

    // This function evaluates to its second argument.
    let appData = null;
    function f(context, values) {
      // Unlikely anyone will ever use this call but check it anyway.
      appData = sqlite3.user_data(context);

      const value = sqlite3.value(values[1]);
      sqlite3.result(context, value);
    }
    result = sqlite3.create_function(
      db, "MyFunc", 2, SQLite.SQLITE_UTF8, 0x1234, f, null, null);
    expect(result).toBe(SQLite.SQLITE_OK);

    // Apply the function to each row.
    const values = [];
    await sqlite3.exec(db, `SELECT MyFunc(0, value) FROM tbl`, row => {
      // Blob results do not remain valid so copy to retain.
      const value = row[0] instanceof Int8Array ? Array.from(row[0]) : row[0];
      values.push(value);
    });
    const expected = [Array.from(vBlob), vDouble, vInt, vNull, vText];
    expect(values).toEqual(expected);

    expect(appData).toBe(0x1234);
  });

  it('aggregate', async function() {
    // A real aggregate function would need to manage separate
    // invocations by keying off context but that is unnecessary
    // for this test.
    let sum = 0;
    function SumStep(context, values) {
      const value = sqlite3.value_int(values[0]);
      sum += value;
    }
    function SumFinal(context) {
      sqlite3.result(context, sum);
    }

    let result;
    result = sqlite3.create_function(
      db, "MySum", 1, SQLite.SQLITE_UTF8, 0x1234, null, SumStep, SumFinal);
    expect(result).toBe(SQLite.SQLITE_OK);

    await sqlite3.exec(db, `
      CREATE TABLE tbl (value);
      INSERT INTO tbl VALUES (1), (2), (3), (4);
      SELECT MySum(value) FROM tbl;
    `, row => {
      result = row[0];
    });
    expect(result).toBe(10);
  });
}

describe('sqlite-api', function() {
  const sqlite3Ready = getSQLite();
  shared(sqlite3Ready);
});

describe('sqlite-api async', function() {
  const sqlite3Ready = getSQLiteAsync();
  shared(sqlite3Ready);
});