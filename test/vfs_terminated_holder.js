import * as Comlink from 'comlink';

const ROUNDS = 10;
const QUERY_BOUND_MS = 10_000;
const LONG_QUERY = `
  WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 10000000)
  SELECT count(*) FROM c`;

/**
 * Handle hand-over from a connection whose worker is terminated mid-call,
 * each connection in its own worker.
 * @param {import('./TestContext.js').TestContext} context
 * @param {{ build: string, config: string }} params
 */
export function vfs_terminated_holder(context, { build, config }) {
  describe('vfs_terminated_holder', function() {
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
  const url = new URL('./test-worker.js', import.meta.url);
  url.searchParams.set('build', build);
  url.searchParams.set('config', config);
  url.searchParams.set('reset', 'false');
  const worker = new Worker(url, { type: 'module' });
  const port = await new Promise((resolve, reject) => {
    worker.addEventListener('message', ({ data, ports }) => {
      if (ports[0]) {
        resolve(ports[0]);
      } else {
        worker.terminate();
        reject(Object.assign(new Error(data?.message), data));
      }
    }, { once: true });
  });
  return { sqlite3: Comlink.wrap(port).sqlite3, terminate: () => worker.terminate() };
}
