const CALL_BOUND_MS = 10000;

/**
 * The rollback journal of OPFSAdaptiveVFS on engines without readwrite-unsafe
 * access handles: kept open with its database between transactions, handed
 * over with it, and still rolled back when its connection is terminated.
 * @param {{ build: string }} params
 */
export function vfs_journal_handle({ build }) {
  describe('vfs_journal_handle', function() {
    const cleanup = [];
    afterEach(async function() {
      for (const fn of cleanup.splice(0).reverse()) {
        await fn();
      }
    });

    function connect() {
      const url = new URL('./vfs_journal_handle-worker.js', import.meta.url);
      url.searchParams.set('build', build);
      const worker = new Worker(url, { type: 'module' });
      cleanup.push(() => worker.terminate());
      const call = (op, args = {}) => new Promise((resolve, reject) => {
        const bound = setTimeout(() => reject(new Error(`${op} hung`)), CALL_BOUND_MS);
        worker.addEventListener('message', ({ data }) => {
          clearTimeout(bound);
          if (data.ok) resolve(data.value);
          else reject(new Error(data.error));
        }, { once: true });
        worker.postMessage({ op, ...args });
      });
      return { call, terminate: () => worker.terminate() };
    }

    async function newFilename() {
      const filename = `journal-handle-${Math.random().toString(36).slice(2)}`;
      const root = await navigator.storage.getDirectory();
      cleanup.push(async () => {
        for (const name of [filename, `${filename}-journal`]) {
          await root.removeEntry(name).catch(() => {});
        }
      });
      return filename;
    }

    it('should not create or remove the journal at every write transaction',
      async function() {
        const filename = await newFilename();
        const connection = connect();
        await connection.call('open', { filename });
        await connection.call('exec', { sql: 'CREATE TABLE t(x)' });
        await connection.call('exec', { sql: 'INSERT INTO t VALUES (0)' });

        // Count from here: the first transactions created the journal.
        await connection.call('takeJournalCalls');
        for (let i = 1; i <= 5; i++) {
          await connection.call('exec', { sql: `INSERT INTO t VALUES (${i})` });
        }
        expect(await connection.call('takeJournalCalls'))
          .toEqual({ createSyncAccessHandle: 0, removeEntry: 0 });
        expect(await connection.call('exec', { sql: 'SELECT count(*) FROM t' }))
          .toEqual([[6]]);
      });

    it('should hand the journal over between connections', async function() {
      const filename = await newFilename();
      const a = connect();
      const b = connect();
      await a.call('open', { filename });
      await a.call('exec', { sql: 'CREATE TABLE t(x)' });
      await b.call('open', { filename });
      for (let i = 0; i < 5; i++) {
        await a.call('exec', { sql: `INSERT INTO t VALUES ('a${i}')` });
        await b.call('exec', { sql: `INSERT INTO t VALUES ('b${i}')` });
      }
      await a.call('exec', { sql: "BEGIN; INSERT INTO t VALUES ('rolled back'); ROLLBACK" });

      expect(await a.call('exec', { sql: 'SELECT count(*) FROM t' })).toEqual([[10]]);
      expect(await b.call('exec', { sql: 'SELECT count(*) FROM t' })).toEqual([[10]]);
      expect(await b.call('exec', { sql: 'PRAGMA integrity_check' })).toEqual([['ok']]);
    });

    it('should roll back the journal of a terminated connection', async function() {
      const filename = await newFilename();
      const a = connect();
      await a.call('open', { filename });
      await a.call('exec', {
        sql: `
          CREATE TABLE t(v);
          WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM c WHERE i < 200)
            INSERT INTO t SELECT printf('%.500c', 'c') FROM c;`
      });
      await a.call('exec', { sql: "INSERT INTO t VALUES (printf('%.500c', 'c'))" });

      // With a cache of two pages, the update writes the rows it changes to
      // the database file before any commit, so only the journal holds them.
      await a.call('exec', { sql: 'PRAGMA cache_size = 2' });
      await a.call('exec', { sql: "BEGIN; UPDATE t SET v = printf('%.500c', 'y')" });
      a.terminate();

      const b = connect();
      await b.call('waitUntilFree', { filename });
      await b.call('waitUntilFree', { filename: `${filename}-journal` });
      await b.call('open', { filename });
      expect(await b.call('exec', { sql: "SELECT count(*), sum(v GLOB 'c*') FROM t" }))
        .toEqual([[201, 201]]);
      expect(await b.call('exec', { sql: 'PRAGMA integrity_check' })).toEqual([['ok']]);
    });
  });
}
