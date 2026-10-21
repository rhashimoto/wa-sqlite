import * as SQLite from '../src/sqlite-api.js';
import { IDBMirrorVFS } from '../src/examples/IDBMirrorVFS.js';

const BUILDS = new Map([
  ['asyncify', '../dist/wa-sqlite-async.mjs'],
  ['jspi', '../dist/wa-sqlite-jspi.mjs'],
]);

/**
 * Every IndexedDB transaction of the VFS has finished when close()
 * returns, so a context ended right after leaves none behind.
 * @param {{ build: string }} params
 */
export function vfs_close_settles({ build }) {
  describe('vfs_close_settles', function() {
    const ROUNDS = 5;
    const idbName = `close-settles-${Math.random().toString(36).slice(2)}`;

    // Transactions started on any IDBDatabase in this context and not yet
    // complete or aborted.
    const live = new Set();
    const transaction = IDBDatabase.prototype.transaction;
    beforeEach(function() {
      IDBDatabase.prototype.transaction = function(...args) {
        const tx = transaction.apply(this, args);
        live.add(tx);
        tx.addEventListener('complete', () => live.delete(tx));
        tx.addEventListener('abort', () => live.delete(tx));
        return tx;
      };
    });
    afterEach(async function() {
      IDBDatabase.prototype.transaction = transaction;
      for (let i = 0; i < ROUNDS; ++i) {
        await new Promise(resolve => {
          const request = indexedDB.deleteDatabase(`${idbName}-${i}`);
          request.onsuccess = request.onerror = request.onblocked = resolve;
        });
      }
    });

    it('should finish its transactions before close() returns', async function() {
      const { default: moduleFactory } = await import(BUILDS.get(build));
      const module = await moduleFactory();
      const sqlite3 = SQLite.Factory(module);

      async function execAndClose(name, sql) {
        const vfs = await IDBMirrorVFS.create(name, module);
        sqlite3.vfs_register(vfs, true);
        const db = await sqlite3.open_v2('demo');
        await sqlite3.exec(db, sql);
        await sqlite3.close(db);
        await vfs.close();
        return live.size;
      }

      for (let i = 0; i < ROUNDS; ++i) {
        const name = `${idbName}-${i}`;
        expect(await execAndClose(name, 'CREATE TABLE t(x); INSERT INTO t VALUES (1)')).toBe(0);
        expect(await execAndClose(name, 'SELECT * FROM t')).toBe(0);
      }
    });
  });
}
