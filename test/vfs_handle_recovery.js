const HOLDER_SRC = `
  let handle = null;
  self.onmessage = async ({ data }) => {
    if (data.type === 'take') {
      try {
        const root = await navigator.storage.getDirectory();
        const file = await root.getFileHandle(data.name, { create: true });
        handle = await file.createSyncAccessHandle();
        self.postMessage({ ok: true });
      } catch (e) {
        self.postMessage({ ok: false, error: e.name });
      }
    } else {
      try { handle?.close(); } catch {}
      handle = null;
      self.postMessage({ ok: true });
    }
  };
`;

/**
 * Holds an exclusive access handle on a file, in a worker of its own:
 * createSyncAccessHandle is not available on the main thread.
 */
function createHolder() {
  const url = URL.createObjectURL(
    new Blob([HOLDER_SRC], { type: 'text/javascript' }));
  const worker = new Worker(url);
  const next = () => new Promise((resolve, reject) => {
    const bound = setTimeout(() => reject(new Error('holder timed out')), 10_000);
    worker.addEventListener('message', ({ data }) => {
      clearTimeout(bound);
      resolve(data);
    }, { once: true });
  });
  return {
    take(name) {
      worker.postMessage({ type: 'take', name });
      return next();
    },
    release() {
      worker.postMessage({ type: 'release' });
      return next();
    },
    dispose() {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  };
}

/**
 * Recovery after an access handle acquisition that failed, for a VFS taking
 * exclusive handles. Another context holding the database file is an ordinary
 * condition - a connection elsewhere, or a worker that has just been
 * terminated and whose handles the engine has not reclaimed yet - and the open
 * failing then is expected. What is not expected is that it keeps failing once
 * the file is free again.
 * @param {import('./TestContext.js').TestContext} context
 */
export function vfs_handle_recovery(context) {
  describe('vfs_handle_recovery', function() {
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

    it('should open a database once the file it could not acquire is released',
      async function() {
        const name = 'demo';
        const holder = createHolder();
        cleanup.push(() => holder.dispose());

        const taken = await holder.take(name);
        if (!taken.ok) {
          // The engine grants a second handle on the same file, so nothing
          // here can be held from another context.
          pending(`cannot hold an exclusive handle: ${taken.error}`);
          return;
        }

        const proxy = await context.create({ reset: false });
        cleanup.push(() => context.destroy(proxy));
        const sqlite3 = proxy.sqlite3;

        // Expected to fail: the file is held elsewhere.
        await expectAsync(sqlite3.open_v2(name)).toBeRejected();

        await holder.release();

        // The file is free, so this must succeed. Before the access handles
        // acquired beside the one that failed were closed, it did not: the
        // instance kept a handle on a sidecar file and failed on that instead,
        // for as long as it lived.
        const db = await sqlite3.open_v2(name);
        cleanup.push(() => sqlite3.close(db));
        await expectAsync(sqlite3.exec(db, 'SELECT 1')).toBeResolved();
      });
  });
}
