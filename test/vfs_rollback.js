import * as Comlink from 'comlink';

/**
 * A rollback of a transaction large enough to spill the page cache. SQLite
 * then journals the pages it writes, and stamps the journal header once they
 * are on disk; the rollback reads that header back to undo them.
 * @param {import('./TestContext.js').TestContext} context
 */
export function vfs_rollback(context) {
  describe('vfs_rollback', function() {
    let proxy, sqlite3, db;
    beforeEach(async function() {
      proxy = await context.create();
      sqlite3 = proxy.sqlite3;
      db = await sqlite3.open_v2('rollback-test');
    });

    afterEach(async function() {
      await sqlite3.close(db);
      await context.destroy(proxy);
    });

    it('should undo a transaction that spilled the page cache', async function() {
      await sqlite3.exec(db, 'CREATE TABLE t(x)');
      await sqlite3.exec(db, "INSERT INTO t VALUES ('before')");

      // Large enough that SQLite must write pages before the commit, which
      // is what makes it journal them.
      await sqlite3.exec(db, 'BEGIN');
      await sqlite3.exec(db, `
        INSERT INTO t WITH RECURSIVE c(x) AS
          (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 200000)
        SELECT x FROM c`);
      await sqlite3.exec(db, 'ROLLBACK');

      const integrity = [];
      await sqlite3.exec(db, 'PRAGMA integrity_check',
        Comlink.proxy(row => { integrity.push(row[0]); }));
      expect(integrity).toEqual(['ok']);

      const rows = [];
      await sqlite3.exec(db, 'SELECT x FROM t',
        Comlink.proxy(row => { rows.push(row[0]); }));
      expect(rows).toEqual(['before']);
    });
  });
}
