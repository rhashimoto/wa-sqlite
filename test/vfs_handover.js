import * as SQLite from '../src/sqlite-api.js';

const ITERATIONS = 100;
const ATTEMPTS = 10;
const ORPHANS = 30;

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
            result.value.terminate();
          } else {
            failures.push(`${result.reason.name}: ${result.reason.message}`);
          }
        }
      }

      expect(failures).toEqual([]);
    });
  });
}

/**
 * Starts a test worker and settles once the SQLite instance and its VFS
 * are ready. Unlike TestContext.create(), a failed start rejects.
 * @param {string} build
 * @param {string} config
 * @returns {Promise<Worker>}
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
        resolve(worker);
      } else {
        worker.terminate();
        reject(Object.assign(new Error(data?.message), data));
      }
    }, { once: true });
  });
}
