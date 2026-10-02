import { createHolder } from "./vfs_handle_recovery.js";

/**
 * After an open that failed, the VFS must hold nothing on the files it
 * acquired along the way. OPFSWriteAheadVFS opens its two write-ahead files
 * together; when one of them fails while the other is still being acquired,
 * the one that succeeds late must still be closed.
 * @param {import('./TestContext.js').TestContext} context
 */
export function vfs_open_cleanup(context) {
  describe('vfs_open_cleanup', function() {
    beforeAll(async function() {
      // Clear persistent storage.
      const proxy = await context.create();
      await context.destroy(proxy);
    });

    const cleanup = [];
    beforeEach(function() {
      cleanup.splice(0);
    });

    afterEach(async function() {
      for (const fn of cleanup.reverse()) {
        await fn();
      }
    });

    it('should release the other write-ahead file when one fails to open',
      async function() {
        const name = 'demo';
        const root = await navigator.storage.getDirectory();

        // A directory where the first write-ahead file should be: its open
        // rejects at once, while the second is still being acquired.
        await root.getDirectoryHandle(`${name}-wa0`, { create: true });
        cleanup.push(() => root.removeEntry(`${name}-wa0`).catch(() => {}));

        const proxy = await context.create({ reset: false });
        cleanup.push(() => context.destroy(proxy));
        await expectAsync(proxy.sqlite3.open_v2(name)).toBeRejected();

        // The second write-ahead file must be free. When the cleanup ran
        // before its acquisition completed, its handle was never closed, and
        // an exclusive handle on it failed for as long as the worker lived.
        const holder = createHolder();
        cleanup.push(() => holder.dispose());
        const taken = await holder.take(`${name}-wa1`);
        expect(taken.ok ? 'free' : taken.error).toBe('free');
        await holder.release();
      });
  });
}
