// @ts-ignore
import SQLiteModuleFactory from '../dist/wa-sqlite.mjs';
// @ts-ignore
import SQLiteAsyncModuleFactory from '../dist/wa-sqlite-async.mjs';
import * as SQLite from '../src/sqlite-api.js';
import * as VFS from '../src/VFS.js';
import { MemoryAsyncVFS } from '../src/examples/MemoryAsyncVFS.js';
import { MemoryVFS } from '../src/examples/MemoryVFS.js';
import { IndexedDbVFS } from '../src/examples/IndexedDbVFS.js';

import GOOG from './GOOG.js';

/**
 * @param {SQLite.SQLiteAPI} sqlite3 
 * @param {number} db 
 */
async function loadSampleTable(sqlite3, db) {
  await sqlite3.exec(db, `
    PRAGMA journal_mode = DELETE;
    DROP TABLE IF EXISTS goog;
    CREATE TABLE goog (${GOOG.columns.join(',')});
    BEGIN TRANSACTION;
  `);
  for (const row of GOOG.rows) {
    await sqlite3.exec(db, `
      INSERT INTO goog VALUES (${row.join(',')})
    `);
  }
  await sqlite3.exec(db, `
    COMMIT;
  `);
}

function shared(ready) {
  const setup = {};

  /** @type {SQLite.SQLiteAPI} */ let sqlite3, vfs;
  let db, sql;
  beforeEach(async function() {
    ({ sqlite3, vfs} = await ready);
    db = await sqlite3.open_v2('foo', 0x06, vfs.name);

    sql = async function(strings, ...values) {
      let interleaved = [];
      strings.forEach((s, i) => {
        interleaved.push(s, values[i]);
      });

      const results = [];
      await sqlite3.exec(db, interleaved.join(''), (row, columns) => {
        results.push(row);
      });
      return results;
    }

    // Package test objects for non-shared tests.
    Object.assign(setup, { sqlite3, db, sql })
  });

  afterEach(async function() {
    await sqlite3.close(db);
  });

  it('persists', async function() {
    // Load data into the database.
    await loadSampleTable(sqlite3, db);
    const resultA = await sql`SELECT COUNT(*) FROM goog`;
    expect(resultA[0][0]).toBeGreaterThan(0);

    // Close and reopen the database.
    await sqlite3.close(db);
    db = await sqlite3.open_v2('foo', 0x06, vfs.name);

    const resultB = await sql`SELECT COUNT(*) FROM goog`;
    expect(resultB[0][0]).toBe(resultA[0][0]);
  });

  it('resize', async function() {
    // Load data into the database.
    await loadSampleTable(sqlite3, db);
    await sql`DELETE FROM goog WHERE Close > Open`;
    await sql`VACUUM`;

    const result = await sql`SELECT COUNT(*) FROM goog`;
    expect(result[0][0]).toBeGreaterThan(0);
  });

  return setup;
}

describe('MemoryVFS', function() {
  let resolveReady;
  let ready = new Promise(resolve => {
    resolveReady = resolve;
  });
  beforeAll(async function() {
    const SQLiteModule = await SQLiteModuleFactory();

    const sqlite3 = SQLite.Factory(SQLiteModule);
    const vfs = new MemoryVFS();
    sqlite3.vfs_register(vfs, false);
    resolveReady({ sqlite3 , vfs });
  });

  shared(ready);
});

describe('MemoryAsyncVFS', function() {
  let resolveReady;
  let ready = new Promise(resolve => {
    resolveReady = resolve;
  });
  beforeAll(async function() {
    const SQLiteModule = await SQLiteAsyncModuleFactory();

    const sqlite3 = SQLite.Factory(SQLiteModule);
    const vfs = new MemoryAsyncVFS();
    sqlite3.vfs_register(vfs, false);
    resolveReady({ sqlite3 , vfs });
  });

  shared(ready);
});

// Explore the IndexedDB filesystem without using SQLite.
class ExploreIndexedDbVFS extends IndexedDbVFS {
  handleAsync(f) {
    return f();
  }
}

// Convenience Promisification for IDBRequest.
function idb(request, listeners = {}) {
  listeners = Object.assign({
    'success': () => request.resolve(request.result),
    'error': () => request.reject('idb error')
  }, listeners);
  return new Promise(function(resolve, reject) {
    Object.assign(request, { resolve, reject });
    for (const type of Object.keys(listeners)) {
      request.addEventListener(type, listeners[type]);
    }
  });
}

