import { getSQLite } from './api-instances.js';
import * as SQLite from '../src/sqlite-api.js';
import { ArrayModule } from '../src/examples/ArrayModule.js';
import GOOG from './GOOG.js';

describe('module', function() {
  /** @type {SQLite.SQLiteAPI} */ let sqlite3;
  beforeAll(async function() {
    sqlite3 = await getSQLite();
  });

  let db;
  beforeEach(async function() {
    db = await sqlite3.open_v2('module');
  });

  afterEach(async function() {
    await sqlite3.close(db);
  });

  it('ArrayModule', async function() {
    const module = new ArrayModule(
      sqlite3, db,
      GOOG.rows, GOOG.columns.map(column => column.toString()));
    sqlite3.create_module(db, 'GOOG', module);

    const results = [];
    await sqlite3.exec(db, `
      CREATE VIRTUAL TABLE vt USING GOOG;
      SELECT COUNT(*), AVG(Volume) FROM vt WHERE Close > Open;
      DROP TABLE vt;
    `, function(row) { results.push(row); });
    expect(results[0][0]).toBeGreaterThan(0);
    expect(results[0][1]).toBeGreaterThan(0);
  });
});