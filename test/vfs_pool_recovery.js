/**
 * AccessHandlePoolVFS takes every file of its pool. When one of them is held
 * elsewhere its creation fails, which is expected; once the file is free
 * again, creating the VFS must succeed.
 * @param {{ build: string }} params
 */
export function vfs_pool_recovery({ build }) {
  describe('vfs_pool_recovery', function() {
    const workers = [];
    const directory = `pool-recovery-${Math.random().toString(36).slice(2)}`;
    afterEach(async function() {
      for (const worker of workers.splice(0)) worker.terminate();
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(directory, { recursive: true }).catch(() => {});
    });

    function connect() {
      const url = new URL('./vfs_pool_recovery-worker.js', import.meta.url);
      url.searchParams.set('build', build);
      const worker = new Worker(url, { type: 'module' });
      workers.push(worker);
      return (message) => new Promise((resolve, reject) => {
        worker.addEventListener('message', ({ data }) => resolve(data), { once: true });
        worker.addEventListener('error', event => reject(new Error(event.message)), { once: true });
        worker.postMessage(message);
      });
    }

    it('should create the VFS once the pool file it could not acquire is released',
      async function() {
        // Create the pool, then let it go.
        const setup = connect();
        expect((await setup({ type: 'create', directory })).ok).toBeTrue();
        await setup({ type: 'close' });

        const holder = connect();
        const held = await holder({ type: 'hold', directory });
        if (!held.ok) {
          pending(`cannot hold an exclusive handle: ${held.error}`);
          return;
        }

        // Expected to fail: one pool file is held elsewhere.
        const vfs = connect();
        expect((await vfs({ type: 'create', directory })).ok).toBeFalse();

        await holder({ type: 'release' });

        // The pool is free, so this must succeed. Before the access handles
        // acquired beside the one that failed were closed, it did not: the
        // worker kept them, and failed on its own handles for as long as it
        // lived.
        const created = await vfs({ type: 'create', directory });
        expect(created.ok ? 'created' : created.error).toBe('created');
        await vfs({ type: 'close' });
      });
  });
}
