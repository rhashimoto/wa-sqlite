import * as SQLite from '../src/sqlite-api.js';
import { MemoryVFS } from '../src/examples/MemoryVFS.js';
import { MemoryAsyncVFS } from '../src/examples/MemoryAsyncVFS.js';
import { TestContext } from './TestContext.js';

// These tests call the API in the page rather than through the test
// worker: Comlink would turn every return value into a Promise.
//
// Classes are checked with instanceof rather than toBeInstanceOf() or
// toBeRejectedWithError(): the runner clones a failed expectation's
// expected value, a class cannot be cloned, and the run then never ends.
const BUILDS = new Map([
  ['default', '../dist/wa-sqlite.mjs'],
  ['asyncify', '../dist/wa-sqlite-async.mjs'],
]);
if (await TestContext.supportsJSPI()) {
  BUILDS.set('jspi', '../dist/wa-sqlite-jspi.mjs');
}

const ROWS = 100;
const QUERY = 'SELECT x FROM t ORDER BY x';

// What stepping QUERY to its end must give, call by call.
const EXPECTED_CODES = [...Array(ROWS).fill(SQLite.SQLITE_ROW), SQLite.SQLITE_DONE];
const EXPECTED_VALUES = Array.from({ length: ROWS }, (_, i) => i + 1);

// Answers SQLITE_BUSY to the next `busy` locks, each time with a retry
// operation queued, as OPFSCoopSyncVFS does while it waits for an
// access handle.
class BusyVFS extends MemoryVFS {
  busy = 0;
  refused = 0;

  jLock(fileId, lockType) {
    if (this.busy) {
      --this.busy;
      ++this.refused;
      this._module.retryOps.push(Promise.resolve());
      return SQLite.SQLITE_BUSY;
    }
    return super.jLock(fileId, lockType);
  }
}

// Grants the next lock but leaves an operation pending, settled on a
// later task: 'resolve' or 'reject'.
class PendingVFS extends MemoryVFS {
  pending = null;
  settled = false;

  jLock(fileId, lockType) {
    if (this.pending) {
      const outcome = this.pending;
      this.pending = null;
      this._module.pendingOps.push(new Promise((resolve, reject) => {
        setTimeout(() => {
          this.settled = true;
          if (outcome === 'reject') {
            reject(Object.assign(new Error('pending'), { code: SQLite.SQLITE_IOERR }));
          } else {
            resolve();
          }
        });
      }));
    }
    return super.jLock(fileId, lockType);
  }
}

