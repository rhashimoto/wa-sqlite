/**
 * A commit deletes the stored transactions no connection still needs, and
 * only those: a connection behind, here one inside a read transaction, may
 * still have to catch up from the `tx` store if it missed a broadcast. The
 * oldest transaction in use comes from the other connections' view locks,
 * whose names carry the prefix option.
 * @param {{ build: string }} params
 */
export function vfs_tx_retention({ build }) {
  describe('vfs_tx_retention', function() {
    const workers = [];
    afterEach(function() {
      for (const worker of workers.splice(0)) worker.terminate();
    });

    function connect(idb, prefix) {
      const url = new URL('./vfs_tx_retention-worker.js', import.meta.url);
      url.searchParams.set('build', build);
      url.searchParams.set('idb', idb);
      url.searchParams.set('prefix', prefix);
      const worker = new Worker(url, { type: 'module' });
      workers.push(worker);
      return (message) => new Promise((resolve, reject) => {
        worker.addEventListener('message', ({ data }) => resolve(data), { once: true });
        worker.addEventListener('error', event => reject(new Error(event.message)), { once: true });
        worker.postMessage(message);
      });
    }
    const exec = (connection, sql) => connection({ type: 'exec', sql });

    /** The ids of the transactions in the `tx` store, ascending. */
    async function storedTxIds(idb) {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(idb);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const keys = await new Promise((resolve, reject) => {
          const request = db.transaction('tx').objectStore('tx').getAllKeys();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return keys.map(([, txId]) => txId).sort((a, b) => a - b);
      } finally {
        db.close();
      }
    }

    for (const prefix of ['', 'tx-retention-prefix:']) {
      it(`should keep the transactions a connection behind still needs${prefix ? ', with a prefix' : ''}`, async function() {
        const idb = `tx-retention-${Math.random().toString(36).slice(2)}`;
        const writer = connect(idb, prefix);
        expect(await exec(writer, 'CREATE TABLE t(x)')).toEqual({ rows: [] });
        expect(await exec(writer, 'INSERT INTO t VALUES (0)')).toEqual({ rows: [] });

        // The reader's view stays at the second transaction while its read
        // transaction is open.
        const reader = connect(idb, prefix);
        expect(await exec(reader, 'BEGIN; SELECT count(*) FROM t'))
          .toEqual({ rows: [[1]] });

        // Two more commits. Each deletes the stored transactions older than
        // the oldest view still in use, the reader's.
        expect(await exec(writer, 'INSERT INTO t VALUES (1)')).toEqual({ rows: [] });
        expect(await exec(writer, 'INSERT INTO t VALUES (2)')).toEqual({ rows: [] });
        // Closing waits for the last commit to reach IndexedDB (#385).
        expect(await writer({ type: 'close' })).toEqual({});

        // The reader's view and everything after it are still stored. Taking
        // the writer's own view as the oldest would keep only the last one.
        const txIds = await storedTxIds(idb);
        const last = txIds[txIds.length - 1];
        expect(txIds).toEqual([last - 2, last - 1, last]);

        expect(await exec(reader, 'COMMIT')).toEqual({ rows: [] });
        expect(await exec(reader, 'SELECT count(*) FROM t')).toEqual({ rows: [[3]] });
      });
    }
  });
}
