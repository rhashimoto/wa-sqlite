import { TestContext } from "./TestContext.js";
import { sql_0001 } from "./sql_0001.js";
import { sql_0002 } from "./sql_0002.js";

function sqlSpecs(build, config) {
  const context = new TestContext(build, config);

  describe(`SQLite ${build} ${config}`, function() {
    sql_0001(context);
    sql_0002(context);
  });
}

sqlSpecs('default', '');
sqlSpecs('default', 'MemoryVFS');
sqlSpecs('asyncify', 'MemoryAsyncVFS');
sqlSpecs('asyncify', 'OriginPrivateVFS');

if (await TestContext.supportsJSPI()) {
  sqlSpecs('jspi', 'MemoryAsyncVFS');
  sqlSpecs('jspi', 'OriginPrivateVFS');
}
