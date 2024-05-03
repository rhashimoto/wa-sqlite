import { TestContext } from "./TestContext.js";
import { sql_0001 } from "./sql_0001.js";
import { sql_0002 } from "./sql_0002.js";
import { sql_0003 } from "./sql_0003.js";

const ALL_BUILDS = ['default', 'asyncify', 'jspi'];
const ASYNC_BUILDS = ['asyncify', 'jspi'];

// Not all browsers support JSPI yet.
const supportsJSPI = await TestContext.supportsJSPI();

/** @type {Map<string, string[]>} */
const CONFIGS = new Map([
  ['', ALL_BUILDS],
  ['MemoryVFS', ALL_BUILDS],
  ['AccessHandlePoolVFS', ALL_BUILDS],
  ['OPFSCoopSyncVFS', ALL_BUILDS],
  ['MemoryAsyncVFS', ASYNC_BUILDS],
  ['IDBBatchAtomicVFS', ASYNC_BUILDS],
  ['OriginPrivateVFS', ASYNC_BUILDS],
  ['FLOOR', ASYNC_BUILDS]
]);

const DISALLOWS_PAGE_SIZE_CHANGE = ['IDBBatchAtomicVFS', 'FLOOR'];

describe('SQL', function() {
  for (const [config, builds] of CONFIGS) {
    describe(config, function() {
      for (const build of builds) {
        // Skip JSPI tests if the browser does not support it.
        if (build === 'jspi' && !supportsJSPI) continue;

        describe(build, function() {
          sqlSpecs(build, config);
        });
      }
    });
  }
});

function sqlSpecs(build, config) {
  const context = new TestContext({ build, config });

  sql_0001(context);
  sql_0002(context);
  if (!DISALLOWS_PAGE_SIZE_CHANGE.includes(config)) {
    // These tests change the page size, which is not supported by these
    // VFS classes.
    sql_0003(context);
  }
}
