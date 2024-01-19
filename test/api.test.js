import { startWorker } from "./startWorker.js";
import { api_exec } from "./api_exec.js";

function apiSpecs(build, config) {
  const context = {
    build,
    config,
    setup() {
      return startWorker(build, config);
    },
    cleanup() {
    }
  };

  describe(`SQLite ${build} ${config}`, function() {
    api_exec(context);
  });
}

apiSpecs('default', '');
apiSpecs('default', 'MemoryVFS');
apiSpecs('asyncify', 'MemoryAsyncVFS');
apiSpecs('asyncify', 'OriginPrivateVFS');
// apiSpecs('jspi', 'MemoryAsyncVFS');