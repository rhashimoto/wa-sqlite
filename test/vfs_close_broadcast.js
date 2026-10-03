/**
 * A commit still in flight when its connection closes must reach the
 * other connections, which otherwise read a stale view until they write.
 * @param {{ build: string }} params
 */
export function vfs_close_broadcast({ build }) {
  describe('vfs_close_broadcast', function() {
    const workers = [];
    afterEach(function() {
      for (const worker of workers.splice(0)) worker.terminate();
    });

    function connect(idb) {
      const url = new URL('./vfs_close_broadcast-worker.js', import.meta.url);
      url.searchParams.set('build', build);
      url.searchParams.set('idb', idb);
      const worker = new Worker(url, { type: 'module' });
      workers.push(worker);
      const context = (message) => new Promise((resolve, reject) => {
        worker.addEventListener('message', ({ data }) => resolve(data), { once: true });
        worker.addEventListener('error', event => reject(new Error(event.message)), { once: true });
        worker.postMessage(message);
      });
      context.worker = worker;
      return context;
    }
    const exec = (context, sql) => context({ type: 'exec', sql });
    const count = async (context) => (await exec(context, 'SELECT count(*) FROM t')).rows[0][0];

    // A reader sees a broadcast commit without taking a lock to write.
    async function readerSees(reader, expected) {
      const deadline = Date.now() + 1000;
      let n = await count(reader);
      while (n !== expected && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
        n = await count(reader);
      }
      return n;
    }

    for (const synchronous of ['full', 'normal']) {
      for (const terminate of [false, true]) {
        it(`should broadcast a commit made just before close with synchronous=${synchronous}${terminate ? ', worker terminated' : ''}`, async function() {
          const idb = `close-broadcast-${Math.random().toString(36).slice(2)}`;
          const a = connect(idb);
          expect((await exec(a, 'CREATE TABLE t(x); INSERT INTO t VALUES (0)')).error).toBeUndefined();
          const b = connect(idb);
          expect(await count(b)).toBe(1);

          await exec(a, `PRAGMA synchronous = ${synchronous}`);
          expect((await a({ type: 'exec-close', sql: 'INSERT INTO t VALUES (1)' })).error).toBeUndefined();
          if (terminate) {
            a.worker.terminate();
          }

          expect(await readerSees(b, 2)).toBe(2);
          if (!terminate) {
            expect((await a({ type: 'uncaught' })).uncaught).toEqual([]);
          }
        });
      }
    }
  });
}
