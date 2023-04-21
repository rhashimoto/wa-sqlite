/** @type {Map<string, Set<string>>} */ const mapLabelToClients = new Map();
const clientsChannel = new BroadcastChannel('clients');
const goChannel = new BroadcastChannel('go');

globalThis.addEventListener('connect', event => {
  const clientPort = event.ports[0];
  clientPort.addEventListener('message', ({data}) => {
    switch (data.type) {
      case 'register':
        let clients = mapLabelToClients.get(data.label);
        if (!clients) {
          clients = new Set();
          mapLabelToClients.set(data.label, clients);
        }
        clients.add(data.name);
        clientsChannel.postMessage({
          label: data.label,
          size: clients.size
        });
        navigator.locks.request(data.name, () => {
          clients.delete(data.name);
          clientsChannel.postMessage({
            label: data.label,
            size: clients.size
          });
        });
        break;
      case 'go':
        const config = data.config;
        config.deadline = Date.now() + config.seconds * 1000;
        goChannel.postMessage(config);
        break;
      default:
        console.warn('unrecognized message', data);
        break;
    }
  });
  clientPort.start();
});