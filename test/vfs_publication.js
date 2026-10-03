const ROWS = `
  CREATE TABLE t(x BLOB);
  WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM c WHERE i < 200)
  INSERT INTO t SELECT randomblob(500) FROM c;`;

/**
 * Changes held in a writable stream are invisible to other contexts until
 * it is closed, so they must be published before the lock is handed over,
 * whatever SQLite does before releasing it.
 * @param {{ build: string }} params
 */
export function vfs_publication({ build }) {
  describe('vfs_publication', function() {
    const workers = [];
    afterEach(function() {
      for (const worker of workers.splice(0)) worker.terminate();
    });

    function connect(filename) {
      const url = new URL('./vfs_publication-worker.js', import.meta.url);
      url.searchParams.set('build', build);
      url.searchParams.set('filename', filename);
      const worker = new Worker(url, { type: 'module' });
      workers.push(worker);
      const send = (message) => new Promise((resolve, reject) => {
        worker.addEventListener('message', ({ data }) => resolve(data), { once: true });
        worker.addEventListener('error', event => reject(new Error(event.message)), { once: true });
        worker.postMessage(message);
      });
      send.worker = worker;
      return send;
    }
    const exec = (context, sql) => context({ type: 'exec', sql });
    const count = async (context) => (await exec(context, 'SELECT count(*) FROM t')).rows[0][0];

    it('should keep another context\'s commit after a failed cache spill', async function() {
      const filename = `publication-${Math.random().toString(36).slice(2)}`;
      const a = connect(filename);
      expect((await exec(a, ROWS)).error).toBeUndefined();

      // A spills pages to the database, then a spill write fails. SQLite
      // gives up the transaction without syncing what it had written.
      await exec(a, 'PRAGMA cache_size = 10');
      await a({ type: 'fail-writes', after: 5 });
      const failed = await exec(a, `
        BEGIN;
        WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM c WHERE i < 2000)
        INSERT INTO t SELECT randomblob(500) FROM c;
        COMMIT;`);
      expect(failed.error).toBeDefined();
      await a({ type: 'heal' });

      // B rolls the hot journal back and commits.
      const b = connect(filename);
      expect(await count(b)).toBe(200);
      expect((await exec(b, 'INSERT INTO t VALUES (zeroblob(10))')).error).toBeUndefined();

      // A reads, and B's row must still be there for everyone.
      expect(await count(a)).toBe(201);
      expect(await count(b)).toBe(201);
      expect((await exec(b, 'PRAGMA integrity_check')).rows).toEqual([['ok']]);
    });

    it('should keep a commit in exclusive locking mode when the context goes away', async function() {
      const filename = `publication-${Math.random().toString(36).slice(2)}`;
      const a = connect(filename);
      expect((await exec(a, ROWS)).error).toBeUndefined();

      // In exclusive locking mode the lock is not released after a commit,
      // and with synchronous=OFF SQLite never calls xSync.
      await exec(a, 'PRAGMA locking_mode = EXCLUSIVE; PRAGMA synchronous = OFF');
      expect((await exec(a, 'INSERT INTO t VALUES (zeroblob(10))')).error).toBeUndefined();
      a.worker.terminate();

      const b = connect(filename);
      expect(await count(b)).toBe(201);
    });

    it('should publish a VACUUM with one copy of the database', async function() {
      const filename = `publication-${Math.random().toString(36).slice(2)}`;
      const a = connect(filename);
      expect((await exec(a, ROWS)).error).toBeUndefined();
      expect((await exec(a, 'DELETE FROM t WHERE rowid % 2 = 0')).error).toBeUndefined();

      await a({ type: 'writables' });
      expect((await exec(a, 'VACUUM')).error).toBeUndefined();

      // The truncation is visible from outside the context, before A does
      // anything else.
      const root = await navigator.storage.getDirectory();
      const file = await (await root.getFileHandle(filename)).getFile();
      expect((await a({ type: 'writables' })).n).toBe(1);
      const [[pageCount]] = (await exec(a, 'PRAGMA page_count')).rows;
      const [[pageSize]] = (await exec(a, 'PRAGMA page_size')).rows;
      expect(file.size).toBe(pageCount * pageSize);
    });
  });
}
