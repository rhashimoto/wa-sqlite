const ROWS = `
  CREATE TABLE t(x BLOB);
  WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM c WHERE i < 200)
  INSERT INTO t SELECT randomblob(500) FROM c;`;
const ABORTED = 'INSERT INTO t VALUES (zeroblob(10)), (zeroblob(10)), (zeroblob(10))';

/**
 * A commit whose IndexedDB transaction aborts must never reach the stored
 * database, nor any commit built on it, and the connection must go on.
 * @param {{ build: string }} params
 */
export function vfs_commit_abort({ build }) {
  describe('vfs_commit_abort', function() {
    const workers = [];
    afterEach(function() {
      for (const worker of workers.splice(0)) worker.terminate();
    });

    function connect(idb) {
      const url = new URL('./vfs_commit_abort-worker.js', import.meta.url);
      url.searchParams.set('build', build);
      url.searchParams.set('idb', idb);
      const worker = new Worker(url, { type: 'module' });
      workers.push(worker);
      return (message) => new Promise((resolve, reject) => {
        worker.addEventListener('message', ({ data }) => resolve(data), { once: true });
        worker.addEventListener('error', event => reject(new Error(event.message)), { once: true });
        worker.postMessage(message);
      });
    }
    const exec = (context, sql) => context({ type: 'exec', sql });
    const query = async (context, sql) => (await exec(context, sql)).rows[0][0];

    // A new connection reads what is stored.
    async function expectStored(idb, count) {
      const c = connect(idb);
      expect(await query(c, 'SELECT count(*) FROM t')).toBe(count);
      expect(await query(c, 'SELECT count(*) FROM t WHERE length(x) = 10')).toBe(0);
      expect(await query(c, 'SELECT length(x) FROM t WHERE rowid = 1')).toBe(500);
      expect((await exec(c, 'PRAGMA integrity_check')).rows).toEqual([['ok']]);
    }

    for (const synchronous of ['full', 'normal']) {
      for (const lockingMode of ['normal', 'exclusive']) {
        it(`should not keep an aborted commit with synchronous=${synchronous}, locking_mode=${lockingMode}`, async function() {
          const idb = `commit-abort-${Math.random().toString(36).slice(2)}`;
          const a = connect(idb);
          expect((await exec(a, ROWS)).error).toBeUndefined();
          await exec(a, `
            PRAGMA synchronous = ${synchronous};
            PRAGMA locking_mode = ${lockingMode};
            PRAGMA busy_timeout = 1000;`);
          expect(await query(a, 'SELECT count(*) FROM t')).toBe(200);

          // With synchronous=full the commit fails. With synchronous=normal
          // it has already returned when the abort arrives.
          await a({ type: 'abort-next-commit' });
          const aborted = await exec(a, ABORTED);
          expect(aborted.error !== undefined).toBe(synchronous === 'full');

          if (synchronous === 'normal' && lockingMode === 'exclusive') {
            // The lock is never released, so the first commit after the
            // abort is known fails, and the view is reloaded then.
            await a({ type: 'settle' });
            expect((await exec(a, 'INSERT INTO t VALUES (zeroblob(20))')).error).toBeDefined();
            expect(await query(a, 'SELECT count(*) FROM t WHERE length(x) = 20')).toBe(0);
          }
          expect((await exec(a, 'INSERT INTO t VALUES (zeroblob(20))')).error).toBeUndefined();
          expect(await query(a, 'SELECT count(*) FROM t')).toBe(201);
          await a({ type: 'close' });

          await expectStored(idb, 201);
        });
      }
    }

    it('should not store a commit queued behind an aborted one', async function() {
      const idb = `commit-abort-${Math.random().toString(36).slice(2)}`;
      const a = connect(idb);
      expect((await exec(a, ROWS)).error).toBeUndefined();
      await exec(a, 'PRAGMA synchronous = normal; PRAGMA locking_mode = exclusive');
      expect(await query(a, 'SELECT count(*) FROM t')).toBe(200);

      // The update is committed while the aborted transaction is pending.
      await a({ type: 'abort-next-commit', delay: 300 });
      expect((await exec(a, ABORTED)).error).toBeUndefined();
      expect((await exec(a, 'UPDATE t SET x = zeroblob(11) WHERE rowid = 1')).error).toBeUndefined();
      await a({ type: 'sleep', ms: 600 });
      expect((await exec(a, 'INSERT INTO t VALUES (zeroblob(20))')).error).toBeDefined();

      await a({ type: 'reopen' });
      expect(await query(a, 'SELECT length(x) FROM t WHERE rowid = 1')).toBe(500);
      expect((await exec(a, 'INSERT INTO t VALUES (zeroblob(20))')).error).toBeUndefined();
      await a({ type: 'close' });

      await expectStored(idb, 201);
    });

    it('should not play back a journal written on an aborted view', async function() {
      const idb = `commit-abort-${Math.random().toString(36).slice(2)}`;
      const a = connect(idb);
      expect((await exec(a, ROWS)).error).toBeUndefined();
      await exec(a, `
        PRAGMA synchronous = normal;
        PRAGMA locking_mode = exclusive;
        PRAGMA cache_size = 10;`);
      expect(await query(a, 'SELECT count(*) FROM t')).toBe(200);

      // A transaction larger than the cache writes a rollback journal
      // before its commit is refused, so only a reopen recovers.
      await a({ type: 'abort-next-commit' });
      expect((await exec(a, ABORTED)).error).toBeUndefined();
      await a({ type: 'settle' });
      expect((await exec(a, `
        BEGIN;
        WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM c WHERE i < 2000)
        INSERT INTO t SELECT randomblob(500) FROM c;
        COMMIT;`)).error).toBeDefined();

      await a({ type: 'reopen' });
      expect(await query(a, 'SELECT count(*) FROM t')).toBe(200);
      expect((await exec(a, 'INSERT INTO t VALUES (zeroblob(20))')).error).toBeUndefined();
      await a({ type: 'close' });

      await expectStored(idb, 201);
    });
  });
}
