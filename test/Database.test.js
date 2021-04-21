// @ts-ignore
import SQLiteFactory from '../dist/wa-sqlite.mjs';
import { Database } from './Database.js';

const SQLiteReady = SQLiteFactory().then(SQLite => {
  Database.initialize(SQLite);
  return SQLite;
});

async function createDatabase(name = "foo") {
  const SQLite = await SQLiteReady;
  return new Database(name);
}

describe('Database', function() {
  let db;
  beforeEach(async function() {
    db = await createDatabase();
  });

  afterEach(async function() {
    await db.close();
  });

  it('works', async () => {
    const result = await db.sql`SELECT 6 * 7`;
    expect(result[0].rows[0][0]).toBe(42);
  });
});
