import * as Comlink from 'comlink';

const TEST_WORKER_URL = './test-worker.js';
const TEST_WORKER_TERMINATE = true;

const workerFinalization = new FinalizationRegistry(worker => {
  if (TEST_WORKER_TERMINATE) {
    worker.terminate();
  }
});

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
      worker.addEventListener('message', ({ data }) => {
        resolve(data);
      }, { once: true });
    });

    const proxy = Comlink.wrap(port);
    workerFinalization.register(proxy, worker);
    this.#proxy = proxy;
    return proxy;
  }

  async destroy() {
    this.#proxy[Comlink.releaseProxy]();
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
}
