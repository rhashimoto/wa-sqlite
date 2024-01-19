import * as Comlink from 'comlink';

const TEST_WORKER_URL = './test-worker.js';

const workerFinalization = new FinalizationRegistry(worker => {
  console.log('terminating worker');
  worker.terminate();
});

export async function startWorker(build, config) {
  // Create URL with configuration parameters.
  const url = new URL(TEST_WORKER_URL, import.meta.url);
  url.searchParams.set('build', build);
  url.searchParams.set('config', config);

  // Launch worker and wait for it to initialize.
  const worker = new Worker(url, { type: 'module' });
  const port = await new Promise(resolve => {
    worker.addEventListener('message', ({ data }) => {
      resolve(data);
    }, { once: true });
  });

  // Return the worker proxy.
  const workerProxy = Comlink.wrap(port);
  workerFinalization.register(workerProxy, worker);
  return workerProxy ;
}
