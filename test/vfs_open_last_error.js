import * as Comlink from 'comlink';
import * as VFS from '../src/VFS.js';

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
 * The cause of an open that failed in its asynchronous phase. A VFS that
 * cannot open a database synchronously reports SQLITE_BUSY, does the work,
 * and answers the retried call - so the error is raised in one call and
 * reported in the next. It has to be carried across, or the caller is left
 * with a bare SQLITE_CANTOPEN and no way to tell a file held elsewhere from
 * one that does not exist.
 * @param {import('./TestContext.js').TestContext} context
 */
export function vfs_open_last_error(context) {
  describe('vfs_open_last_error', function() {
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

    it('should record the cause of an open that failed asynchronously',
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
        cleanup.push(() => holder.release());

        const proxy = await context.create({ reset: false });
        cleanup.push(() => context.destroy(proxy));
        const vfs = proxy.vfs;

        // Drive xOpen directly: the failure has to be observable without a
        // connection to ask sqlite3_errmsg, which is exactly the caller's
        // situation when sqlite3_open_v2 is what failed.
        const pOutFlags = Comlink.proxy(new DataView(new ArrayBuffer(4)));
        const flags = VFS.SQLITE_OPEN_CREATE |
          VFS.SQLITE_OPEN_READWRITE |
          VFS.SQLITE_OPEN_MAIN_DB;

        let rc;
        do {
          const nRetryOps = await proxy.module.retryOps.length;
          for (let i = 0; i < nRetryOps; i++) {
            await proxy.module.retryOps[i];
          }
          rc = await vfs.jOpen(name, 1, flags, pOutFlags);
        } while (rc === VFS.SQLITE_BUSY);

        // The file is held elsewhere, so the open fails. That is expected.
        expect(rc).toEqual(VFS.SQLITE_CANTOPEN);

        // What must not be lost is why. xGetLastError reports whatever
        // lastError holds, and the asynchronous phase is the only place in
        // this VFS that failed without setting it.
        const lastError = await vfs.lastError;
        expect(lastError).toBeTruthy();
        expect(lastError?.name).toEqual('NoModificationAllowedError');
      });
  });
}
