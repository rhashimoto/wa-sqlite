// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.

// Uncomment one of the following imports to choose which SQLite build
// to use. Note that an asynchronous VFS requires an asynchronous build
// (JSPI or Asyncify).
// import SQLiteESMFactory from '../dist/wa-sqlite.mjs';
import SQLiteESMFactory from '../dist/wa-sqlite-jspi.mjs';
// import SQLiteESMFactory from '../dist/wa-sqlite-async.mjs';

// Uncomment one of the following imports to choose a VFS. Note that an
// asynchronous VFS requires an asynchronous build, and an VFS using
// FileSystemSyncAccessHandle (generally any OPFS VFS) will run only
// in a Worker.
// import { MemoryVFS as MyVFS } from '../src/examples/MemoryVFS.js';
// import { MemoryAsyncVFS as MyVFS} from '../src/examples/MemoryAsyncVFS.js';
import { OriginPrivateVFS as MyVFS } from '../src/examples/OriginPrivateVFS.js';

import * as SQLite from 'wa-sqlite';

const broadcast = new BroadcastChannel('hello');

reset().then(async () => {
  const module = await SQLiteESMFactory();
  const sqlite3 = SQLite.Factory(module);

  const vfs = await MyVFS.create('test', module);
  // @ts-ignore
  sqlite3.vfs_register(vfs, true);
  const db = await sqlite3.open_v2(
    'file://localhost/test.db?foo=bar&baz=quux',
    SQLite.SQLITE_OPEN_CREATE | SQLite.SQLITE_OPEN_READWRITE | SQLite.SQLITE_OPEN_URI,
    'test');
  await sqlite3.exec(db, `SELECT 'Hello, world!'`, (row, columns) => {
    console.log(row);
    broadcast.postMessage(JSON.stringify(row[0]));
  });

  await sqlite3.exec(db, `
    PRAGMA cache_size=0;
    CREATE TABLE IF NOT EXISTS t(x);
    INSERT INTO t VALUES ('how'), ('now'), ('brown'), ('cow');
    SELECT * FROM t;
  `, (row, columns) => {
    console.log(row);
  });
  await sqlite3.close(db);
}).catch(e => {
  broadcast.postMessage(e.toString());
});

async function reset() {
  // Delete all OPFS contents.
  const root = await navigator.storage?.getDirectory();
  if (root) {
    // @ts-ignore
    for await (const name of root.keys()) {
      await root.removeEntry(name, { recursive: true });
    }
  }
}