// A worker for vfs_commit_abort.js, holding one connection on
// IDBMirrorVFS. It can make the next IndexedDB commit abort, as a full
// quota would, optionally after keeping the transaction alive.
import * as SQLite from '../src/sqlite-api.js';
import { IDBMirrorVFS } from '../src/examples/IDBMirrorVFS.js';

const BUILDS = new Map([
  ['default', '../dist/wa-sqlite.mjs'],
  ['asyncify', '../dist/wa-sqlite-async.mjs'],
  ['jspi', '../dist/wa-sqlite-jspi.mjs'],
]);

const searchParams = new URLSearchParams(location.search);

let abortNextCommit = false;
let abortDelay = 0;
const commit = IDBTransaction.prototype.commit;
IDBTransaction.prototype.commit = function() {
  if (abortNextCommit && this.mode === 'readwrite') {
    abortNextCommit = false;
    if (!abortDelay) return this.abort();

    // Keep the transaction active with requests, then abort it.
    const deadline = Date.now() + abortDelay;
    const store = this.objectStore('tx');
    const keepAlive = () => {
      if (Date.now() < deadline) {
        store.get(['', 0]).onsuccess = keepAlive;
      } else {
        this.abort();
      }
    };
    return keepAlive();
  }
  return commit.call(this);
};

const ready = (async () => {
  const { default: moduleFactory } = await import(BUILDS.get(searchParams.get('build')));
  const module = await moduleFactory();
  const sqlite3 = SQLite.Factory(module);
  const vfs = await IDBMirrorVFS.create(searchParams.get('idb'), module);
  sqlite3.vfs_register(vfs, true);
  return { sqlite3, db: await sqlite3.open_v2('commit-abort') };
})();

// A read-only transaction completes after the read-write transactions
// created before it, and after their completion or abort events. Closing
// before a commit completes makes its broadcast throw, which is not what
// these tests are about.
async function commitsFinished() {
  const idb = await new Promise((resolve, reject) => {
    const request = indexedDB.open(searchParams.get('idb'));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise(resolve => {
    const tx = idb.transaction(['blocks', 'tx']);
    tx.objectStore('tx').count();
    tx.oncomplete = tx.onabort = resolve;
  });
  idb.close();
}

addEventListener('message', async ({ data }) => {
  try {
    const state = await ready;
    const { sqlite3 } = state;
    switch (data.type) {
      case 'exec': {
        const rows = [];
        try {
          await sqlite3.exec(state.db, data.sql, row => rows.push(row));
          postMessage({ rows });
        } catch (e) {
          postMessage({ rows, error: e.message });
        }
        break;
      }
      case 'abort-next-commit':
        abortNextCommit = true;
        abortDelay = data.delay ?? 0;
        postMessage({});
        break;
      case 'sleep':
        await new Promise(resolve => setTimeout(resolve, data.ms));
        postMessage({});
        break;
      case 'settle':
        await commitsFinished();
        postMessage({});
        break;
      case 'reopen':
        await commitsFinished();
        await sqlite3.close(state.db);
        state.db = await sqlite3.open_v2('commit-abort');
        postMessage({});
        break;
      case 'close':
        await commitsFinished();
        await sqlite3.close(state.db);
        postMessage({});
        break;
    }
  } catch (e) {
    postMessage({ error: e.message });
  }
});
