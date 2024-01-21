import * as Comlink from 'comlink';

const TEST_WORKER_URL = './test-worker.js';
const TEST_WORKER_TERMINATE = true;

const mapProxyToReleaser = new WeakMap();
const workerFinalization = new FinalizationRegistry(release => release());

export class TestContext {
  #proxy;

  constructor(build, config) {
    this.build = build
    this.config = config;
  }

  async create() {
    const url = new URL(TEST_WORKER_URL, import.meta.url);
    url.searchParams.set('build', this.build);
    url.searchParams.set('config', this.config);

    const worker = new Worker(url, { type: 'module' });
    const port = await new Promise(resolve => {
      worker.addEventListener('message', (event) => {
        if (event.ports[0]) {
          return resolve(event.ports[0]);
        }
        const e = new Error(event.data.message);
        throw Object.assign(e, event.data);
      }, { once: true });
    });

    const proxy = Comlink.wrap(port);
    if (TEST_WORKER_TERMINATE) {
      function releaser() {
        worker.terminate();
      }
      mapProxyToReleaser.set(proxy, releaser);
      workerFinalization.register(proxy, releaser);
    }

    this.#proxy = proxy;
    return proxy;
  }

  async destroy() {
    this.#proxy[Comlink.releaseProxy]();
    mapProxyToReleaser.get(this.#proxy)?.();

    this.#proxy = null;
  }

  get module() {
    return this.#proxy.module;
  }

  get sqlite3() {
    return this.#proxy.sqlite3;
  }

  get vfs() {
    return this.#proxy.vfs;
  }

  static async supportsJSPI() {
    try {
      const m = new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 1, 111, 0, 3, 2, 1, 0, 7, 5, 1,
        1, 111, 0, 0, 10, 4, 1, 2, 0, 11,
      ]);
      const { instance } = await WebAssembly.instantiate(m);
      // @ts-ignore
      new WebAssembly.Function(
        {
          parameters: [],
          results: ["externref"],
        },
        instance.exports.o,
        { promising: "first" }
      );
      return true;
    } catch (e) {
      return false;
    }
  }
}
