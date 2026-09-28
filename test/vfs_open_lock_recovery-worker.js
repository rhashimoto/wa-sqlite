// A worker for vfs_open_lock_recovery.js, holding one connection. Where the
// engine offers readwrite-unsafe access handles, OPFSAdaptiveVFS takes no
// lock on open; the test removes that feature first, so that the path taken
// is the one of engines without it.
import * as SQLite from '../src/sqlite-api.js';

const BUILDS = new Map([
  ['asyncify', '../dist/wa-sqlite-async.mjs'],
  ['jspi', '../dist/wa-sqlite-jspi.mjs'],
]);

const searchParams = new URLSearchParams(location.search);
const ready = (async () => {
  if (searchParams.get('unsafe') === 'off') {
    delete globalThis.FileSystemSyncAccessHandle.prototype.mode;
  }
  const { default: moduleFactory } = await import(BUILDS.get(searchParams.get('build')));
  const { OPFSAdaptiveVFS } = await import('../src/examples/OPFSAdaptiveVFS.js');
  const module = await moduleFactory();
  const sqlite3 = SQLite.Factory(module);
  const vfs = await OPFSAdaptiveVFS.create('lock-recovery', module);
  sqlite3.vfs_register(vfs, true);
  return sqlite3;
})();

addEventListener('message', async ({ data }) => {
  const sqlite3 = await ready;
  try {
    const db = await sqlite3.open_v2(data.filename);
    await sqlite3.exec(db, 'SELECT 1');
    await sqlite3.close(db);
    postMessage({ ok: true });
  } catch (e) {
    postMessage({ ok: false, error: e.message });
  }
});
