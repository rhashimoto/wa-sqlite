import { TestContext } from "./TestContext.js";
import { TEST_ROOT_DIRECTORY } from "./customRoot.js";

const ANSWER_MS = 10_000;
const WAIT_MS = 3_000;

/**
 * A VFS given the getRoot option keeps its files under that directory, and
 * with the lockPrefix option shares no locks or messages with a file of the
 * same name under the default root.
 * @param {{ config: string }} params VFS class name
 */
export function vfs_root({ config }) {
  describe('vfs_root', function() {
    const workers = [];
    beforeEach(async function() {
      // Starting a test worker clears the origin private file system.
      const context = new TestContext();
      await context.destroy(await context.create());
    });

    afterEach(function() {
      for (const worker of workers.splice(0)) worker.terminate();
    });

    /**
     * @param {{ filename: string, root?: string, rejectRoot?: boolean }} params
     * @returns {(message: object) => Promise<any>}
     */
    function connect({ filename, root, rejectRoot }) {
      const url = new URL('./vfs_root-worker.js', import.meta.url);
      url.searchParams.set('config', config);
      url.searchParams.set('filename', filename);
      if (root !== undefined) {
        url.searchParams.set('root', root);
      }
      if (rejectRoot) {
        url.searchParams.set('rejectRoot', '');
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

    it('should keep its files under the root directory', async function() {
      const db = connect({ filename: 'under-root', root: TEST_ROOT_DIRECTORY });
      expect(await db({
        type: 'exec',
        sql: `CREATE TABLE t(x); INSERT INTO t VALUES ('root')`
      })).toEqual({ rows: [] });
      expect(await db({ type: 'close' })).toEqual({});

      const paths = await listAll(await navigator.storage.getDirectory());
      expect(paths.length).toBeGreaterThan(1);
      // Every entry is the root directory or below it.
      expect(paths.filter(path =>
        path !== TEST_ROOT_DIRECTORY && !path.startsWith(`${TEST_ROOT_DIRECTORY}/`)))
        .toEqual([]);
      if (config !== 'AccessHandlePoolVFS') {
        // AccessHandlePoolVFS stores files under generated names.
        expect(paths).toContain(`${TEST_ROOT_DIRECTORY}/under-root`);
      }
    });

    it('should keep apart from a file of the same name under the default root', async function() {
      const underRoot = connect({ filename: 'same-name', root: TEST_ROOT_DIRECTORY });
      const inDefault = connect({ filename: 'same-name' });
      await underRoot({ type: 'exec', sql: `CREATE TABLE t(x); INSERT INTO t VALUES ('root')` });
      await inDefault({ type: 'exec', sql: `CREATE TABLE t(x); INSERT INTO t VALUES ('default')` });

      // A write while the other connection is open, then time for any message
      // it sends to arrive.
      await inDefault({ type: 'exec', sql: `INSERT INTO t VALUES ('default')` });
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(await underRoot({ type: 'exec', sql: 'SELECT x FROM t' }))
        .toEqual({ rows: [['root']] });
      expect(await inDefault({ type: 'exec', sql: 'SELECT x FROM t' }))
        .toEqual({ rows: [['default'], ['default']] });
    });

    it('should not wait for a transaction on a file of the same name under the default root', async function() {
      const underRoot = connect({ filename: 'same-name', root: TEST_ROOT_DIRECTORY });
      const inDefault = connect({ filename: 'same-name' });
      await underRoot({ type: 'exec', sql: 'CREATE TABLE t(x)' });
      await inDefault({ type: 'exec', sql: 'CREATE TABLE t(x)' });

      // The connection under the root holds a write transaction open.
      await underRoot({ type: 'exec', sql: `BEGIN IMMEDIATE; INSERT INTO t VALUES ('root')` });
      const result = await Promise.race([
        inDefault({ type: 'exec', sql: `INSERT INTO t VALUES ('default')` }),
        new Promise(resolve => setTimeout(() => resolve('waited'), WAIT_MS)),
      ]);
      expect(result).toEqual({ rows: [] });

      expect(await underRoot({ type: 'exec', sql: 'COMMIT' })).toEqual({ rows: [] });
      expect(await underRoot({ type: 'exec', sql: 'SELECT x FROM t' }))
        .toEqual({ rows: [['root']] });
    });

    it('should fail to open when getRoot fails', async function() {
      const db = connect({ filename: 'x', rejectRoot: true });
      expect(await db({ type: 'ready' }))
        .toEqual({ error: 'no root for the test', name: 'NotAllowedError' });
    });
  });
}

/**
 * @param {FileSystemDirectoryHandle} directory
 * @returns {Promise<string[]>} paths of every entry below the directory
 */
async function listAll(directory, prefix = '') {
  const paths = [];
  // @ts-ignore
  for await (const [name, handle] of directory.entries()) {
    paths.push(prefix + name);
    if (handle.kind === 'directory') {
      paths.push(...await listAll(handle, `${prefix}${name}/`));
    }
  }
  return paths.sort();
}
