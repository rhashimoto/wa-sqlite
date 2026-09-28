// A worker for vfs_read_freshness.js, holding one connection with
// read_to_current set. Each context has its own WriteAhead view, which is
// the point: two connections in one context share it and cannot disagree.
import * as SQLite from '../src/sqlite-api.js';
import { OPFSWriteAheadVFS } from '../src/examples/OPFSWriteAheadVFS.js';

const BUILDS = new Map([
  ['asyncify', '../dist/wa-sqlite-async.mjs'],
  ['jspi', '../dist/wa-sqlite-jspi.mjs'],
]);

const searchParams = new URLSearchParams(location.search);
const ready = (async () => {
  const { default: moduleFactory } = await import(BUILDS.get(searchParams.get('build')));
  const module = await moduleFactory();
  const sqlite3 = SQLite.Factory(module);
  const vfs = await OPFSWriteAheadVFS.create('read-freshness', module);
  sqlite3.vfs_register(vfs, true);
  const db = await sqlite3.open_v2(searchParams.get('filename'));
  await sqlite3.exec(db, 'PRAGMA read_to_current = 1');
  return { sqlite3, db };
})();

async function count({ sqlite3, db }) {
  let n;
  await sqlite3.exec(db, 'SELECT count(*) FROM t', (row) => { n = row[0]; });
  return n;
}

addEventListener('message', async ({ data }) => {
  try {
    const connection = await ready;
    switch (data.type) {
      case 'exec':
        await connection.sqlite3.exec(connection.db, data.sql);
        postMessage({});
        break;
      case 'count':
        postMessage({ n: await count(connection) });
        break;
      case 'block-then-count': {
        // Keep this context's event loop busy, so that a transaction another
        // context commits meanwhile is broadcast but not yet delivered here,
        // then read in the same task.
        const end = performance.now() + data.ms;
        while (performance.now() < end);
        postMessage({ n: await count(connection), blockEnd: performance.timeOrigin + end });
        break;
      }
      case 'close':
        await connection.sqlite3.close(connection.db);
        postMessage({});
        break;
    }
  } catch (e) {
    postMessage({ error: e.message });
  }
});
