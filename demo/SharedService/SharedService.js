const DEFAULT_SHARED_WORKER_PATH = './SharedService_SharedWorker.js';

export class SharedService extends EventTarget {
  /** @type {string} */ #name;
  /** @type {() => MessagePort|Promise<MessagePort>} */ #portProviderFunc;

  /** @type {SharedWorker} */ #sharedWorker;

  /** @type {AbortController} */ #onClose = new AbortController();
  /** @type {AbortController} */ #onDeactivate;

  /** @type {string} */ #clientId;
  /** @type {Promise} */ #hasOwnLock;

  /** @type {MessagePort} */ #servicePort;
  /** @type {Map<string, { resolve, reject }>} */ #callbacks = new Map();

  /** @type {{ [method: string] : (...args: any) => Promise<*> }} */ proxy;

  /**
   * @param {string} name 
   * @param {() => MessagePort|Promise<MessagePort>} portProviderFunc 
   * @param {string} [sharedWorkerPath] 
   */
  constructor(name, portProviderFunc, sharedWorkerPath = DEFAULT_SHARED_WORKER_PATH) {
    super();

    this.#name = name;
    this.#portProviderFunc = portProviderFunc;

    // A SharedWorker provides a MessagePort to the service.
    this.#sharedWorker = new SharedWorker(sharedWorkerPath);
    this.#sharedWorker.port.addEventListener('message', event => {
      this.#configureServicePort(event.ports[0]);
      this.dispatchEvent(new CustomEvent('service-port'));
    });
    this.#sharedWorker.port.start();

    // The SharedWorker also broadcasts when the service provider changes.
    new BroadcastChannel('SharedService').addEventListener('message', ({data}) => {
      if (data === this.#name) {
        this.#providerChange();
      }
    }, { signal: this.#onClose.signal });

    // Acquire an exclusive lock on our own random id. This allows the
    // service to clean up our channel after we go away.
    this.#hasOwnLock = new Promise(resolve => {
      this.#clientId = `SharedService-${this.#name}-${randomString()}`;
      navigator.locks.request(this.#clientId, () => new Promise(releaseLock => {
        resolve();
        this.#onClose.signal.addEventListener('abort', releaseLock);
      }));
    });
    this.#requestServicePort();

    this.proxy = this.#createProxy();
  }

  activate() {
    if (this.#onDeactivate) return;

    // If we acquire the lock then we are the service provider.
    this.#onDeactivate = new AbortController();
    navigator.locks.request(
      `SharedService-${this.#name}`,
      { signal: this.#onDeactivate.signal },
      async () => {
        // Register a new port provider with the SharedWorker.
        const port = await this.#portProviderFunc();
        this.#sharedWorker.port.postMessage(this.#name, [port]);

        // Release the lock only on user abort or context destruction.
        return new Promise((_, reject) => {
          this.#onDeactivate.signal.addEventListener('abort', reject);
        });
      });
  }

  deactivate() {
    this.#onDeactivate?.abort();
    this.#onDeactivate = null;
  }

  close() {
    this.deactivate();
    this.#onClose.abort();
    for (const { reject } of this.#callbacks.values()) {
      reject(new Error('SharedService closed'));
    }
  }

  async #requestServicePort() {
    await this.#hasOwnLock;
    this.#sharedWorker.port.postMessage({
      name: this.#name,
      lockId: this.#clientId
    });
  }

  #configureServicePort(servicePort) {
    this.#servicePort?.close();
    this.#servicePort = servicePort;
    this.#servicePort.addEventListener('message', ({data}) => {
      const callbacks = this.#callbacks.get(data.nonce);
      if (data.result) {
        callbacks.resolve(data.result);
      } else {
        callbacks.reject(Object.assign(new Error(), data.error));
      }
    });
    this.#servicePort.start();
  }

  /**
   * This handler is called when the SharedWorker broadcasts a change
   * in the service provider.
   */
  #providerChange() {
    // Fetch the new port for proxying calls.
    this.#servicePort?.close();
    this.#servicePort = null;
    this.#requestServicePort();

    // Reject any pending calls.
    for (const { reject } of this.#callbacks.values()) {
      reject(new Error('SharedService provider change'));
    }
  }

  #createProxy() {
    return new Proxy({}, {
      get: (_, method) => {
        return async (...args) => {
          // Use a nonce to match up requests and responses. This allows
          // the responses to be out of order.
          const nonce = randomString();

          // Wait for a valid service port.
          const servicePort = this.#servicePort || await new Promise(resolve => {
            this.addEventListener('service-port', () => {
              resolve(this.#servicePort);
            }, { once: true });
          });

          return new Promise((resolve, reject) => {
            this.#callbacks.set(nonce, { resolve, reject });
            servicePort.postMessage({ nonce, method, args });
          }).finally(() => {
            this.#callbacks.delete(nonce);
          });
        }
      }
    });
  }
}

/**
 * Wrap a target with MessagePort for proxying.
 * @param {{ [method: string]: (...args) => any }} target 
 * @returns 
 */
export function createSharedServicePort(target) {
  const { port1: providerPort1, port2: providerPort2 } = new MessageChannel();
  providerPort1.addEventListener('message', ({data: lockId}) => {
    const { port1, port2 } = new MessageChannel();

    // The port requester holds a lock while using the channel. When the
    // lock is released by the requester, clean up the port on this side.
    navigator.locks.request(lockId, () => {
      port1.close();
    });

    port1.addEventListener('message', async ({data}) => {
      const response = { nonce: data.nonce };
      try {
        response.result = await target[data.method](...data.args);
      } catch(e) {
        // Error is not structured cloneable so copy into POJO.
        const error = e instanceof Error ?
          Object.fromEntries(Object.getOwnPropertyNames(e).map(k => [k, e[k]])) :
          e;
        response.error = error;
      }
      port1.postMessage(response);
    });
    port1.start();
    providerPort1.postMessage(null, [port2]);
  });
  providerPort1.start();
  return providerPort2;
}

function randomString() {
  return Math.random().toString(36).replace('0.', '');
}