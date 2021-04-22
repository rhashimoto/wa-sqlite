// @ts-ignore
import { SQLiteReady, Database } from './SQLite.js';

describe('Database', function() {
  beforeAll(async function() {
    const SQLite = await SQLiteReady;
  });

  let db;
  beforeEach(async function() {
    db = await Database.open('foo');
  });

  afterEach(async function() {
    await db.close();
  });

  it('works', async () => {
    const result = await db.sql`SELECT 6 * 7`;
    expect(result[0].rows[0][0]).toBe(42);
  });
});
