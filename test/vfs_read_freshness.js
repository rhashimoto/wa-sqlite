const BLOCK_MS = 1500;

/**
 * With PRAGMA wal_read_latest, a read on one connection must see a
 * transaction another connection has already committed, however soon the
 * read starts.
 * @param {{ build: string }} params
 */
export function vfs_read_freshness({ build }) {
  describe('vfs_read_freshness', function() {
    const workers = [];
    afterEach(function() {
      for (const worker of workers.splice(0)) worker.terminate();
    });

    function connect(filename) {
      const url = new URL('./vfs_read_freshness-worker.js', import.meta.url);
      url.searchParams.set('build', build);
      url.searchParams.set('filename', filename);
      const worker = new Worker(url, { type: 'module' });
      workers.push(worker);
      return (message) => new Promise((resolve, reject) => {
        worker.addEventListener('message', ({ data }) => {
          if (data.error) reject(new Error(data.error));
          else resolve(data);
        }, { once: true });
        worker.addEventListener('error', event => reject(new Error(event.message)), { once: true });
        worker.postMessage(message);
      });
    }

    it('should see a transaction committed before the read began', async function() {
      const filename = `read-freshness-${Math.random().toString(36).slice(2)}`;
      const writer = connect(filename);
      const reader = connect(filename);

      await writer({ type: 'exec', sql: 'CREATE TABLE t(x); INSERT INTO t VALUES (1)' });
      // Idle long enough for the reader's context to deliver that broadcast,
      // then the reader reads once, taking the read lock that it then keeps.
      await new Promise(resolve => setTimeout(resolve, 200));
      expect((await reader({ type: 'count' })).n).toBe(1);

      // The reader blocks its event loop and then reads. The writer commits
      // while it is blocked, so the transaction broadcast is still queued in
      // the reader's context when its read transaction begins.
      const blocked = reader({ type: 'block-then-count', ms: BLOCK_MS });
      await writer({ type: 'exec', sql: 'INSERT INTO t VALUES (2)' });
      const committed = performance.timeOrigin + performance.now();
      const { n, blockEnd } = await blocked;

      // Guard against a vacuous pass: the commit must have completed before
      // the reader began its read.
      expect(committed).toBeLessThan(blockEnd);
      expect(n).toBe(2);

      await reader({ type: 'close' });
      await writer({ type: 'close' });
    });
  });
}
