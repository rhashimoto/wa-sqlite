import * as Comlink from 'comlink';

function storedBlockOffsets(idbName, path) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(idbName);
    request.onsuccess = () => {
      const idb = request.result;
      const keys = idb.transaction('blocks', 'readonly')
        .objectStore('blocks').getAllKeys();
      keys.onsuccess = () => {
        resolve(keys.result.filter(([p]) => p === path).map(([, o]) => o));
        idb.close();
      };
      keys.onerror = () => reject(keys.error);
    };
    request.onerror = () => reject(request.error);
  });
}

export function vfs_leak(context) {
  describe('vfs_leak', function() {
    let proxy, sqlite3, db;
    beforeEach(async function() {
      proxy = await context.create();
      sqlite3 = proxy.sqlite3;
      db = await sqlite3.open_v2('leak-test');
    });
    afterEach(async function() {
      await sqlite3.close(db);
      await context.destroy(proxy);
    });

    it('should not keep blocks past the end of the database', async function() {
      await sqlite3.exec(db, 'CREATE TABLE t(x)');
      await sqlite3.exec(db, `
        INSERT INTO t WITH RECURSIVE c(x) AS
          (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 200000)
        SELECT x FROM c`);
      // Shrink the database back down. Nothing here is rolled back, so this
      // reaches the same truncation without depending on anything else.
      await sqlite3.exec(db, 'DELETE FROM t');
      await sqlite3.exec(db, 'VACUUM');

      let pageCount = 0;
      await sqlite3.exec(db, 'PRAGMA page_count',
        Comlink.proxy(row => { pageCount = row[0]; }));
      const offsets = await storedBlockOffsets('demo', '/leak-test');
      expect(offsets.length).toEqual(pageCount);
    });
  });
}
