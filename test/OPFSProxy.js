// Create a Proxy that calls OriginPrivateFileSystemVFS in a Worker.
export function makeOPFSProxy() {
  const worker = new Worker(
    new URL('./OPFSWorker.js', import.meta.url).toString(),
     { type: 'module' });

  return new Proxy({}, {
    get(target, property, receiver) {
      if (typeof property === 'string' && property.startsWith('x')) {
        return async function(...args) {
          // Setter functions can't be sent in a message, so replace them
          // with null and include a list of setter argument indices.
          const setters = [];
          const messageArgs = args.map((arg, i) => {
            if (arg?.set) {
              setters.push(i);
              return null;
            }
            return arg;
          });

          // Send the message.
          const message = {
            name: property,
            args: messageArgs,
            setters
          };
          worker.postMessage(message);

          // Wait for the response.
          const response = await new Promise(resolve => {
            worker.addEventListener('message', ({data}) => {
              // console.log('opfs response', data);
              resolve(data);
            }, { once: true });
          });

          if (response.error) throw new Error(response.error);

          // Copy the setter and Int8Array results into the original
          // arguments.
          args.forEach(arg => {
            if (arg?.set) {
              arg.set(response.setters.shift());
            } else if (arg?.value instanceof Int8Array) {
              arg.value.set(response.values.shift())
            }
          });
          return response.result;
        };      
      } else if (property === 'close') {
        return function() {
          worker.terminate();
        }
      }
      return Reflect.get(target, property, receiver);
    }
  });
}