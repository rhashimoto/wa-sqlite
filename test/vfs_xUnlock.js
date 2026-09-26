import * as Comlink from 'comlink';
import * as VFS from '../src/VFS.js';

const FILEID = 1;

export function vfs_xUnlock(context) {
  describe('vfs_xUnlock', function() {
    let proxyA, proxyB;

    afterEach(async function() {
      if (proxyB) await context.destroy(proxyB);
      if (proxyA) await context.destroy(proxyA);
      proxyA = proxyB = null;
    });

    it('should make a truncation visible to another context', async function() {
      let rc;
      const openFlags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE;

      // Context A writes 8192 bytes, syncs, then truncates to 4096 with no
      // further xSync -- the shape SQLite produces when a commit shrinks the
      // database, e.g. VACUUM -- and releases its lock.
      proxyA = await context.create();
      const vfsA = proxyA.vfs;
      rc = await vfsA.jOpen('test', FILEID, openFlags, Comlink.proxy(new DataView(new ArrayBuffer(4))));
      expect(rc).toEqual(VFS.SQLITE_OK);
      for (const lockType of [VFS.SQLITE_LOCK_SHARED, VFS.SQLITE_LOCK_RESERVED, VFS.SQLITE_LOCK_EXCLUSIVE]) {
        rc = await vfsA.jLock(FILEID, lockType);
        expect(rc).toEqual(VFS.SQLITE_OK);
      }
      rc = await vfsA.jWrite(FILEID, new Uint8Array(8192), 0);
      expect(rc).toEqual(VFS.SQLITE_OK);
      rc = await vfsA.jSync(FILEID, VFS.SQLITE_SYNC_NORMAL);
      expect(rc).toEqual(VFS.SQLITE_OK);
      rc = await vfsA.jTruncate(FILEID, 4096);
      expect(rc).toEqual(VFS.SQLITE_OK);
      rc = await vfsA.jUnlock(FILEID, VFS.SQLITE_LOCK_NONE);
      expect(rc).toEqual(VFS.SQLITE_OK);

      // Context B, taking the lock A released, must see the truncated file.
      proxyB = await context.create({ reset: false });
      const vfsB = proxyB.vfs;
      rc = await vfsB.jOpen('test', FILEID, VFS.SQLITE_OPEN_READWRITE, Comlink.proxy(new DataView(new ArrayBuffer(4))));
      expect(rc).toEqual(VFS.SQLITE_OK);
      rc = await vfsB.jLock(FILEID, VFS.SQLITE_LOCK_SHARED);
      expect(rc).toEqual(VFS.SQLITE_OK);
      const pSize64 = new DataView(new ArrayBuffer(8));
      rc = await vfsB.jFileSize(FILEID, Comlink.proxy(pSize64));
      expect(rc).toEqual(VFS.SQLITE_OK);
      expect(Number(pSize64.getBigInt64(0, true))).toEqual(4096);
    });
  });
}
