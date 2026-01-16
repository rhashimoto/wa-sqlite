// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.

import * as SQLite from '../src/sqlite-api.js';

const BUILDS = new Map([
  // ['default', '../dist/wa-sqlite.mjs'],
  // ['asyncify', '../dist/wa-sqlite-async.mjs'],
  // ['jspi', '../dist/wa-sqlite-jspi.mjs'],
  ['default', '../dist/mc-wa-sqlite.mjs'],
  ['asyncify', '../dist/mc-wa-sqlite-async.mjs'],
  ['jspi', '../dist/mc-wa-sqlite-jspi.mjs'],
  // ['default', '../debug/wa-sqlite.mjs'],
  // ['asyncify', '../debug/wa-sqlite-async.mjs'],
  // ['jspi', '../debug/wa-sqlite-jspi.mjs'],
]);

/**
 * @typedef Config
 * @property {string} name
 * @property {string} vfsModule path of the VFS module
 * @property {string} [vfsClassName] name of the VFS class
 * @property {string} [vfsName] name of the VFS instance
 * @property {object} [vfsOptions] VFS constructor arguments
 */

/** @type {Map<string, Config>} */ const VFS_CONFIGS = new Map([
  {
    name: 'default',
    vfsModule: null
  },
  {
    name: 'MemoryVFS',
    vfsModule: '../src/examples/MemoryVFS.js',
  },
  {
    name: 'MemoryAsyncVFS',
    vfsModule: '../src/examples/MemoryAsyncVFS.js',
  },
  {
    name: 'IDBBatchAtomicVFS',
    vfsModule: '../src/examples/IDBBatchAtomicVFS.js',
    vfsOptions: { lockPolicy: 'shared+hint' }
  },
  {
    name: 'IDBMirrorVFS',
    vfsModule: '../src/examples/IDBMirrorVFS.js',
    vfsName: 'demo-mirror'
  },
  {
    name: 'OPFSAdaptiveVFS',
    vfsModule: '../src/examples/OPFSAdaptiveVFS.js',
    vfsOptions: { lockPolicy: 'shared+hint' }
  },
  {
    name: 'OPFSAnyContextVFS',
    vfsModule: '../src/examples/OPFSAnyContextVFS.js',
    vfsOptions: { lockPolicy: 'shared+hint' }
  },
  {
    name: 'OPFSCoopSyncVFS',
    vfsModule: '../src/examples/OPFSCoopSyncVFS.js',
  },
  {
    name: 'OPFSPermutedVFS',
    vfsModule: '../src/examples/OPFSPermutedVFS.js',
  },
  {
    name: 'AccessHandlePoolVFS',
    vfsModule: '../src/examples/AccessHandlePoolVFS.js',
  },
  {
    name: 'FLOOR',
    vfsModule: '../src/examples/FLOOR.js',
  },
].map(config => [config.name, config]));

const searchParams = new URLSearchParams(location.search);