describe('IndexedDbVFS', function() {
  let resolveReady;
  let ready = new Promise(resolve => {
    resolveReady = resolve;
  });
  beforeAll(async function() {
    const SQLiteModule = await SQLiteAsyncModuleFactory();

    const sqlite3 = SQLite.Factory(SQLiteModule);
    const vfs = new IndexedDbVFS();
    sqlite3.vfs_register(vfs, false);
    resolveReady({ sqlite3 , vfs });
  });

  const setup = shared(ready);

  it('xTruncate reduces filesize', async function() {
    const sqlite3 = setup.sqlite3;
    const db = setup.db;
    const sql = setup.sql;

    const vfs = new ExploreIndexedDbVFS();
    const fileId = 0;
    await vfs.xOpen('foo', fileId, 0x6, { set() {} });

    // Load data into the database and record file size.
    const fileSizes = [];
    await loadSampleTable(sqlite3, db);
    await vfs.xLock(fileId, VFS.SQLITE_LOCK_SHARED);
    await vfs.xFileSize(fileId, { set(size) { fileSizes.push(size); } });
    await vfs.xUnlock(fileId, VFS.SQLITE_LOCK_NONE);

    // Shrink the database and record file size.
    await sql`DELETE FROM goog WHERE Close > Open`;
    await sql`VACUUM`;
    await vfs.xLock(fileId, 0x1);
    // SQLite doesn't always call xSync after xTruncate. The file size is
    // written to IDB on xUnlock but the extra blocks will remain until
    // whenever xSync is called. We call it here to delete the blocks
    // immediately.
    await vfs.xSync(fileId, VFS.SQLITE_LOCK_EXCLUSIVE);
    await vfs.xFileSize(fileId, { set(size) { fileSizes.push(size); } });
    await vfs.xUnlock(fileId, VFS.SQLITE_LOCK_NONE);

    vfs.xClose(fileId);
    expect(fileSizes[1]).toBeLessThan(fileSizes[0]);

    // Check that the number of IDB blocks is consistent.
    const nBlocks = Math.floor((fileSizes[1] + 8192 - 1) / 8192);
    const store = vfs.db.transaction('blocks').objectStore('blocks');
    const keyRange = IDBKeyRange.bound('foo#0', 'foo#~');
    const keys = await idb(store.getAllKeys(keyRange));
    expect(keys.length).toBe(nBlocks);
  });

  it('force unlock', async function() {
    const sql = setup.sql;

    // Start a transaction and leave it open.
    await sql`
      BEGIN TRANSACTION;
      CREATE TABLE tbl (x);
    `;

    // Attempting to lock the file from a second connection should fail.
    let status;
    const vfs = new ExploreIndexedDbVFS();
    const fileId = 0;
    status = await vfs.xOpen('foo', fileId, 0x6, { set() {} });
    expect(status).toBe(SQLite.SQLITE_OK);
    status = await vfs.xLock(fileId, VFS.SQLITE_LOCK_SHARED);
    expect(status).toBe(VFS.SQLITE_BUSY);

    // Forcibly clear the lock.
    vfs.forceClearLock('foo');

    // Now locking should work.
    status = await vfs.xLock(fileId, VFS.SQLITE_LOCK_SHARED);
    expect(status).toBe(VFS.SQLITE_OK);

    await vfs.xClose(fileId);
    await sql`ROLLBACK`;
  });

  it('delete file', async function() {
    const sqlite3 = setup.sqlite3;
    const db = setup.db;
    const sql = setup.sql;

    // Open a file and write some data.
    const vfs = new ExploreIndexedDbVFS();
    const fileId = 0;
    await vfs.xOpen('raw', fileId, 0x6, { set() {} });
    await vfs.xWrite(fileId, new Int8Array([1, 2, 3]), 0);

    // Check IDB.
    let store, keys;
    const keyRange = IDBKeyRange.bound('raw#', 'raw#~');

    store = vfs.db.transaction('blocks').objectStore('blocks');
    keys = await idb(store.getAllKeys(keyRange));
    expect(keys.length).toBeGreaterThan(0);

    // Delete the file.
    await vfs.deleteFile('raw');

    // Check IDB again.
    store = vfs.db.transaction('blocks').objectStore('blocks');
    keys = await idb(store.getAllKeys(keyRange));
    expect(keys.length).toBe(0);
  });
});
