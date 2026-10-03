import { createHolder } from "./vfs_handle_recovery.js";

const OPEN_BOUND_MS = 5000;

/**
 * Recovery after an open whose access handle could not be acquired, on the
 * path OPFSAdaptiveVFS takes without readwrite-unsafe access handles: there
 * it takes the file's lock first, then the handle. When the handle fails,
 * the lock must be released with it.
 * @param {{ build: string }} params
 */
export function vfs_open_lock_recovery({ build }) {
  describe('vfs_open_lock_recovery', function() {
    const cleanup = [];
    afterEach(async function() {
      for (const fn of cleanup.splice(0).reverse()) {
        await fn();
      }
    });

    function connect() {
      const url = new URL('./vfs_open_lock_recovery-worker.js', import.meta.url);
      url.searchParams.set('build', build);
      url.searchParams.set('unsafe', 'off');
      const worker = new Worker(url, { type: 'module' });
      cleanup.push(() => worker.terminate());
      return (filename) => new Promise((resolve, reject) => {
        const bound = setTimeout(() => resolve({ ok: false, error: 'hung' }), OPEN_BOUND_MS);
        worker.addEventListener('message', ({ data }) => {
          clearTimeout(bound);
          resolve(data);
        }, { once: true });
        worker.addEventListener('error', event => reject(new Error(event.message)), { once: true });
        worker.postMessage({ filename });
      });
    }

    it('should open a database once the file it could not acquire is released',
      async function() {
        const filename = `lock-recovery-${Math.random().toString(36).slice(2)}`;
        const root = await navigator.storage.getDirectory();
        cleanup.push(() => root.removeEntry(filename).catch(() => {}));

        const holder = createHolder();
        cleanup.push(() => holder.dispose());
        const taken = await holder.take(filename);
        if (!taken.ok) {
          pending(`cannot hold an exclusive handle: ${taken.error}`);
          return;
        }

        // Expected to fail: the file is held elsewhere.
        const open = connect();
        expect((await open(filename)).ok).toBeFalse();

        await holder.release();

        // The file is free, so this must succeed. When the failed open kept
        // the file's lock, this one waited for it forever.
        const opened = await open(filename);
        expect(opened.ok ? 'opened' : opened.error).toBe('opened');
      });
  });
}
