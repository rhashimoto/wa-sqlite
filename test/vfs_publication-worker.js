// A worker for vfs_publication.js, holding one connection on
// OPFSAnyContextVFS. It can make the database's writes fail, as a full
// quota would, and counts the writable streams opened on the database.
import * as SQLite from '../src/sqlite-api.js';
import * as VFS from '../src/VFS.js';
import { OPFSAnyContextVFS } from '../src/examples/OPFSAnyContextVFS.js';

const BUILDS = new Map([
  ['default', '../dist/wa-sqlite.mjs'],
  ['asyncify', '../dist/wa-sqlite-async.mjs'],
  ['jspi', '../dist/wa-sqlite-jspi.mjs'],
]);

const searchParams = new URLSearchParams(location.search);
const filename = searchParams.get('filename');

let writablesOpened = 0;
const createWritable = FileSystemFileHandle.prototype.createWritable;
FileSystemFileHandle.prototype.createWritable = function(...args) {
  if (this.name === filename) writablesOpened++;
  return createWritable.apply(this, args);
};

// Database writes after the first `writesBeforeFailure` fail, until healed.
let writesBeforeFailure = Infinity;
class FailingVFS extends OPFSAnyContextVFS {
  async jWrite(fileId, pData, iOffset) {
    if (this.mapIdToFile.get(fileId).flags & VFS.SQLITE_OPEN_MAIN_DB) {
      if (writesBeforeFailure-- <= 0) return VFS.SQLITE_IOERR_WRITE;
    }
    return super.jWrite(fileId, pData, iOffset);
  }
}

const ready = (async () => {
  const { default: moduleFactory } = await import(BUILDS.get(searchParams.get('build')));
  const module = await moduleFactory();
  const sqlite3 = SQLite.Factory(module);
  const vfs = new FailingVFS('publication', module);
  await vfs.isReady();
  sqlite3.vfs_register(vfs, true);
  const db = await sqlite3.open_v2(filename);
  return { sqlite3, db };
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
      case 'fail-writes':
        writesBeforeFailure = data.after;
        postMessage({});
        break;
      case 'heal':
        writesBeforeFailure = Infinity;
        postMessage({});
        break;
      case 'writables':
        postMessage({ n: writablesOpened });
        writablesOpened = 0;
        break;
    }
  } catch (e) {
    postMessage({ error: e.message });
  }
});
