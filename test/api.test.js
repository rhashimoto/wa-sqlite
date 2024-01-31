import { TestContext } from "./TestContext.js";
import { api_exec } from "./api_exec.js";
import { api_misc } from "./api_misc.js";
import { api_prepare } from "./api_prepare.js";
import { api_statements } from "./api_statements.js";

function apiSpecs(build, config) {
  const context = new TestContext(build, config);

  describe(`SQLite ${build} ${config}`, function() {
    api_exec(context);
    api_misc(context);
    api_prepare(context);
    api_statements(context);
  });
}

apiSpecs('default', '');
apiSpecs('default', 'MemoryVFS');
apiSpecs('default', 'AccessHandlePoolVFS');
apiSpecs('asyncify', 'MemoryAsyncVFS');
apiSpecs('asyncify', 'IDBBatchAtomicVFS');
apiSpecs('asyncify', 'OriginPrivateVFS');
apiSpecs('asyncify', 'FLOOR');

if (await TestContext.supportsJSPI()) {
  apiSpecs('jspi', 'MemoryAsyncVFS');
  apiSpecs('jspi', 'IDBBatchAtomicVFS');
  apiSpecs('jspi', 'OriginPrivateVFS');
  apiSpecs('jspi', 'FLOOR');
}
