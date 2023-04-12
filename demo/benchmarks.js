// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.

// Define the selectable configurations.
const CONFIGURATIONS = new Map([
  {
    label: 'default',
    isAsync: false,
  },
  {
    label: 'Memory (sync)',
    isAsync: false,
    vfsModule: '../src/examples/MemoryVFS.js',
    vfsClass: 'MemoryVFS',
    vfsArgs: []
  },
  {
    label: 'Memory (async)',
    isAsync: true,
    vfsModule: '../src/examples/MemoryVFS.js',
    vfsClass: 'MemoryVFS',
    vfsArgs: []
  },
  {
    label: 'MemoryAsync',
    isAsync: true,
    vfsModule: '../src/examples/MemoryAsyncVFS.js',
    vfsClass: 'MemoryAsyncVFS',
    vfsArgs: []
  },
  {
    label: 'IDBMinimal',
    isAsync: true,
    vfsModule: '../src/examples/IDBMinimalVFS.js',
    vfsClass: 'IDBMinimalVFS',
    vfsArgs: ['demo-IDBMinimalVFS']
  },
  {
    label: 'IDBMinimal relaxed',
    isAsync: true,
    vfsModule: '../src/examples/IDBMinimalVFS.js',
    vfsClass: 'IDBMinimalVFS',
    vfsArgs: ['demo-IDBMinimalVFS-relaxed', { durability: 'relaxed' }]
  },
  {
    label: 'IDBBatchAtomic',
    isAsync: true,
    vfsModule: '../src/examples/IDBBatchAtomicVFS.js',
    vfsClass: 'IDBBatchAtomicVFS',
    vfsArgs: ['demo-IDBBatchAtomicVFS']
  },
  {
    label: 'IDBBatchAtomic relaxed',
    isAsync: true,
    vfsModule: '../src/examples/IDBBatchAtomicVFS.js',
    vfsClass: 'IDBBatchAtomicVFS',
    vfsArgs: ['demo-IDBBatchAtomicVFS-relaxed', { durability: 'relaxed' }]
  },
  {
    label: 'OriginPrivateFileSystem',
    isAsync: true,
    vfsModule: '../src/examples/OriginPrivateFileSystemVFS.js',
    vfsClass: 'OriginPrivateFileSystemVFS',
    vfsArgs: []
  },
  {
    label: 'AccessHandlePool',
    isAsync: false,
    vfsModule: '../src/examples/AccessHandlePoolVFS.js',
    vfsClass: 'AccessHandlePoolVFS',
    vfsArgs: ['/demo-AccessHandlePoolVFS']
  }
].map(obj => [obj.label, obj]));

const benchmarksReady = Promise.all(Array.from(new Array(16), (_, i) => {
  const filename = `./benchmark${i + 1}.sql`;
  return fetch(filename).then(response => response.text());
}));
  
const ComlinkReady = import(location.hostname.endsWith('localhost') ?
'/.yarn/unplugged/comlink-npm-4.4.1-b05bb2527d/node_modules/comlink/dist/esm/comlink.min.js' :
'https://unpkg.com/comlink/dist/esm/comlink.mjs');

const headers = document.querySelector('thead').firstElementChild;
for (const config of CONFIGURATIONS.values()) {
  addEntry(headers, config.label)
}

document.getElementById('start').addEventListener('click', async event => {
  // @ts-ignore
  event.target.disabled = true;

  // Clear any existing storage state.
  const cleanWorker = new Worker('./clean-worker.js', { type: 'module' });
  await new Promise(resolve => {
    cleanWorker.addEventListener('message', resolve);
  });
  cleanWorker.terminate();

  // Clear timings from the table.
  Array.from(document.getElementsByTagName('tr'), element => {
    if (element.parentElement.tagName === 'TBODY') {
      // Keep only the first child.
      while (element.firstElementChild.nextElementSibling) {
        element.firstElementChild.nextElementSibling.remove();
      }
    }
  });

  const benchmarks = await benchmarksReady;
  const Comlink = await ComlinkReady;
  const preamble = document.getElementById('preamble').textContent;
  for (const config of CONFIGURATIONS.values()) {
    const worker = new Worker('./demo-worker.js', { type: 'module' });
    await new Promise(resolve => {
      worker.addEventListener('message', resolve, { once: true });
    });

    const workerProxy = Comlink.wrap(worker)
    const sql = await workerProxy(config);

    await sql([preamble], []);

    let tr = document.querySelector('tbody').firstElementChild;
    for (const benchmark of benchmarks) {
      const startTime = Date.now();
      await sql([benchmark], []);
      const elapsed = (Date.now() - startTime) / 1000;

      addEntry(tr, elapsed.toString());
      tr = tr.nextElementSibling;
    }

    worker.terminate();
  }

  // @ts-ignore
  event.target.disabled = false;
});

function addEntry(parent, text) {
  const tag = parent.parentElement.tagName === 'TBODY' ? 'td' : 'th';
  const child = document.createElement(tag);
  child.textContent = text;
  parent.appendChild(child);
}