import * as SQLite from '../src/sqlite-api.js';

export function api_prepare(context) {
  describe('prepare', function() {
    let sqlite3, db;
    beforeEach(async function() {
      ({ sqlite3 } = await context.create());
      db = await sqlite3.open_v2('demo');
    });

    afterEach(async function() {
      await sqlite3.close(db);
      await context.destroy();
    });

    it('should prepare a statement', async function() {
      const sql = 'SELECT 42';

      let rc;
      const str = await sqlite3.str_new(db, sql);
      let prepared = { stmt: null, sql: await sqlite3.str_value(str) };
      try {
        while (prepared = await sqlite3.prepare_v2(db, prepared.sql)) {
          // Execute the statement twice to check reset().
          for (let i = 0; i < 2; i++) {
            while (await sqlite3.step(prepared.stmt) === SQLite.SQLITE_ROW) {
              const column = await sqlite3.column_int(prepared.stmt, 0);
              expect(column).toBe(42);
            }
            await sqlite3.reset(prepared.stmt);
          }

          rc = await sqlite3.finalize(prepared.stmt);
          expect(rc).toBe(SQLite.SQLITE_OK);
          prepared.stmt = null;
        }
      } finally {
        if (prepared?.stmt) {
          rc = await sqlite3.finalize(prepared.stmt);
          expect(rc).toBe(SQLite.SQLITE_OK);
        }
        await sqlite3.str_finish(str);
      }
    });
  });
};