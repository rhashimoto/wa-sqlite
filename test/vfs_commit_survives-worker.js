// A worker for vfs_commit_survives.js. It writes to a database, or counts its
// tables, through IDBBatchAtomicVFS.
import * as SQLite from '../src/sqlite-api.js';
import { IDBBatchAtomicVFS } from '../src/examples/IDBBatchAtomicVFS.js';

const BUILDS = new Map([
  ['asyncify', '../dist/wa-sqlite-async.mjs'],
  ['jspi', '../dist/wa-sqlite-jspi.mjs'],
]);

const searchParams = new URLSearchParams(location.search);
const ready = (async () => {
  const { default: moduleFactory } = await import(BUILDS.get(searchParams.get('build')));
  const module = await moduleFactory();
  const sqlite3 = SQLite.Factory(module);
  const vfs = await IDBBatchAtomicVFS.create('commit-survives', module, {
    idbName: searchParams.get('idbName')
  });
  sqlite3.vfs_register(vfs, true);
  return sqlite3;
})();

addEventListener('message', async ({ data }) => {
  try {
    const sqlite3 = await ready;
    const db = await sqlite3.open_v2(data.name);
    switch (data.type) {
      case 'write':
        await sqlite3.exec(db, data.sql);
        postMessage({ ok: true });
        // Keep this thread busy, so nothing more of this context runs before
        // the page terminates it.
        for (const end = performance.now() + data.holdMs; performance.now() < end;);
        break;
      case 'count': {
        let n = null;
        await sqlite3.exec(db, data.sql, row => n = row[0]);
        await sqlite3.close(db);
        postMessage({ ok: true, n });
        break;
      }
    }
  } catch (e) {
    postMessage({ ok: false, error: e.message });
  }
});
