// Method names for these signatures must be in src/asyncify_imports.json.
const SIGNATURES = [
  'ippp', // xClose, xSectorSize, xDeviceCharacteristics
  'vppp', // xShmBarrier, xFinal
  'ipppj', // xTruncate
  'ipppi', // xSleep, xSync, xLock, xUnlock, xShmUnmap
  'ipppp', // xFileSize, xCheckReservedLock, xCurrentTime, xCurrentTimeInt64
  'ipppip', // xFileControl, xRandomness, xGetLastError
  'vpppip', // xFunc, xStep
  'ippppi', // xDelete
  'ippppij', // xRead, xWrite
  'ipppiii', // xShmLock
  'ippppip', // xAccess, xFullPathname
  'ipppppip', // xOpen
  'ipppiiip', // xShmMap
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
    const handleAsync = typeof Asyncify === 'object' ?
      Asyncify.handleAsync.bind(Asyncify) :
      null;
    Module['handleAsync'] = handleAsync;

    // This map contains the objects to which calls will be relayed, e.g.
    // a VFS. The key is typically the corresponding WebAssembly pointer.
    const targets = new Map();

    // @ts-ignore
    // Overwrite this function with the relay service function.
    adapters_support = function(isAsync, key, ...args) {
      // If the receiver found with the key is a function, just call it.
      // Otherwise, the next argument is the name of the method to be called.
      const receiver = targets.get(key);
      let methodName = null;
      const f = typeof receiver === 'function' ?
        receiver :
        receiver[methodName = UTF8ToString(args.shift())];
      
      if (isAsync) {
        // Call async function via handleAsync. This works for both
        // Asyncify and JSPI builds.
        if (handleAsync) {
          return handleAsync(() => f.apply(receiver, args));
        }
        throw new Error('Synchronous WebAssembly cannot call async function');
      }

      // The function should not be async so call it directly.
      const result = f.apply(receiver, args);
      if (typeof result?.then == 'function') {
        console.error('unexpected Promise', f);
        throw new Error(`${methodName} unexpectedly returned a Promise`);
      }
      return result;
    };

    // This list of methods must match exactly with libadapters.c.
    const VFS_METHODS = [
      'xOpen',
      'xDelete',
      'xAccess',
      'xFullPathname',
      'xRandomness',
      'xSleep',
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
          if (vfs['hasAsyncMethod'](method)) {
            asyncMask |= 1 << i;
          }
        }
      });

      // Allocate space for adapter_vfs_register to write the sqlite3_vfs
      // pointer. This pointer will be used to look up the JavaScript VFS
      // object.
      const vfsPointer = Module['_malloc'](4);
      try {
        const result = ccall(
          'adapter_vfs_register',
          'number',
          ['string', 'number', 'number', 'number', 'number', 'number'],
          [vfs.name, vfs.mxPathname, methodMask, asyncMask, makeDefault ? 1 : 0, vfsPointer]);
        if (!result) {
          const key = getValue(vfsPointer, '*');
          targets.set(key, vfs);
        }
        return result;
      } finally {
        Module['_free'](vfsPointer);
      }
    };

    const FUNC_METHODS = [
      'xFunc',
      'xStep',
      'xFinal'
    ];

    const mapFunctionNameToKey = new Map();

    Module['create_function'] = function(db, zFunctionName, nArg, eTextRep, pApp, xFunc, xStep, xFinal) {
      // Allocate some memory to store the async flags. In addition, this
      // pointer is passed to SQLite as the application data (the user's
      // application data is ignored), and is used to look up the JavaScript
      // target object.
      const pAsyncFlags = Module['_sqlite3_malloc'](4);
      const target = { xFunc, xStep, xFinal };
      setValue(pAsyncFlags, FUNC_METHODS.reduce((mask, method, i) => {
        if (target[method] instanceof AsyncFunction) {
          return mask | 1 << i;
        }
        return mask;
      }, 0), 'i32');

      const result = ccall(
        'adapter_create_function',
        'number',
        ['number', 'string', 'number', 'number', 'number', 'number', 'number', 'number'],
        [
          db,
          zFunctionName,
          nArg,
          eTextRep,
          pAsyncFlags,
          xFunc ? 1 : 0,
          xStep ? 1 : 0,
          xFinal? 1 : 0
        ]);
      if (!result) {
        if (mapFunctionNameToKey.has(zFunctionName)) {
          // Reclaim the old resources used with this name.
          const oldKey = mapFunctionNameToKey.get(zFunctionName);
          targets.delete(oldKey);
        }
        mapFunctionNameToKey.set(zFunctionName, pAsyncFlags);
        targets.set(pAsyncFlags, { xFunc, xStep, xFinal });
      }
      return result;
    };
  },
  $adapters_support__deps: ['$UTF8ToString'],
  $adapters_support__postset: 'adapters_support();',
};

function injectMethod(signature, isAsync) {
  const method = `${signature}${isAsync ? '_async' : ''}`;
  adapters[`${method}`] = isAsync ?
    // @ts-ignore
    function(...args) { return adapters_support(true, ...args) } :
    // @ts-ignore
    function(...args) { return adapters_support(false, ...args) };
  adapters[`${method}__deps`] = ['$adapters_support'];
  adapters[`${method}__async`] = isAsync;

  // Emscripten "legalizes" 64-bit integer arguments by passing them as
  // two 32-bit signed integers.
  adapters[`${method}__sig`] = `${signature[0]}${signature.substring(1).replaceAll('j', 'ii')}`;
}

// For each function signature, inject a synchronous and asynchronous
// relaying method definition.
for (const signature of SIGNATURES) {
  injectMethod(signature, false);
  injectMethod(signature, true);
}

// @ts-ignore
addToLibrary(adapters);