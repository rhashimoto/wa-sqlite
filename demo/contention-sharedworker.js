const DURATION_MILLIS = 5 * 1000;

globalThis.addEventListener('connect', event => {
  const clientPort = event.ports[0];
  clientPort.addEventListener('message', event => {
    new BroadcastChannel('contention').postMessage(Date.now() + DURATION_MILLIS);
  });
  clientPort.start();
});