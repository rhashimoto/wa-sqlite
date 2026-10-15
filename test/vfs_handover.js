import * as Comlink from 'comlink';
import * as SQLite from '../src/sqlite-api.js';

const ITERATIONS = 100;
const ATTEMPTS = 10;
const ORPHANS = 30;
const ROUNDS = 10;
const QUERY_BOUND_MS = 10_000;
const LONG_QUERY = `
  WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 10000000)
  SELECT count(*) FROM c`;

/**
 * Handle hand-over between connections of a VFS that rotates one access
 * handle, each connection in its own worker.
 * @param {import('./TestContext.js').TestContext} context
 * @param {{ build: string, config: string }} params
 */
export function vfs_handover(context, { build, config }) {
  describe('vfs_handover', function() {
    beforeAll(async function() {
      // Clear persistent storage.
      const proxy = await context.create();
      await context.destroy(proxy);
    });

    const cleanup = [];
    beforeEach(async function() {
      cleanup.splice(0);
    });

    afterEach(async function() {
      for (const fn of cleanup.reverse()) {
        await fn();
      }
    });

    it('should not return SQLITE_BUSY from a re-prepared statement', async function() {
      const connections = [];
      for (let i = 0; i < 2; ++i) {
        const proxy = await context.create({ reset: false });
        const sqlite3 = proxy.sqlite3;
        const db = await sqlite3.open_v2('demo');
        connections.push({ sqlite3, db });
        cleanup.push(async () => {
          await sqlite3.close(db);
          await context.destroy(proxy);
        });
      }
      const [a, b] = connections;
      await a.sqlite3.exec(a.db, 'CREATE TABLE IF NOT EXISTS t(x)');

      // A keeps one statement prepared while B changes the schema, so each
      // step after a change re-prepares it: lock, unlock and lock again
      // within one sqlite3_step call, while B keeps asking for the handle.
      const statements = await a.sqlite3.statements(
        a.db, 'SELECT count(*) FROM sqlite_master', { unscoped: true });
      const { value: stmt } = await statements.next();
      cleanup.push(() => a.sqlite3.finalize(stmt));

      let busy = 0;
      async function countBusy(f) {
        try {
          await f();
        } catch (e) {
          if (e.message !== 'database is locked') throw e;
          ++busy;
        }
      }

      await Promise.all([
        (async function() {
          for (let i = 0; i < ITERATIONS; ++i) {
            await countBusy(() => b.sqlite3.exec(b.db, `CREATE TABLE t${i}(x)`));
          }
        })(),
        (async function() {
          for (let i = 0; i < ITERATIONS; ++i) {
            await countBusy(async () => {
              try {
                while (await a.sqlite3.step(stmt) === SQLite.SQLITE_ROW);
              } finally {
                // sqlite3_reset reports the last step's error again.
                await a.sqlite3.reset(stmt).catch(() => {});
              }
            });
          }
        })()
      ]);

      expect(busy).toBe(0);
    });

    it('should tolerate temporary directories another instance deleted', async function() {
      const root = await navigator.storage.getDirectory();
      const failures = [];
      for (let attempt = 0; attempt < ATTEMPTS; ++attempt) {
        // No lock protects these, so every initializing instance deletes
        // them -- both instances at once, over the same list.
        for (let i = 0; i < ORPHANS; ++i) {
          await root.getDirectoryHandle(`.ahp-orphan-${attempt}-${i}`, { create: true });
        }

        const results = await Promise.allSettled([
          startInstance(build, config),
          startInstance(build, config)
        ]);
        for (const result of results) {
          if (result.status === 'fulfilled') {
            result.value.worker.terminate();
          } else {
            failures.push(`${result.reason.name}: ${result.reason.message}`);
          }
        }
      }

      expect(failures).toEqual([]);
    });

    it('should acquire the handle of a connection terminated mid-call', async function() {
      // A connection holds the access handle for the whole of a call. When
      // its worker is terminated mid-call, its Web Lock is released at once
      // but its access handle only later, so the connection queued on that
      // lock can be granted it while the file is still held.
      const failures = [];
      for (let round = 0; round < ROUNDS; ++round) {
        const filename = `terminated-${round}`;
        const b = await context.create({ reset: false });
        let a;
        try {
          const dbB = await b.sqlite3.open_v2(filename);
          await b.sqlite3.exec(dbB, 'CREATE TABLE IF NOT EXISTS t(x)');

          // A takes the handle at its open, and keeps it while it counts.
          a = await connect(build, config);
          const dbA = await a.sqlite3.open_v2(filename);
          a.sqlite3.exec(dbA, LONG_QUERY).catch(() => {});
          await new Promise(resolve => setTimeout(resolve, 200));

          // B asks for the handle and queues on the lock A holds. A's worker
          // is then terminated as it is, with no chance to close anything.
          const query = b.sqlite3.exec(dbB, 'SELECT count(*) FROM t');
          await new Promise(resolve => setTimeout(resolve, 100));
          a.terminate();

          // Bounded, so that a query that never settles is reported here
          // rather than left running into the next test.
          const outcome = await Promise.race([
            query.then(() => null, e => `${e.name}: ${e.message}`),
            new Promise(resolve => setTimeout(() => resolve('hung'), QUERY_BOUND_MS))
          ]);
          if (outcome) failures.push(outcome);
          if (outcome !== 'hung') await b.sqlite3.close(dbB);
        } finally {
          a?.terminate();
          await context.destroy(b);
        }
      }

      expect(failures).toEqual([]);
    });
  });
}

/**
 * Starts a test worker and returns its SQLite API with a way to terminate
 * the worker directly, whatever TestContext.destroy() does first.
 * @param {string} build
 * @param {string} config
 */
async function connect(build, config) {
  const { worker, port } = await startInstance(build, config);
  return { sqlite3: Comlink.wrap(port).sqlite3, terminate: () => worker.terminate() };
}

/**
 * Starts a test worker and settles once the SQLite instance and its VFS
 * are ready. Unlike TestContext.create(), a failed start rejects.
 * @param {string} build
 * @param {string} config
 * @returns {Promise<{ worker: Worker, port: MessagePort }>}
 */
function startInstance(build, config) {
  const url = new URL('./test-worker.js', import.meta.url);
  url.searchParams.set('build', build);
  url.searchParams.set('config', config);
  url.searchParams.set('reset', 'false');
  const worker = new Worker(url, { type: 'module' });
  return new Promise((resolve, reject) => {
    worker.addEventListener('message', ({ data, ports }) => {
      if (ports[0]) {
        resolve({ worker, port: ports[0] });
      } else {
        worker.terminate();
        reject(Object.assign(new Error(data?.message), data));
      }
    }, { once: true });
  });
}
