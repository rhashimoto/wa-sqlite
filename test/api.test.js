import { startWorker } from "./startWorker.js";
import { api_exec } from "./api_exec.js";
import { api_statements } from "./api_statements.js";

class Context {
  #proxy; // Finalization will terminate the worker.

  constructor(build, config) {
    this.build = build;
    this.config = config;
  }

  async setup() {
    this.#proxy = await startWorker(this.build, this.config);
    return this.#proxy;
  }

  cleanup() {
    this.#proxy = null;
  }
}

function apiSpecs(build, config) {
  const context = new Context(build, config);

  describe(`SQLite ${build} ${config}`, function() {
    api_exec(context);
    api_statements(context);
  });
}

apiSpecs('default', '');
apiSpecs('default', 'MemoryVFS');
apiSpecs('asyncify', 'MemoryAsyncVFS');
apiSpecs('asyncify', 'OriginPrivateVFS');

// @ts-ignore
if (WebAssembly?.Function?.prototype.type) {
apiSpecs('jspi', 'MemoryAsyncVFS');
}
