import * as Comlink from 'comlink';
import { TestContext } from "./TestContext.js";
import { vfs_xOpen } from "./vfs_xOpen.js";
import { vfs_xAccess } from "./vfs_xAccess.js";
import { vfs_xClose } from "./vfs_xClose.js";
import { vfs_xRead } from "./vfs_xRead.js";
import { vfs_xWrite } from "./vfs_xWrite.js";
import { vfs_xUnlock } from "./vfs_xUnlock.js";
import { vfs_publication } from "./vfs_publication.js";

const CONFIG = 'OPFSAnyContextVFS';
const BUILDS = ['asyncify', 'jspi'];

const supportsJSPI = await TestContext.supportsJSPI();

describe(CONFIG, function() {
  for (const build of BUILDS) {
    if (build === 'jspi' && !supportsJSPI) return;

    describe(build, function() {
      const context = new TestContext({ build, config: CONFIG });

      it('should reuse SQLite file handles without mixing database locks or contents', async function() {
        const proxy = await context.create();
        try {
          // Vary the live set so SQLite recycles file pointers across different database paths.
          for (let round = 0; round < 20; round++) {
            const names = Array.from(
              { length: 1 + (round % 4) },
              (_, i) => `reopen-${(round + i) % 7}`);
            const databases = [];
            for (const name of names) {
              const db = await proxy.sqlite3.open_v2(name);
              databases.push(db);
              await proxy.sqlite3.exec(db, 'PRAGMA locking_mode = EXCLUSIVE');
              const rows = [];
              await proxy.sqlite3.exec(db, `
                CREATE TABLE IF NOT EXISTS notes (body TEXT);
                INSERT INTO notes VALUES ('${name}');
                SELECT DISTINCT body FROM notes;`, Comlink.proxy(row => rows.push(row)));
              expect(rows).toEqual([[name]]);
            }
            // One asynchronous WASM instance cannot execute overlapping SQLite calls.
            for (const db of databases) await proxy.sqlite3.close(db);
          }
        } finally {
          await context.destroy(proxy);
        }
      }, 15_000);
    
      vfs_xAccess(context);
      vfs_xOpen(context);
      vfs_xClose(context);
      vfs_xRead(context);
      vfs_xWrite(context);
      vfs_xUnlock(context);
      vfs_publication({ build });
    });
  }
});
