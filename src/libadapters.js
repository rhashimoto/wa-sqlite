// Method names for these signatures must be in src/asyncify_imports.json.
const SIGNATURES = [
  'ii',
  'ip', // xClose, xSectorSize, xDeviceCharacteristics
  'vp', // xShmBarrier
  'ipI', // xTruncate
  'ipi', // xSync, xLock, xUnlock, xShmUnmap
  'ipp', // xFileSize, xCheckReservedLock, xCurrentTimeInt64
  'ipip', // xFileControl, xGetLastError
  'ippi', // xDelete
  'ippiI', // xRead, xWrite
  'ipiii', // xShmLock
  'ippip', // xAccess, xFullPathname
  'ipppip', // xOpen
  'ipiiip', // xShmMap
];

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
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

    // @ts-ignore
    // Expose handleAsync to library and application code.
    let handleAsync = typeof Asyncify === 'object' && Asyncify.State ?
      Asyncify.handleAsync.bind(Asyncify) :
      null;
    Module['handleAsync'] = handleAsync;

    // This map contains the objects to which calls will be relayed, e.g.
    // a VFS. The key is typically the corresponding WebAssembly pointer.
    const targets = new Map();

    // @ts-ignore
    // Overwrite this function with the relay service function.
    adapters_support = function(key, ...args) {
      // If the receiver found with the key is a function, just call it.
      // Otherwise, the next argument is the method to be called.
      const receiver = targets.get(key);
      const f = typeof receiver === 'function' ?
        receiver :
        receiver[UTF8ToString(args.shift())];
      
      // If legacy Asyncify is being used, wrap async functions
      // with handleAsync. Otherwise, just call the function.
      return handleAsync && f instanceof AsyncFunction ?
        handleAsync(() => f.apply(receiver, args)) :
        f.apply(receiver, args);
    };

    // This list of methods must match exactly with libadapters.c.
    const VFS_METHODS = [
      'xOpen',
      'xDelete',
      'xAccess',
      'xFullPathname',
      'xCurrentTime',
      'xGetLastError',
      'xCurrentTimeInt64',

      'xClose',
      'xRead',
      'xWrite',
      'xTruncate',
      'xSync',
      'xFileSize',
      'xLock',
      'xUnlock',
      'xCheckReservedLock',
      'xFileControl',
      'xSectorSize',
      'xDeviceCharacteristics',
      'xShmMap',
      'xShmLock',
      'xShmBarrier',
      'xShmUnmap'
    ];

    Module['vfs_register'] = function(vfs, makeDefault) {
      // Determine which methods exist and which are asynchronous.
      let methodMask = 0;
      let asyncMask = 0;
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      VFS_METHODS.forEach((method, i) => {
        if (vfs[method]) {
          methodMask |= 1 << i;
          if (vfs[method] instanceof AsyncFunction) {
            asyncMask |= 1 << i;
          }
        }
      });

      // Allocate space for the key.
      const keyPointer = Module['_malloc'](4);
      try {
        const result = ccall(
          'adapter_vfs_register',
          'number',
          ['string', 'number', 'number', 'number', 'number', 'number'],
          [vfs.name, vfs.mxPathname, methodMask, asyncMask, makeDefault ? 1 : 0, keyPointer]);
        if (!result) {
          const key = getValue(keyPointer, '*');
          targets.set(key, vfs);
        }
        return result;
      } finally {
        Module['_free'](keyPointer);
      }
    };
  },
  $adapters_support__deps: ['$UTF8ToString'],
  $adapters_support__postset: 'adapters_support();',
};

function injectMethod(signature, isAsync) {
  const method = `${signature}${isAsync ? '_async' : ''}`;
  // @ts-ignore
  adapters[`${method}`] = function(...args) { return adapters_support(...args) };
  adapters[`${method}__sig`] = `${signature[0]}pp${signature.substring(1).replaceAll('I', 'ii')}`;
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