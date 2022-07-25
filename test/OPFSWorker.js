import { OriginPrivateFileSystemVFS } from "../src/examples/OriginPrivateFileSystemVFS.js";

class TestWrapper extends OriginPrivateFileSystemVFS {
  handleAsync(f) {
    return f();
  }
}
const opfs = new TestWrapper();

addEventListener('message', async function({data}) {
  if (data === 'clean') {
    // Delete all files for this origin.
    const root = await navigator.storage.getDirectory();
    // @ts-ignore
    for await (const handle of root.values()) {
      await root.removeEntry(handle.name, { recursive: true });
    }
    postMessage(null);
    return;
  }
  
  // console.log('opfs request', data);
  let response = {
    result: null,
    setters: [],
    values: []
  };
  try {
    const args = data.args.map((arg, i) => {
      // Insert setter argument.
      const index = data.setters.indexOf(i);
      if (index >= 0) {
        return {
          set(value) {
            response.setters[index] = value;
          }
        }
      }

      // Return pData arrays.
      if (arg?.value instanceof Int8Array) {
        response.values.push(arg.value);
      }

      return arg;
    });

    // Call the method.
    response.result = await opfs[data.name](...args);
  } catch(e) {
    console.error(e);
    // @ts-ignore
    response = { error: e.message };
  }
  postMessage(response);
});