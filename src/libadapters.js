// Method names for these signatures must be in src/asyncify_imports.json.
const SIGNATURES = ['ii'];

// @ts-ignore
// This object will define the methods callable from WebAssembly.
// See https://emscripten.org/docs/porting/connecting_cpp_and_javascript/Interacting-with-code.html#implement-a-c-api-in-javascript
//
// At this writing, asynchronous JavaScript functions to be called from
// WebAssembly must be statically defined, i.e. they cannot be registered
// at runtime. The workaround here is to define synchronous and asynchronous
// relaying functions for each needed call signature.
//
// On the C side, calls are made to the relaying function with two prepended
// arguments (key, methodName). The relaying function then looks up and
// calls the appropriate receiver and method.
const adapters = {
  $adapters_support: function() {
    // This map contains the objects to which calls will be relayed, e.g.
    // a VFS. The key is typically the corresponding WebAssembly pointer.
    const targets = new Map();

    targets.set(42, {
      testSync(x) {
        console.log('testSync', x);
        return x + 1;
      },

      testAsync(x) {
        console.log('testAsync', x);
        return Promise.resolve(x + 1);
      }
    });

    // @ts-ignore
    // Overwrite this function with the relay service function.
    adapters_support = function(key, methodName, ...args) {
      const receiver = targets.get(key);
      const m = UTF8ToString(methodName);
      return receiver[m](...args);
    };
  },
  $adapters_support__deps: ['$UTF8ToString'],
  $adapters_support__postset: 'adapters_support();',
};

function injectMethod(signature, isAsync) {
  const method = `${isAsync ? 'async_' : ''}${signature}`;
  // @ts-ignore
  adapters[`${method}`] = function(...args) { return adapters_support(...args) };
  adapters[`${method}__sig`] = `${signature[0]}pp${signature.substring(1)}`;
  adapters[`${method}__deps`] = ['$adapters_support'];
  adapters[`${method}__async`] = isAsync;
}

// For each function signature, inject a synchronous and asynchronous
// relaying method definition.
for (const signature of SIGNATURES) {
  injectMethod(signature, false);
  injectMethod(signature, true);
}

// @ts-ignore
addToLibrary(adapters);