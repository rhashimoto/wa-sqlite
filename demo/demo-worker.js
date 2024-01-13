// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.

import * as SQLite from '../src/sqlite-api.js';

// For a typical application, the Emscripten module would be imported
// statically, but we want to be able to select between the Asyncify
// and non-Asyncify builds so dynamic import is done later.
const WA_SQLITE = '../dist/wa-sqlite.mjs';
const WA_SQLITE_ASYNC = '../dist/wa-sqlite-async.mjs';
const WA_SQLITE_JSPI = '../dist/wa-sqlite-jspi.mjs';

const MODULE = Symbol('module');

/**
 * @typedef Config
 * @property {string} name
 * @property {string} build build path
 * @property {string} vfsModule path of the VFS module
 * @property {string} [vfsClass] name of the VFS class
 * @property {Array<*>} [vfsArgs] VFS constructor arguments
 */

/** @type {Map<string, Config>} */ const CONFIGS = new Map([
  {
    name: 'default',
    build: WA_SQLITE,
    vfsModule: null
  },
  {
    name: 'MemoryVFS',
    build: WA_SQLITE,
    vfsModule: '../src/examples/MemoryVFS.js',
  },
  {
    name: 'MemoryAsyncVFS-async',
    build: WA_SQLITE_ASYNC,
    vfsModule: '../src/examples/MemoryAsyncVFS.js',
  },
  {
    name: 'MemoryAsyncVFS-jspi',
    build: WA_SQLITE_JSPI,
    vfsModule: '../src/examples/MemoryAsyncVFS.js',
  },
  {
    name: 'OriginPrivateVFS-async',
    build: WA_SQLITE_ASYNC,
    vfsModule: '../src/examples/OriginPrivateVFS.js',
  },
  {
    name: 'OriginPrivateVFS-jspi',
    build: WA_SQLITE_JSPI,
    vfsModule: '../src/examples/OriginPrivateVFS.js',
  },
].map(config => [config.name, config]));

const searchParams = new URLSearchParams(location.search);

maybeReset().then(async () => {
  const configName = searchParams.get('config') || CONFIGS.keys().next().value;
  const config = CONFIGS.get(configName);

  // Instantiate SQLite.
  const { default: moduleFactory } = await import(config.build);
  const module = await moduleFactory();
  const sqlite3 = SQLite.Factory(module);

  if (config.vfsModule) {
    // Create the VFS and register it as the default file system.
    const namespace = await import(config.vfsModule);
    const className = config.vfsClass ?? config.vfsModule.match(/([^/]+)\.js$/)[1];
    const vfsArgs = (config.vfsArgs ?? ['demo', MODULE])
      .map(arg => arg === MODULE ? module : arg);
    const vfs = new namespace[className](...vfsArgs);
    await vfs.isReady();
    sqlite3.vfs_register(vfs, true);
  }

  // Open the database.
  const db = await sqlite3.open_v2(searchParams.get('db') ?? 'demo');

  // Handle SQL queries.
  addEventListener('message', async (event) => {
    try {
      const query = event.data;

      const start = performance.now();
      const results = [];
      for await (const stmt of sqlite3.statements(db, query)) {
        const rows = [];
        while (await sqlite3.step(stmt) === SQLite.SQLITE_ROW) {
          const row = sqlite3.row(stmt);
          rows.push(row);
        }
  
        const columns = sqlite3.column_names(stmt)
        if (columns.length) {
          results.push({ columns, rows });
        }
      }
      const end = performance.now();

      postMessage({
        results,
        elapsed: (end - start) / 1000
      })
    } catch (e) {
      console.error(e);
      postMessage({ error: e.toString() });
    }
  });

  // Signal that we're ready.
  postMessage(null);
}).catch(e => {
  console.error(e);
  postMessage(e.toString());
});

async function maybeReset() {
  if (searchParams.has('reset')) {
    const root = await navigator.storage?.getDirectory();
    if (root) {
      console.log('clearing OPFS');
      // @ts-ignore
      for await (const name of root.keys()) {
        await root.removeEntry(name, { recursive: true });
      }
    }
  }
}
