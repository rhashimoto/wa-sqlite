// A worker for vfs_close_broadcast.js, holding one connection on
// IDBMirrorVFS. It records the errors no handler caught.
import * as SQLite from '../src/sqlite-api.js';
import { IDBMirrorVFS } from '../src/examples/IDBMirrorVFS.js';

const BUILDS = new Map([
  ['default', '../dist/wa-sqlite.mjs'],
  ['asyncify', '../dist/wa-sqlite-async.mjs'],
  ['jspi', '../dist/wa-sqlite-jspi.mjs'],
]);

const searchParams = new URLSearchParams(location.search);

const uncaught = [];
addEventListener('error', event => {
  uncaught.push(event.message);
  event.preventDefault();
});

const ready = (async () => {
  const { default: moduleFactory } = await import(BUILDS.get(searchParams.get('build')));
  const module = await moduleFactory();
  const sqlite3 = SQLite.Factory(module);
  const vfs = await IDBMirrorVFS.create(searchParams.get('idb'), module);
  sqlite3.vfs_register(vfs, true);
  return { sqlite3, db: await sqlite3.open_v2('close-broadcast') };
})();

addEventListener('message', async ({ data }) => {
  try {
    const { sqlite3, db } = await ready;
    switch (data.type) {
      case 'exec': {
        const rows = [];
        try {
          await sqlite3.exec(db, data.sql, row => rows.push(row));
          postMessage({ rows });
        } catch (e) {
          postMessage({ rows, error: e.message });
        }
        break;
      }
      case 'exec-close':
        // No await between the statement and the close.
        await sqlite3.exec(db, data.sql);
        await sqlite3.close(db);
        postMessage({});
        break;
      case 'uncaught':
        postMessage({ uncaught });
        break;
    }
  } catch (e) {
    postMessage({ error: e.message });
  }
});
