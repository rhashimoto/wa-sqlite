const clients = new Set();
const clientsChannel = new BroadcastChannel('clients');
const goChannel = new BroadcastChannel('go');

globalThis.addEventListener('connect', event => {
  const clientPort = event.ports[0];
  clientPort.addEventListener('message', ({data}) => {
    switch (data.type) {
      case 'register':
        clients.add(data.name);
        clientsChannel.postMessage(clients.size);
        navigator.locks.request(data.name, () => {
          clients.delete(data.name);
          clientsChannel.postMessage(clients.size);
        });
        break;
      case 'go':
        const duration = data.duration;
        goChannel.postMessage(Date.now() + duration);
        break;
      default:
        console.warn('unrecognized message', data);
        break;
    }
  });
  clientPort.start();
});