import * as Comlink from 'comlink';
import * as VFS from '../src/VFS.js';

const FILEID = 1;
const PAGE = 4096;

/**
 * Writes that do not line up with the blocks already stored.
 * @param {import('./TestContext.js').TestContext} context
 */
export function vfs_sparse_write(context) {
  describe('vfs_sparse_write', function() {
    let proxy, vfs;
    beforeEach(async function() {
      proxy = await context.create();
      vfs = proxy.vfs;
    });

    afterEach(async function() {
      await context.destroy(proxy);
    });

    async function open(name) {
      const pOpenOutput = Comlink.proxy(new DataView(new ArrayBuffer(4)));
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE;
      expect(await vfs.jOpen(name, FILEID, flags, pOpenOutput)).toEqual(VFS.SQLITE_OK);
    }

    const filled = (byte, length) => new Uint8Array(length).fill(byte);

    async function readBack(length, iOffset) {
      const out = Comlink.proxy(new Uint8Array(length));
      expect(await vfs.jRead(FILEID, out, iOffset)).toEqual(VFS.SQLITE_OK);
      return [...out];
    }

    // A file written out of order: the gap is filled last.
    it('should fill a gap between blocks already written', async function() {
      await open('sparse-gap');
      expect(await vfs.jWrite(FILEID, filled(1, PAGE), 0)).toEqual(VFS.SQLITE_OK);
      expect(await vfs.jWrite(FILEID, filled(3, PAGE), 2 * PAGE)).toEqual(VFS.SQLITE_OK);

      expect(await vfs.jWrite(FILEID, filled(2, PAGE), PAGE)).toEqual(VFS.SQLITE_OK);

      expect(await readBack(PAGE, 0)).toEqual([...filled(1, PAGE)]);
      expect(await readBack(PAGE, PAGE)).toEqual([...filled(2, PAGE)]);
      expect(await readBack(PAGE, 2 * PAGE)).toEqual([...filled(3, PAGE)]);
    });

    // A block written over with more than it holds.
    it('should overwrite a block with more data than it holds', async function() {
      await open('sparse-grow');
      expect(await vfs.jWrite(FILEID, filled(1, 512), 0)).toEqual(VFS.SQLITE_OK);
      expect(await vfs.jWrite(FILEID, filled(2, PAGE), 0)).toEqual(VFS.SQLITE_OK);

      expect(await readBack(PAGE, 0)).toEqual([...filled(2, PAGE)]);
    });

    // A write that fills a gap and runs over a block starting inside it.
    it('should read back a gap write from any offset', async function() {
      await open('sparse-inner');
      expect(await vfs.jWrite(FILEID, filled(1, 1024), 0)).toEqual(VFS.SQLITE_OK);
      expect(await vfs.jWrite(FILEID, filled(2, 8), 1032)).toEqual(VFS.SQLITE_OK);

      expect(await vfs.jWrite(FILEID, filled(3, 512), 1024)).toEqual(VFS.SQLITE_OK);

      expect(await readBack(512, 1024)).toEqual([...filled(3, 512)]);
      expect(await readBack(4, 1032)).toEqual([...filled(3, 4)]);
      expect(await readBack(4, 1040)).toEqual([...filled(3, 4)]);
    });

    // SQLite overwrites a single byte to invalidate a stale journal header.
    it('should overwrite a single byte', async function() {
      await open('sparse-byte');
      expect(await vfs.jWrite(FILEID, filled(1, 512), 0)).toEqual(VFS.SQLITE_OK);
      expect(await vfs.jWrite(FILEID, filled(2, 1), 8)).toEqual(VFS.SQLITE_OK);

      expect(await readBack(12, 0)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1]);
    });
  });
}
