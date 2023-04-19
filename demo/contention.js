const DURATION_MILLIS = 5 * 1000;

const DATABASE_CONFIGS = new Map([
  {
    label: 'IDBMinimalVFS',
    isAsync: true,
    vfsModule: '../src/examples/IDBMinimalVFS.js',
    vfsClass: 'IDBMinimalVFS',
    vfsArgs: ['demo-IDBMinimalVFS']
  },
  {
    label: 'IDBBatchAtomicVFS',
    isAsync: true,
    vfsModule: '../src/examples/IDBBatchAtomicVFS.js',
    vfsClass: 'IDBBatchAtomicVFS',
    vfsArgs: ['demo-IDBBatchAtomicVFS']
  },
  {
    label: 'OriginPrivateFileSystemVFS',
    isAsync: true,
    vfsModule: '../src/examples/OriginPrivateFileSystemVFS.js',
    vfsClass: 'OriginPrivateFileSystemVFS',
    vfsArgs: []
  }
].map(value => [value.label, value]));

const DATE_OPTIONS = {
  hour12: false,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3
};

function log(s) {
  const output = document.getElementById('output');
  const pre = document.createElement('pre');
  output.appendChild(pre);

  // @ts-ignore
  const timestamp = new Date().toLocaleTimeString(undefined, DATE_OPTIONS);
  pre.textContent = `${timestamp} ${s}`;
}

window.addEventListener('DOMContentLoaded', async function() {
  // Create a unique id for this tab.
  const tabId = Math.random().toString(36).replace('0.', '');

  // Attach the SharedWorker.
  const sharedWorker = new SharedWorker('./contention-sharedworker.js');
  sharedWorker.port.start();
  
  new BroadcastChannel('clients').addEventListener('message', ({data}) => {
    // TODO: display number of ready clients
    log(`${data} clients`);
  });

  try {
    log('preparing...')
    document.getElementById('newtab').addEventListener('click', () => {
      window.open(window.location.href, '_blank');
    });

    // Optionally clear storage.
    const params = new URLSearchParams(window.location.search);
    if (params.has('clear')) {
      log('clearing storage...')
      localStorage.clear();
      const worker = new Worker('./clean-worker.js', { type: 'module' });
      await new Promise(resolve => {
        worker.addEventListener('message', resolve);
      });
      worker.terminate();
    }

    // Launch the Worker.
    const vfsName = params.get('vfs') ?? 'IDBBatchAtomicVFS';
    const vfsConfig = DATABASE_CONFIGS.get(vfsName);
    if (!vfsConfig) throw new Error(`Bad VFS: ${vfsName}`);
    log(`loading ${vfsName}...`);

    const Comlink = await import(location.hostname.endsWith('localhost') ?
      '/.yarn/unplugged/comlink-npm-4.4.1-b05bb2527d/node_modules/comlink/dist/esm/comlink.min.js' :
      'https://unpkg.com/comlink/dist/esm/comlink.mjs');

    const worker = new Worker('./demo-worker.js', { type: 'module' });
    await new Promise(resolve => {
      worker.addEventListener('message', resolve, { once: true });
    });
    const workerProxy = Comlink.wrap(worker);
    const sql = await workerProxy(vfsConfig);

    // Use a SharedWorker as the starter.
    document.getElementById('start').addEventListener('click', async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS kv (key PRIMARY KEY, value);
        REPLACE INTO kv VALUES ('counter', 0);

        CREATE TABLE IF NOT EXISTS log (time, tabId, count);
        DELETE FROM log;
      `;
      sharedWorker.port.postMessage({
        type: 'go',
        duration: DURATION_MILLIS
      });
    });

    new BroadcastChannel('go').addEventListener('message', async ({data}) => {
      log('begin test');
      const endTime = data;
      while (Date.now() < endTime) {
        await sql`
          BEGIN IMMEDIATE;

          UPDATE kv SET value = value + 1 WHERE key = 'counter';
          INSERT INTO log VALUES
            (${Date.now()}, '${tabId}', (SELECT value FROM kv WHERE key = 'counter'));

          COMMIT;
        `
      }
      log('end test');

      const results = await sql`
        DELETE FROM log WHERE time > ${endTime};

        SELECT COUNT(*) FROM log GROUP BY tabId;
      `;
      log(`result counts ${JSON.stringify(results[0].rows.flat())}`);
      console.log(results);
    });

    navigator.locks.request(tabId, () => new Promise(() => {
      // Register with the SharedWorker.
      sharedWorker.port.postMessage({
        type: 'register',
        name: tabId
      });
      // This Promise never resolves so we keep the lock until exit.
    }));
  
    // @ts-ignore
    this.document.getElementById('start').disabled = false;
    log('ready');
  } catch (e) {
    log(e.stack.includes(e.message) ? e.stack : `${e.message}\n${e.stack}`);
  }
});