maybeReset().then(async () => {
  const buildName = searchParams.get('build') || BUILDS.keys().next().value;
  const configName = searchParams.get('config') || VFS_CONFIGS.keys().next().value;
  const config = VFS_CONFIGS.get(configName);

  const dbName = searchParams.get('dbName') ?? 'hello';
  const vfsName = searchParams.get('vfsName') ?? config.vfsName ?? 'demo';

  // Instantiate SQLite.
  // Add cache-busting to ensure we get the latest build
  const buildPath = BUILDS.get(buildName);
  const cacheBuster = Date.now();
  const { default: moduleFactory } = await import(`${buildPath}?t=${cacheBuster}`);
  
  const module = await moduleFactory({
    locateFile(path) {
      // Add cache-busting to WASM file to avoid stale cached versions
      return `../dist/${path}?t=${cacheBuster}`;
    },
  });
  const sqlite3 = SQLite.Factory(module);

  // For multiple ciphers builds, check if cipher support is available
  const buildFile = BUILDS.get(buildName);
  const isMultipleCiphersBuild = buildFile && buildFile.includes('/mc-');

  if (config.vfsModule) {
    // Create the custom VFS
    const namespace = await import(config.vfsModule);
    const className = config.vfsClassName ?? config.vfsModule.match(/([^/]+)\.js$/)[1];
    const vfs = await namespace[className].create(vfsName, module, config.vfsOptions);
    
    if (isMultipleCiphersBuild) {
      // For cipher builds: register VFS but NOT as default, then wrap with cipher VFS
      sqlite3.vfs_register(vfs, false);
      
      // Create cipher VFS wrapping the custom VFS and make it default
      const cipherResult = module.ccall('sqlite3mc_vfs_create', 'number', ['string', 'number'], [vfsName, 1]);
      if (cipherResult !== 0) {
        console.warn('Failed to create cipher VFS (error:', cipherResult, '), falling back to non-encrypted VFS');
        sqlite3.vfs_register(vfs, true);
      }
    } else {
      // For non-cipher builds: just register VFS as default
      sqlite3.vfs_register(vfs, true);
    }
  }

  // Open the database.
  const db = await sqlite3.open_v2(dbName);

  // Add example functions regex and regex_replace.
  sqlite3.create_function(
    db,
    'regexp', 2,
    SQLite.SQLITE_UTF8 | SQLite.SQLITE_DETERMINISTIC, 0,
    function(context, values) {
      const pattern = new RegExp(sqlite3.value_text(values[0]))
      const s = sqlite3.value_text(values[1]);
      sqlite3.result(context, pattern.test(s) ? 1 : 0);
    },
    null, null);

  sqlite3.create_function(
    db,
    'regexp_replace', -1,
    SQLite.SQLITE_UTF8 | SQLite.SQLITE_DETERMINISTIC, 0,
    function(context, values) {
      // Arguments are
      // (pattern, s, replacement) or
      // (pattern, s, replacement, flags).
      if (values.length < 3) {
        sqlite3.result(context, '');
        return;  
      }
      const pattern = sqlite3.value_text(values[0]);
      const s = sqlite3.value_text(values[1]);
      const replacement = sqlite3.value_text(values[2]);
      const flags = values.length > 3 ? sqlite3.value_text(values[3]) : '';
      sqlite3.result(context, s.replace(new RegExp(pattern, flags), replacement));
    },
    null, null);

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
        elapsed: Math.trunc(end - start) / 1000
      })
    } catch (e) {
      console.error(e);
      postMessage({ error: cvtErrorToCloneable(e) });
    }
  });

  // Signal that we're ready.
  postMessage(null);
}).catch(e => {
  console.error(e);
  postMessage({ error: cvtErrorToCloneable(e) });
});

async function maybeReset() {
  if (searchParams.has('reset')) {
    const outerLockReleaser = await new Promise(resolve => {
      navigator.locks.request('demo-worker-outer', lock => {
        return new Promise(release => {
          resolve(release);
        });
      });
    });

    await navigator.locks.request('demo-worker-inner', { ifAvailable: true }, async lock => {
      if (lock) {
        console.log('clearing OPFS and IndexedDB');
        const root = await navigator.storage?.getDirectory();
        if (root) {
          // @ts-ignore
          for await (const name of root.keys()) {
            await root.removeEntry(name, { recursive: true });
          }
        }
    
        // Clear IndexedDB.
        const dbList = indexedDB.databases ?
          await indexedDB.databases() :
          ['demo', 'demo-floor'].map(name => ({ name }));
        await Promise.all(dbList.map(({name}) => {
          return new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(name);
            request.onsuccess = resolve;
            request.onerror = reject;
          });
        }));
      } else {
        console.warn('reset skipped because another instance already holds the lock');
      }
    });
    
    await new Promise((resolve, reject) => {
      const mode = searchParams.has('exclusive') ? 'exclusive' : 'shared';
      navigator.locks.request('demo-worker-inner', { mode, ifAvailable: true }, lock => {
        if (lock) {
          resolve();
          return new Promise(() => {});
        } else {
          reject(new Error('failed to acquire inner lock'));
        }
      });
    });

    outerLockReleaser();
  }
}

function cvtErrorToCloneable(e) {
  if (e instanceof Error) {
    const props = new Set([
      ...['name', 'message', 'stack'].filter(k => e[k] !== undefined),
      ...Object.getOwnPropertyNames(e)
    ]);
    return Object.fromEntries(Array.from(props, k =>  [k, e[k]])
      .filter(([_, v]) => {
        // Skip any non-cloneable properties.
        try {
          structuredClone(v);
          return true;
        } catch (e) {
          return false;
        }
      }));
  }
  return e;
}
