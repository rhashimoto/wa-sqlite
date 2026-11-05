import * as Comlink from 'comlink';

// The committed state. It is larger than SQLite's default 2 MB page cache,
// so a connection that has read it still reads most of it from the file.
const ROWS = 4000;
const COMMITTED = `
  CREATE TABLE t(id INTEGER PRIMARY KEY, x TEXT);
  WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM c WHERE i < ${ROWS})
  INSERT INTO t SELECT i, printf('%01000d', i) FROM c`;

// A transaction that is never committed. It changes more than the page cache
// holds, so SQLite writes changed pages to the database file before any
// commit, after saving the original pages in the rollback journal.
const UNFINISHED = `
  BEGIN IMMEDIATE;
  UPDATE t SET x = printf('%02000d', id)`;

const AS_COMMITTED = { integrity: ['ok'], rows: [ROWS], changed: [0] };

/**
 * A transaction whose connection is terminated before it commits leaves a
 * hot journal. Every other connection must roll it back before it reads,
 * whether it opened the database before or after that.
 * @param {{ build: string, config: string }} params
 */
export function vfs_hot_journal({ build, config }) {
  describe('vfs_hot_journal', function() {
    const terminators = [];
    afterEach(function() {
      for (const terminate of terminators.splice(0)) terminate();
    });

    // Each connection is in a worker of its own.
    async function open(filename) {
      const { sqlite3, terminate } = await connect(build, config);
      terminators.push(terminate);
      return { sqlite3, terminate, db: await sqlite3.open_v2(filename) };
    }

    // What a connection reads. A read that fails is reported as its error.
    async function read({ sqlite3, db }) {
      const column = async sql => {
        const values = [];
        try {
          await sqlite3.exec(db, sql, Comlink.proxy(row => { values.push(row[0]); }));
        } catch (e) {
          values.push(e.message);
        }
        return values;
      };
      return {
        integrity: await column('PRAGMA integrity_check(1)'),
        rows: await column('SELECT count(*) FROM t'),
        changed: await column('SELECT count(*) FROM t WHERE length(x) <> 1000'),
      };
    }

    it('should be rolled back by a connection opened afterwards', async function() {
      const filename = `hot-journal-${Math.random().toString(36).slice(2)}`;
      const writer = await open(filename);
      await writer.sqlite3.exec(writer.db, COMMITTED);

      await writer.sqlite3.exec(writer.db, UNFINISHED);
      writer.terminate();

      const survivor = await open(filename);
      expect(await read(survivor)).toEqual(AS_COMMITTED);
    });

    it('should be rolled back by a connection that was already open', async function() {
      const filename = `hot-journal-${Math.random().toString(36).slice(2)}`;
      const writer = await open(filename);
      await writer.sqlite3.exec(writer.db, COMMITTED);

      // The survivor opens and reads while there is no journal.
      const survivor = await open(filename);
      expect(await read(survivor)).toEqual(AS_COMMITTED);

      await writer.sqlite3.exec(writer.db, UNFINISHED);
      writer.terminate();

      expect(await read(survivor)).toEqual(AS_COMMITTED);
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
