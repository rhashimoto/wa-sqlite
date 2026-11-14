// A worker for vfs_journal_handle.js, holding one connection. Where the
// engine offers readwrite-unsafe access handles, OPFSAdaptiveVFS shares its
// files between connections; the test removes that feature first, so that
// the path taken is the one of engines without it: access handles are
// exclusive, whatever mode is asked for.
import * as SQLite from '../src/sqlite-api.js';

const BUILDS = new Map([
  ['asyncify', '../dist/wa-sqlite-async.mjs'],
  ['jspi', '../dist/wa-sqlite-jspi.mjs'],
]);

const searchParams = new URLSearchParams(location.search);

const { createSyncAccessHandle } = FileSystemFileHandle.prototype;
const { removeEntry } = FileSystemDirectoryHandle.prototype;

// What the connection does to its rollback journal, counted.
const journalCalls = { createSyncAccessHandle: 0, removeEntry: 0 };

const ready = (async () => {
  delete globalThis.FileSystemSyncAccessHandle.prototype.mode;
  FileSystemFileHandle.prototype.createSyncAccessHandle = function() {
    if (this.name.endsWith('-journal')) journalCalls.createSyncAccessHandle++;
    return createSyncAccessHandle.call(this);
  };
  FileSystemDirectoryHandle.prototype.removeEntry = function(name, ...args) {
    if (name.endsWith('-journal')) journalCalls.removeEntry++;
    return removeEntry.call(this, name, ...args);
  };

  const { default: moduleFactory } = await import(BUILDS.get(searchParams.get('build')));
  const { OPFSAdaptiveVFS } = await import('../src/examples/OPFSAdaptiveVFS.js');
  const module = await moduleFactory();
  const sqlite3 = SQLite.Factory(module);
  const vfs = await OPFSAdaptiveVFS.create('journal-handle', module);
  sqlite3.vfs_register(vfs, true);
  return sqlite3;
})();

let db;

const ops = {
  async open(sqlite3, { filename }) {
    db = await sqlite3.open_v2(filename);
  },
  async exec(sqlite3, { sql }) {
    const rows = [];
    await sqlite3.exec(db, sql, row => rows.push(row));
    return rows;
  },
  // Returns the counts since the last call, and starts them again.
  takeJournalCalls() {
    const calls = { ...journalCalls };
    journalCalls.createSyncAccessHandle = 0;
    journalCalls.removeEntry = 0;
    return calls;
  },
  // A terminated worker releases its access handles some time after its
  // Web Locks, depending on the engine: wait until no one holds the file.
  async waitUntilFree(sqlite3, { filename }) {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(filename);
    while (true) {
      try {
        (await createSyncAccessHandle.call(fileHandle)).close();
        return;
      } catch (e) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  },
};

addEventListener('message', async ({ data }) => {
  const sqlite3 = await ready;
  try {
    postMessage({ ok: true, value: await ops[data.op](sqlite3, data) });
  } catch (e) {
    postMessage({ ok: false, error: e.message });
  }
});
