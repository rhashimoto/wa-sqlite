// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.

import * as Comlink from 'comlink';
import * as SQLite from '../src/sqlite-api.js';

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
      // Comlink intercepts some function property names, e.g. "bind",
      // so allow aliases to avoid the problem.
      if (typeof p === 'string') p = p.replaceAll('$', '');

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
  postMessage(null, [port2]);
}).catch(e => {
  console.error(e);
  postMessage(cvtErrorToCloneable(e));
});

async function reset() {
  // Limit the amount of time in this function.
  const abortController = new AbortController();
  setTimeout(() => abortController.abort(), 10_000);

  // Use a lock to ensure this context is the only one using OPFS.
  await new Promise((resolve, reject) => {
    navigator.locks.request('test-worker', { signal: abortController.signal }, lock => {
      if (lock) {
        resolve();
        return new Promise(() => {});
      }
      reject(abortController.signal.reason);
    });
  });

  // Clear OPFS.
  const root = await navigator.storage?.getDirectory();
  if (root) {
    while (true) {
      abortController.signal.throwIfAborted();
      try {
        // @ts-ignore
        for await (const name of root.keys()) {
          await root.removeEntry(name, { recursive: true });
        }
        return;
      } catch (e) {
        // A NoModificationAllowedError is thrown if an entry can't be
        // deleted because it isn't closed. Just try again.
        if (e.name === 'NoModificationAllowedError') {
          await new Promise(resolve => setTimeout(resolve));
          continue;
        }
        throw e;
      }
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