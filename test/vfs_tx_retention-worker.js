// A worker for vfs_tx_retention.js, holding one connection on IDBMirrorVFS,
// created with the prefix parameter as its prefix option.
import * as SQLite from '../src/sqlite-api.js';
import { IDBMirrorVFS } from '../src/examples/IDBMirrorVFS.js';

const BUILDS = new Map([
  ['default', '../dist/wa-sqlite.mjs'],
  ['asyncify', '../dist/wa-sqlite-async.mjs'],
  ['jspi', '../dist/wa-sqlite-jspi.mjs'],
]);

const searchParams = new URLSearchParams(location.search);

const ready = (async () => {
  const { default: moduleFactory } = await import(BUILDS.get(searchParams.get('build')));
  const module = await moduleFactory();
  const sqlite3 = SQLite.Factory(module);
  const vfs = await IDBMirrorVFS.create(searchParams.get('idb'), module, {
    prefix: searchParams.get('prefix'),
  });
  sqlite3.vfs_register(vfs, true);
  return { sqlite3, db: await sqlite3.open_v2('tx-retention') };
})();

addEventListener('message', async ({ data }) => {
  try {
    const { sqlite3, db } = await ready;
    switch (data.type) {
      case 'exec': {
        const rows = [];
        await sqlite3.exec(db, data.sql, row => rows.push(row));
        postMessage({ rows });
        break;
      }
      case 'close':
        await sqlite3.close(db);
        postMessage({});
        break;
    }
  } catch (e) {
    postMessage({ error: e.message });
  }
});
