"use strict";
const readline = require('readline');

// Functions that make indirect calls to asynchronous Javascript.
const INDIRECT_CALLERS = [
  // VFS
  // Search sqlite3.c for regex pMethods->x\w+(
  "sqlite3OsClose",
  "sqlite3OsRead",
  "sqlite3OsWrite",
  "sqlite30sTruncate",
  "sqlite3OsSync",
  "sqlite3OsFileSize",
  "sqlite3OsLock",
  "sqlite3OsUnlock",
  "sqlite3OsCheckReservedLock",
  "sqlite3OsFileControl",
  "sqlite3OsFileControlHint",
  "sqlite3OsSectorSize",
  "sqlite3OsDeviceCharacteristics",
  "sqlite3OsOpen",
  "sqlite3OsDelete",
  "sqlite3OsAccess",
  "sqlite3OsFullPathname",

  // vtable module
  // Search sqlite3.c for regex pModule->x\w+(
  "vtabBestIndex",
  "vtabCallConstructor",
  "sqlite3VdbeExec",
  "sqlite3VdbeFreeCursor",
  "sqlite3VtabBegin",
  "sqlite3VtabUnlock",

  "fts3DisconnectMethod",
  "fts3InitVtab",
  "sqlite3Fts3OpenTokenizer",
  "getNextToken",
  "getNextString",
  "fts3PendingTermsAdd",
  "fts3IntegrityCheck",
  "sqlite3Fts3CacheDeferredDoclists",

  // Indirect call to pager xGet.
  // Search sqlite3.c for regex pPager->xGet(
  "sqlite3PagerGet",

  // Walker indirect calls.
  "walkExpr",
  "sqlite3WalkSelect",
  "sqlite3AggInfoPersistWalkerInit",
];

(async function() {
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
    terminal: false
  });

  // Organize the call graph data, which lists the calls each function makes.
  let caller;
  const nodeRegex = /Call graph node for function: '([^']*)'/;
  const edgeRegex = /calls function '([^']*)'/;
  /** @type {Map<string, Set<string>} */ const mapFunctionToCallers = new Map();
  for await (const line of rl) {
    let m;
    if (m = line.match(nodeRegex)) {
      caller = m[1];
    } else if (m = line.match(edgeRegex)) {
      const callee = m[1];

      if (caller) {
        let callers = mapFunctionToCallers.get(callee);
        if (!callers) {
          callers = new Set();
          mapFunctionToCallers.set(callee, callers);
        }
        callers.add(caller);
      }
    }
  }

  // Starting with the calls that we know need to be Asyncify-ed,
  // iteratively add the functions that call them.
  const asyncify = new Set();
  let frontier = new Set(INDIRECT_CALLERS);
  do {
    const callers = new Set();
    for (const f of frontier) {
      // Find unvisited callers the next step further.
      for (const caller of mapFunctionToCallers.get(f) ?? []) {
        if (!frontier.has(caller) && !asyncify.has(caller)) {
          callers.add(caller);
        }
      }
      asyncify.add(f);
    }

    frontier = callers;
  } while (frontier.size);

  const json = JSON.stringify(Array.from(asyncify).sort(), null, 2);
  console.log(json);
})();
