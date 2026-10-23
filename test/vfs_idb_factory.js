import { TestContext } from "./TestContext.js";
import { supportsStorageBuckets, TEST_BUCKET } from "./customFactory.js";

const ANSWER_MS = 10_000;
const WAIT_MS = 3_000;
const DEFAULT_NAME = 'vfs-idb-factory-test';

/**
 * A VFS given the getIDBFactory option keeps its database in that factory,
 * and with the prefix option shares no locks or messages with a file of the
 * same name elsewhere.
 * @param {{ config: string }} params VFS class name
 */
export function vfs_idb_factory({ config }) {
  describe('vfs_idb_factory', function() {
    const workers = [];
    beforeEach(async function() {
      // Starting a test worker clears IndexedDB and the test bucket.
      const context = new TestContext();
      await context.destroy(await context.create());
    });

    afterEach(function() {
      for (const worker of workers.splice(0)) worker.terminate();
    });

    /**
     * @param {{ filename: string, bucket?: string, rejectFactory?: boolean }} params
     * @returns {(message: object) => Promise<any>}
     */
    function connect({ filename, bucket, rejectFactory }) {
      const url = new URL('./vfs_idb_factory-worker.js', import.meta.url);
      url.searchParams.set('config', config);
      url.searchParams.set('filename', filename);
      if (bucket !== undefined) {
        url.searchParams.set('bucket', bucket);
      }
      if (rejectFactory) {
        url.searchParams.set('rejectFactory', '');
      }
      const worker = new Worker(url, { type: 'module' });
      workers.push(worker);
      return (message) => new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`no answer to ${JSON.stringify(message)}`)),
          ANSWER_MS);
        worker.addEventListener('message', ({ data }) => {
          clearTimeout(timer);
          resolve(data);
        }, { once: true });
        worker.addEventListener('error', (event) => {
          clearTimeout(timer);
          reject(new Error(`worker error: ${event.message}`));
        }, { once: true });
        worker.postMessage(message);
      });
    }

    it('should keep its database in the factory', async function() {
      if (!supportsStorageBuckets()) {
        pending('no Storage Buckets');
        return;
      }
      const db = connect({ filename: 'in-bucket', bucket: TEST_BUCKET });
      expect(await db({
        type: 'exec',
        sql: `CREATE TABLE t(x); INSERT INTO t VALUES ('bucket')`
      })).toEqual({ rows: [] });
      expect(await db({ type: 'close' })).toEqual({});

      // @ts-ignore
      const bucket = await navigator.storageBuckets.open(TEST_BUCKET);
      const inBucket = await bucket.indexedDB.databases();
      const inDefault = await indexedDB.databases();
      expect(inBucket.map(({ name }) => name)).toContain(DEFAULT_NAME);
      expect(inDefault.map(({ name }) => name)).not.toContain(DEFAULT_NAME);
    });

    it('should keep apart from a database of the same name in the default factory', async function() {
      if (!supportsStorageBuckets()) {
        pending('no Storage Buckets');
        return;
      }
      const inBucket = connect({ filename: 'same-name', bucket: TEST_BUCKET });
      const inDefault = connect({ filename: 'same-name' });
      await inBucket({ type: 'exec', sql: `CREATE TABLE t(x); INSERT INTO t VALUES ('bucket')` });
      await inDefault({ type: 'exec', sql: `CREATE TABLE t(x); INSERT INTO t VALUES ('default')` });

      // A write while the other connection is open, then time for any message
      // it sends to arrive.
      await inDefault({ type: 'exec', sql: `INSERT INTO t VALUES ('default')` });
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(await inBucket({ type: 'exec', sql: 'SELECT x FROM t' }))
        .toEqual({ rows: [['bucket']] });
      expect(await inDefault({ type: 'exec', sql: 'SELECT x FROM t' }))
        .toEqual({ rows: [['default'], ['default']] });
    });

    it('should not wait for a transaction on a file of the same name in the default factory', async function() {
      if (!supportsStorageBuckets()) {
        pending('no Storage Buckets');
        return;
      }
      const inBucket = connect({ filename: 'same-name', bucket: TEST_BUCKET });
      const inDefault = connect({ filename: 'same-name' });
      await inBucket({ type: 'exec', sql: 'CREATE TABLE t(x)' });
      await inDefault({ type: 'exec', sql: 'CREATE TABLE t(x)' });

      // The connection in the bucket holds a write transaction open.
      await inBucket({ type: 'exec', sql: `BEGIN IMMEDIATE; INSERT INTO t VALUES ('bucket')` });
      const result = await Promise.race([
        inDefault({ type: 'exec', sql: `INSERT INTO t VALUES ('default')` }),
        new Promise(resolve => setTimeout(() => resolve('waited'), WAIT_MS)),
      ]);
      expect(result).toEqual({ rows: [] });

      expect(await inBucket({ type: 'exec', sql: 'COMMIT' })).toEqual({ rows: [] });
      expect(await inBucket({ type: 'exec', sql: 'SELECT x FROM t' }))
        .toEqual({ rows: [['bucket']] });
    });

    it('should fail to open when getIDBFactory fails', async function() {
      const db = connect({ filename: 'x', rejectFactory: true });
      expect(await db({ type: 'ready' }))
        .toEqual({ error: 'no factory for the test', name: 'NotAllowedError' });
    });
  });
}
