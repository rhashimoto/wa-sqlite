// A worker for vfs_pool_recovery.js. It can create an AccessHandlePoolVFS,
// or hold one file of its pool with an exclusive access handle.
import { AccessHandlePoolVFS } from '../src/examples/AccessHandlePoolVFS.js';

const BUILDS = new Map([
  ['default', '../dist/wa-sqlite.mjs'],
  ['asyncify', '../dist/wa-sqlite-async.mjs'],
  ['jspi', '../dist/wa-sqlite-jspi.mjs'],
]);

const searchParams = new URLSearchParams(location.search);
const ready = (async () => {
  const { default: moduleFactory } = await import(BUILDS.get(searchParams.get('build')));
  return moduleFactory();
})();

let vfs = null;
let held = null;

addEventListener('message', async ({ data }) => {
  try {
    switch (data.type) {
      case 'create':
        try {
          vfs = await AccessHandlePoolVFS.create(data.directory, await ready);
          postMessage({ ok: true });
        } catch (e) {
          postMessage({ ok: false, error: e.name });
        }
        break;
      case 'close':
        await vfs?.close();
        vfs = null;
        postMessage({ ok: true });
        break;
      case 'hold': {
        const root = await navigator.storage.getDirectory();
        const directory = await root.getDirectoryHandle(data.directory);
        const names = [];
        for await (const [name, handle] of directory) {
          if (handle.kind === 'file') names.push(name);
        }
        try {
          const file = await directory.getFileHandle(names.sort()[0]);
          held = await file.createSyncAccessHandle();
          postMessage({ ok: true });
        } catch (e) {
          postMessage({ ok: false, error: e.name });
        }
        break;
      }
      case 'release':
        held?.close();
        held = null;
        postMessage({ ok: true });
        break;
    }
  } catch (e) {
    postMessage({ ok: false, error: e.message });
  }
});
