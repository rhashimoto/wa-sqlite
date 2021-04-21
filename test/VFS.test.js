// @ts-ignore
import { SQLiteReady, Database } from './SQLite.js';
import { MemoryAsyncVFS } from './MemoryAsyncVFS.js';
import { MemoryVFS } from './MemoryVFS.js';

import GOOG from './GOOG.js';

async function loadSampleTable(db) {
  await db.sql`
    DROP TABLE IF EXISTS goog;
    CREATE TABLE goog (${GOOG.columns.join(',')});
  `;
  for (const row of GOOG.rows) {
    await db.sql`INSERT INTO goog VALUES (${row.join(',')})`;
  }
}

describe('VFS', function() {
  let vfs;
  beforeAll(async function() {
    const SQLite = await SQLiteReady;

    vfs = new MemoryVFS(SQLite);
    SQLite.registerVFS('mem', vfs);
  });

  let db;
  beforeEach(async function() {
    db = new Database('foo', 'mem');
  });

  afterEach(async function() {
    await db.close();
  });

  it('persists', async function() {
    // Load data into the database.
    await loadSampleTable(db);
    const resultA = await db.sql`SELECT COUNT(*) FROM goog`;
    expect(resultA[0].rows[0][0]).toBeGreaterThan(0);

    // Close and reopen the database.
    await db.close();
    db = new Database('foo', 'mem');

    const resultB = await db.sql`SELECT COUNT(*) FROM goog`;
    expect(resultB[0].rows[0][0]).toBe(resultA[0].rows[0][0]);
  });
});
