// A worker for vfs_idb_factory.js, holding one connection through the VFS
// class named by the config parameter. With the bucket parameter the VFS
// keeps its IndexedDB database in that Storage Bucket; without it, in the
// default one. With the rejectFactory parameter its getIDBFactory option
// fails.
import * as SQLite from '../src/sqlite-api.js';
import { customFactoryOptions } from './customFactory.js';

const searchParams = new URLSearchParams(location.search);
const ready = (async () => {
  const { default: moduleFactory } = await import('../dist/wa-sqlite-async.mjs');
  const module = await moduleFactory();
  const sqlite3 = SQLite.Factory(module);

  const className = searchParams.get('config');
  const namespace = await import(`../src/examples/${className}.js`);
  const bucket = searchParams.get('bucket');
  const options = searchParams.has('rejectFactory')
    ? { getIDBFactory: () => Promise.reject(new DOMException('no factory for the test', 'NotAllowedError')) }
    : bucket === null ? {} : customFactoryOptions(bucket);
  const vfs = await namespace[className].create('vfs-idb-factory-test', module, options);
  sqlite3.vfs_register(vfs, true);

  const db = await sqlite3.open_v2(searchParams.get('filename'));
  return { sqlite3, db };
})();

addEventListener('message', async ({ data }) => {
  try {
    const { sqlite3, db } = await ready;
    switch (data.type) {
      case 'ready':
        postMessage({});
        break;
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
    postMessage({ error: e.message, name: e.name });
  }
});
