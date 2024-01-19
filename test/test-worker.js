// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.

import * as Comlink from 'comlink';
import * as SQLite from '../src/sqlite-api.js';

console.log('worker started');

const BUILDS = new Map([
  ['default', '../dist/wa-sqlite.mjs'],
  ['asyncify', '../dist/wa-sqlite-async.mjs'],
  ['jspi', '../dist/wa-sqlite-jspi.mjs'],
]);

const MODULE = Symbol('module');
const VFS_CONFIGS = new Map([
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
    name: 'OriginPrivateVFS',
    vfsModule: '../src/examples/OriginPrivateVFS.js',
  },
].map(config => [config.name, config]));

const searchParams = new URLSearchParams(location.search);

reset().then(async () => {
  const buildName = searchParams.get('build') || BUILDS.keys().next().value;
  const configName = searchParams.get('config') || VFS_CONFIGS.keys().next().value;
  const config = VFS_CONFIGS.get(configName);

  // Instantiate SQLite.
  const { default: moduleFactory } = await import(BUILDS.get(buildName));
  const module = await moduleFactory();
  const sqlite3 = SQLite.Factory(module);

  const vfs = await (async function() {
    if (config.vfsModule) {
      // Create the VFS and register it as the default file system.
      const namespace = await import(config.vfsModule);
      const className = config.vfsClass ?? config.vfsModule.match(/([^/]+)\.js$/)[1];
      const vfsArgs = (config.vfsArgs ?? ['demo', MODULE])
        .map(arg => arg === MODULE ? module : arg);
      const vfs = await namespace[className].create(...vfsArgs);
      sqlite3.vfs_register(vfs, true);
      return vfs;
    }
    return null;
  })();

  const sqlite3Proxy = new Proxy(sqlite3, {
    get(target, p, receiver) {
      const value = Reflect.get(target, p, receiver);
      if (typeof value === 'function') {
        return async (...args) => {
          const result = await value.apply(target, args);
          if (p === 'statements') {
            return Comlink.proxy(result);
          }
          return result;
        };
      }
    }
  });

  const { port1, port2 } = new MessageChannel();
  Comlink.expose({
    module,
    sqlite3: sqlite3Proxy,
    vfs
  }, port1);
  postMessage(port2, [port2]);
}).catch(e => {
  console.error(e);
  postMessage(null);
});

async function reset() {
  // Clear OPFS.
  const root = await navigator.storage?.getDirectory();
  if (root) {
    // @ts-ignore
    for await (const name of root.keys()) {
      await root.removeEntry(name, { recursive: true });
    }
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