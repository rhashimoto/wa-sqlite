/** @type {Map<string, MessagePort>} */
const mapNameToProviderPort = new Map();

globalThis.addEventListener('connect', event => {
  const workerPort = event.ports[0];
  workerPort.addEventListener('message', async event => {
    if (event.ports.length) {
      // Register new port provider.
      const name = event.data;
      const providerPort = event.ports[0];
      providerPort.start();
      mapNameToProviderPort.get(name)?.close();
      mapNameToProviderPort.set(name, providerPort);

      new BroadcastChannel('SharedService').postMessage(name);
    } else {
      // Handle port provider request.
      const { name, lockId } = event.data;
      const providerPort = mapNameToProviderPort.get(name);
      if (providerPort) {
        providerPort.addEventListener('message', event => {
          event.stopImmediatePropagation();
          workerPort.postMessage(null, event.ports);
        }, { once: true });
        providerPort.postMessage(lockId);
      }
    }
  });
  workerPort.start();
});