// A worker for vfs_root.js, holding one connection through the VFS class
// named by the config parameter. With the root parameter the VFS keeps its
// files in that directory of the origin private file system; without it, in
// the root. With the rejectRoot parameter its getRoot option fails.
import * as SQLite from '../src/sqlite-api.js';
import { customRootOptions } from './customRoot.js';

const searchParams = new URLSearchParams(location.search);
const ready = (async () => {
  const { default: moduleFactory } = await import('../dist/wa-sqlite.mjs');
  const module = await moduleFactory();
  const sqlite3 = SQLite.Factory(module);

  const className = searchParams.get('config');
  const namespace = await import(`../src/examples/${className}.js`);
  const root = searchParams.get('root');
  const options = searchParams.has('rejectRoot')
    ? { getRoot: () => Promise.reject(new DOMException('no root for the test', 'NotAllowedError')) }
    : root === null ? {} : customRootOptions(root);
  const vfs = await namespace[className].create('vfs-root-test', module, options);
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
