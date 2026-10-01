/**
 * A transaction that has committed stays committed when its context ends
 * immediately afterwards.
 * @param {{ build: string }} params
 */
export function vfs_commit_survives({ build }) {
  describe('vfs_commit_survives', function() {
    const workers = [];
    const idbName = `commit-survives-${Math.random().toString(36).slice(2)}`;
    afterEach(async function() {
      for (const worker of workers.splice(0)) worker.terminate();
      await new Promise(resolve => {
        const request = indexedDB.deleteDatabase(idbName);
        request.onsuccess = request.onerror = request.onblocked = resolve;
      });
    });

    function connect() {
      const url = new URL('./vfs_commit_survives-worker.js', import.meta.url);
      url.searchParams.set('build', build);
      url.searchParams.set('idbName', idbName);
      const worker = new Worker(url, { type: 'module' });
      workers.push(worker);
      const send = (message) => new Promise((resolve, reject) => {
        worker.addEventListener('message', ({ data }) => resolve(data), { once: true });
        worker.addEventListener('error', event => reject(new Error(event.message)), { once: true });
        worker.postMessage(message);
      });
      return { worker, send };
    }

    it('should keep the first transaction of a new database', async function() {
      const name = 'first.db';
      const writer = connect();
      const written = await writer.send({
        type: 'write', name, sql: 'CREATE TABLE t(x)', holdMs: 1000
      });
      expect(written.ok).toBeTrue();
      writer.worker.terminate();

      const reader = connect();
      const counted = await reader.send({
        type: 'count', name, sql: 'SELECT count(*) FROM sqlite_master'
      });
      expect(counted.ok ? counted.n : counted.error).toBe(1);
    });

    it('should keep a transaction larger than the page cache', async function() {
      const name = 'large.db';
      // This worker is left running, so the table it creates stays committed.
      const setup = connect();
      expect((await setup.send({
        type: 'write', name, sql: 'CREATE TABLE t(x)', holdMs: 0
      })).ok).toBeTrue();

      // About 4 MB of new pages, more than the default 2 MB cache.
      const writer = connect();
      const written = await writer.send({
        type: 'write',
        name,
        sql: `
          BEGIN;
          WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2000)
            INSERT INTO t SELECT randomblob(2000) FROM n;
          COMMIT;
        `,
        holdMs: 1000
      });
      expect(written.ok).toBeTrue();
      writer.worker.terminate();

      const reader = connect();
      const counted = await reader.send({
        type: 'count', name, sql: 'SELECT count(*) FROM t'
      });
      expect(counted.ok ? counted.n : counted.error).toBe(2000);
    });
  });
}