describe('SQLite API step_asap', function() {
  for (const [build, path] of BUILDS) {
    describe(build, function() {
      let module, sqlite3, db, statements;
      beforeEach(async function() {
        const { default: moduleFactory } = await import(path);
        module = await moduleFactory();
        sqlite3 = SQLite.Factory(module);
        statements = [];
      });

      afterEach(async function() {
        for (const stmt of statements) await sqlite3.finalize(stmt);
        if (db) await sqlite3.close(db);
        db = null;
      });

      async function open(vfs) {
        await vfs.isReady?.();
        sqlite3.vfs_register(vfs, true);
        db = await sqlite3.open_v2('test');
        await sqlite3.exec(db, `
          CREATE TABLE t(x UNIQUE);
          WITH RECURSIVE r(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM r WHERE i < ${ROWS})
          INSERT INTO t SELECT i FROM r;
        `);
      }

      async function prepare(sql) {
        const iterator = sqlite3.statements(db, sql, { unscoped: true })[Symbol.asyncIterator]();
        const { value: stmt } = await iterator.next();
        await iterator.return();
        statements.push(stmt);
        return stmt;
      }

      // Calls step_asap() once, recording whether it returned a Promise
      // or threw, and what it gave.
      async function stepOnce(stmt) {
        try {
          const result = sqlite3.step_asap(stmt);
          if (result instanceof Promise) {
            return await result.then(
              code => ({ form: 'promise', code }),
              error => ({ form: 'promise', error }));
          }
          return { form: 'number', code: result };
        } catch (error) {
          return { form: 'throw', error };
        }
      }

      // Steps QUERY to its end with step_asap() and checks every call
      // against what the table holds. Returns the form of each call.
      async function stepQuery(stmt) {
        const forms = [];
        const codes = [];
        const values = [];
        while (codes.length < EXPECTED_CODES.length) {
          const { form, code, error } = await stepOnce(stmt);
          expect(error).toBeUndefined();
          forms.push(form);
          codes.push(code);
          if (code !== SQLite.SQLITE_ROW) break;
          values.push(sqlite3.column(stmt, 0));
        }
        expect(codes).toEqual(EXPECTED_CODES);
        expect(values).toEqual(EXPECTED_VALUES);
        return forms;
      }

      it('returns a number when nothing suspends, except with JSPI', async function() {
        await open(new MemoryVFS('memory', module));
        const forms = await stepQuery(await prepare(QUERY));

        // JSPI exports always return a Promise.
        const expected = build === 'jspi' ? 'promise' : 'number';
        expect(forms.every(form => form === expected)).toBeTrue();
      });

      if (build !== 'default') {
        it('returns a Promise when the VFS suspends', async function() {
          await open(new MemoryAsyncVFS('memory-async', module));
          const forms = await stepQuery(await prepare(QUERY));

          // Taking the lock suspends.
          expect(forms[0]).toBe('promise');
        });
      }

      it('returns a Promise when a retry operation was queued', async function() {
        const vfs = new BusyVFS('busy', module);
        await open(vfs);
        const stmt = await prepare(QUERY);

        // Preparing released the lock; the first step takes it again.
        vfs.busy = 1;
        const forms = await stepQuery(stmt);
        expect(vfs.refused).toBe(1);
        expect(forms[0]).toBe('promise');
      });

      it('gives up after a second refusal, as step() always did', async function() {
        const vfs = new BusyVFS('busy', module);
        await open(vfs);
        const stmt = await prepare(QUERY);

        vfs.busy = 2;
        const { form, error } = await stepOnce(stmt);
        expect(vfs.refused).toBe(2);
        expect(form).toBe('promise');
        expect(error instanceof SQLite.SQLiteError).toBeTrue();
        expect(error?.code).toBe(SQLite.SQLITE_BUSY);

        // The retry operation left queued is awaited by the next call.
        await sqlite3.reset(stmt).catch(() => {});
        const forms = await stepQuery(stmt);
        expect(forms[0]).toBe('promise');
      });

      it('returns a Promise when an operation was left pending', async function() {
        const vfs = new PendingVFS('pending', module);
        await open(vfs);
        const stmt = await prepare(QUERY);

        vfs.pending = 'resolve';
        const first = sqlite3.step_asap(stmt);
        expect(first instanceof Promise).toBeTrue();
        expect(vfs.settled).toBeFalse();
        expect(await first).toBe(SQLite.SQLITE_ROW);
        expect(vfs.settled).toBeTrue();
      });

      it('rejects with the code of a pending operation that failed', async function() {
        const vfs = new PendingVFS('pending', module);
        await open(vfs);
        const stmt = await prepare(QUERY);

        vfs.pending = 'reject';
        const { form, error } = await stepOnce(stmt);
        expect(form).toBe('promise');
        expect(error instanceof SQLite.SQLiteError).toBeTrue();
        expect(error?.code).toBe(SQLite.SQLITE_IOERR);
      });

      it('throws an error it meets synchronously, otherwise rejects', async function() {
        await open(new MemoryVFS('memory', module));
        const { form, error } = await stepOnce(await prepare('INSERT INTO t VALUES (1)'));
        expect(form).toBe(build === 'jspi' ? 'promise' : 'throw');
        expect(error instanceof SQLite.SQLiteError).toBeTrue();
        expect(error?.code).toBe(SQLite.SQLITE_CONSTRAINT);
      });

      it('throws on something that is not a statement', async function() {
        await open(new MemoryVFS('memory', module));
        const { form, error } = await stepOnce(0);
        expect(form).toBe('throw');
        expect(error instanceof SQLite.SQLiteError).toBeTrue();
        expect(error?.code).toBe(SQLite.SQLITE_MISUSE);
        expect(error?.message).toBe('not a statement');
      });

      it('leaves step() returning a Promise in every case', async function() {
        await open(new MemoryVFS('memory', module));
        const stmt = await prepare(QUERY);
        const codes = [];
        const values = [];
        while (codes.length < EXPECTED_CODES.length) {
          const result = sqlite3.step(stmt);
          expect(result instanceof Promise).toBeTrue();
          const code = await result;
          codes.push(code);
          if (code !== SQLite.SQLITE_ROW) break;
          values.push(sqlite3.column(stmt, 0));
        }
        expect(codes).toEqual(EXPECTED_CODES);
        expect(values).toEqual(EXPECTED_VALUES);

        const insert = await prepare('INSERT INTO t VALUES (1)');
        const rejected = sqlite3.step(insert);
        expect(rejected instanceof Promise).toBeTrue();
        const constraint = await rejected.then(() => null, e => e);
        expect(constraint instanceof SQLite.SQLiteError).toBeTrue();
        expect(constraint?.code).toBe(SQLite.SQLITE_CONSTRAINT);

        const misuse = sqlite3.step(0);
        expect(misuse instanceof Promise).toBeTrue();
        const notStatement = await misuse.then(() => null, e => e);
        expect(notStatement instanceof SQLite.SQLiteError).toBeTrue();
        expect(notStatement?.code).toBe(SQLite.SQLITE_MISUSE);
        expect(notStatement?.message).toBe('not a statement');
      });
    });
  }
});
