import * as VFS from "../../src/VFS.js";
import { IDBBatchAtomicVFS } from "../../src/examples/IDBBatchAtomicVFS.js";

// Install the service worker as soon as possible.
globalThis.addEventListener('install', (/** @type {ExtendableEvent} */ event) => {
  event.waitUntil(globalThis.skipWaiting());
});
globalThis.addEventListener('activate', (/** @type {ExtendableEvent} */ event) => {
  event.waitUntil(globalThis.clients.claim());
});

globalThis.addEventListener('fetch', async (/** @type {FetchEvent} */ event) => {
  const url = new URL(event.request.url);
  if (!url.href.includes(globalThis.registration.scope)) return;
  if (!url.pathname.endsWith('export')) return;

  if (url.searchParams.has('check')) {
    return event.respondWith(new Response('OK'));
  }

  const vfs = new IDBBatchAtomicVFS(url.searchParams.get('idb'));
  const path = url.searchParams.get('db');
  const source = new DatabaseSource(vfs, path);
  event.waitUntil(source.isDone.finally(() => vfs.close()));
  return event.respondWith(new Response(new ReadableStream(source), {
    headers: {
      "Content-Type": 'application/octet-stream',
      "Content-Disposition": `attachment; filename=sqlite.db`
    }
  }));
});

class DatabaseSource {
  isDone;

  #vfs;
  #path;
  #fileId = Math.floor(Math.random() * 0x100000000);
  #iOffset = 0;
  #bytesRemaining = 0;

  #onDone = [];
  #resolve;
  #reject;

  constructor(vfs, path) {
    this.#vfs = vfs;
    this.#path = path;
    this.isDone = new Promise((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    }).finally(async () => {
      while (this.#onDone.length) {
        await this.#onDone.pop()();
      }
    });
  }

  async start(controller) {
    try {
      // Open the file for reading.
      const flags = VFS.SQLITE_OPEN_MAIN_DB | VFS.SQLITE_OPEN_READONLY;
      await check(this.#vfs.xOpen(this.#path, this.#fileId, flags, {setInt32(){}}));
      this.#onDone.push(() => this.#vfs.xClose(this.#fileId));
      await check(this.#vfs.xLock(this.#fileId, VFS.SQLITE_LOCK_SHARED));
      this.#onDone.push(() => this.#vfs.xUnlock(this.#fileId, VFS.SQLITE_LOCK_NONE));

      // Get the file size.
      const fileSize = new DataView(new ArrayBuffer(8));
      await check(this.#vfs.xFileSize(this.#fileId, fileSize));
      this.#bytesRemaining = Number(fileSize.getBigUint64(0, true));
    } catch (e) {
      controller.error(e);
      this.#reject(e);
    }
  }

  async pull(controller) {
    try {
      const buffer = new Uint8Array(Math.min(this.#bytesRemaining, 65536));
      await check(this.#vfs.xRead(this.#fileId, buffer, this.#iOffset));
      controller.enqueue(buffer);

      this.#iOffset += buffer.byteLength;
      this.#bytesRemaining -= buffer.byteLength;
      if (this.#bytesRemaining === 0) {
        controller.close();
        this.#resolve();
      }
    } catch (e) {
      controller.error(e);
      this.#reject(e);
    }
  }

  cancel(reason) {
    this.#reject(new Error(reason));
  }
};

async function check(code) {
  if (await code !== VFS.SQLITE_OK) {
    throw new Error(`Error code: ${code}`);
  }
}