
var Module = (() => {
  var _scriptName = import.meta.url;
  
  return (
function(moduleArg = {}) {
  var moduleRtn;

// include: shell.js
// The Module object: Our interface to the outside world. We import
// and export values on it. There are various ways Module can be used:
// 1. Not defined. We create it here
// 2. A function parameter, function(moduleArg) => Promise<Module>
// 3. pre-run appended it, var Module = {}; ..generated code..
// 4. External script tag defines var Module.
// We need to check if Module already exists (e.g. case 3 above).
// Substitution will be replaced with actual code on later stage of the build,
// this way Closure Compiler will not mangle it (e.g. case 4. above).
// Note that if you want to run closure, and also to use Module
// after the generated code, you will need to define   var Module = {};
// before the code. Then that object will be used in the code, and you
// can continue to use Module afterwards as well.
var Module = moduleArg;

// Set up the promise that indicates the Module is initialized
var readyPromiseResolve, readyPromiseReject;
var readyPromise = new Promise((resolve, reject) => {
  readyPromiseResolve = resolve;
  readyPromiseReject = reject;
});

// Determine the runtime environment we are in. You can customize this by
// setting the ENVIRONMENT setting at compile time (see settings.js).

// Attempt to auto-detect the environment
var ENVIRONMENT_IS_WEB = typeof window == 'object';
var ENVIRONMENT_IS_WORKER = typeof WorkerGlobalScope != 'undefined';
// N.b. Electron.js environment is simultaneously a NODE-environment, but
// also a web environment.
var ENVIRONMENT_IS_NODE = typeof process == 'object' && typeof process.versions == 'object' && typeof process.versions.node == 'string' && process.type != 'renderer';
var ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;

// --pre-jses are emitted after the Module integration code, so that they can
// refer to Module (if they choose; they can also define Module)


// Sometimes an existing Module object exists with properties
// meant to overwrite the default module functionality. Here
// we collect those properties and reapply _after_ we configure
// the current environment's defaults to avoid having to be so
// defensive during initialization.
var moduleOverrides = Object.assign({}, Module);

var arguments_ = [];
var thisProgram = './this.program';
var quit_ = (status, toThrow) => {
  throw toThrow;
};

// `/` should be present at the end if `scriptDirectory` is not empty
var scriptDirectory = '';
function locateFile(path) {
  if (Module['locateFile']) {
    return Module['locateFile'](path, scriptDirectory);
  }
  return scriptDirectory + path;
}

// Hooks that are implemented differently in different runtime environments.
var readAsync, readBinary;

// Note that this includes Node.js workers when relevant (pthreads is enabled).
// Node.js workers are detected as a combination of ENVIRONMENT_IS_WORKER and
// ENVIRONMENT_IS_NODE.
if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
  if (ENVIRONMENT_IS_WORKER) { // Check worker, not web, since window could be polyfilled
    scriptDirectory = self.location.href;
  } else if (typeof document != 'undefined' && document.currentScript) { // web
    scriptDirectory = document.currentScript.src;
  }
  // When MODULARIZE, this JS may be executed later, after document.currentScript
  // is gone, so we saved it, and we use it here instead of any other info.
  if (_scriptName) {
    scriptDirectory = _scriptName;
  }
  // blob urls look like blob:http://site.com/etc/etc and we cannot infer anything from them.
  // otherwise, slice off the final part of the url to find the script directory.
  // if scriptDirectory does not contain a slash, lastIndexOf will return -1,
  // and scriptDirectory will correctly be replaced with an empty string.
  // If scriptDirectory contains a query (starting with ?) or a fragment (starting with #),
  // they are removed because they could contain a slash.
  if (scriptDirectory.startsWith('blob:')) {
    scriptDirectory = '';
  } else {
    scriptDirectory = scriptDirectory.substr(0, scriptDirectory.replace(/[?#].*/, '').lastIndexOf('/')+1);
  }

  {
// include: web_or_worker_shell_read.js
if (ENVIRONMENT_IS_WORKER) {
    readBinary = (url) => {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.responseType = 'arraybuffer';
      xhr.send(null);
      return new Uint8Array(/** @type{!ArrayBuffer} */(xhr.response));
    };
  }

  readAsync = async (url) => {
    var response = await fetch(url, { credentials: 'same-origin' });
    if (response.ok) {
      return response.arrayBuffer();
    }
    throw new Error(response.status + ' : ' + response.url);
  };
// end include: web_or_worker_shell_read.js
  }
} else
{
}

var out = Module['print'] || console.log.bind(console);
var err = Module['printErr'] || console.error.bind(console);

// Merge back in the overrides
Object.assign(Module, moduleOverrides);
// Free the object hierarchy contained in the overrides, this lets the GC
// reclaim data used.
moduleOverrides = null;

// Emit code to handle expected values on the Module object. This applies Module.x
// to the proper local x. This has two benefits: first, we only emit it if it is
// expected to arrive, and second, by using a local everywhere else that can be
// minified.

if (Module['arguments']) arguments_ = Module['arguments'];

if (Module['thisProgram']) thisProgram = Module['thisProgram'];

// perform assertions in shell.js after we set up out() and err(), as otherwise if an assertion fails it cannot print the message
// end include: shell.js

// include: preamble.js
// === Preamble library stuff ===

// Documentation for the public APIs defined in this file must be updated in:
//    site/source/docs/api_reference/preamble.js.rst
// A prebuilt local version of the documentation is available at:
//    site/build/text/docs/api_reference/preamble.js.txt
// You can also build docs locally as HTML or other formats in site/
// An online HTML version (which may be of a different version of Emscripten)
//    is up at http://kripken.github.io/emscripten-site/docs/api_reference/preamble.js.html

var wasmBinary = Module['wasmBinary'];

// Wasm globals

var wasmMemory;

//========================================
// Runtime essentials
//========================================

// whether we are quitting the application. no code should run after this.
// set in exit() and abort()
var ABORT = false;

// set by exit() and abort().  Passed to 'onExit' handler.
// NOTE: This is also used as the process return code code in shell environments
// but only when noExitRuntime is false.
var EXITSTATUS;

// In STRICT mode, we only define assert() when ASSERTIONS is set.  i.e. we
// don't define it at all in release modes.  This matches the behaviour of
// MINIMAL_RUNTIME.
// TODO(sbc): Make this the default even without STRICT enabled.
/** @type {function(*, string=)} */
function assert(condition, text) {
  if (!condition) {
    // This build was created without ASSERTIONS defined.  `assert()` should not
    // ever be called in this configuration but in case there are callers in
    // the wild leave this simple abort() implementation here for now.
    abort(text);
  }
}

// Memory management

var HEAP,
/** @type {!Int8Array} */
  HEAP8,
/** @type {!Uint8Array} */
  HEAPU8,
/** @type {!Int16Array} */
  HEAP16,
/** @type {!Uint16Array} */
  HEAPU16,
/** @type {!Int32Array} */
  HEAP32,
/** @type {!Uint32Array} */
  HEAPU32,
/** @type {!Float32Array} */
  HEAPF32,
/** @type {!Float64Array} */
  HEAPF64;

// include: runtime_shared.js
function updateMemoryViews() {
  var b = wasmMemory.buffer;
  Module['HEAP8'] = HEAP8 = new Int8Array(b);
  Module['HEAP16'] = HEAP16 = new Int16Array(b);
  Module['HEAPU8'] = HEAPU8 = new Uint8Array(b);
  Module['HEAPU16'] = HEAPU16 = new Uint16Array(b);
  Module['HEAP32'] = HEAP32 = new Int32Array(b);
  Module['HEAPU32'] = HEAPU32 = new Uint32Array(b);
  Module['HEAPF32'] = HEAPF32 = new Float32Array(b);
  Module['HEAPF64'] = HEAPF64 = new Float64Array(b);
}

// end include: runtime_shared.js
// include: runtime_stack_check.js
// end include: runtime_stack_check.js
var __ATPRERUN__  = []; // functions called before the runtime is initialized
var __ATINIT__    = []; // functions called during startup
var __ATMAIN__    = []; // functions called when main() is to be run
var __ATEXIT__    = []; // functions called during shutdown
var __ATPOSTRUN__ = []; // functions called after the main() is called

var runtimeInitialized = false;

function preRun() {
  if (Module['preRun']) {
    if (typeof Module['preRun'] == 'function') Module['preRun'] = [Module['preRun']];
    while (Module['preRun'].length) {
      addOnPreRun(Module['preRun'].shift());
    }
  }
  callRuntimeCallbacks(__ATPRERUN__);
}

function initRuntime() {
  runtimeInitialized = true;

  
if (!Module['noFSInit'] && !FS.initialized)
  FS.init();
FS.ignorePermissions = false;

TTY.init();
  callRuntimeCallbacks(__ATINIT__);
}

function preMain() {
  
  callRuntimeCallbacks(__ATMAIN__);
}

function postRun() {

  if (Module['postRun']) {
    if (typeof Module['postRun'] == 'function') Module['postRun'] = [Module['postRun']];
    while (Module['postRun'].length) {
      addOnPostRun(Module['postRun'].shift());
    }
  }

  callRuntimeCallbacks(__ATPOSTRUN__);
}

function addOnPreRun(cb) {
  __ATPRERUN__.unshift(cb);
}

function addOnInit(cb) {
  __ATINIT__.unshift(cb);
}

function addOnPreMain(cb) {
  __ATMAIN__.unshift(cb);
}

function addOnExit(cb) {
}

function addOnPostRun(cb) {
  __ATPOSTRUN__.unshift(cb);
}

// include: runtime_math.js
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/imul

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/fround

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/clz32

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/trunc

// end include: runtime_math.js
// A counter of dependencies for calling run(). If we need to
// do asynchronous work before running, increment this and
// decrement it. Incrementing must happen in a place like
// Module.preRun (used by emcc to add file preloading).
// Note that you can add dependencies in preRun, even though
// it happens right before run - run will be postponed until
// the dependencies are met.
var runDependencies = 0;
var dependenciesFulfilled = null; // overridden to take different actions when all run dependencies are fulfilled

function getUniqueRunDependency(id) {
  return id;
}

function addRunDependency(id) {
  runDependencies++;

  Module['monitorRunDependencies']?.(runDependencies);

}

function removeRunDependency(id) {
  runDependencies--;

  Module['monitorRunDependencies']?.(runDependencies);

  if (runDependencies == 0) {
    if (dependenciesFulfilled) {
      var callback = dependenciesFulfilled;
      dependenciesFulfilled = null;
      callback(); // can add another dependenciesFulfilled
    }
  }
}

/** @param {string|number=} what */
function abort(what) {
  Module['onAbort']?.(what);

  what = 'Aborted(' + what + ')';
  // TODO(sbc): Should we remove printing and leave it up to whoever
  // catches the exception?
  err(what);

  ABORT = true;

  what += '. Build with -sASSERTIONS for more info.';

  // Use a wasm runtime error, because a JS error might be seen as a foreign
  // exception, which means we'd run destructors on it. We need the error to
  // simply make the program stop.
  // FIXME This approach does not work in Wasm EH because it currently does not assume
  // all RuntimeErrors are from traps; it decides whether a RuntimeError is from
  // a trap or not based on a hidden field within the object. So at the moment
  // we don't have a way of throwing a wasm trap from JS. TODO Make a JS API that
  // allows this in the wasm spec.

  // Suppress closure compiler warning here. Closure compiler's builtin extern
  // definition for WebAssembly.RuntimeError claims it takes no arguments even
  // though it can.
  // TODO(https://github.com/google/closure-compiler/pull/3913): Remove if/when upstream closure gets fixed.
  /** @suppress {checkTypes} */
  var e = new WebAssembly.RuntimeError(what);

  readyPromiseReject(e);
  // Throw the error whether or not MODULARIZE is set because abort is used
  // in code paths apart from instantiation where an exception is expected
  // to be thrown when abort is called.
  throw e;
}

// include: memoryprofiler.js
// end include: memoryprofiler.js
// include: URIUtils.js
// Prefix of data URIs emitted by SINGLE_FILE and related options.
var dataURIPrefix = 'data:application/octet-stream;base64,';

/**
 * Indicates whether filename is a base64 data URI.
 * @noinline
 */
var isDataURI = (filename) => filename.startsWith(dataURIPrefix);

/**
 * Indicates whether filename is delivered via file protocol (as opposed to http/https)
 * @noinline
 */
var isFileURI = (filename) => filename.startsWith('file://');
// end include: URIUtils.js
// include: runtime_exceptions.js
// end include: runtime_exceptions.js
function findWasmBinary() {
  if (Module['locateFile']) {
    var f = 'wa-sqlite.wasm';
    if (!isDataURI(f)) {
      return locateFile(f);
    }
    return f;
  }
  // Use bundler-friendly `new URL(..., import.meta.url)` pattern; works in browsers too.
  return new URL('wa-sqlite.wasm', import.meta.url).href;
}

var wasmBinaryFile;

function getBinarySync(file) {
  if (file == wasmBinaryFile && wasmBinary) {
    return new Uint8Array(wasmBinary);
  }
  if (readBinary) {
    return readBinary(file);
  }
  throw 'both async and sync fetching of the wasm failed';
}

async function getWasmBinary(binaryFile) {
  // If we don't have the binary yet, load it asynchronously using readAsync.
  if (!wasmBinary
      ) {
    // Fetch the binary using readAsync
    try {
      var response = await readAsync(binaryFile);
      return new Uint8Array(response);
    } catch {
      // Fall back to getBinarySync below;
    }
  }

  // Otherwise, getBinarySync should be able to get it synchronously
  return getBinarySync(binaryFile);
}

async function instantiateArrayBuffer(binaryFile, imports) {
  try {
    var binary = await getWasmBinary(binaryFile);
    var instance = await WebAssembly.instantiate(binary, imports);
    return instance;
  } catch (reason) {
    err(`failed to asynchronously prepare wasm: ${reason}`);

    abort(reason);
  }
}

async function instantiateAsync(binary, binaryFile, imports) {
  if (!binary &&
      typeof WebAssembly.instantiateStreaming == 'function' &&
      !isDataURI(binaryFile) &&
      typeof fetch == 'function') {
    try {
      var response = fetch(binaryFile, { credentials: 'same-origin' });
      var instantiationResult = await WebAssembly.instantiateStreaming(response, imports);
      return instantiationResult;
    } catch (reason) {
      // We expect the most common failure cause to be a bad MIME type for the binary,
      // in which case falling back to ArrayBuffer instantiation should work.
      err(`wasm streaming compile failed: ${reason}`);
      err('falling back to ArrayBuffer instantiation');
      // fall back of instantiateArrayBuffer below
    };
  }
  return instantiateArrayBuffer(binaryFile, imports);
}

function getWasmImports() {
  // prepare imports
  return {
    'env': wasmImports,
    'wasi_snapshot_preview1': wasmImports,
  }
}

// Create the wasm instance.
// Receives the wasm imports, returns the exports.
async function createWasm() {
  // Load the wasm module and create an instance of using native support in the JS engine.
  // handle a generated wasm instance, receiving its exports and
  // performing other necessary setup
  /** @param {WebAssembly.Module=} module*/
  function receiveInstance(instance, module) {
    wasmExports = instance.exports;

    

    wasmMemory = wasmExports['memory'];
    
    updateMemoryViews();

    wasmTable = wasmExports['__indirect_function_table'];
    

    addOnInit(wasmExports['__wasm_call_ctors']);

    removeRunDependency('wasm-instantiate');
    return wasmExports;
  }
  // wait for the pthread pool (if any)
  addRunDependency('wasm-instantiate');

  // Prefer streaming instantiation if available.
  function receiveInstantiationResult(result) {
    // 'result' is a ResultObject object which has both the module and instance.
    // receiveInstance() will swap in the exports (to Module.asm) so they can be called
    // TODO: Due to Closure regression https://github.com/google/closure-compiler/issues/3193, the above line no longer optimizes out down to the following line.
    // When the regression is fixed, can restore the above PTHREADS-enabled path.
    receiveInstance(result['instance']);
  }

  var info = getWasmImports();

  // User shell pages can write their own Module.instantiateWasm = function(imports, successCallback) callback
  // to manually instantiate the Wasm module themselves. This allows pages to
  // run the instantiation parallel to any other async startup actions they are
  // performing.
  // Also pthreads and wasm workers initialize the wasm instance through this
  // path.
  if (Module['instantiateWasm']) {
    try {
      return Module['instantiateWasm'](info, receiveInstance);
    } catch(e) {
      err(`Module.instantiateWasm callback failed with error: ${e}`);
        // If instantiation fails, reject the module ready promise.
        readyPromiseReject(e);
    }
  }

  wasmBinaryFile ??= findWasmBinary();

  try {
    var result = await instantiateAsync(wasmBinary, wasmBinaryFile, info);
    receiveInstantiationResult(result);
    return result;
  } catch (e) {
    // If instantiation fails, reject the module ready promise.
    readyPromiseReject(e);
    return;
  }
}

// Globals used by JS i64 conversions (see makeSetValue)
var tempDouble;
var tempI64;

// include: runtime_debug.js
// end include: runtime_debug.js
// === Body ===
// end include: preamble.js


  class ExitStatus {
      name = 'ExitStatus';
      constructor(status) {
        this.message = `Program terminated with exit(${status})`;
        this.status = status;
      }
    }

  var callRuntimeCallbacks = (callbacks) => {
      while (callbacks.length > 0) {
        // Pass the module as the first argument.
        callbacks.shift()(Module);
      }
    };

  
    /**
     * @param {number} ptr
     * @param {string} type
     */
  function getValue(ptr, type = 'i8') {
    if (type.endsWith('*')) type = '*';
    switch (type) {
      case 'i1': return HEAP8[ptr];
      case 'i8': return HEAP8[ptr];
      case 'i16': return HEAP16[((ptr)>>1)];
      case 'i32': return HEAP32[((ptr)>>2)];
      case 'i64': abort('to do getValue(i64) use WASM_BIGINT');
      case 'float': return HEAPF32[((ptr)>>2)];
      case 'double': return HEAPF64[((ptr)>>3)];
      case '*': return HEAPU32[((ptr)>>2)];
      default: abort(`invalid type for getValue: ${type}`);
    }
  }

  var noExitRuntime = Module['noExitRuntime'] || true;

  
    /**
     * @param {number} ptr
     * @param {number} value
     * @param {string} type
     */
  function setValue(ptr, value, type = 'i8') {
    if (type.endsWith('*')) type = '*';
    switch (type) {
      case 'i1': HEAP8[ptr] = value; break;
      case 'i8': HEAP8[ptr] = value; break;
      case 'i16': HEAP16[((ptr)>>1)] = value; break;
      case 'i32': HEAP32[((ptr)>>2)] = value; break;
      case 'i64': abort('to do setValue(i64) use WASM_BIGINT');
      case 'float': HEAPF32[((ptr)>>2)] = value; break;
      case 'double': HEAPF64[((ptr)>>3)] = value; break;
      case '*': HEAPU32[((ptr)>>2)] = value; break;
      default: abort(`invalid type for setValue: ${type}`);
    }
  }

  var stackRestore = (val) => __emscripten_stack_restore(val);

  var stackSave = () => _emscripten_stack_get_current();

  var UTF8Decoder = typeof TextDecoder != 'undefined' ? new TextDecoder() : undefined;
  
    /**
     * Given a pointer 'idx' to a null-terminated UTF8-encoded string in the given
     * array that contains uint8 values, returns a copy of that string as a
     * Javascript String object.
     * heapOrArray is either a regular array, or a JavaScript typed array view.
     * @param {number=} idx
     * @param {number=} maxBytesToRead
     * @return {string}
     */
  var UTF8ArrayToString = (heapOrArray, idx = 0, maxBytesToRead = NaN) => {
      var endIdx = idx + maxBytesToRead;
      var endPtr = idx;
      // TextDecoder needs to know the byte length in advance, it doesn't stop on
      // null terminator by itself.  Also, use the length info to avoid running tiny
      // strings through TextDecoder, since .subarray() allocates garbage.
      // (As a tiny code save trick, compare endPtr against endIdx using a negation,
      // so that undefined/NaN means Infinity)
      while (heapOrArray[endPtr] && !(endPtr >= endIdx)) ++endPtr;
  
      if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
        return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
      }
      var str = '';
      // If building with TextDecoder, we have already computed the string length
      // above, so test loop end condition against that
      while (idx < endPtr) {
        // For UTF8 byte structure, see:
        // http://en.wikipedia.org/wiki/UTF-8#Description
        // https://www.ietf.org/rfc/rfc2279.txt
        // https://tools.ietf.org/html/rfc3629
        var u0 = heapOrArray[idx++];
        if (!(u0 & 0x80)) { str += String.fromCharCode(u0); continue; }
        var u1 = heapOrArray[idx++] & 63;
        if ((u0 & 0xE0) == 0xC0) { str += String.fromCharCode(((u0 & 31) << 6) | u1); continue; }
        var u2 = heapOrArray[idx++] & 63;
        if ((u0 & 0xF0) == 0xE0) {
          u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
        } else {
          u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (heapOrArray[idx++] & 63);
        }
  
        if (u0 < 0x10000) {
          str += String.fromCharCode(u0);
        } else {
          var ch = u0 - 0x10000;
          str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
        }
      }
      return str;
    };
  
    /**
     * Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the
     * emscripten HEAP, returns a copy of that string as a Javascript String object.
     *
     * @param {number} ptr
     * @param {number=} maxBytesToRead - An optional length that specifies the
     *   maximum number of bytes to read. You can omit this parameter to scan the
     *   string until the first 0 byte. If maxBytesToRead is passed, and the string
     *   at [ptr, ptr+maxBytesToReadr[ contains a null byte in the middle, then the
     *   string will cut short at that byte index (i.e. maxBytesToRead will not
     *   produce a string of exact length [ptr, ptr+maxBytesToRead[) N.B. mixing
     *   frequent uses of UTF8ToString() with and without maxBytesToRead may throw
     *   JS JIT optimizations off, so it is worth to consider consistently using one
     * @return {string}
     */
  var UTF8ToString = (ptr, maxBytesToRead) => {
      return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : '';
    };
  var ___assert_fail = (condition, filename, line, func) =>
      abort(`Assertion failed: ${UTF8ToString(condition)}, at: ` + [filename ? UTF8ToString(filename) : 'unknown filename', line, func ? UTF8ToString(func) : 'unknown function']);

  var PATH = {
  isAbs:(path) => path.charAt(0) === '/',
  splitPath:(filename) => {
        var splitPathRe = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
        return splitPathRe.exec(filename).slice(1);
      },
  normalizeArray:(parts, allowAboveRoot) => {
        // if the path tries to go above the root, `up` ends up > 0
        var up = 0;
        for (var i = parts.length - 1; i >= 0; i--) {
          var last = parts[i];
          if (last === '.') {
            parts.splice(i, 1);
          } else if (last === '..') {
            parts.splice(i, 1);
            up++;
          } else if (up) {
            parts.splice(i, 1);
            up--;
          }
        }
        // if the path is allowed to go above the root, restore leading ..s
        if (allowAboveRoot) {
          for (; up; up--) {
            parts.unshift('..');
          }
        }
        return parts;
      },
  normalize:(path) => {
        var isAbsolute = PATH.isAbs(path),
            trailingSlash = path.substr(-1) === '/';
        // Normalize the path
        path = PATH.normalizeArray(path.split('/').filter((p) => !!p), !isAbsolute).join('/');
        if (!path && !isAbsolute) {
          path = '.';
        }
        if (path && trailingSlash) {
          path += '/';
        }
        return (isAbsolute ? '/' : '') + path;
      },
  dirname:(path) => {
        var result = PATH.splitPath(path),
            root = result[0],
            dir = result[1];
        if (!root && !dir) {
          // No dirname whatsoever
          return '.';
        }
        if (dir) {
          // It has a dirname, strip trailing slash
          dir = dir.substr(0, dir.length - 1);
        }
        return root + dir;
      },
  basename:(path) => {
        // EMSCRIPTEN return '/'' for '/', not an empty string
        if (path === '/') return '/';
        path = PATH.normalize(path);
        path = path.replace(/\/$/, "");
        var lastSlash = path.lastIndexOf('/');
        if (lastSlash === -1) return path;
        return path.substr(lastSlash+1);
      },
  join:(...paths) => PATH.normalize(paths.join('/')),
  join2:(l, r) => PATH.normalize(l + '/' + r),
  };
  
  var initRandomFill = () => {
      if (typeof crypto == 'object' && typeof crypto['getRandomValues'] == 'function') {
        // for modern web browsers
        return (view) => crypto.getRandomValues(view);
      } else
      // we couldn't find a proper implementation, as Math.random() is not suitable for /dev/random, see emscripten-core/emscripten/pull/7096
      abort('initRandomDevice');
    };
  var randomFill = (view) => {
      // Lazily init on the first invocation.
      return (randomFill = initRandomFill())(view);
    };
  
  
  
  var PATH_FS = {
  resolve:(...args) => {
        var resolvedPath = '',
          resolvedAbsolute = false;
        for (var i = args.length - 1; i >= -1 && !resolvedAbsolute; i--) {
          var path = (i >= 0) ? args[i] : FS.cwd();
          // Skip empty and invalid entries
          if (typeof path != 'string') {
            throw new TypeError('Arguments to path.resolve must be strings');
          } else if (!path) {
            return ''; // an invalid portion invalidates the whole thing
          }
          resolvedPath = path + '/' + resolvedPath;
          resolvedAbsolute = PATH.isAbs(path);
        }
        // At this point the path should be resolved to a full absolute path, but
        // handle relative paths to be safe (might happen when process.cwd() fails)
        resolvedPath = PATH.normalizeArray(resolvedPath.split('/').filter((p) => !!p), !resolvedAbsolute).join('/');
        return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
      },
  relative:(from, to) => {
        from = PATH_FS.resolve(from).substr(1);
        to = PATH_FS.resolve(to).substr(1);
        function trim(arr) {
          var start = 0;
          for (; start < arr.length; start++) {
            if (arr[start] !== '') break;
          }
          var end = arr.length - 1;
          for (; end >= 0; end--) {
            if (arr[end] !== '') break;
          }
          if (start > end) return [];
          return arr.slice(start, end - start + 1);
        }
        var fromParts = trim(from.split('/'));
        var toParts = trim(to.split('/'));
        var length = Math.min(fromParts.length, toParts.length);
        var samePartsLength = length;
        for (var i = 0; i < length; i++) {
          if (fromParts[i] !== toParts[i]) {
            samePartsLength = i;
            break;
          }
        }
        var outputParts = [];
        for (var i = samePartsLength; i < fromParts.length; i++) {
          outputParts.push('..');
        }
        outputParts = outputParts.concat(toParts.slice(samePartsLength));
        return outputParts.join('/');
      },
  };
  
  
  
  var FS_stdin_getChar_buffer = [];
  
  var lengthBytesUTF8 = (str) => {
      var len = 0;
      for (var i = 0; i < str.length; ++i) {
        // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code
        // unit, not a Unicode code point of the character! So decode
        // UTF16->UTF32->UTF8.
        // See http://unicode.org/faq/utf_bom.html#utf16-3
        var c = str.charCodeAt(i); // possibly a lead surrogate
        if (c <= 0x7F) {
          len++;
        } else if (c <= 0x7FF) {
          len += 2;
        } else if (c >= 0xD800 && c <= 0xDFFF) {
          len += 4; ++i;
        } else {
          len += 3;
        }
      }
      return len;
    };
  
  var stringToUTF8Array = (str, heap, outIdx, maxBytesToWrite) => {
      // Parameter maxBytesToWrite is not optional. Negative values, 0, null,
      // undefined and false each don't write out any bytes.
      if (!(maxBytesToWrite > 0))
        return 0;
  
      var startIdx = outIdx;
      var endIdx = outIdx + maxBytesToWrite - 1; // -1 for string null terminator.
      for (var i = 0; i < str.length; ++i) {
        // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code
        // unit, not a Unicode code point of the character! So decode
        // UTF16->UTF32->UTF8.
        // See http://unicode.org/faq/utf_bom.html#utf16-3
        // For UTF8 byte structure, see http://en.wikipedia.org/wiki/UTF-8#Description
        // and https://www.ietf.org/rfc/rfc2279.txt
        // and https://tools.ietf.org/html/rfc3629
        var u = str.charCodeAt(i); // possibly a lead surrogate
        if (u >= 0xD800 && u <= 0xDFFF) {
          var u1 = str.charCodeAt(++i);
          u = 0x10000 + ((u & 0x3FF) << 10) | (u1 & 0x3FF);
        }
        if (u <= 0x7F) {
          if (outIdx >= endIdx) break;
          heap[outIdx++] = u;
        } else if (u <= 0x7FF) {
          if (outIdx + 1 >= endIdx) break;
          heap[outIdx++] = 0xC0 | (u >> 6);
          heap[outIdx++] = 0x80 | (u & 63);
        } else if (u <= 0xFFFF) {
          if (outIdx + 2 >= endIdx) break;
          heap[outIdx++] = 0xE0 | (u >> 12);
          heap[outIdx++] = 0x80 | ((u >> 6) & 63);
          heap[outIdx++] = 0x80 | (u & 63);
        } else {
          if (outIdx + 3 >= endIdx) break;
          heap[outIdx++] = 0xF0 | (u >> 18);
          heap[outIdx++] = 0x80 | ((u >> 12) & 63);
          heap[outIdx++] = 0x80 | ((u >> 6) & 63);
          heap[outIdx++] = 0x80 | (u & 63);
        }
      }
      // Null-terminate the pointer to the buffer.
      heap[outIdx] = 0;
      return outIdx - startIdx;
    };
  /** @type {function(string, boolean=, number=)} */
  function intArrayFromString(stringy, dontAddNull, length) {
    var len = length > 0 ? length : lengthBytesUTF8(stringy)+1;
    var u8array = new Array(len);
    var numBytesWritten = stringToUTF8Array(stringy, u8array, 0, u8array.length);
    if (dontAddNull) u8array.length = numBytesWritten;
    return u8array;
  }
  var FS_stdin_getChar = () => {
      if (!FS_stdin_getChar_buffer.length) {
        var result = null;
        if (typeof window != 'undefined' &&
          typeof window.prompt == 'function') {
          // Browser.
          result = window.prompt('Input: ');  // returns null on cancel
          if (result !== null) {
            result += '\n';
          }
        } else
        {}
        if (!result) {
          return null;
        }
        FS_stdin_getChar_buffer = intArrayFromString(result, true);
      }
      return FS_stdin_getChar_buffer.shift();
    };
  var TTY = {
  ttys:[],
  init() {
        // https://github.com/emscripten-core/emscripten/pull/1555
        // if (ENVIRONMENT_IS_NODE) {
        //   // currently, FS.init does not distinguish if process.stdin is a file or TTY
        //   // device, it always assumes it's a TTY device. because of this, we're forcing
        //   // process.stdin to UTF8 encoding to at least make stdin reading compatible
        //   // with text files until FS.init can be refactored.
        //   process.stdin.setEncoding('utf8');
        // }
      },
  shutdown() {
        // https://github.com/emscripten-core/emscripten/pull/1555
        // if (ENVIRONMENT_IS_NODE) {
        //   // inolen: any idea as to why node -e 'process.stdin.read()' wouldn't exit immediately (with process.stdin being a tty)?
        //   // isaacs: because now it's reading from the stream, you've expressed interest in it, so that read() kicks off a _read() which creates a ReadReq operation
        //   // inolen: I thought read() in that case was a synchronous operation that just grabbed some amount of buffered data if it exists?
        //   // isaacs: it is. but it also triggers a _read() call, which calls readStart() on the handle
        //   // isaacs: do process.stdin.pause() and i'd think it'd probably close the pending call
        //   process.stdin.pause();
        // }
      },
  register(dev, ops) {
        TTY.ttys[dev] = { input: [], output: [], ops: ops };
        FS.registerDevice(dev, TTY.stream_ops);
      },
  stream_ops:{
  open(stream) {
          var tty = TTY.ttys[stream.node.rdev];
          if (!tty) {
            throw new FS.ErrnoError(43);
          }
          stream.tty = tty;
          stream.seekable = false;
        },
  close(stream) {
          // flush any pending line data
          stream.tty.ops.fsync(stream.tty);
        },
  fsync(stream) {
          stream.tty.ops.fsync(stream.tty);
        },
  read(stream, buffer, offset, length, pos /* ignored */) {
          if (!stream.tty || !stream.tty.ops.get_char) {
            throw new FS.ErrnoError(60);
          }
          var bytesRead = 0;
          for (var i = 0; i < length; i++) {
            var result;
            try {
              result = stream.tty.ops.get_char(stream.tty);
            } catch (e) {
              throw new FS.ErrnoError(29);
            }
            if (result === undefined && bytesRead === 0) {
              throw new FS.ErrnoError(6);
            }
            if (result === null || result === undefined) break;
            bytesRead++;
            buffer[offset+i] = result;
          }
          if (bytesRead) {
            stream.node.atime = Date.now();
          }
          return bytesRead;
        },
  write(stream, buffer, offset, length, pos) {
          if (!stream.tty || !stream.tty.ops.put_char) {
            throw new FS.ErrnoError(60);
          }
          try {
            for (var i = 0; i < length; i++) {
              stream.tty.ops.put_char(stream.tty, buffer[offset+i]);
            }
          } catch (e) {
            throw new FS.ErrnoError(29);
          }
          if (length) {
            stream.node.mtime = stream.node.ctime = Date.now();
          }
          return i;
        },
  },
  default_tty_ops:{
  get_char(tty) {
          return FS_stdin_getChar();
        },
  put_char(tty, val) {
          if (val === null || val === 10) {
            out(UTF8ArrayToString(tty.output));
            tty.output = [];
          } else {
            if (val != 0) tty.output.push(val); // val == 0 would cut text output off in the middle.
          }
        },
  fsync(tty) {
          if (tty.output && tty.output.length > 0) {
            out(UTF8ArrayToString(tty.output));
            tty.output = [];
          }
        },
  ioctl_tcgets(tty) {
          // typical setting
          return {
            c_iflag: 25856,
            c_oflag: 5,
            c_cflag: 191,
            c_lflag: 35387,
            c_cc: [
              0x03, 0x1c, 0x7f, 0x15, 0x04, 0x00, 0x01, 0x00, 0x11, 0x13, 0x1a, 0x00,
              0x12, 0x0f, 0x17, 0x16, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
              0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            ]
          };
        },
  ioctl_tcsets(tty, optional_actions, data) {
          // currently just ignore
          return 0;
        },
  ioctl_tiocgwinsz(tty) {
          return [24, 80];
        },
  },
  default_tty1_ops:{
  put_char(tty, val) {
          if (val === null || val === 10) {
            err(UTF8ArrayToString(tty.output));
            tty.output = [];
          } else {
            if (val != 0) tty.output.push(val);
          }
        },
  fsync(tty) {
          if (tty.output && tty.output.length > 0) {
            err(UTF8ArrayToString(tty.output));
            tty.output = [];
          }
        },
  },
  };
  
  
  var zeroMemory = (address, size) => {
      HEAPU8.fill(0, address, address + size);
    };
  
  var alignMemory = (size, alignment) => {
      return Math.ceil(size / alignment) * alignment;
    };
  var mmapAlloc = (size) => {
      size = alignMemory(size, 65536);
      var ptr = _emscripten_builtin_memalign(65536, size);
      if (ptr) zeroMemory(ptr, size);
      return ptr;
    };
  var MEMFS = {
  ops_table:null,
  mount(mount) {
        return MEMFS.createNode(null, '/', 16895, 0);
      },
  createNode(parent, name, mode, dev) {
        if (FS.isBlkdev(mode) || FS.isFIFO(mode)) {
          // no supported
          throw new FS.ErrnoError(63);
        }
        MEMFS.ops_table ||= {
          dir: {
            node: {
              getattr: MEMFS.node_ops.getattr,
              setattr: MEMFS.node_ops.setattr,
              lookup: MEMFS.node_ops.lookup,
              mknod: MEMFS.node_ops.mknod,
              rename: MEMFS.node_ops.rename,
              unlink: MEMFS.node_ops.unlink,
              rmdir: MEMFS.node_ops.rmdir,
              readdir: MEMFS.node_ops.readdir,
              symlink: MEMFS.node_ops.symlink
            },
            stream: {
              llseek: MEMFS.stream_ops.llseek
            }
          },
          file: {
            node: {
              getattr: MEMFS.node_ops.getattr,
              setattr: MEMFS.node_ops.setattr
            },
            stream: {
              llseek: MEMFS.stream_ops.llseek,
              read: MEMFS.stream_ops.read,
              write: MEMFS.stream_ops.write,
              allocate: MEMFS.stream_ops.allocate,
              mmap: MEMFS.stream_ops.mmap,
              msync: MEMFS.stream_ops.msync
            }
          },
          link: {
            node: {
              getattr: MEMFS.node_ops.getattr,
              setattr: MEMFS.node_ops.setattr,
              readlink: MEMFS.node_ops.readlink
            },
            stream: {}
          },
          chrdev: {
            node: {
              getattr: MEMFS.node_ops.getattr,
              setattr: MEMFS.node_ops.setattr
            },
            stream: FS.chrdev_stream_ops
          }
        };
        var node = FS.createNode(parent, name, mode, dev);
        if (FS.isDir(node.mode)) {
          node.node_ops = MEMFS.ops_table.dir.node;
          node.stream_ops = MEMFS.ops_table.dir.stream;
          node.contents = {};
        } else if (FS.isFile(node.mode)) {
          node.node_ops = MEMFS.ops_table.file.node;
          node.stream_ops = MEMFS.ops_table.file.stream;
          node.usedBytes = 0; // The actual number of bytes used in the typed array, as opposed to contents.length which gives the whole capacity.
          // When the byte data of the file is populated, this will point to either a typed array, or a normal JS array. Typed arrays are preferred
          // for performance, and used by default. However, typed arrays are not resizable like normal JS arrays are, so there is a small disk size
          // penalty involved for appending file writes that continuously grow a file similar to std::vector capacity vs used -scheme.
          node.contents = null; 
        } else if (FS.isLink(node.mode)) {
          node.node_ops = MEMFS.ops_table.link.node;
          node.stream_ops = MEMFS.ops_table.link.stream;
        } else if (FS.isChrdev(node.mode)) {
          node.node_ops = MEMFS.ops_table.chrdev.node;
          node.stream_ops = MEMFS.ops_table.chrdev.stream;
        }
        node.atime = node.mtime = node.ctime = Date.now();
        // add the new node to the parent
        if (parent) {
          parent.contents[name] = node;
          parent.atime = parent.mtime = parent.ctime = node.atime;
        }
        return node;
      },
  getFileDataAsTypedArray(node) {
        if (!node.contents) return new Uint8Array(0);
        if (node.contents.subarray) return node.contents.subarray(0, node.usedBytes); // Make sure to not return excess unused bytes.
        return new Uint8Array(node.contents);
      },
  expandFileStorage(node, newCapacity) {
        var prevCapacity = node.contents ? node.contents.length : 0;
        if (prevCapacity >= newCapacity) return; // No need to expand, the storage was already large enough.
        // Don't expand strictly to the given requested limit if it's only a very small increase, but instead geometrically grow capacity.
        // For small filesizes (<1MB), perform size*2 geometric increase, but for large sizes, do a much more conservative size*1.125 increase to
        // avoid overshooting the allocation cap by a very large margin.
        var CAPACITY_DOUBLING_MAX = 1024 * 1024;
        newCapacity = Math.max(newCapacity, (prevCapacity * (prevCapacity < CAPACITY_DOUBLING_MAX ? 2.0 : 1.125)) >>> 0);
        if (prevCapacity != 0) newCapacity = Math.max(newCapacity, 256); // At minimum allocate 256b for each file when expanding.
        var oldContents = node.contents;
        node.contents = new Uint8Array(newCapacity); // Allocate new storage.
        if (node.usedBytes > 0) node.contents.set(oldContents.subarray(0, node.usedBytes), 0); // Copy old data over to the new storage.
      },
  resizeFileStorage(node, newSize) {
        if (node.usedBytes == newSize) return;
        if (newSize == 0) {
          node.contents = null; // Fully decommit when requesting a resize to zero.
          node.usedBytes = 0;
        } else {
          var oldContents = node.contents;
          node.contents = new Uint8Array(newSize); // Allocate new storage.
          if (oldContents) {
            node.contents.set(oldContents.subarray(0, Math.min(newSize, node.usedBytes))); // Copy old data over to the new storage.
          }
          node.usedBytes = newSize;
        }
      },
  node_ops:{
  getattr(node) {
          var attr = {};
          // device numbers reuse inode numbers.
          attr.dev = FS.isChrdev(node.mode) ? node.id : 1;
          attr.ino = node.id;
          attr.mode = node.mode;
          attr.nlink = 1;
          attr.uid = 0;
          attr.gid = 0;
          attr.rdev = node.rdev;
          if (FS.isDir(node.mode)) {
            attr.size = 4096;
          } else if (FS.isFile(node.mode)) {
            attr.size = node.usedBytes;
          } else if (FS.isLink(node.mode)) {
            attr.size = node.link.length;
          } else {
            attr.size = 0;
          }
          attr.atime = new Date(node.atime);
          attr.mtime = new Date(node.mtime);
          attr.ctime = new Date(node.ctime);
          // NOTE: In our implementation, st_blocks = Math.ceil(st_size/st_blksize),
          //       but this is not required by the standard.
          attr.blksize = 4096;
          attr.blocks = Math.ceil(attr.size / attr.blksize);
          return attr;
        },
  setattr(node, attr) {
          for (const key of ["mode", "atime", "mtime", "ctime"]) {
            if (attr[key]) {
              node[key] = attr[key];
            }
          }
          if (attr.size !== undefined) {
            MEMFS.resizeFileStorage(node, attr.size);
          }
        },
  lookup(parent, name) {
          throw MEMFS.doesNotExistError;
        },
  mknod(parent, name, mode, dev) {
          return MEMFS.createNode(parent, name, mode, dev);
        },
  rename(old_node, new_dir, new_name) {
          var new_node;
          try {
            new_node = FS.lookupNode(new_dir, new_name);
          } catch (e) {}
          if (new_node) {
            if (FS.isDir(old_node.mode)) {
              // if we're overwriting a directory at new_name, make sure it's empty.
              for (var i in new_node.contents) {
                throw new FS.ErrnoError(55);
              }
            }
            FS.hashRemoveNode(new_node);
          }
          // do the internal rewiring
          delete old_node.parent.contents[old_node.name];
          new_dir.contents[new_name] = old_node;
          old_node.name = new_name;
          new_dir.ctime = new_dir.mtime = old_node.parent.ctime = old_node.parent.mtime = Date.now();
        },
  unlink(parent, name) {
          delete parent.contents[name];
          parent.ctime = parent.mtime = Date.now();
        },
  rmdir(parent, name) {
          var node = FS.lookupNode(parent, name);
          for (var i in node.contents) {
            throw new FS.ErrnoError(55);
          }
          delete parent.contents[name];
          parent.ctime = parent.mtime = Date.now();
        },
  readdir(node) {
          return ['.', '..', ...Object.keys(node.contents)];
        },
  symlink(parent, newname, oldpath) {
          var node = MEMFS.createNode(parent, newname, 0o777 | 40960, 0);
          node.link = oldpath;
          return node;
        },
  readlink(node) {
          if (!FS.isLink(node.mode)) {
            throw new FS.ErrnoError(28);
          }
          return node.link;
        },
  },
  stream_ops:{
  read(stream, buffer, offset, length, position) {
          var contents = stream.node.contents;
          if (position >= stream.node.usedBytes) return 0;
          var size = Math.min(stream.node.usedBytes - position, length);
          if (size > 8 && contents.subarray) { // non-trivial, and typed array
            buffer.set(contents.subarray(position, position + size), offset);
          } else {
            for (var i = 0; i < size; i++) buffer[offset + i] = contents[position + i];
          }
          return size;
        },
  write(stream, buffer, offset, length, position, canOwn) {
          // If the buffer is located in main memory (HEAP), and if
          // memory can grow, we can't hold on to references of the
          // memory buffer, as they may get invalidated. That means we
          // need to do copy its contents.
          if (buffer.buffer === HEAP8.buffer) {
            canOwn = false;
          }
  
          if (!length) return 0;
          var node = stream.node;
          node.mtime = node.ctime = Date.now();
  
          if (buffer.subarray && (!node.contents || node.contents.subarray)) { // This write is from a typed array to a typed array?
            if (canOwn) {
              node.contents = buffer.subarray(offset, offset + length);
              node.usedBytes = length;
              return length;
            } else if (node.usedBytes === 0 && position === 0) { // If this is a simple first write to an empty file, do a fast set since we don't need to care about old data.
              node.contents = buffer.slice(offset, offset + length);
              node.usedBytes = length;
              return length;
            } else if (position + length <= node.usedBytes) { // Writing to an already allocated and used subrange of the file?
              node.contents.set(buffer.subarray(offset, offset + length), position);
              return length;
            }
          }
  
          // Appending to an existing file and we need to reallocate, or source data did not come as a typed array.
          MEMFS.expandFileStorage(node, position+length);
          if (node.contents.subarray && buffer.subarray) {
            // Use typed array write which is available.
            node.contents.set(buffer.subarray(offset, offset + length), position);
          } else {
            for (var i = 0; i < length; i++) {
             node.contents[position + i] = buffer[offset + i]; // Or fall back to manual write if not.
            }
          }
          node.usedBytes = Math.max(node.usedBytes, position + length);
          return length;
        },
  llseek(stream, offset, whence) {
          var position = offset;
          if (whence === 1) {
            position += stream.position;
          } else if (whence === 2) {
            if (FS.isFile(stream.node.mode)) {
              position += stream.node.usedBytes;
            }
          }
          if (position < 0) {
            throw new FS.ErrnoError(28);
          }
          return position;
        },
  allocate(stream, offset, length) {
          MEMFS.expandFileStorage(stream.node, offset + length);
          stream.node.usedBytes = Math.max(stream.node.usedBytes, offset + length);
        },
  mmap(stream, length, position, prot, flags) {
          if (!FS.isFile(stream.node.mode)) {
            throw new FS.ErrnoError(43);
          }
          var ptr;
          var allocated;
          var contents = stream.node.contents;
          // Only make a new copy when MAP_PRIVATE is specified.
          if (!(flags & 2) && contents && contents.buffer === HEAP8.buffer) {
            // We can't emulate MAP_SHARED when the file is not backed by the
            // buffer we're mapping to (e.g. the HEAP buffer).
            allocated = false;
            ptr = contents.byteOffset;
          } else {
            allocated = true;
            ptr = mmapAlloc(length);
            if (!ptr) {
              throw new FS.ErrnoError(48);
            }
            if (contents) {
              // Try to avoid unnecessary slices.
              if (position > 0 || position + length < contents.length) {
                if (contents.subarray) {
                  contents = contents.subarray(position, position + length);
                } else {
                  contents = Array.prototype.slice.call(contents, position, position + length);
                }
              }
              HEAP8.set(contents, ptr);
            }
          }
          return { ptr, allocated };
        },
  msync(stream, buffer, offset, length, mmapFlags) {
          MEMFS.stream_ops.write(stream, buffer, 0, length, offset, false);
          // should we check if bytesWritten and length are the same?
          return 0;
        },
  },
  };
  
  var asyncLoad = async (url) => {
      var arrayBuffer = await readAsync(url);
      return new Uint8Array(arrayBuffer);
    };
  
  
  var FS_createDataFile = (parent, name, fileData, canRead, canWrite, canOwn) => {
      FS.createDataFile(parent, name, fileData, canRead, canWrite, canOwn);
    };
  
  var preloadPlugins = Module['preloadPlugins'] || [];
  var FS_handledByPreloadPlugin = (byteArray, fullname, finish, onerror) => {
      // Ensure plugins are ready.
      if (typeof Browser != 'undefined') Browser.init();
  
      var handled = false;
      preloadPlugins.forEach((plugin) => {
        if (handled) return;
        if (plugin['canHandle'](fullname)) {
          plugin['handle'](byteArray, fullname, finish, onerror);
          handled = true;
        }
      });
      return handled;
    };
  var FS_createPreloadedFile = (parent, name, url, canRead, canWrite, onload, onerror, dontCreateFile, canOwn, preFinish) => {
      // TODO we should allow people to just pass in a complete filename instead
      // of parent and name being that we just join them anyways
      var fullname = name ? PATH_FS.resolve(PATH.join2(parent, name)) : parent;
      var dep = getUniqueRunDependency(`cp ${fullname}`); // might have several active requests for the same fullname
      function processData(byteArray) {
        function finish(byteArray) {
          preFinish?.();
          if (!dontCreateFile) {
            FS_createDataFile(parent, name, byteArray, canRead, canWrite, canOwn);
          }
          onload?.();
          removeRunDependency(dep);
        }
        if (FS_handledByPreloadPlugin(byteArray, fullname, finish, () => {
          onerror?.();
          removeRunDependency(dep);
        })) {
          return;
        }
        finish(byteArray);
      }
      addRunDependency(dep);
      if (typeof url == 'string') {
        asyncLoad(url).then(processData, onerror);
      } else {
        processData(url);
      }
    };
  
  var FS_modeStringToFlags = (str) => {
      var flagModes = {
        'r': 0,
        'r+': 2,
        'w': 512 | 64 | 1,
        'w+': 512 | 64 | 2,
        'a': 1024 | 64 | 1,
        'a+': 1024 | 64 | 2,
      };
      var flags = flagModes[str];
      if (typeof flags == 'undefined') {
        throw new Error(`Unknown file open mode: ${str}`);
      }
      return flags;
    };
  
  var FS_getMode = (canRead, canWrite) => {
      var mode = 0;
      if (canRead) mode |= 292 | 73;
      if (canWrite) mode |= 146;
      return mode;
    };
  
  
  
  var FS = {
  root:null,
  mounts:[],
  devices:{
  },
  streams:[],
  nextInode:1,
  nameTable:null,
  currentPath:"/",
  initialized:false,
  ignorePermissions:true,
  ErrnoError:class {
        name = 'ErrnoError';
        // We set the `name` property to be able to identify `FS.ErrnoError`
        // - the `name` is a standard ECMA-262 property of error objects. Kind of good to have it anyway.
        // - when using PROXYFS, an error can come from an underlying FS
        // as different FS objects have their own FS.ErrnoError each,
        // the test `err instanceof FS.ErrnoError` won't detect an error coming from another filesystem, causing bugs.
        // we'll use the reliable test `err.name == "ErrnoError"` instead
        constructor(errno) {
          this.errno = errno;
        }
      },
  filesystems:null,
  syncFSRequests:0,
  readFiles:{
  },
  FSStream:class {
        shared = {};
        get object() {
          return this.node;
        }
        set object(val) {
          this.node = val;
        }
        get isRead() {
          return (this.flags & 2097155) !== 1;
        }
        get isWrite() {
          return (this.flags & 2097155) !== 0;
        }
        get isAppend() {
          return (this.flags & 1024);
        }
        get flags() {
          return this.shared.flags;
        }
        set flags(val) {
          this.shared.flags = val;
        }
        get position() {
          return this.shared.position;
        }
        set position(val) {
          this.shared.position = val;
        }
      },
  FSNode:class {
        node_ops = {};
        stream_ops = {};
        readMode = 292 | 73;
        writeMode = 146;
        mounted = null;
        constructor(parent, name, mode, rdev) {
          if (!parent) {
            parent = this;  // root node sets parent to itself
          }
          this.parent = parent;
          this.mount = parent.mount;
          this.id = FS.nextInode++;
          this.name = name;
          this.mode = mode;
          this.rdev = rdev;
          this.atime = this.mtime = this.ctime = Date.now();
        }
        get read() {
          return (this.mode & this.readMode) === this.readMode;
        }
        set read(val) {
          val ? this.mode |= this.readMode : this.mode &= ~this.readMode;
        }
        get write() {
          return (this.mode & this.writeMode) === this.writeMode;
        }
        set write(val) {
          val ? this.mode |= this.writeMode : this.mode &= ~this.writeMode;
        }
        get isFolder() {
          return FS.isDir(this.mode);
        }
        get isDevice() {
          return FS.isChrdev(this.mode);
        }
      },
  lookupPath(path, opts = {}) {
        if (!path) return { path: '', node: null };
        opts.follow_mount ??= true
  
        if (!PATH.isAbs(path)) {
          path = FS.cwd() + '/' + path;
        }
  
        // limit max consecutive symlinks to 40 (SYMLOOP_MAX).
        linkloop: for (var nlinks = 0; nlinks < 40; nlinks++) {
          // split the absolute path
          var parts = path.split('/').filter((p) => !!p && (p !== '.'));
  
          // start at the root
          var current = FS.root;
          var current_path = '/';
  
          for (var i = 0; i < parts.length; i++) {
            var islast = (i === parts.length-1);
            if (islast && opts.parent) {
              // stop resolving
              break;
            }
  
            if (parts[i] === '..') {
              current_path = PATH.dirname(current_path);
              current = current.parent;
              continue;
            }
  
            current_path = PATH.join2(current_path, parts[i]);
            try {
              current = FS.lookupNode(current, parts[i]);
            } catch (e) {
              // if noent_okay is true, suppress a ENOENT in the last component
              // and return an object with an undefined node. This is needed for
              // resolving symlinks in the path when creating a file.
              if ((e?.errno === 44) && islast && opts.noent_okay) {
                return { path: current_path };
              }
              throw e;
            }
  
            // jump to the mount's root node if this is a mountpoint
            if (FS.isMountpoint(current) && (!islast || opts.follow_mount)) {
              current = current.mounted.root;
            }
  
            // by default, lookupPath will not follow a symlink if it is the final path component.
            // setting opts.follow = true will override this behavior.
            if (FS.isLink(current.mode) && (!islast || opts.follow)) {
              if (!current.node_ops.readlink) {
                throw new FS.ErrnoError(52);
              }
              var link = current.node_ops.readlink(current);
              if (!PATH.isAbs(link)) {
                link = PATH.dirname(current_path) + '/' + link;
              }
              path = link + '/' + parts.slice(i + 1).join('/');
              continue linkloop;
            }
          }
          return { path: current_path, node: current };
        }
        throw new FS.ErrnoError(32);
      },
  getPath(node) {
        var path;
        while (true) {
          if (FS.isRoot(node)) {
            var mount = node.mount.mountpoint;
            if (!path) return mount;
            return mount[mount.length-1] !== '/' ? `${mount}/${path}` : mount + path;
          }
          path = path ? `${node.name}/${path}` : node.name;
          node = node.parent;
        }
      },
  hashName(parentid, name) {
        var hash = 0;
  
        for (var i = 0; i < name.length; i++) {
          hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
        }
        return ((parentid + hash) >>> 0) % FS.nameTable.length;
      },
  hashAddNode(node) {
        var hash = FS.hashName(node.parent.id, node.name);
        node.name_next = FS.nameTable[hash];
        FS.nameTable[hash] = node;
      },
  hashRemoveNode(node) {
        var hash = FS.hashName(node.parent.id, node.name);
        if (FS.nameTable[hash] === node) {
          FS.nameTable[hash] = node.name_next;
        } else {
          var current = FS.nameTable[hash];
          while (current) {
            if (current.name_next === node) {
              current.name_next = node.name_next;
              break;
            }
            current = current.name_next;
          }
        }
      },
  lookupNode(parent, name) {
        var errCode = FS.mayLookup(parent);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        var hash = FS.hashName(parent.id, name);
        for (var node = FS.nameTable[hash]; node; node = node.name_next) {
          var nodeName = node.name;
          if (node.parent.id === parent.id && nodeName === name) {
            return node;
          }
        }
        // if we failed to find it in the cache, call into the VFS
        return FS.lookup(parent, name);
      },
  createNode(parent, name, mode, rdev) {
        var node = new FS.FSNode(parent, name, mode, rdev);
  
        FS.hashAddNode(node);
  
        return node;
      },
  destroyNode(node) {
        FS.hashRemoveNode(node);
      },
  isRoot(node) {
        return node === node.parent;
      },
  isMountpoint(node) {
        return !!node.mounted;
      },
  isFile(mode) {
        return (mode & 61440) === 32768;
      },
  isDir(mode) {
        return (mode & 61440) === 16384;
      },
  isLink(mode) {
        return (mode & 61440) === 40960;
      },
  isChrdev(mode) {
        return (mode & 61440) === 8192;
      },
  isBlkdev(mode) {
        return (mode & 61440) === 24576;
      },
  isFIFO(mode) {
        return (mode & 61440) === 4096;
      },
  isSocket(mode) {
        return (mode & 49152) === 49152;
      },
  flagsToPermissionString(flag) {
        var perms = ['r', 'w', 'rw'][flag & 3];
        if ((flag & 512)) {
          perms += 'w';
        }
        return perms;
      },
  nodePermissions(node, perms) {
        if (FS.ignorePermissions) {
          return 0;
        }
        // return 0 if any user, group or owner bits are set.
        if (perms.includes('r') && !(node.mode & 292)) {
          return 2;
        } else if (perms.includes('w') && !(node.mode & 146)) {
          return 2;
        } else if (perms.includes('x') && !(node.mode & 73)) {
          return 2;
        }
        return 0;
      },
  mayLookup(dir) {
        if (!FS.isDir(dir.mode)) return 54;
        var errCode = FS.nodePermissions(dir, 'x');
        if (errCode) return errCode;
        if (!dir.node_ops.lookup) return 2;
        return 0;
      },
  mayCreate(dir, name) {
        if (!FS.isDir(dir.mode)) {
          return 54;
        }
        try {
          var node = FS.lookupNode(dir, name);
          return 20;
        } catch (e) {
        }
        return FS.nodePermissions(dir, 'wx');
      },
  mayDelete(dir, name, isdir) {
        var node;
        try {
          node = FS.lookupNode(dir, name);
        } catch (e) {
          return e.errno;
        }
        var errCode = FS.nodePermissions(dir, 'wx');
        if (errCode) {
          return errCode;
        }
        if (isdir) {
          if (!FS.isDir(node.mode)) {
            return 54;
          }
          if (FS.isRoot(node) || FS.getPath(node) === FS.cwd()) {
            return 10;
          }
        } else {
          if (FS.isDir(node.mode)) {
            return 31;
          }
        }
        return 0;
      },
  mayOpen(node, flags) {
        if (!node) {
          return 44;
        }
        if (FS.isLink(node.mode)) {
          return 32;
        } else if (FS.isDir(node.mode)) {
          if (FS.flagsToPermissionString(flags) !== 'r' || // opening for write
              (flags & 512)) { // TODO: check for O_SEARCH? (== search for dir only)
            return 31;
          }
        }
        return FS.nodePermissions(node, FS.flagsToPermissionString(flags));
      },
  MAX_OPEN_FDS:4096,
  nextfd() {
        for (var fd = 0; fd <= FS.MAX_OPEN_FDS; fd++) {
          if (!FS.streams[fd]) {
            return fd;
          }
        }
        throw new FS.ErrnoError(33);
      },
  getStreamChecked(fd) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(8);
        }
        return stream;
      },
  getStream:(fd) => FS.streams[fd],
  createStream(stream, fd = -1) {
  
        // clone it, so we can return an instance of FSStream
        stream = Object.assign(new FS.FSStream(), stream);
        if (fd == -1) {
          fd = FS.nextfd();
        }
        stream.fd = fd;
        FS.streams[fd] = stream;
        return stream;
      },
  closeStream(fd) {
        FS.streams[fd] = null;
      },
  dupStream(origStream, fd = -1) {
        var stream = FS.createStream(origStream, fd);
        stream.stream_ops?.dup?.(stream);
        return stream;
      },
  chrdev_stream_ops:{
  open(stream) {
          var device = FS.getDevice(stream.node.rdev);
          // override node's stream ops with the device's
          stream.stream_ops = device.stream_ops;
          // forward the open call
          stream.stream_ops.open?.(stream);
        },
  llseek() {
          throw new FS.ErrnoError(70);
        },
  },
  major:(dev) => ((dev) >> 8),
  minor:(dev) => ((dev) & 0xff),
  makedev:(ma, mi) => ((ma) << 8 | (mi)),
  registerDevice(dev, ops) {
        FS.devices[dev] = { stream_ops: ops };
      },
  getDevice:(dev) => FS.devices[dev],
  getMounts(mount) {
        var mounts = [];
        var check = [mount];
  
        while (check.length) {
          var m = check.pop();
  
          mounts.push(m);
  
          check.push(...m.mounts);
        }
  
        return mounts;
      },
  syncfs(populate, callback) {
        if (typeof populate == 'function') {
          callback = populate;
          populate = false;
        }
  
        FS.syncFSRequests++;
  
        if (FS.syncFSRequests > 1) {
          err(`warning: ${FS.syncFSRequests} FS.syncfs operations in flight at once, probably just doing extra work`);
        }
  
        var mounts = FS.getMounts(FS.root.mount);
        var completed = 0;
  
        function doCallback(errCode) {
          FS.syncFSRequests--;
          return callback(errCode);
        }
  
        function done(errCode) {
          if (errCode) {
            if (!done.errored) {
              done.errored = true;
              return doCallback(errCode);
            }
            return;
          }
          if (++completed >= mounts.length) {
            doCallback(null);
          }
        };
  
        // sync all mounts
        mounts.forEach((mount) => {
          if (!mount.type.syncfs) {
            return done(null);
          }
          mount.type.syncfs(mount, populate, done);
        });
      },
  mount(type, opts, mountpoint) {
        var root = mountpoint === '/';
        var pseudo = !mountpoint;
        var node;
  
        if (root && FS.root) {
          throw new FS.ErrnoError(10);
        } else if (!root && !pseudo) {
          var lookup = FS.lookupPath(mountpoint, { follow_mount: false });
  
          mountpoint = lookup.path;  // use the absolute path
          node = lookup.node;
  
          if (FS.isMountpoint(node)) {
            throw new FS.ErrnoError(10);
          }
  
          if (!FS.isDir(node.mode)) {
            throw new FS.ErrnoError(54);
          }
        }
  
        var mount = {
          type,
          opts,
          mountpoint,
          mounts: []
        };
  
        // create a root node for the fs
        var mountRoot = type.mount(mount);
        mountRoot.mount = mount;
        mount.root = mountRoot;
  
        if (root) {
          FS.root = mountRoot;
        } else if (node) {
          // set as a mountpoint
          node.mounted = mount;
  
          // add the new mount to the current mount's children
          if (node.mount) {
            node.mount.mounts.push(mount);
          }
        }
  
        return mountRoot;
      },
  unmount(mountpoint) {
        var lookup = FS.lookupPath(mountpoint, { follow_mount: false });
  
        if (!FS.isMountpoint(lookup.node)) {
          throw new FS.ErrnoError(28);
        }
  
        // destroy the nodes for this mount, and all its child mounts
        var node = lookup.node;
        var mount = node.mounted;
        var mounts = FS.getMounts(mount);
  
        Object.keys(FS.nameTable).forEach((hash) => {
          var current = FS.nameTable[hash];
  
          while (current) {
            var next = current.name_next;
  
            if (mounts.includes(current.mount)) {
              FS.destroyNode(current);
            }
  
            current = next;
          }
        });
  
        // no longer a mountpoint
        node.mounted = null;
  
        // remove this mount from the child mounts
        var idx = node.mount.mounts.indexOf(mount);
        node.mount.mounts.splice(idx, 1);
      },
  lookup(parent, name) {
        return parent.node_ops.lookup(parent, name);
      },
  mknod(path, mode, dev) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        if (!name || name === '.' || name === '..') {
          throw new FS.ErrnoError(28);
        }
        var errCode = FS.mayCreate(parent, name);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        if (!parent.node_ops.mknod) {
          throw new FS.ErrnoError(63);
        }
        return parent.node_ops.mknod(parent, name, mode, dev);
      },
  statfs(path) {
  
        // NOTE: None of the defaults here are true. We're just returning safe and
        //       sane values.
        var rtn = {
          bsize: 4096,
          frsize: 4096,
          blocks: 1e6,
          bfree: 5e5,
          bavail: 5e5,
          files: FS.nextInode,
          ffree: FS.nextInode - 1,
          fsid: 42,
          flags: 2,
          namelen: 255,
        };
  
        var parent = FS.lookupPath(path, {follow: true}).node;
        if (parent?.node_ops.statfs) {
          Object.assign(rtn, parent.node_ops.statfs(parent.mount.opts.root));
        }
        return rtn;
      },
  create(path, mode = 0o666) {
        mode &= 4095;
        mode |= 32768;
        return FS.mknod(path, mode, 0);
      },
  mkdir(path, mode = 0o777) {
        mode &= 511 | 512;
        mode |= 16384;
        return FS.mknod(path, mode, 0);
      },
  mkdirTree(path, mode) {
        var dirs = path.split('/');
        var d = '';
        for (var i = 0; i < dirs.length; ++i) {
          if (!dirs[i]) continue;
          d += '/' + dirs[i];
          try {
            FS.mkdir(d, mode);
          } catch(e) {
            if (e.errno != 20) throw e;
          }
        }
      },
  mkdev(path, mode, dev) {
        if (typeof dev == 'undefined') {
          dev = mode;
          mode = 0o666;
        }
        mode |= 8192;
        return FS.mknod(path, mode, dev);
      },
  symlink(oldpath, newpath) {
        if (!PATH_FS.resolve(oldpath)) {
          throw new FS.ErrnoError(44);
        }
        var lookup = FS.lookupPath(newpath, { parent: true });
        var parent = lookup.node;
        if (!parent) {
          throw new FS.ErrnoError(44);
        }
        var newname = PATH.basename(newpath);
        var errCode = FS.mayCreate(parent, newname);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        if (!parent.node_ops.symlink) {
          throw new FS.ErrnoError(63);
        }
        return parent.node_ops.symlink(parent, newname, oldpath);
      },
  rename(old_path, new_path) {
        var old_dirname = PATH.dirname(old_path);
        var new_dirname = PATH.dirname(new_path);
        var old_name = PATH.basename(old_path);
        var new_name = PATH.basename(new_path);
        // parents must exist
        var lookup, old_dir, new_dir;
  
        // let the errors from non existent directories percolate up
        lookup = FS.lookupPath(old_path, { parent: true });
        old_dir = lookup.node;
        lookup = FS.lookupPath(new_path, { parent: true });
        new_dir = lookup.node;
  
        if (!old_dir || !new_dir) throw new FS.ErrnoError(44);
        // need to be part of the same mount
        if (old_dir.mount !== new_dir.mount) {
          throw new FS.ErrnoError(75);
        }
        // source must exist
        var old_node = FS.lookupNode(old_dir, old_name);
        // old path should not be an ancestor of the new path
        var relative = PATH_FS.relative(old_path, new_dirname);
        if (relative.charAt(0) !== '.') {
          throw new FS.ErrnoError(28);
        }
        // new path should not be an ancestor of the old path
        relative = PATH_FS.relative(new_path, old_dirname);
        if (relative.charAt(0) !== '.') {
          throw new FS.ErrnoError(55);
        }
        // see if the new path already exists
        var new_node;
        try {
          new_node = FS.lookupNode(new_dir, new_name);
        } catch (e) {
          // not fatal
        }
        // early out if nothing needs to change
        if (old_node === new_node) {
          return;
        }
        // we'll need to delete the old entry
        var isdir = FS.isDir(old_node.mode);
        var errCode = FS.mayDelete(old_dir, old_name, isdir);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        // need delete permissions if we'll be overwriting.
        // need create permissions if new doesn't already exist.
        errCode = new_node ?
          FS.mayDelete(new_dir, new_name, isdir) :
          FS.mayCreate(new_dir, new_name);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        if (!old_dir.node_ops.rename) {
          throw new FS.ErrnoError(63);
        }
        if (FS.isMountpoint(old_node) || (new_node && FS.isMountpoint(new_node))) {
          throw new FS.ErrnoError(10);
        }
        // if we are going to change the parent, check write permissions
        if (new_dir !== old_dir) {
          errCode = FS.nodePermissions(old_dir, 'w');
          if (errCode) {
            throw new FS.ErrnoError(errCode);
          }
        }
        // remove the node from the lookup hash
        FS.hashRemoveNode(old_node);
        // do the underlying fs rename
        try {
          old_dir.node_ops.rename(old_node, new_dir, new_name);
          // update old node (we do this here to avoid each backend
          // needing to)
          old_node.parent = new_dir;
        } catch (e) {
          throw e;
        } finally {
          // add the node back to the hash (in case node_ops.rename
          // changed its name)
          FS.hashAddNode(old_node);
        }
      },
  rmdir(path) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        var node = FS.lookupNode(parent, name);
        var errCode = FS.mayDelete(parent, name, true);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        if (!parent.node_ops.rmdir) {
          throw new FS.ErrnoError(63);
        }
        if (FS.isMountpoint(node)) {
          throw new FS.ErrnoError(10);
        }
        parent.node_ops.rmdir(parent, name);
        FS.destroyNode(node);
      },
  readdir(path) {
        var lookup = FS.lookupPath(path, { follow: true });
        var node = lookup.node;
        if (!node.node_ops.readdir) {
          throw new FS.ErrnoError(54);
        }
        return node.node_ops.readdir(node);
      },
  unlink(path) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        if (!parent) {
          throw new FS.ErrnoError(44);
        }
        var name = PATH.basename(path);
        var node = FS.lookupNode(parent, name);
        var errCode = FS.mayDelete(parent, name, false);
        if (errCode) {
          // According to POSIX, we should map EISDIR to EPERM, but
          // we instead do what Linux does (and we must, as we use
          // the musl linux libc).
          throw new FS.ErrnoError(errCode);
        }
        if (!parent.node_ops.unlink) {
          throw new FS.ErrnoError(63);
        }
        if (FS.isMountpoint(node)) {
          throw new FS.ErrnoError(10);
        }
        parent.node_ops.unlink(parent, name);
        FS.destroyNode(node);
      },
  readlink(path) {
        var lookup = FS.lookupPath(path);
        var link = lookup.node;
        if (!link) {
          throw new FS.ErrnoError(44);
        }
        if (!link.node_ops.readlink) {
          throw new FS.ErrnoError(28);
        }
        return link.node_ops.readlink(link);
      },
  stat(path, dontFollow) {
        var lookup = FS.lookupPath(path, { follow: !dontFollow });
        var node = lookup.node;
        if (!node) {
          throw new FS.ErrnoError(44);
        }
        if (!node.node_ops.getattr) {
          throw new FS.ErrnoError(63);
        }
        return node.node_ops.getattr(node);
      },
  lstat(path) {
        return FS.stat(path, true);
      },
  chmod(path, mode, dontFollow) {
        var node;
        if (typeof path == 'string') {
          var lookup = FS.lookupPath(path, { follow: !dontFollow });
          node = lookup.node;
        } else {
          node = path;
        }
        if (!node.node_ops.setattr) {
          throw new FS.ErrnoError(63);
        }
        node.node_ops.setattr(node, {
          mode: (mode & 4095) | (node.mode & ~4095),
          ctime: Date.now()
        });
      },
  lchmod(path, mode) {
        FS.chmod(path, mode, true);
      },
  fchmod(fd, mode) {
        var stream = FS.getStreamChecked(fd);
        FS.chmod(stream.node, mode);
      },
  chown(path, uid, gid, dontFollow) {
        var node;
        if (typeof path == 'string') {
          var lookup = FS.lookupPath(path, { follow: !dontFollow });
          node = lookup.node;
        } else {
          node = path;
        }
        if (!node.node_ops.setattr) {
          throw new FS.ErrnoError(63);
        }
        node.node_ops.setattr(node, {
          timestamp: Date.now()
          // we ignore the uid / gid for now
        });
      },
  lchown(path, uid, gid) {
        FS.chown(path, uid, gid, true);
      },
  fchown(fd, uid, gid) {
        var stream = FS.getStreamChecked(fd);
        FS.chown(stream.node, uid, gid);
      },
  truncate(path, len) {
        if (len < 0) {
          throw new FS.ErrnoError(28);
        }
        var node;
        if (typeof path == 'string') {
          var lookup = FS.lookupPath(path, { follow: true });
          node = lookup.node;
        } else {
          node = path;
        }
        if (!node.node_ops.setattr) {
          throw new FS.ErrnoError(63);
        }
        if (FS.isDir(node.mode)) {
          throw new FS.ErrnoError(31);
        }
        if (!FS.isFile(node.mode)) {
          throw new FS.ErrnoError(28);
        }
        var errCode = FS.nodePermissions(node, 'w');
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        node.node_ops.setattr(node, {
          size: len,
          timestamp: Date.now()
        });
      },
  ftruncate(fd, len) {
        var stream = FS.getStreamChecked(fd);
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(28);
        }
        FS.truncate(stream.node, len);
      },
  utime(path, atime, mtime) {
        var lookup = FS.lookupPath(path, { follow: true });
        var node = lookup.node;
        node.node_ops.setattr(node, {
          atime: atime,
          mtime: mtime
        });
      },
  open(path, flags, mode = 0o666) {
        if (path === "") {
          throw new FS.ErrnoError(44);
        }
        flags = typeof flags == 'string' ? FS_modeStringToFlags(flags) : flags;
        if ((flags & 64)) {
          mode = (mode & 4095) | 32768;
        } else {
          mode = 0;
        }
        var node;
        if (typeof path == 'object') {
          node = path;
        } else {
          // noent_okay makes it so that if the final component of the path
          // doesn't exist, lookupPath returns `node: undefined`. `path` will be
          // updated to point to the target of all symlinks.
          var lookup = FS.lookupPath(path, {
            follow: !(flags & 131072),
            noent_okay: true
          });
          node = lookup.node;
          path = lookup.path;
        }
        // perhaps we need to create the node
        var created = false;
        if ((flags & 64)) {
          if (node) {
            // if O_CREAT and O_EXCL are set, error out if the node already exists
            if ((flags & 128)) {
              throw new FS.ErrnoError(20);
            }
          } else {
            // node doesn't exist, try to create it
            node = FS.mknod(path, mode, 0);
            created = true;
          }
        }
        if (!node) {
          throw new FS.ErrnoError(44);
        }
        // can't truncate a device
        if (FS.isChrdev(node.mode)) {
          flags &= ~512;
        }
        // if asked only for a directory, then this must be one
        if ((flags & 65536) && !FS.isDir(node.mode)) {
          throw new FS.ErrnoError(54);
        }
        // check permissions, if this is not a file we just created now (it is ok to
        // create and write to a file with read-only permissions; it is read-only
        // for later use)
        if (!created) {
          var errCode = FS.mayOpen(node, flags);
          if (errCode) {
            throw new FS.ErrnoError(errCode);
          }
        }
        // do truncation if necessary
        if ((flags & 512) && !created) {
          FS.truncate(node, 0);
        }
        // we've already handled these, don't pass down to the underlying vfs
        flags &= ~(128 | 512 | 131072);
  
        // register the stream with the filesystem
        var stream = FS.createStream({
          node,
          path: FS.getPath(node),  // we want the absolute path to the node
          flags,
          seekable: true,
          position: 0,
          stream_ops: node.stream_ops,
          // used by the file family libc calls (fopen, fwrite, ferror, etc.)
          ungotten: [],
          error: false
        });
        // call the new stream's open function
        if (stream.stream_ops.open) {
          stream.stream_ops.open(stream);
        }
        if (Module['logReadFiles'] && !(flags & 1)) {
          if (!(path in FS.readFiles)) {
            FS.readFiles[path] = 1;
          }
        }
        return stream;
      },
  close(stream) {
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(8);
        }
        if (stream.getdents) stream.getdents = null; // free readdir state
        try {
          if (stream.stream_ops.close) {
            stream.stream_ops.close(stream);
          }
        } catch (e) {
          throw e;
        } finally {
          FS.closeStream(stream.fd);
        }
        stream.fd = null;
      },
  isClosed(stream) {
        return stream.fd === null;
      },
  llseek(stream, offset, whence) {
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(8);
        }
        if (!stream.seekable || !stream.stream_ops.llseek) {
          throw new FS.ErrnoError(70);
        }
        if (whence != 0 && whence != 1 && whence != 2) {
          throw new FS.ErrnoError(28);
        }
        stream.position = stream.stream_ops.llseek(stream, offset, whence);
        stream.ungotten = [];
        return stream.position;
      },
  read(stream, buffer, offset, length, position) {
        if (length < 0 || position < 0) {
          throw new FS.ErrnoError(28);
        }
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(8);
        }
        if ((stream.flags & 2097155) === 1) {
          throw new FS.ErrnoError(8);
        }
        if (FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(31);
        }
        if (!stream.stream_ops.read) {
          throw new FS.ErrnoError(28);
        }
        var seeking = typeof position != 'undefined';
        if (!seeking) {
          position = stream.position;
        } else if (!stream.seekable) {
          throw new FS.ErrnoError(70);
        }
        var bytesRead = stream.stream_ops.read(stream, buffer, offset, length, position);
        if (!seeking) stream.position += bytesRead;
        return bytesRead;
      },
  write(stream, buffer, offset, length, position, canOwn) {
        if (length < 0 || position < 0) {
          throw new FS.ErrnoError(28);
        }
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(8);
        }
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(8);
        }
        if (FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(31);
        }
        if (!stream.stream_ops.write) {
          throw new FS.ErrnoError(28);
        }
        if (stream.seekable && stream.flags & 1024) {
          // seek to the end before writing in append mode
          FS.llseek(stream, 0, 2);
        }
        var seeking = typeof position != 'undefined';
        if (!seeking) {
          position = stream.position;
        } else if (!stream.seekable) {
          throw new FS.ErrnoError(70);
        }
        var bytesWritten = stream.stream_ops.write(stream, buffer, offset, length, position, canOwn);
        if (!seeking) stream.position += bytesWritten;
        return bytesWritten;
      },
  allocate(stream, offset, length) {
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(8);
        }
        if (offset < 0 || length <= 0) {
          throw new FS.ErrnoError(28);
        }
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(8);
        }
        if (!FS.isFile(stream.node.mode) && !FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(43);
        }
        if (!stream.stream_ops.allocate) {
          throw new FS.ErrnoError(138);
        }
        stream.stream_ops.allocate(stream, offset, length);
      },
  mmap(stream, length, position, prot, flags) {
        // User requests writing to file (prot & PROT_WRITE != 0).
        // Checking if we have permissions to write to the file unless
        // MAP_PRIVATE flag is set. According to POSIX spec it is possible
        // to write to file opened in read-only mode with MAP_PRIVATE flag,
        // as all modifications will be visible only in the memory of
        // the current process.
        if ((prot & 2) !== 0
            && (flags & 2) === 0
            && (stream.flags & 2097155) !== 2) {
          throw new FS.ErrnoError(2);
        }
        if ((stream.flags & 2097155) === 1) {
          throw new FS.ErrnoError(2);
        }
        if (!stream.stream_ops.mmap) {
          throw new FS.ErrnoError(43);
        }
        if (!length) {
          throw new FS.ErrnoError(28);
        }
        return stream.stream_ops.mmap(stream, length, position, prot, flags);
      },
  msync(stream, buffer, offset, length, mmapFlags) {
        if (!stream.stream_ops.msync) {
          return 0;
        }
        return stream.stream_ops.msync(stream, buffer, offset, length, mmapFlags);
      },
  ioctl(stream, cmd, arg) {
        if (!stream.stream_ops.ioctl) {
          throw new FS.ErrnoError(59);
        }
        return stream.stream_ops.ioctl(stream, cmd, arg);
      },
  readFile(path, opts = {}) {
        opts.flags = opts.flags || 0;
        opts.encoding = opts.encoding || 'binary';
        if (opts.encoding !== 'utf8' && opts.encoding !== 'binary') {
          throw new Error(`Invalid encoding type "${opts.encoding}"`);
        }
        var ret;
        var stream = FS.open(path, opts.flags);
        var stat = FS.stat(path);
        var length = stat.size;
        var buf = new Uint8Array(length);
        FS.read(stream, buf, 0, length, 0);
        if (opts.encoding === 'utf8') {
          ret = UTF8ArrayToString(buf);
        } else if (opts.encoding === 'binary') {
          ret = buf;
        }
        FS.close(stream);
        return ret;
      },
  writeFile(path, data, opts = {}) {
        opts.flags = opts.flags || 577;
        var stream = FS.open(path, opts.flags, opts.mode);
        if (typeof data == 'string') {
          var buf = new Uint8Array(lengthBytesUTF8(data)+1);
          var actualNumBytes = stringToUTF8Array(data, buf, 0, buf.length);
          FS.write(stream, buf, 0, actualNumBytes, undefined, opts.canOwn);
        } else if (ArrayBuffer.isView(data)) {
          FS.write(stream, data, 0, data.byteLength, undefined, opts.canOwn);
        } else {
          throw new Error('Unsupported data type');
        }
        FS.close(stream);
      },
  cwd:() => FS.currentPath,
  chdir(path) {
        var lookup = FS.lookupPath(path, { follow: true });
        if (lookup.node === null) {
          throw new FS.ErrnoError(44);
        }
        if (!FS.isDir(lookup.node.mode)) {
          throw new FS.ErrnoError(54);
        }
        var errCode = FS.nodePermissions(lookup.node, 'x');
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        FS.currentPath = lookup.path;
      },
  createDefaultDirectories() {
        FS.mkdir('/tmp');
        FS.mkdir('/home');
        FS.mkdir('/home/web_user');
      },
  createDefaultDevices() {
        // create /dev
        FS.mkdir('/dev');
        // setup /dev/null
        FS.registerDevice(FS.makedev(1, 3), {
          read: () => 0,
          write: (stream, buffer, offset, length, pos) => length,
          llseek: () => 0,
        });
        FS.mkdev('/dev/null', FS.makedev(1, 3));
        // setup /dev/tty and /dev/tty1
        // stderr needs to print output using err() rather than out()
        // so we register a second tty just for it.
        TTY.register(FS.makedev(5, 0), TTY.default_tty_ops);
        TTY.register(FS.makedev(6, 0), TTY.default_tty1_ops);
        FS.mkdev('/dev/tty', FS.makedev(5, 0));
        FS.mkdev('/dev/tty1', FS.makedev(6, 0));
        // setup /dev/[u]random
        // use a buffer to avoid overhead of individual crypto calls per byte
        var randomBuffer = new Uint8Array(1024), randomLeft = 0;
        var randomByte = () => {
          if (randomLeft === 0) {
            randomLeft = randomFill(randomBuffer).byteLength;
          }
          return randomBuffer[--randomLeft];
        };
        FS.createDevice('/dev', 'random', randomByte);
        FS.createDevice('/dev', 'urandom', randomByte);
        // we're not going to emulate the actual shm device,
        // just create the tmp dirs that reside in it commonly
        FS.mkdir('/dev/shm');
        FS.mkdir('/dev/shm/tmp');
      },
  createSpecialDirectories() {
        // create /proc/self/fd which allows /proc/self/fd/6 => readlink gives the
        // name of the stream for fd 6 (see test_unistd_ttyname)
        FS.mkdir('/proc');
        var proc_self = FS.mkdir('/proc/self');
        FS.mkdir('/proc/self/fd');
        FS.mount({
          mount() {
            var node = FS.createNode(proc_self, 'fd', 16895, 73);
            node.stream_ops = {
              llseek: MEMFS.stream_ops.llseek,
            };
            node.node_ops = {
              lookup(parent, name) {
                var fd = +name;
                var stream = FS.getStreamChecked(fd);
                var ret = {
                  parent: null,
                  mount: { mountpoint: 'fake' },
                  node_ops: { readlink: () => stream.path },
                  id: fd + 1,
                };
                ret.parent = ret; // make it look like a simple root node
                return ret;
              },
              readdir() {
                return Array.from(FS.streams.entries())
                  .filter(([k, v]) => v)
                  .map(([k, v]) => k.toString());
              }
            };
            return node;
          }
        }, {}, '/proc/self/fd');
      },
  createStandardStreams(input, output, error) {
        // TODO deprecate the old functionality of a single
        // input / output callback and that utilizes FS.createDevice
        // and instead require a unique set of stream ops
  
        // by default, we symlink the standard streams to the
        // default tty devices. however, if the standard streams
        // have been overwritten we create a unique device for
        // them instead.
        if (input) {
          FS.createDevice('/dev', 'stdin', input);
        } else {
          FS.symlink('/dev/tty', '/dev/stdin');
        }
        if (output) {
          FS.createDevice('/dev', 'stdout', null, output);
        } else {
          FS.symlink('/dev/tty', '/dev/stdout');
        }
        if (error) {
          FS.createDevice('/dev', 'stderr', null, error);
        } else {
          FS.symlink('/dev/tty1', '/dev/stderr');
        }
  
        // open default streams for the stdin, stdout and stderr devices
        var stdin = FS.open('/dev/stdin', 0);
        var stdout = FS.open('/dev/stdout', 1);
        var stderr = FS.open('/dev/stderr', 1);
      },
  staticInit() {
        FS.nameTable = new Array(4096);
  
        FS.mount(MEMFS, {}, '/');
  
        FS.createDefaultDirectories();
        FS.createDefaultDevices();
        FS.createSpecialDirectories();
  
        FS.filesystems = {
          'MEMFS': MEMFS,
        };
      },
  init(input, output, error) {
        FS.initialized = true;
  
        // Allow Module.stdin etc. to provide defaults, if none explicitly passed to us here
        input ??= Module['stdin'];
        output ??= Module['stdout'];
        error ??= Module['stderr'];
  
        FS.createStandardStreams(input, output, error);
      },
  quit() {
        FS.initialized = false;
        // force-flush all streams, so we get musl std streams printed out
        // close all of our streams
        for (var i = 0; i < FS.streams.length; i++) {
          var stream = FS.streams[i];
          if (!stream) {
            continue;
          }
          FS.close(stream);
        }
      },
  findObject(path, dontResolveLastLink) {
        var ret = FS.analyzePath(path, dontResolveLastLink);
        if (!ret.exists) {
          return null;
        }
        return ret.object;
      },
  analyzePath(path, dontResolveLastLink) {
        // operate from within the context of the symlink's target
        try {
          var lookup = FS.lookupPath(path, { follow: !dontResolveLastLink });
          path = lookup.path;
        } catch (e) {
        }
        var ret = {
          isRoot: false, exists: false, error: 0, name: null, path: null, object: null,
          parentExists: false, parentPath: null, parentObject: null
        };
        try {
          var lookup = FS.lookupPath(path, { parent: true });
          ret.parentExists = true;
          ret.parentPath = lookup.path;
          ret.parentObject = lookup.node;
          ret.name = PATH.basename(path);
          lookup = FS.lookupPath(path, { follow: !dontResolveLastLink });
          ret.exists = true;
          ret.path = lookup.path;
          ret.object = lookup.node;
          ret.name = lookup.node.name;
          ret.isRoot = lookup.path === '/';
        } catch (e) {
          ret.error = e.errno;
        };
        return ret;
      },
  createPath(parent, path, canRead, canWrite) {
        parent = typeof parent == 'string' ? parent : FS.getPath(parent);
        var parts = path.split('/').reverse();
        while (parts.length) {
          var part = parts.pop();
          if (!part) continue;
          var current = PATH.join2(parent, part);
          try {
            FS.mkdir(current);
          } catch (e) {
            // ignore EEXIST
          }
          parent = current;
        }
        return current;
      },
  createFile(parent, name, properties, canRead, canWrite) {
        var path = PATH.join2(typeof parent == 'string' ? parent : FS.getPath(parent), name);
        var mode = FS_getMode(canRead, canWrite);
        return FS.create(path, mode);
      },
  createDataFile(parent, name, data, canRead, canWrite, canOwn) {
        var path = name;
        if (parent) {
          parent = typeof parent == 'string' ? parent : FS.getPath(parent);
          path = name ? PATH.join2(parent, name) : parent;
        }
        var mode = FS_getMode(canRead, canWrite);
        var node = FS.create(path, mode);
        if (data) {
          if (typeof data == 'string') {
            var arr = new Array(data.length);
            for (var i = 0, len = data.length; i < len; ++i) arr[i] = data.charCodeAt(i);
            data = arr;
          }
          // make sure we can write to the file
          FS.chmod(node, mode | 146);
          var stream = FS.open(node, 577);
          FS.write(stream, data, 0, data.length, 0, canOwn);
          FS.close(stream);
          FS.chmod(node, mode);
        }
      },
  createDevice(parent, name, input, output) {
        var path = PATH.join2(typeof parent == 'string' ? parent : FS.getPath(parent), name);
        var mode = FS_getMode(!!input, !!output);
        FS.createDevice.major ??= 64;
        var dev = FS.makedev(FS.createDevice.major++, 0);
        // Create a fake device that a set of stream ops to emulate
        // the old behavior.
        FS.registerDevice(dev, {
          open(stream) {
            stream.seekable = false;
          },
          close(stream) {
            // flush any pending line data
            if (output?.buffer?.length) {
              output(10);
            }
          },
          read(stream, buffer, offset, length, pos /* ignored */) {
            var bytesRead = 0;
            for (var i = 0; i < length; i++) {
              var result;
              try {
                result = input();
              } catch (e) {
                throw new FS.ErrnoError(29);
              }
              if (result === undefined && bytesRead === 0) {
                throw new FS.ErrnoError(6);
              }
              if (result === null || result === undefined) break;
              bytesRead++;
              buffer[offset+i] = result;
            }
            if (bytesRead) {
              stream.node.atime = Date.now();
            }
            return bytesRead;
          },
          write(stream, buffer, offset, length, pos) {
            for (var i = 0; i < length; i++) {
              try {
                output(buffer[offset+i]);
              } catch (e) {
                throw new FS.ErrnoError(29);
              }
            }
            if (length) {
              stream.node.mtime = stream.node.ctime = Date.now();
            }
            return i;
          }
        });
        return FS.mkdev(path, mode, dev);
      },
  forceLoadFile(obj) {
        if (obj.isDevice || obj.isFolder || obj.link || obj.contents) return true;
        if (typeof XMLHttpRequest != 'undefined') {
          throw new Error("Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.");
        } else { // Command-line.
          try {
            obj.contents = readBinary(obj.url);
            obj.usedBytes = obj.contents.length;
          } catch (e) {
            throw new FS.ErrnoError(29);
          }
        }
      },
  createLazyFile(parent, name, url, canRead, canWrite) {
        // Lazy chunked Uint8Array (implements get and length from Uint8Array).
        // Actual getting is abstracted away for eventual reuse.
        class LazyUint8Array {
          lengthKnown = false;
          chunks = []; // Loaded chunks. Index is the chunk number
          get(idx) {
            if (idx > this.length-1 || idx < 0) {
              return undefined;
            }
            var chunkOffset = idx % this.chunkSize;
            var chunkNum = (idx / this.chunkSize)|0;
            return this.getter(chunkNum)[chunkOffset];
          }
          setDataGetter(getter) {
            this.getter = getter;
          }
          cacheLength() {
            // Find length
            var xhr = new XMLHttpRequest();
            xhr.open('HEAD', url, false);
            xhr.send(null);
            if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
            var datalength = Number(xhr.getResponseHeader("Content-length"));
            var header;
            var hasByteServing = (header = xhr.getResponseHeader("Accept-Ranges")) && header === "bytes";
            var usesGzip = (header = xhr.getResponseHeader("Content-Encoding")) && header === "gzip";
  
            var chunkSize = 1024*1024; // Chunk size in bytes
  
            if (!hasByteServing) chunkSize = datalength;
  
            // Function to get a range from the remote URL.
            var doXHR = (from, to) => {
              if (from > to) throw new Error("invalid range (" + from + ", " + to + ") or no bytes requested!");
              if (to > datalength-1) throw new Error("only " + datalength + " bytes available! programmer error!");
  
              // TODO: Use mozResponseArrayBuffer, responseStream, etc. if available.
              var xhr = new XMLHttpRequest();
              xhr.open('GET', url, false);
              if (datalength !== chunkSize) xhr.setRequestHeader("Range", "bytes=" + from + "-" + to);
  
              // Some hints to the browser that we want binary data.
              xhr.responseType = 'arraybuffer';
              if (xhr.overrideMimeType) {
                xhr.overrideMimeType('text/plain; charset=x-user-defined');
              }
  
              xhr.send(null);
              if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
              if (xhr.response !== undefined) {
                return new Uint8Array(/** @type{Array<number>} */(xhr.response || []));
              }
              return intArrayFromString(xhr.responseText || '', true);
            };
            var lazyArray = this;
            lazyArray.setDataGetter((chunkNum) => {
              var start = chunkNum * chunkSize;
              var end = (chunkNum+1) * chunkSize - 1; // including this byte
              end = Math.min(end, datalength-1); // if datalength-1 is selected, this is the last block
              if (typeof lazyArray.chunks[chunkNum] == 'undefined') {
                lazyArray.chunks[chunkNum] = doXHR(start, end);
              }
              if (typeof lazyArray.chunks[chunkNum] == 'undefined') throw new Error('doXHR failed!');
              return lazyArray.chunks[chunkNum];
            });
  
            if (usesGzip || !datalength) {
              // if the server uses gzip or doesn't supply the length, we have to download the whole file to get the (uncompressed) length
              chunkSize = datalength = 1; // this will force getter(0)/doXHR do download the whole file
              datalength = this.getter(0).length;
              chunkSize = datalength;
              out("LazyFiles on gzip forces download of the whole file when length is accessed");
            }
  
            this._length = datalength;
            this._chunkSize = chunkSize;
            this.lengthKnown = true;
          }
          get length() {
            if (!this.lengthKnown) {
              this.cacheLength();
            }
            return this._length;
          }
          get chunkSize() {
            if (!this.lengthKnown) {
              this.cacheLength();
            }
            return this._chunkSize;
          }
        }
  
        if (typeof XMLHttpRequest != 'undefined') {
          if (!ENVIRONMENT_IS_WORKER) throw 'Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc';
          var lazyArray = new LazyUint8Array();
          var properties = { isDevice: false, contents: lazyArray };
        } else {
          var properties = { isDevice: false, url: url };
        }
  
        var node = FS.createFile(parent, name, properties, canRead, canWrite);
        // This is a total hack, but I want to get this lazy file code out of the
        // core of MEMFS. If we want to keep this lazy file concept I feel it should
        // be its own thin LAZYFS proxying calls to MEMFS.
        if (properties.contents) {
          node.contents = properties.contents;
        } else if (properties.url) {
          node.contents = null;
          node.url = properties.url;
        }
        // Add a function that defers querying the file size until it is asked the first time.
        Object.defineProperties(node, {
          usedBytes: {
            get: function() { return this.contents.length; }
          }
        });
        // override each stream op with one that tries to force load the lazy file first
        var stream_ops = {};
        var keys = Object.keys(node.stream_ops);
        keys.forEach((key) => {
          var fn = node.stream_ops[key];
          stream_ops[key] = (...args) => {
            FS.forceLoadFile(node);
            return fn(...args);
          };
        });
        function writeChunks(stream, buffer, offset, length, position) {
          var contents = stream.node.contents;
          if (position >= contents.length)
            return 0;
          var size = Math.min(contents.length - position, length);
          if (contents.slice) { // normal array
            for (var i = 0; i < size; i++) {
              buffer[offset + i] = contents[position + i];
            }
          } else {
            for (var i = 0; i < size; i++) { // LazyUint8Array from sync binary XHR
              buffer[offset + i] = contents.get(position + i);
            }
          }
          return size;
        }
        // use a custom read function
        stream_ops.read = (stream, buffer, offset, length, position) => {
          FS.forceLoadFile(node);
          return writeChunks(stream, buffer, offset, length, position)
        };
        // use a custom mmap function
        stream_ops.mmap = (stream, length, position, prot, flags) => {
          FS.forceLoadFile(node);
          var ptr = mmapAlloc(length);
          if (!ptr) {
            throw new FS.ErrnoError(48);
          }
          writeChunks(stream, HEAP8, ptr, length, position);
          return { ptr, allocated: true };
        };
        node.stream_ops = stream_ops;
        return node;
      },
  };
  
  var SYSCALLS = {
  DEFAULT_POLLMASK:5,
  calculateAt(dirfd, path, allowEmpty) {
        if (PATH.isAbs(path)) {
          return path;
        }
        // relative path
        var dir;
        if (dirfd === -100) {
          dir = FS.cwd();
        } else {
          var dirstream = SYSCALLS.getStreamFromFD(dirfd);
          dir = dirstream.path;
        }
        if (path.length == 0) {
          if (!allowEmpty) {
            throw new FS.ErrnoError(44);;
          }
          return dir;
        }
        return dir + '/' + path;
      },
  doStat(func, path, buf) {
        var stat = func(path);
        HEAP32[((buf)>>2)] = stat.dev;
        HEAP32[(((buf)+(4))>>2)] = stat.mode;
        HEAPU32[(((buf)+(8))>>2)] = stat.nlink;
        HEAP32[(((buf)+(12))>>2)] = stat.uid;
        HEAP32[(((buf)+(16))>>2)] = stat.gid;
        HEAP32[(((buf)+(20))>>2)] = stat.rdev;
        (tempI64 = [stat.size>>>0,(tempDouble = stat.size,(+(Math.abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? (+(Math.floor((tempDouble)/4294967296.0)))>>>0 : (~~((+(Math.ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)], HEAP32[(((buf)+(24))>>2)] = tempI64[0],HEAP32[(((buf)+(28))>>2)] = tempI64[1]);
        HEAP32[(((buf)+(32))>>2)] = 4096;
        HEAP32[(((buf)+(36))>>2)] = stat.blocks;
        var atime = stat.atime.getTime();
        var mtime = stat.mtime.getTime();
        var ctime = stat.ctime.getTime();
        (tempI64 = [Math.floor(atime / 1000)>>>0,(tempDouble = Math.floor(atime / 1000),(+(Math.abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? (+(Math.floor((tempDouble)/4294967296.0)))>>>0 : (~~((+(Math.ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)], HEAP32[(((buf)+(40))>>2)] = tempI64[0],HEAP32[(((buf)+(44))>>2)] = tempI64[1]);
        HEAPU32[(((buf)+(48))>>2)] = (atime % 1000) * 1000 * 1000;
        (tempI64 = [Math.floor(mtime / 1000)>>>0,(tempDouble = Math.floor(mtime / 1000),(+(Math.abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? (+(Math.floor((tempDouble)/4294967296.0)))>>>0 : (~~((+(Math.ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)], HEAP32[(((buf)+(56))>>2)] = tempI64[0],HEAP32[(((buf)+(60))>>2)] = tempI64[1]);
        HEAPU32[(((buf)+(64))>>2)] = (mtime % 1000) * 1000 * 1000;
        (tempI64 = [Math.floor(ctime / 1000)>>>0,(tempDouble = Math.floor(ctime / 1000),(+(Math.abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? (+(Math.floor((tempDouble)/4294967296.0)))>>>0 : (~~((+(Math.ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)], HEAP32[(((buf)+(72))>>2)] = tempI64[0],HEAP32[(((buf)+(76))>>2)] = tempI64[1]);
        HEAPU32[(((buf)+(80))>>2)] = (ctime % 1000) * 1000 * 1000;
        (tempI64 = [stat.ino>>>0,(tempDouble = stat.ino,(+(Math.abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? (+(Math.floor((tempDouble)/4294967296.0)))>>>0 : (~~((+(Math.ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)], HEAP32[(((buf)+(88))>>2)] = tempI64[0],HEAP32[(((buf)+(92))>>2)] = tempI64[1]);
        return 0;
      },
  doMsync(addr, stream, len, flags, offset) {
        if (!FS.isFile(stream.node.mode)) {
          throw new FS.ErrnoError(43);
        }
        if (flags & 2) {
          // MAP_PRIVATE calls need not to be synced back to underlying fs
          return 0;
        }
        var buffer = HEAPU8.slice(addr, addr + len);
        FS.msync(stream, buffer, offset, len, flags);
      },
  getStreamFromFD(fd) {
        var stream = FS.getStreamChecked(fd);
        return stream;
      },
  varargs:undefined,
  getStr(ptr) {
        var ret = UTF8ToString(ptr);
        return ret;
      },
  };
  function ___syscall_chmod(path, mode) {
  try {
  
      path = SYSCALLS.getStr(path);
      FS.chmod(path, mode);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }

  function ___syscall_faccessat(dirfd, path, amode, flags) {
  try {
  
      path = SYSCALLS.getStr(path);
      path = SYSCALLS.calculateAt(dirfd, path);
      if (amode & ~7) {
        // need a valid mode
        return -28;
      }
      var lookup = FS.lookupPath(path, { follow: true });
      var node = lookup.node;
      if (!node) {
        return -44;
      }
      var perms = '';
      if (amode & 4) perms += 'r';
      if (amode & 2) perms += 'w';
      if (amode & 1) perms += 'x';
      if (perms /* otherwise, they've just passed F_OK */ && FS.nodePermissions(node, perms)) {
        return -2;
      }
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }

  function ___syscall_fchmod(fd, mode) {
  try {
  
      FS.fchmod(fd, mode);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }

  function ___syscall_fchown32(fd, owner, group) {
  try {
  
      FS.fchown(fd, owner, group);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }

  /** @suppress {duplicate } */
  var syscallGetVarargI = () => {
      // the `+` prepended here is necessary to convince the JSCompiler that varargs is indeed a number.
      var ret = HEAP32[((+SYSCALLS.varargs)>>2)];
      SYSCALLS.varargs += 4;
      return ret;
    };
  var syscallGetVarargP = syscallGetVarargI;
  
  
  function ___syscall_fcntl64(fd, cmd, varargs) {
  SYSCALLS.varargs = varargs;
  try {
  
      var stream = SYSCALLS.getStreamFromFD(fd);
      switch (cmd) {
        case 0: {
          var arg = syscallGetVarargI();
          if (arg < 0) {
            return -28;
          }
          while (FS.streams[arg]) {
            arg++;
          }
          var newStream;
          newStream = FS.dupStream(stream, arg);
          return newStream.fd;
        }
        case 1:
        case 2:
          return 0;  // FD_CLOEXEC makes no sense for a single process.
        case 3:
          return stream.flags;
        case 4: {
          var arg = syscallGetVarargI();
          stream.flags |= arg;
          return 0;
        }
        case 12: {
          var arg = syscallGetVarargP();
          var offset = 0;
          // We're always unlocked.
          HEAP16[(((arg)+(offset))>>1)] = 2;
          return 0;
        }
        case 13:
        case 14:
          return 0; // Pretend that the locking is successful.
      }
      return -28;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }

  function ___syscall_fstat64(fd, buf) {
  try {
  
      var stream = SYSCALLS.getStreamFromFD(fd);
      return SYSCALLS.doStat(FS.stat, stream.path, buf);
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }

  var convertI32PairToI53Checked = (lo, hi) => {
      return ((hi + 0x200000) >>> 0 < 0x400001 - !!lo) ? (lo >>> 0) + hi * 4294967296 : NaN;
    };
  function ___syscall_ftruncate64(fd,length_low, length_high) {
    var length = convertI32PairToI53Checked(length_low, length_high);
  
    
  try {
  
      if (isNaN(length)) return 61;
      FS.ftruncate(fd, length);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  ;
  }

  
  var stringToUTF8 = (str, outPtr, maxBytesToWrite) => {
      return stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
    };
  function ___syscall_getcwd(buf, size) {
  try {
  
      if (size === 0) return -28;
      var cwd = FS.cwd();
      var cwdLengthInBytes = lengthBytesUTF8(cwd) + 1;
      if (size < cwdLengthInBytes) return -68;
      stringToUTF8(cwd, buf, size);
      return cwdLengthInBytes;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }

  function ___syscall_lstat64(path, buf) {
  try {
  
      path = SYSCALLS.getStr(path);
      return SYSCALLS.doStat(FS.lstat, path, buf);
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }

  function ___syscall_mkdirat(dirfd, path, mode) {
  try {
  
      path = SYSCALLS.getStr(path);
      path = SYSCALLS.calculateAt(dirfd, path);
      FS.mkdir(path, mode, 0);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }

  function ___syscall_newfstatat(dirfd, path, buf, flags) {
  try {
  
      path = SYSCALLS.getStr(path);
      var nofollow = flags & 256;
      var allowEmpty = flags & 4096;
      flags = flags & (~6400);
      path = SYSCALLS.calculateAt(dirfd, path, allowEmpty);
      return SYSCALLS.doStat(nofollow ? FS.lstat : FS.stat, path, buf);
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }

  
  function ___syscall_openat(dirfd, path, flags, varargs) {
  SYSCALLS.varargs = varargs;
  try {
  
      path = SYSCALLS.getStr(path);
      path = SYSCALLS.calculateAt(dirfd, path);
      var mode = varargs ? syscallGetVarargI() : 0;
      return FS.open(path, flags, mode).fd;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }

  
  
  function ___syscall_readlinkat(dirfd, path, buf, bufsize) {
  try {
  
      path = SYSCALLS.getStr(path);
      path = SYSCALLS.calculateAt(dirfd, path);
      if (bufsize <= 0) return -28;
      var ret = FS.readlink(path);
  
      var len = Math.min(bufsize, lengthBytesUTF8(ret));
      var endChar = HEAP8[buf+len];
      stringToUTF8(ret, buf, bufsize+1);
      // readlink is one of the rare functions that write out a C string, but does never append a null to the output buffer(!)
      // stringToUTF8() always appends a null byte, so restore the character under the null byte after the write.
      HEAP8[buf+len] = endChar;
      return len;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }

  function ___syscall_rmdir(path) {
  try {
  
      path = SYSCALLS.getStr(path);
      FS.rmdir(path);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }

  function ___syscall_stat64(path, buf) {
  try {
  
      path = SYSCALLS.getStr(path);
      return SYSCALLS.doStat(FS.stat, path, buf);
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }

  function ___syscall_unlinkat(dirfd, path, flags) {
  try {
  
      path = SYSCALLS.getStr(path);
      path = SYSCALLS.calculateAt(dirfd, path);
      if (flags === 0) {
        FS.unlink(path);
      } else if (flags === 512) {
        FS.rmdir(path);
      } else {
        abort('Invalid flags passed to unlinkat');
      }
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }

  var readI53FromI64 = (ptr) => {
      return HEAPU32[((ptr)>>2)] + HEAP32[(((ptr)+(4))>>2)] * 4294967296;
    };
  
  function ___syscall_utimensat(dirfd, path, times, flags) {
  try {
  
      path = SYSCALLS.getStr(path);
      path = SYSCALLS.calculateAt(dirfd, path, true);
      var now = Date.now(), atime, mtime;
      if (!times) {
        atime = now;
        mtime = now;
      } else {
        var seconds = readI53FromI64(times);
        var nanoseconds = HEAP32[(((times)+(8))>>2)];
        if (nanoseconds == 1073741823) {
          atime = now;
        } else if (nanoseconds == 1073741822) {
          atime = null;
        } else {
          atime = (seconds*1000) + (nanoseconds/(1000*1000));
        }
        times += 16;
        seconds = readI53FromI64(times);
        nanoseconds = HEAP32[(((times)+(8))>>2)];
        if (nanoseconds == 1073741823) {
          mtime = now;
        } else if (nanoseconds == 1073741822) {
          mtime = null;
        } else {
          mtime = (seconds*1000) + (nanoseconds/(1000*1000));
        }
      }
      // null here means UTIME_OMIT was passed. If both were set to UTIME_OMIT then
      // we can skip the call completely.
      if ((mtime ?? atime) !== null) {
        FS.utime(path, atime, mtime);
      }
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }

  var __abort_js = () =>
      abort('');

  var __emscripten_memcpy_js = (dest, src, num) => HEAPU8.copyWithin(dest, src, src + num);

  var runtimeKeepaliveCounter = 0;
  var __emscripten_runtime_keepalive_clear = () => {
      noExitRuntime = false;
      runtimeKeepaliveCounter = 0;
    };

  var isLeapYear = (year) => year%4 === 0 && (year%100 !== 0 || year%400 === 0);
  
  var MONTH_DAYS_LEAP_CUMULATIVE = [0,31,60,91,121,152,182,213,244,274,305,335];
  
  var MONTH_DAYS_REGULAR_CUMULATIVE = [0,31,59,90,120,151,181,212,243,273,304,334];
  var ydayFromDate = (date) => {
      var leap = isLeapYear(date.getFullYear());
      var monthDaysCumulative = (leap ? MONTH_DAYS_LEAP_CUMULATIVE : MONTH_DAYS_REGULAR_CUMULATIVE);
      var yday = monthDaysCumulative[date.getMonth()] + date.getDate() - 1; // -1 since it's days since Jan 1
  
      return yday;
    };
  
  function __localtime_js(time_low, time_high,tmPtr) {
    var time = convertI32PairToI53Checked(time_low, time_high);
  
    
      var date = new Date(time*1000);
      HEAP32[((tmPtr)>>2)] = date.getSeconds();
      HEAP32[(((tmPtr)+(4))>>2)] = date.getMinutes();
      HEAP32[(((tmPtr)+(8))>>2)] = date.getHours();
      HEAP32[(((tmPtr)+(12))>>2)] = date.getDate();
      HEAP32[(((tmPtr)+(16))>>2)] = date.getMonth();
      HEAP32[(((tmPtr)+(20))>>2)] = date.getFullYear()-1900;
      HEAP32[(((tmPtr)+(24))>>2)] = date.getDay();
  
      var yday = ydayFromDate(date)|0;
      HEAP32[(((tmPtr)+(28))>>2)] = yday;
      HEAP32[(((tmPtr)+(36))>>2)] = -(date.getTimezoneOffset() * 60);
  
      // Attention: DST is in December in South, and some regions don't have DST at all.
      var start = new Date(date.getFullYear(), 0, 1);
      var summerOffset = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
      var winterOffset = start.getTimezoneOffset();
      var dst = (summerOffset != winterOffset && date.getTimezoneOffset() == Math.min(winterOffset, summerOffset))|0;
      HEAP32[(((tmPtr)+(32))>>2)] = dst;
    ;
  }

  
  
  
  
  
  function __mmap_js(len,prot,flags,fd,offset_low, offset_high,allocated,addr) {
    var offset = convertI32PairToI53Checked(offset_low, offset_high);
  
    
  try {
  
      if (isNaN(offset)) return 61;
      var stream = SYSCALLS.getStreamFromFD(fd);
      var res = FS.mmap(stream, len, offset, prot, flags);
      var ptr = res.ptr;
      HEAP32[((allocated)>>2)] = res.allocated;
      HEAPU32[((addr)>>2)] = ptr;
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  ;
  }

  
  function __munmap_js(addr,len,prot,flags,fd,offset_low, offset_high) {
    var offset = convertI32PairToI53Checked(offset_low, offset_high);
  
    
  try {
  
      var stream = SYSCALLS.getStreamFromFD(fd);
      if (prot & 2) {
        SYSCALLS.doMsync(addr, stream, len, flags, offset);
      }
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  ;
  }

  var timers = {
  };
  
  var handleException = (e) => {
      // Certain exception types we do not treat as errors since they are used for
      // internal control flow.
      // 1. ExitStatus, which is thrown by exit()
      // 2. "unwind", which is thrown by emscripten_unwind_to_js_event_loop() and others
      //    that wish to return to JS event loop.
      if (e instanceof ExitStatus || e == 'unwind') {
        return EXITSTATUS;
      }
      quit_(1, e);
    };
  
  
  var keepRuntimeAlive = () => noExitRuntime || runtimeKeepaliveCounter > 0;
  var _proc_exit = (code) => {
      EXITSTATUS = code;
      if (!keepRuntimeAlive()) {
        Module['onExit']?.(code);
        ABORT = true;
      }
      quit_(code, new ExitStatus(code));
    };
  /** @suppress {duplicate } */
  /** @param {boolean|number=} implicit */
  var exitJS = (status, implicit) => {
      EXITSTATUS = status;
  
      _proc_exit(status);
    };
  var _exit = exitJS;
  
  
  var maybeExit = () => {
      if (!keepRuntimeAlive()) {
        try {
          _exit(EXITSTATUS);
        } catch (e) {
          handleException(e);
        }
      }
    };
  var callUserCallback = (func) => {
      if (ABORT) {
        return;
      }
      try {
        func();
        maybeExit();
      } catch (e) {
        handleException(e);
      }
    };
  
  
  var _emscripten_get_now = () => performance.now();
  var __setitimer_js = (which, timeout_ms) => {
      // First, clear any existing timer.
      if (timers[which]) {
        clearTimeout(timers[which].id);
        delete timers[which];
      }
  
      // A timeout of zero simply cancels the current timeout so we have nothing
      // more to do.
      if (!timeout_ms) return 0;
  
      var id = setTimeout(() => {
        delete timers[which];
        callUserCallback(() => __emscripten_timeout(which, _emscripten_get_now()));
      }, timeout_ms);
      timers[which] = { id, timeout_ms };
      return 0;
    };

  var __tzset_js = (timezone, daylight, std_name, dst_name) => {
      // TODO: Use (malleable) environment variables instead of system settings.
      var currentYear = new Date().getFullYear();
      var winter = new Date(currentYear, 0, 1);
      var summer = new Date(currentYear, 6, 1);
      var winterOffset = winter.getTimezoneOffset();
      var summerOffset = summer.getTimezoneOffset();
  
      // Local standard timezone offset. Local standard time is not adjusted for
      // daylight savings.  This code uses the fact that getTimezoneOffset returns
      // a greater value during Standard Time versus Daylight Saving Time (DST).
      // Thus it determines the expected output during Standard Time, and it
      // compares whether the output of the given date the same (Standard) or less
      // (DST).
      var stdTimezoneOffset = Math.max(winterOffset, summerOffset);
  
      // timezone is specified as seconds west of UTC ("The external variable
      // `timezone` shall be set to the difference, in seconds, between
      // Coordinated Universal Time (UTC) and local standard time."), the same
      // as returned by stdTimezoneOffset.
      // See http://pubs.opengroup.org/onlinepubs/009695399/functions/tzset.html
      HEAPU32[((timezone)>>2)] = stdTimezoneOffset * 60;
  
      HEAP32[((daylight)>>2)] = Number(winterOffset != summerOffset);
  
      var extractZone = (timezoneOffset) => {
        // Why inverse sign?
        // Read here https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/getTimezoneOffset
        var sign = timezoneOffset >= 0 ? "-" : "+";
  
        var absOffset = Math.abs(timezoneOffset)
        var hours = String(Math.floor(absOffset / 60)).padStart(2, "0");
        var minutes = String(absOffset % 60).padStart(2, "0");
  
        return `UTC${sign}${hours}${minutes}`;
      }
  
      var winterName = extractZone(winterOffset);
      var summerName = extractZone(summerOffset);
      if (summerOffset < winterOffset) {
        // Northern hemisphere
        stringToUTF8(winterName, std_name, 17);
        stringToUTF8(summerName, dst_name, 17);
      } else {
        stringToUTF8(winterName, dst_name, 17);
        stringToUTF8(summerName, std_name, 17);
      }
    };

  var _emscripten_date_now = () => Date.now();


  var getHeapMax = () =>
      // Stay one Wasm page short of 4GB: while e.g. Chrome is able to allocate
      // full 4GB Wasm memories, the size will wrap back to 0 bytes in Wasm side
      // for any code that deals with heap sizes, which would require special
      // casing all heap size related code to treat 0 specially.
      2147483648;
  
  
  var growMemory = (size) => {
      var b = wasmMemory.buffer;
      var pages = ((size - b.byteLength + 65535) / 65536) | 0;
      try {
        // round size grow request up to wasm page size (fixed 64KB per spec)
        wasmMemory.grow(pages); // .grow() takes a delta compared to the previous size
        updateMemoryViews();
        return 1 /*success*/;
      } catch(e) {
      }
      // implicit 0 return to save code size (caller will cast "undefined" into 0
      // anyhow)
    };
  var _emscripten_resize_heap = (requestedSize) => {
      var oldSize = HEAPU8.length;
      // With CAN_ADDRESS_2GB or MEMORY64, pointers are already unsigned.
      requestedSize >>>= 0;
      // With multithreaded builds, races can happen (another thread might increase the size
      // in between), so return a failure, and let the caller retry.
  
      // Memory resize rules:
      // 1.  Always increase heap size to at least the requested size, rounded up
      //     to next page multiple.
      // 2a. If MEMORY_GROWTH_LINEAR_STEP == -1, excessively resize the heap
      //     geometrically: increase the heap size according to
      //     MEMORY_GROWTH_GEOMETRIC_STEP factor (default +20%), At most
      //     overreserve by MEMORY_GROWTH_GEOMETRIC_CAP bytes (default 96MB).
      // 2b. If MEMORY_GROWTH_LINEAR_STEP != -1, excessively resize the heap
      //     linearly: increase the heap size by at least
      //     MEMORY_GROWTH_LINEAR_STEP bytes.
      // 3.  Max size for the heap is capped at 2048MB-WASM_PAGE_SIZE, or by
      //     MAXIMUM_MEMORY, or by ASAN limit, depending on which is smallest
      // 4.  If we were unable to allocate as much memory, it may be due to
      //     over-eager decision to excessively reserve due to (3) above.
      //     Hence if an allocation fails, cut down on the amount of excess
      //     growth, in an attempt to succeed to perform a smaller allocation.
  
      // A limit is set for how much we can grow. We should not exceed that
      // (the wasm binary specifies it, so if we tried, we'd fail anyhow).
      var maxHeapSize = getHeapMax();
      if (requestedSize > maxHeapSize) {
        return false;
      }
  
      // Loop through potential heap size increases. If we attempt a too eager
      // reservation that fails, cut down on the attempted size and reserve a
      // smaller bump instead. (max 3 times, chosen somewhat arbitrarily)
      for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
        var overGrownHeapSize = oldSize * (1 + 0.2 / cutDown); // ensure geometric growth
        // but limit overreserving (default to capping at +96MB overgrowth at most)
        overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296 );
  
        var newSize = Math.min(maxHeapSize, alignMemory(Math.max(requestedSize, overGrownHeapSize), 65536));
  
        var replacement = growMemory(newSize);
        if (replacement) {
  
          return true;
        }
      }
      return false;
    };

  var ENV = {
  };
  
  var getExecutableName = () => thisProgram || './this.program';
  var getEnvStrings = () => {
      if (!getEnvStrings.strings) {
        // Default values.
        // Browser language detection #8751
        var lang = ((typeof navigator == 'object' && navigator.languages && navigator.languages[0]) || 'C').replace('-', '_') + '.UTF-8';
        var env = {
          'USER': 'web_user',
          'LOGNAME': 'web_user',
          'PATH': '/',
          'PWD': '/',
          'HOME': '/home/web_user',
          'LANG': lang,
          '_': getExecutableName()
        };
        // Apply the user-provided values, if any.
        for (var x in ENV) {
          // x is a key in ENV; if ENV[x] is undefined, that means it was
          // explicitly set to be so. We allow user code to do that to
          // force variables with default values to remain unset.
          if (ENV[x] === undefined) delete env[x];
          else env[x] = ENV[x];
        }
        var strings = [];
        for (var x in env) {
          strings.push(`${x}=${env[x]}`);
        }
        getEnvStrings.strings = strings;
      }
      return getEnvStrings.strings;
    };
  
  var stringToAscii = (str, buffer) => {
      for (var i = 0; i < str.length; ++i) {
        HEAP8[buffer++] = str.charCodeAt(i);
      }
      // Null-terminate the string
      HEAP8[buffer] = 0;
    };
  var _environ_get = (__environ, environ_buf) => {
      var bufSize = 0;
      getEnvStrings().forEach((string, i) => {
        var ptr = environ_buf + bufSize;
        HEAPU32[(((__environ)+(i*4))>>2)] = ptr;
        stringToAscii(string, ptr);
        bufSize += string.length + 1;
      });
      return 0;
    };

  var _environ_sizes_get = (penviron_count, penviron_buf_size) => {
      var strings = getEnvStrings();
      HEAPU32[((penviron_count)>>2)] = strings.length;
      var bufSize = 0;
      strings.forEach((string) => bufSize += string.length + 1);
      HEAPU32[((penviron_buf_size)>>2)] = bufSize;
      return 0;
    };

  function _fd_close(fd) {
  try {
  
      var stream = SYSCALLS.getStreamFromFD(fd);
      FS.close(stream);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return e.errno;
  }
  }

  function _fd_fdstat_get(fd, pbuf) {
  try {
  
      var rightsBase = 0;
      var rightsInheriting = 0;
      var flags = 0;
      {
        var stream = SYSCALLS.getStreamFromFD(fd);
        // All character devices are terminals (other things a Linux system would
        // assume is a character device, like the mouse, we have special APIs for).
        var type = stream.tty ? 2 :
                   FS.isDir(stream.mode) ? 3 :
                   FS.isLink(stream.mode) ? 7 :
                   4;
      }
      HEAP8[pbuf] = type;
      HEAP16[(((pbuf)+(2))>>1)] = flags;
      (tempI64 = [rightsBase>>>0,(tempDouble = rightsBase,(+(Math.abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? (+(Math.floor((tempDouble)/4294967296.0)))>>>0 : (~~((+(Math.ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)], HEAP32[(((pbuf)+(8))>>2)] = tempI64[0],HEAP32[(((pbuf)+(12))>>2)] = tempI64[1]);
      (tempI64 = [rightsInheriting>>>0,(tempDouble = rightsInheriting,(+(Math.abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? (+(Math.floor((tempDouble)/4294967296.0)))>>>0 : (~~((+(Math.ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)], HEAP32[(((pbuf)+(16))>>2)] = tempI64[0],HEAP32[(((pbuf)+(20))>>2)] = tempI64[1]);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return e.errno;
  }
  }

  /** @param {number=} offset */
  var doReadv = (stream, iov, iovcnt, offset) => {
      var ret = 0;
      for (var i = 0; i < iovcnt; i++) {
        var ptr = HEAPU32[((iov)>>2)];
        var len = HEAPU32[(((iov)+(4))>>2)];
        iov += 8;
        var curr = FS.read(stream, HEAP8, ptr, len, offset);
        if (curr < 0) return -1;
        ret += curr;
        if (curr < len) break; // nothing more to read
        if (typeof offset != 'undefined') {
          offset += curr;
        }
      }
      return ret;
    };
  
  function _fd_read(fd, iov, iovcnt, pnum) {
  try {
  
      var stream = SYSCALLS.getStreamFromFD(fd);
      var num = doReadv(stream, iov, iovcnt);
      HEAPU32[((pnum)>>2)] = num;
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return e.errno;
  }
  }

  
  function _fd_seek(fd,offset_low, offset_high,whence,newOffset) {
    var offset = convertI32PairToI53Checked(offset_low, offset_high);
  
    
  try {
  
      if (isNaN(offset)) return 61;
      var stream = SYSCALLS.getStreamFromFD(fd);
      FS.llseek(stream, offset, whence);
      (tempI64 = [stream.position>>>0,(tempDouble = stream.position,(+(Math.abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? (+(Math.floor((tempDouble)/4294967296.0)))>>>0 : (~~((+(Math.ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)], HEAP32[((newOffset)>>2)] = tempI64[0],HEAP32[(((newOffset)+(4))>>2)] = tempI64[1]);
      if (stream.getdents && offset === 0 && whence === 0) stream.getdents = null; // reset readdir state
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return e.errno;
  }
  ;
  }

  function _fd_sync(fd) {
  try {
  
      var stream = SYSCALLS.getStreamFromFD(fd);
      if (stream.stream_ops?.fsync) {
        return stream.stream_ops.fsync(stream);
      }
      return 0; // we can't do anything synchronously; the in-memory FS is already synced to
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return e.errno;
  }
  }

  /** @param {number=} offset */
  var doWritev = (stream, iov, iovcnt, offset) => {
      var ret = 0;
      for (var i = 0; i < iovcnt; i++) {
        var ptr = HEAPU32[((iov)>>2)];
        var len = HEAPU32[(((iov)+(4))>>2)];
        iov += 8;
        var curr = FS.write(stream, HEAP8, ptr, len, offset);
        if (curr < 0) return -1;
        ret += curr;
        if (curr < len) {
          // No more space to write.
          break;
        }
        if (typeof offset != 'undefined') {
          offset += curr;
        }
      }
      return ret;
    };
  
  function _fd_write(fd, iov, iovcnt, pnum) {
  try {
  
      var stream = SYSCALLS.getStreamFromFD(fd);
      var num = doWritev(stream, iov, iovcnt);
      HEAPU32[((pnum)>>2)] = num;
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return e.errno;
  }
  }

  
  var adapters_support = function() {
      // @ts-ignore
      // Expose handleAsync to library code.
      const handleAsync = typeof Asyncify === 'object' ?
        Asyncify.handleAsync.bind(Asyncify) :
        null;
      Module['handleAsync'] = handleAsync;
  
      // This map contains the objects to which calls will be relayed, e.g.
      // a VFS. The key is typically the corresponding WebAssembly pointer.
      const targets = new Map();
      Module['setCallback'] = (key, target) => targets.set(key, target);
      Module['getCallback'] = key => targets.get(key);
      Module['deleteCallback'] = key => targets.delete(key);
  
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
    };
  function _ipp(...args) { return adapters_support(false, ...args) }

  function _ipp_async(...args) { return adapters_support(true, ...args) }

  function _ippipppp(...args) { return adapters_support(false, ...args) }

  function _ippipppp_async(...args) { return adapters_support(true, ...args) }

  function _ippp(...args) { return adapters_support(false, ...args) }

  function _ippp_async(...args) { return adapters_support(true, ...args) }

  function _ipppi(...args) { return adapters_support(false, ...args) }

  function _ipppi_async(...args) { return adapters_support(true, ...args) }

  function _ipppiii(...args) { return adapters_support(false, ...args) }

  function _ipppiii_async(...args) { return adapters_support(true, ...args) }

  function _ipppiiip(...args) { return adapters_support(false, ...args) }

  function _ipppiiip_async(...args) { return adapters_support(true, ...args) }

  function _ipppip(...args) { return adapters_support(false, ...args) }

  function _ipppip_async(...args) { return adapters_support(true, ...args) }

  function _ipppj(...args) { return adapters_support(false, ...args) }

  function _ipppj_async(...args) { return adapters_support(true, ...args) }

  function _ipppp(...args) { return adapters_support(false, ...args) }

  function _ipppp_async(...args) { return adapters_support(true, ...args) }

  function _ippppi(...args) { return adapters_support(false, ...args) }

  function _ippppi_async(...args) { return adapters_support(true, ...args) }

  function _ippppij(...args) { return adapters_support(false, ...args) }

  function _ippppij_async(...args) { return adapters_support(true, ...args) }

  function _ippppip(...args) { return adapters_support(false, ...args) }

  function _ippppip_async(...args) { return adapters_support(true, ...args) }

  function _ipppppip(...args) { return adapters_support(false, ...args) }

  function _ipppppip_async(...args) { return adapters_support(true, ...args) }


  function _vppippii(...args) { return adapters_support(false, ...args) }

  function _vppippii_async(...args) { return adapters_support(true, ...args) }

  function _vppp(...args) { return adapters_support(false, ...args) }

  function _vppp_async(...args) { return adapters_support(true, ...args) }

  function _vpppip(...args) { return adapters_support(false, ...args) }

  function _vpppip_async(...args) { return adapters_support(true, ...args) }



  var uleb128Encode = (n, target) => {
      if (n < 128) {
        target.push(n);
      } else {
        target.push((n % 128) | 128, n >> 7);
      }
    };
  
  var sigToWasmTypes = (sig) => {
      var typeNames = {
        'i': 'i32',
        'j': 'i64',
        'f': 'f32',
        'd': 'f64',
        'e': 'externref',
        'p': 'i32',
      };
      var type = {
        parameters: [],
        results: sig[0] == 'v' ? [] : [typeNames[sig[0]]]
      };
      for (var i = 1; i < sig.length; ++i) {
        type.parameters.push(typeNames[sig[i]]);
      }
      return type;
    };
  
  var generateFuncType = (sig, target) => {
      var sigRet = sig.slice(0, 1);
      var sigParam = sig.slice(1);
      var typeCodes = {
        'i': 0x7f, // i32
        'p': 0x7f, // i32
        'j': 0x7e, // i64
        'f': 0x7d, // f32
        'd': 0x7c, // f64
        'e': 0x6f, // externref
      };
  
      // Parameters, length + signatures
      target.push(0x60 /* form: func */);
      uleb128Encode(sigParam.length, target);
      for (var i = 0; i < sigParam.length; ++i) {
        target.push(typeCodes[sigParam[i]]);
      }
  
      // Return values, length + signatures
      // With no multi-return in MVP, either 0 (void) or 1 (anything else)
      if (sigRet == 'v') {
        target.push(0x00);
      } else {
        target.push(0x01, typeCodes[sigRet]);
      }
    };
  var convertJsFunctionToWasm = (func, sig) => {
  
      // If the type reflection proposal is available, use the new
      // "WebAssembly.Function" constructor.
      // Otherwise, construct a minimal wasm module importing the JS function and
      // re-exporting it.
      if (typeof WebAssembly.Function == "function") {
        return new WebAssembly.Function(sigToWasmTypes(sig), func);
      }
  
      // The module is static, with the exception of the type section, which is
      // generated based on the signature passed in.
      var typeSectionBody = [
        0x01, // count: 1
      ];
      generateFuncType(sig, typeSectionBody);
  
      // Rest of the module is static
      var bytes = [
        0x00, 0x61, 0x73, 0x6d, // magic ("\0asm")
        0x01, 0x00, 0x00, 0x00, // version: 1
        0x01, // Type section code
      ];
      // Write the overall length of the type section followed by the body
      uleb128Encode(typeSectionBody.length, bytes);
      bytes.push(...typeSectionBody);
  
      // The rest of the module is static
      bytes.push(
        0x02, 0x07, // import section
          // (import "e" "f" (func 0 (type 0)))
          0x01, 0x01, 0x65, 0x01, 0x66, 0x00, 0x00,
        0x07, 0x05, // export section
          // (export "f" (func 0 (type 0)))
          0x01, 0x01, 0x66, 0x00, 0x00,
      );
  
      // We can compile this wasm module synchronously because it is very small.
      // This accepts an import (at "e.f"), that it reroutes to an export (at "f")
      var module = new WebAssembly.Module(new Uint8Array(bytes));
      var instance = new WebAssembly.Instance(module, { 'e': { 'f': func } });
      var wrappedFunc = instance.exports['f'];
      return wrappedFunc;
    };
  
  var wasmTableMirror = [];
  
  /** @type {WebAssembly.Table} */
  var wasmTable;
  var getWasmTableEntry = (funcPtr) => {
      var func = wasmTableMirror[funcPtr];
      if (!func) {
        if (funcPtr >= wasmTableMirror.length) wasmTableMirror.length = funcPtr + 1;
        /** @suppress {checkTypes} */
        wasmTableMirror[funcPtr] = func = wasmTable.get(funcPtr);
      }
      return func;
    };
  
  var updateTableMap = (offset, count) => {
      if (functionsInTableMap) {
        for (var i = offset; i < offset + count; i++) {
          var item = getWasmTableEntry(i);
          // Ignore null values.
          if (item) {
            functionsInTableMap.set(item, i);
          }
        }
      }
    };
  
  var functionsInTableMap;
  
  var getFunctionAddress = (func) => {
      // First, create the map if this is the first use.
      if (!functionsInTableMap) {
        functionsInTableMap = new WeakMap();
        updateTableMap(0, wasmTable.length);
      }
      return functionsInTableMap.get(func) || 0;
    };
  
  
  var freeTableIndexes = [];
  
  var getEmptyTableSlot = () => {
      // Reuse a free index if there is one, otherwise grow.
      if (freeTableIndexes.length) {
        return freeTableIndexes.pop();
      }
      // Grow the table
      try {
        /** @suppress {checkTypes} */
        wasmTable.grow(1);
      } catch (err) {
        if (!(err instanceof RangeError)) {
          throw err;
        }
        throw 'Unable to grow wasm table. Set ALLOW_TABLE_GROWTH.';
      }
      return wasmTable.length - 1;
    };
  
  
  
  var setWasmTableEntry = (idx, func) => {
      /** @suppress {checkTypes} */
      wasmTable.set(idx, func);
      // With ABORT_ON_WASM_EXCEPTIONS wasmTable.get is overridden to return wrapped
      // functions so we need to call it here to retrieve the potential wrapper correctly
      // instead of just storing 'func' directly into wasmTableMirror
      /** @suppress {checkTypes} */
      wasmTableMirror[idx] = wasmTable.get(idx);
    };
  
  /** @param {string=} sig */
  var addFunction = (func, sig) => {
      // Check if the function is already in the table, to ensure each function
      // gets a unique index.
      var rtn = getFunctionAddress(func);
      if (rtn) {
        return rtn;
      }
  
      // It's not in the table, add it now.
  
      var ret = getEmptyTableSlot();
  
      // Set the new value.
      try {
        // Attempting to call this with JS function will cause of table.set() to fail
        setWasmTableEntry(ret, func);
      } catch (err) {
        if (!(err instanceof TypeError)) {
          throw err;
        }
        var wrapped = convertJsFunctionToWasm(func, sig);
        setWasmTableEntry(ret, wrapped);
      }
  
      functionsInTableMap.set(func, ret);
  
      return ret;
    };

  var getCFunc = (ident) => {
      var func = Module['_' + ident]; // closure exported function
      return func;
    };
  
  var writeArrayToMemory = (array, buffer) => {
      HEAP8.set(array, buffer);
    };
  
  
  
  var stackAlloc = (sz) => __emscripten_stack_alloc(sz);
  var stringToUTF8OnStack = (str) => {
      var size = lengthBytesUTF8(str) + 1;
      var ret = stackAlloc(size);
      stringToUTF8(str, ret, size);
      return ret;
    };
  
  
  
  
  
    /**
     * @param {string|null=} returnType
     * @param {Array=} argTypes
     * @param {Arguments|Array=} args
     * @param {Object=} opts
     */
  var ccall = (ident, returnType, argTypes, args, opts) => {
      // For fast lookup of conversion functions
      var toC = {
        'string': (str) => {
          var ret = 0;
          if (str !== null && str !== undefined && str !== 0) { // null string
            ret = stringToUTF8OnStack(str);
          }
          return ret;
        },
        'array': (arr) => {
          var ret = stackAlloc(arr.length);
          writeArrayToMemory(arr, ret);
          return ret;
        }
      };
  
      function convertReturnValue(ret) {
        if (returnType === 'string') {
          return UTF8ToString(ret);
        }
        if (returnType === 'boolean') return Boolean(ret);
        return ret;
      }
  
      var func = getCFunc(ident);
      var cArgs = [];
      var stack = 0;
      if (args) {
        for (var i = 0; i < args.length; i++) {
          var converter = toC[argTypes[i]];
          if (converter) {
            if (stack === 0) stack = stackSave();
            cArgs[i] = converter(args[i]);
          } else {
            cArgs[i] = args[i];
          }
        }
      }
      var ret = func(...cArgs);
      function onDone(ret) {
        if (stack !== 0) stackRestore(stack);
        return convertReturnValue(ret);
      }
  
      ret = onDone(ret);
      return ret;
    };

  
  
    /**
     * @param {string=} returnType
     * @param {Array=} argTypes
     * @param {Object=} opts
     */
  var cwrap = (ident, returnType, argTypes, opts) => {
      // When the function takes numbers and returns a number, we can just return
      // the original function
      var numericArgs = !argTypes || argTypes.every((type) => type === 'number' || type === 'boolean');
      var numericRet = returnType !== 'string';
      if (numericRet && numericArgs && !opts) {
        return getCFunc(ident);
      }
      return (...args) => ccall(ident, returnType, argTypes, args, opts);
    };

  var getTempRet0 = (val) => __emscripten_tempret_get();





  var stringToUTF16 = (str, outPtr, maxBytesToWrite) => {
      // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
      maxBytesToWrite ??= 0x7FFFFFFF;
      if (maxBytesToWrite < 2) return 0;
      maxBytesToWrite -= 2; // Null terminator.
      var startPtr = outPtr;
      var numCharsToWrite = (maxBytesToWrite < str.length*2) ? (maxBytesToWrite / 2) : str.length;
      for (var i = 0; i < numCharsToWrite; ++i) {
        // charCodeAt returns a UTF-16 encoded code unit, so it can be directly written to the HEAP.
        var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
        HEAP16[((outPtr)>>1)] = codeUnit;
        outPtr += 2;
      }
      // Null-terminate the pointer to the HEAP.
      HEAP16[((outPtr)>>1)] = 0;
      return outPtr - startPtr;
    };

  var stringToUTF32 = (str, outPtr, maxBytesToWrite) => {
      // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
      maxBytesToWrite ??= 0x7FFFFFFF;
      if (maxBytesToWrite < 4) return 0;
      var startPtr = outPtr;
      var endPtr = startPtr + maxBytesToWrite - 4;
      for (var i = 0; i < str.length; ++i) {
        // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
        // See http://unicode.org/faq/utf_bom.html#utf16-3
        var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
        if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) {
          var trailSurrogate = str.charCodeAt(++i);
          codeUnit = 0x10000 + ((codeUnit & 0x3FF) << 10) | (trailSurrogate & 0x3FF);
        }
        HEAP32[((outPtr)>>2)] = codeUnit;
        outPtr += 4;
        if (outPtr + 4 > endPtr) break;
      }
      // Null-terminate the pointer to the HEAP.
      HEAP32[((outPtr)>>2)] = 0;
      return outPtr - startPtr;
    };

  var AsciiToString = (ptr) => {
      var str = '';
      while (1) {
        var ch = HEAPU8[ptr++];
        if (!ch) return str;
        str += String.fromCharCode(ch);
      }
    };


  var UTF16Decoder = typeof TextDecoder != 'undefined' ? new TextDecoder('utf-16le') : undefined;;
  var UTF16ToString = (ptr, maxBytesToRead) => {
      var endPtr = ptr;
      // TextDecoder needs to know the byte length in advance, it doesn't stop on
      // null terminator by itself.
      // Also, use the length info to avoid running tiny strings through
      // TextDecoder, since .subarray() allocates garbage.
      var idx = endPtr >> 1;
      var maxIdx = idx + maxBytesToRead / 2;
      // If maxBytesToRead is not passed explicitly, it will be undefined, and this
      // will always evaluate to true. This saves on code size.
      while (!(idx >= maxIdx) && HEAPU16[idx]) ++idx;
      endPtr = idx << 1;
  
      if (endPtr - ptr > 32 && UTF16Decoder)
        return UTF16Decoder.decode(HEAPU8.subarray(ptr, endPtr));
  
      // Fallback: decode without UTF16Decoder
      var str = '';
  
      // If maxBytesToRead is not passed explicitly, it will be undefined, and the
      // for-loop's condition will always evaluate to true. The loop is then
      // terminated on the first null char.
      for (var i = 0; !(i >= maxBytesToRead / 2); ++i) {
        var codeUnit = HEAP16[(((ptr)+(i*2))>>1)];
        if (codeUnit == 0) break;
        // fromCharCode constructs a character from a UTF-16 code unit, so we can
        // pass the UTF16 string right through.
        str += String.fromCharCode(codeUnit);
      }
  
      return str;
    };

  var UTF32ToString = (ptr, maxBytesToRead) => {
      var i = 0;
  
      var str = '';
      // If maxBytesToRead is not passed explicitly, it will be undefined, and this
      // will always evaluate to true. This saves on code size.
      while (!(i >= maxBytesToRead / 4)) {
        var utf32 = HEAP32[(((ptr)+(i*4))>>2)];
        if (utf32 == 0) break;
        ++i;
        // Gotcha: fromCharCode constructs a character from a UTF-16 encoded code (pair), not from a Unicode code point! So encode the code point to UTF-16 for constructing.
        // See http://unicode.org/faq/utf_bom.html#utf16-3
        if (utf32 >= 0x10000) {
          var ch = utf32 - 0x10000;
          str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
        } else {
          str += String.fromCharCode(utf32);
        }
      }
      return str;
    };


  function intArrayToString(array) {
    var ret = [];
    for (var i = 0; i < array.length; i++) {
      var chr = array[i];
      if (chr > 0xFF) {
        chr &= 0xFF;
      }
      ret.push(String.fromCharCode(chr));
    }
    return ret.join('');
  }


  FS.createPreloadedFile = FS_createPreloadedFile;
  FS.staticInit();
  // Set module methods based on EXPORTED_RUNTIME_METHODS
  ;

      // This error may happen quite a bit. To avoid overhead we reuse it (and
      // suffer a lack of stack info).
      MEMFS.doesNotExistError = new FS.ErrnoError(44);
      /** @suppress {checkTypes} */
      MEMFS.doesNotExistError.stack = '<generic error, no stack>';
      ;
adapters_support();;
var wasmImports = {
  /** @export */
  __assert_fail: ___assert_fail,
  /** @export */
  __syscall_chmod: ___syscall_chmod,
  /** @export */
  __syscall_faccessat: ___syscall_faccessat,
  /** @export */
  __syscall_fchmod: ___syscall_fchmod,
  /** @export */
  __syscall_fchown32: ___syscall_fchown32,
  /** @export */
  __syscall_fcntl64: ___syscall_fcntl64,
  /** @export */
  __syscall_fstat64: ___syscall_fstat64,
  /** @export */
  __syscall_ftruncate64: ___syscall_ftruncate64,
  /** @export */
  __syscall_getcwd: ___syscall_getcwd,
  /** @export */
  __syscall_lstat64: ___syscall_lstat64,
  /** @export */
  __syscall_mkdirat: ___syscall_mkdirat,
  /** @export */
  __syscall_newfstatat: ___syscall_newfstatat,
  /** @export */
  __syscall_openat: ___syscall_openat,
  /** @export */
  __syscall_readlinkat: ___syscall_readlinkat,
  /** @export */
  __syscall_rmdir: ___syscall_rmdir,
  /** @export */
  __syscall_stat64: ___syscall_stat64,
  /** @export */
  __syscall_unlinkat: ___syscall_unlinkat,
  /** @export */
  __syscall_utimensat: ___syscall_utimensat,
  /** @export */
  _abort_js: __abort_js,
  /** @export */
  _emscripten_memcpy_js: __emscripten_memcpy_js,
  /** @export */
  _emscripten_runtime_keepalive_clear: __emscripten_runtime_keepalive_clear,
  /** @export */
  _localtime_js: __localtime_js,
  /** @export */
  _mmap_js: __mmap_js,
  /** @export */
  _munmap_js: __munmap_js,
  /** @export */
  _setitimer_js: __setitimer_js,
  /** @export */
  _tzset_js: __tzset_js,
  /** @export */
  emscripten_date_now: _emscripten_date_now,
  /** @export */
  emscripten_get_now: _emscripten_get_now,
  /** @export */
  emscripten_resize_heap: _emscripten_resize_heap,
  /** @export */
  environ_get: _environ_get,
  /** @export */
  environ_sizes_get: _environ_sizes_get,
  /** @export */
  fd_close: _fd_close,
  /** @export */
  fd_fdstat_get: _fd_fdstat_get,
  /** @export */
  fd_read: _fd_read,
  /** @export */
  fd_seek: _fd_seek,
  /** @export */
  fd_sync: _fd_sync,
  /** @export */
  fd_write: _fd_write,
  /** @export */
  ipp: _ipp,
  /** @export */
  ipp_async: _ipp_async,
  /** @export */
  ippipppp: _ippipppp,
  /** @export */
  ippipppp_async: _ippipppp_async,
  /** @export */
  ippp: _ippp,
  /** @export */
  ippp_async: _ippp_async,
  /** @export */
  ipppi: _ipppi,
  /** @export */
  ipppi_async: _ipppi_async,
  /** @export */
  ipppiii: _ipppiii,
  /** @export */
  ipppiii_async: _ipppiii_async,
  /** @export */
  ipppiiip: _ipppiiip,
  /** @export */
  ipppiiip_async: _ipppiiip_async,
  /** @export */
  ipppip: _ipppip,
  /** @export */
  ipppip_async: _ipppip_async,
  /** @export */
  ipppj: _ipppj,
  /** @export */
  ipppj_async: _ipppj_async,
  /** @export */
  ipppp: _ipppp,
  /** @export */
  ipppp_async: _ipppp_async,
  /** @export */
  ippppi: _ippppi,
  /** @export */
  ippppi_async: _ippppi_async,
  /** @export */
  ippppij: _ippppij,
  /** @export */
  ippppij_async: _ippppij_async,
  /** @export */
  ippppip: _ippppip,
  /** @export */
  ippppip_async: _ippppip_async,
  /** @export */
  ipppppip: _ipppppip,
  /** @export */
  ipppppip_async: _ipppppip_async,
  /** @export */
  proc_exit: _proc_exit,
  /** @export */
  vppippii: _vppippii,
  /** @export */
  vppippii_async: _vppippii_async,
  /** @export */
  vppp: _vppp,
  /** @export */
  vppp_async: _vppp_async,
  /** @export */
  vpppip: _vpppip,
  /** @export */
  vpppip_async: _vpppip_async
};
var wasmExports;
createWasm();
var ___wasm_call_ctors = () => (___wasm_call_ctors = wasmExports['__wasm_call_ctors'])();
var _sqlite3_status64 = Module['_sqlite3_status64'] = (a0, a1, a2, a3) => (_sqlite3_status64 = Module['_sqlite3_status64'] = wasmExports['sqlite3_status64'])(a0, a1, a2, a3);
var _sqlite3_status = Module['_sqlite3_status'] = (a0, a1, a2, a3) => (_sqlite3_status = Module['_sqlite3_status'] = wasmExports['sqlite3_status'])(a0, a1, a2, a3);
var _sqlite3_db_status = Module['_sqlite3_db_status'] = (a0, a1, a2, a3, a4) => (_sqlite3_db_status = Module['_sqlite3_db_status'] = wasmExports['sqlite3_db_status'])(a0, a1, a2, a3, a4);
var _sqlite3_msize = Module['_sqlite3_msize'] = (a0) => (_sqlite3_msize = Module['_sqlite3_msize'] = wasmExports['sqlite3_msize'])(a0);
var _sqlite3_vfs_find = Module['_sqlite3_vfs_find'] = (a0) => (_sqlite3_vfs_find = Module['_sqlite3_vfs_find'] = wasmExports['sqlite3_vfs_find'])(a0);
var _sqlite3_vfs_register = Module['_sqlite3_vfs_register'] = (a0, a1) => (_sqlite3_vfs_register = Module['_sqlite3_vfs_register'] = wasmExports['sqlite3_vfs_register'])(a0, a1);
var _sqlite3_vfs_unregister = Module['_sqlite3_vfs_unregister'] = (a0) => (_sqlite3_vfs_unregister = Module['_sqlite3_vfs_unregister'] = wasmExports['sqlite3_vfs_unregister'])(a0);
var _sqlite3_release_memory = Module['_sqlite3_release_memory'] = (a0) => (_sqlite3_release_memory = Module['_sqlite3_release_memory'] = wasmExports['sqlite3_release_memory'])(a0);
var _sqlite3_soft_heap_limit64 = Module['_sqlite3_soft_heap_limit64'] = (a0, a1) => (_sqlite3_soft_heap_limit64 = Module['_sqlite3_soft_heap_limit64'] = wasmExports['sqlite3_soft_heap_limit64'])(a0, a1);
var _sqlite3_memory_used = Module['_sqlite3_memory_used'] = () => (_sqlite3_memory_used = Module['_sqlite3_memory_used'] = wasmExports['sqlite3_memory_used'])();
var _sqlite3_hard_heap_limit64 = Module['_sqlite3_hard_heap_limit64'] = (a0, a1) => (_sqlite3_hard_heap_limit64 = Module['_sqlite3_hard_heap_limit64'] = wasmExports['sqlite3_hard_heap_limit64'])(a0, a1);
var _sqlite3_memory_highwater = Module['_sqlite3_memory_highwater'] = (a0) => (_sqlite3_memory_highwater = Module['_sqlite3_memory_highwater'] = wasmExports['sqlite3_memory_highwater'])(a0);
var _sqlite3_malloc = Module['_sqlite3_malloc'] = (a0) => (_sqlite3_malloc = Module['_sqlite3_malloc'] = wasmExports['sqlite3_malloc'])(a0);
var _sqlite3_malloc64 = Module['_sqlite3_malloc64'] = (a0, a1) => (_sqlite3_malloc64 = Module['_sqlite3_malloc64'] = wasmExports['sqlite3_malloc64'])(a0, a1);
var _sqlite3_free = Module['_sqlite3_free'] = (a0) => (_sqlite3_free = Module['_sqlite3_free'] = wasmExports['sqlite3_free'])(a0);
var _sqlite3_realloc = Module['_sqlite3_realloc'] = (a0, a1) => (_sqlite3_realloc = Module['_sqlite3_realloc'] = wasmExports['sqlite3_realloc'])(a0, a1);
var _sqlite3_realloc64 = Module['_sqlite3_realloc64'] = (a0, a1, a2) => (_sqlite3_realloc64 = Module['_sqlite3_realloc64'] = wasmExports['sqlite3_realloc64'])(a0, a1, a2);
var _sqlite3_str_vappendf = Module['_sqlite3_str_vappendf'] = (a0, a1, a2) => (_sqlite3_str_vappendf = Module['_sqlite3_str_vappendf'] = wasmExports['sqlite3_str_vappendf'])(a0, a1, a2);
var _sqlite3_str_append = Module['_sqlite3_str_append'] = (a0, a1, a2) => (_sqlite3_str_append = Module['_sqlite3_str_append'] = wasmExports['sqlite3_str_append'])(a0, a1, a2);
var _sqlite3_str_appendchar = Module['_sqlite3_str_appendchar'] = (a0, a1, a2) => (_sqlite3_str_appendchar = Module['_sqlite3_str_appendchar'] = wasmExports['sqlite3_str_appendchar'])(a0, a1, a2);
var _sqlite3_str_appendall = Module['_sqlite3_str_appendall'] = (a0, a1) => (_sqlite3_str_appendall = Module['_sqlite3_str_appendall'] = wasmExports['sqlite3_str_appendall'])(a0, a1);
var _sqlite3_str_appendf = Module['_sqlite3_str_appendf'] = (a0, a1, a2) => (_sqlite3_str_appendf = Module['_sqlite3_str_appendf'] = wasmExports['sqlite3_str_appendf'])(a0, a1, a2);
var _sqlite3_str_finish = Module['_sqlite3_str_finish'] = (a0) => (_sqlite3_str_finish = Module['_sqlite3_str_finish'] = wasmExports['sqlite3_str_finish'])(a0);
var _sqlite3_str_errcode = Module['_sqlite3_str_errcode'] = (a0) => (_sqlite3_str_errcode = Module['_sqlite3_str_errcode'] = wasmExports['sqlite3_str_errcode'])(a0);
var _sqlite3_str_length = Module['_sqlite3_str_length'] = (a0) => (_sqlite3_str_length = Module['_sqlite3_str_length'] = wasmExports['sqlite3_str_length'])(a0);
var _sqlite3_str_value = Module['_sqlite3_str_value'] = (a0) => (_sqlite3_str_value = Module['_sqlite3_str_value'] = wasmExports['sqlite3_str_value'])(a0);
var _sqlite3_str_reset = Module['_sqlite3_str_reset'] = (a0) => (_sqlite3_str_reset = Module['_sqlite3_str_reset'] = wasmExports['sqlite3_str_reset'])(a0);
var _sqlite3_str_new = Module['_sqlite3_str_new'] = (a0) => (_sqlite3_str_new = Module['_sqlite3_str_new'] = wasmExports['sqlite3_str_new'])(a0);
var _sqlite3_vmprintf = Module['_sqlite3_vmprintf'] = (a0, a1) => (_sqlite3_vmprintf = Module['_sqlite3_vmprintf'] = wasmExports['sqlite3_vmprintf'])(a0, a1);
var _sqlite3_mprintf = Module['_sqlite3_mprintf'] = (a0, a1) => (_sqlite3_mprintf = Module['_sqlite3_mprintf'] = wasmExports['sqlite3_mprintf'])(a0, a1);
var _sqlite3_vsnprintf = Module['_sqlite3_vsnprintf'] = (a0, a1, a2, a3) => (_sqlite3_vsnprintf = Module['_sqlite3_vsnprintf'] = wasmExports['sqlite3_vsnprintf'])(a0, a1, a2, a3);
var _sqlite3_snprintf = Module['_sqlite3_snprintf'] = (a0, a1, a2, a3) => (_sqlite3_snprintf = Module['_sqlite3_snprintf'] = wasmExports['sqlite3_snprintf'])(a0, a1, a2, a3);
var _sqlite3_log = Module['_sqlite3_log'] = (a0, a1, a2) => (_sqlite3_log = Module['_sqlite3_log'] = wasmExports['sqlite3_log'])(a0, a1, a2);
var _sqlite3_randomness = Module['_sqlite3_randomness'] = (a0, a1) => (_sqlite3_randomness = Module['_sqlite3_randomness'] = wasmExports['sqlite3_randomness'])(a0, a1);
var _sqlite3_stricmp = Module['_sqlite3_stricmp'] = (a0, a1) => (_sqlite3_stricmp = Module['_sqlite3_stricmp'] = wasmExports['sqlite3_stricmp'])(a0, a1);
var _sqlite3_strnicmp = Module['_sqlite3_strnicmp'] = (a0, a1, a2) => (_sqlite3_strnicmp = Module['_sqlite3_strnicmp'] = wasmExports['sqlite3_strnicmp'])(a0, a1, a2);
var _sqlite3_os_init = Module['_sqlite3_os_init'] = () => (_sqlite3_os_init = Module['_sqlite3_os_init'] = wasmExports['sqlite3_os_init'])();
var _sqlite3_os_end = Module['_sqlite3_os_end'] = () => (_sqlite3_os_end = Module['_sqlite3_os_end'] = wasmExports['sqlite3_os_end'])();
var _sqlite3_serialize = Module['_sqlite3_serialize'] = (a0, a1, a2, a3) => (_sqlite3_serialize = Module['_sqlite3_serialize'] = wasmExports['sqlite3_serialize'])(a0, a1, a2, a3);
var _sqlite3_prepare_v2 = Module['_sqlite3_prepare_v2'] = (a0, a1, a2, a3, a4) => (_sqlite3_prepare_v2 = Module['_sqlite3_prepare_v2'] = wasmExports['sqlite3_prepare_v2'])(a0, a1, a2, a3, a4);
var _sqlite3_step = Module['_sqlite3_step'] = (a0) => (_sqlite3_step = Module['_sqlite3_step'] = wasmExports['sqlite3_step'])(a0);
var _sqlite3_column_int64 = Module['_sqlite3_column_int64'] = (a0, a1) => (_sqlite3_column_int64 = Module['_sqlite3_column_int64'] = wasmExports['sqlite3_column_int64'])(a0, a1);
var _sqlite3_reset = Module['_sqlite3_reset'] = (a0) => (_sqlite3_reset = Module['_sqlite3_reset'] = wasmExports['sqlite3_reset'])(a0);
var _sqlite3_exec = Module['_sqlite3_exec'] = (a0, a1, a2, a3, a4) => (_sqlite3_exec = Module['_sqlite3_exec'] = wasmExports['sqlite3_exec'])(a0, a1, a2, a3, a4);
var _sqlite3_column_int = Module['_sqlite3_column_int'] = (a0, a1) => (_sqlite3_column_int = Module['_sqlite3_column_int'] = wasmExports['sqlite3_column_int'])(a0, a1);
var _sqlite3_finalize = Module['_sqlite3_finalize'] = (a0) => (_sqlite3_finalize = Module['_sqlite3_finalize'] = wasmExports['sqlite3_finalize'])(a0);
var _sqlite3_deserialize = Module['_sqlite3_deserialize'] = (a0, a1, a2, a3, a4, a5, a6, a7) => (_sqlite3_deserialize = Module['_sqlite3_deserialize'] = wasmExports['sqlite3_deserialize'])(a0, a1, a2, a3, a4, a5, a6, a7);
var _sqlite3_database_file_object = Module['_sqlite3_database_file_object'] = (a0) => (_sqlite3_database_file_object = Module['_sqlite3_database_file_object'] = wasmExports['sqlite3_database_file_object'])(a0);
var _sqlite3_backup_init = Module['_sqlite3_backup_init'] = (a0, a1, a2, a3) => (_sqlite3_backup_init = Module['_sqlite3_backup_init'] = wasmExports['sqlite3_backup_init'])(a0, a1, a2, a3);
var _sqlite3_backup_step = Module['_sqlite3_backup_step'] = (a0, a1) => (_sqlite3_backup_step = Module['_sqlite3_backup_step'] = wasmExports['sqlite3_backup_step'])(a0, a1);
var _sqlite3_backup_finish = Module['_sqlite3_backup_finish'] = (a0) => (_sqlite3_backup_finish = Module['_sqlite3_backup_finish'] = wasmExports['sqlite3_backup_finish'])(a0);
var _sqlite3_backup_remaining = Module['_sqlite3_backup_remaining'] = (a0) => (_sqlite3_backup_remaining = Module['_sqlite3_backup_remaining'] = wasmExports['sqlite3_backup_remaining'])(a0);
var _sqlite3_backup_pagecount = Module['_sqlite3_backup_pagecount'] = (a0) => (_sqlite3_backup_pagecount = Module['_sqlite3_backup_pagecount'] = wasmExports['sqlite3_backup_pagecount'])(a0);
var _sqlite3_clear_bindings = Module['_sqlite3_clear_bindings'] = (a0) => (_sqlite3_clear_bindings = Module['_sqlite3_clear_bindings'] = wasmExports['sqlite3_clear_bindings'])(a0);
var _sqlite3_value_blob = Module['_sqlite3_value_blob'] = (a0) => (_sqlite3_value_blob = Module['_sqlite3_value_blob'] = wasmExports['sqlite3_value_blob'])(a0);
var _sqlite3_value_text = Module['_sqlite3_value_text'] = (a0) => (_sqlite3_value_text = Module['_sqlite3_value_text'] = wasmExports['sqlite3_value_text'])(a0);
var _sqlite3_value_bytes = Module['_sqlite3_value_bytes'] = (a0) => (_sqlite3_value_bytes = Module['_sqlite3_value_bytes'] = wasmExports['sqlite3_value_bytes'])(a0);
var _sqlite3_value_bytes16 = Module['_sqlite3_value_bytes16'] = (a0) => (_sqlite3_value_bytes16 = Module['_sqlite3_value_bytes16'] = wasmExports['sqlite3_value_bytes16'])(a0);
var _sqlite3_value_double = Module['_sqlite3_value_double'] = (a0) => (_sqlite3_value_double = Module['_sqlite3_value_double'] = wasmExports['sqlite3_value_double'])(a0);
var _sqlite3_value_int = Module['_sqlite3_value_int'] = (a0) => (_sqlite3_value_int = Module['_sqlite3_value_int'] = wasmExports['sqlite3_value_int'])(a0);
var _sqlite3_value_int64 = Module['_sqlite3_value_int64'] = (a0) => (_sqlite3_value_int64 = Module['_sqlite3_value_int64'] = wasmExports['sqlite3_value_int64'])(a0);
var _sqlite3_value_subtype = Module['_sqlite3_value_subtype'] = (a0) => (_sqlite3_value_subtype = Module['_sqlite3_value_subtype'] = wasmExports['sqlite3_value_subtype'])(a0);
var _sqlite3_value_pointer = Module['_sqlite3_value_pointer'] = (a0, a1) => (_sqlite3_value_pointer = Module['_sqlite3_value_pointer'] = wasmExports['sqlite3_value_pointer'])(a0, a1);
var _sqlite3_value_text16 = Module['_sqlite3_value_text16'] = (a0) => (_sqlite3_value_text16 = Module['_sqlite3_value_text16'] = wasmExports['sqlite3_value_text16'])(a0);
var _sqlite3_value_text16be = Module['_sqlite3_value_text16be'] = (a0) => (_sqlite3_value_text16be = Module['_sqlite3_value_text16be'] = wasmExports['sqlite3_value_text16be'])(a0);
var _sqlite3_value_text16le = Module['_sqlite3_value_text16le'] = (a0) => (_sqlite3_value_text16le = Module['_sqlite3_value_text16le'] = wasmExports['sqlite3_value_text16le'])(a0);
var _sqlite3_value_type = Module['_sqlite3_value_type'] = (a0) => (_sqlite3_value_type = Module['_sqlite3_value_type'] = wasmExports['sqlite3_value_type'])(a0);
var _sqlite3_value_encoding = Module['_sqlite3_value_encoding'] = (a0) => (_sqlite3_value_encoding = Module['_sqlite3_value_encoding'] = wasmExports['sqlite3_value_encoding'])(a0);
var _sqlite3_value_nochange = Module['_sqlite3_value_nochange'] = (a0) => (_sqlite3_value_nochange = Module['_sqlite3_value_nochange'] = wasmExports['sqlite3_value_nochange'])(a0);
var _sqlite3_value_frombind = Module['_sqlite3_value_frombind'] = (a0) => (_sqlite3_value_frombind = Module['_sqlite3_value_frombind'] = wasmExports['sqlite3_value_frombind'])(a0);
var _sqlite3_value_dup = Module['_sqlite3_value_dup'] = (a0) => (_sqlite3_value_dup = Module['_sqlite3_value_dup'] = wasmExports['sqlite3_value_dup'])(a0);
var _sqlite3_value_free = Module['_sqlite3_value_free'] = (a0) => (_sqlite3_value_free = Module['_sqlite3_value_free'] = wasmExports['sqlite3_value_free'])(a0);
var _sqlite3_result_blob = Module['_sqlite3_result_blob'] = (a0, a1, a2, a3) => (_sqlite3_result_blob = Module['_sqlite3_result_blob'] = wasmExports['sqlite3_result_blob'])(a0, a1, a2, a3);
var _sqlite3_result_blob64 = Module['_sqlite3_result_blob64'] = (a0, a1, a2, a3, a4) => (_sqlite3_result_blob64 = Module['_sqlite3_result_blob64'] = wasmExports['sqlite3_result_blob64'])(a0, a1, a2, a3, a4);
var _sqlite3_result_double = Module['_sqlite3_result_double'] = (a0, a1) => (_sqlite3_result_double = Module['_sqlite3_result_double'] = wasmExports['sqlite3_result_double'])(a0, a1);
var _sqlite3_result_error = Module['_sqlite3_result_error'] = (a0, a1, a2) => (_sqlite3_result_error = Module['_sqlite3_result_error'] = wasmExports['sqlite3_result_error'])(a0, a1, a2);
var _sqlite3_result_error16 = Module['_sqlite3_result_error16'] = (a0, a1, a2) => (_sqlite3_result_error16 = Module['_sqlite3_result_error16'] = wasmExports['sqlite3_result_error16'])(a0, a1, a2);
var _sqlite3_result_int = Module['_sqlite3_result_int'] = (a0, a1) => (_sqlite3_result_int = Module['_sqlite3_result_int'] = wasmExports['sqlite3_result_int'])(a0, a1);
var _sqlite3_result_int64 = Module['_sqlite3_result_int64'] = (a0, a1, a2) => (_sqlite3_result_int64 = Module['_sqlite3_result_int64'] = wasmExports['sqlite3_result_int64'])(a0, a1, a2);
var _sqlite3_result_null = Module['_sqlite3_result_null'] = (a0) => (_sqlite3_result_null = Module['_sqlite3_result_null'] = wasmExports['sqlite3_result_null'])(a0);
var _sqlite3_result_pointer = Module['_sqlite3_result_pointer'] = (a0, a1, a2, a3) => (_sqlite3_result_pointer = Module['_sqlite3_result_pointer'] = wasmExports['sqlite3_result_pointer'])(a0, a1, a2, a3);
var _sqlite3_result_subtype = Module['_sqlite3_result_subtype'] = (a0, a1) => (_sqlite3_result_subtype = Module['_sqlite3_result_subtype'] = wasmExports['sqlite3_result_subtype'])(a0, a1);
var _sqlite3_result_text = Module['_sqlite3_result_text'] = (a0, a1, a2, a3) => (_sqlite3_result_text = Module['_sqlite3_result_text'] = wasmExports['sqlite3_result_text'])(a0, a1, a2, a3);
var _sqlite3_result_text64 = Module['_sqlite3_result_text64'] = (a0, a1, a2, a3, a4, a5) => (_sqlite3_result_text64 = Module['_sqlite3_result_text64'] = wasmExports['sqlite3_result_text64'])(a0, a1, a2, a3, a4, a5);
var _sqlite3_result_text16 = Module['_sqlite3_result_text16'] = (a0, a1, a2, a3) => (_sqlite3_result_text16 = Module['_sqlite3_result_text16'] = wasmExports['sqlite3_result_text16'])(a0, a1, a2, a3);
var _sqlite3_result_text16be = Module['_sqlite3_result_text16be'] = (a0, a1, a2, a3) => (_sqlite3_result_text16be = Module['_sqlite3_result_text16be'] = wasmExports['sqlite3_result_text16be'])(a0, a1, a2, a3);
var _sqlite3_result_text16le = Module['_sqlite3_result_text16le'] = (a0, a1, a2, a3) => (_sqlite3_result_text16le = Module['_sqlite3_result_text16le'] = wasmExports['sqlite3_result_text16le'])(a0, a1, a2, a3);
var _sqlite3_result_value = Module['_sqlite3_result_value'] = (a0, a1) => (_sqlite3_result_value = Module['_sqlite3_result_value'] = wasmExports['sqlite3_result_value'])(a0, a1);
var _sqlite3_result_error_toobig = Module['_sqlite3_result_error_toobig'] = (a0) => (_sqlite3_result_error_toobig = Module['_sqlite3_result_error_toobig'] = wasmExports['sqlite3_result_error_toobig'])(a0);
var _sqlite3_result_zeroblob = Module['_sqlite3_result_zeroblob'] = (a0, a1) => (_sqlite3_result_zeroblob = Module['_sqlite3_result_zeroblob'] = wasmExports['sqlite3_result_zeroblob'])(a0, a1);
var _sqlite3_result_zeroblob64 = Module['_sqlite3_result_zeroblob64'] = (a0, a1, a2) => (_sqlite3_result_zeroblob64 = Module['_sqlite3_result_zeroblob64'] = wasmExports['sqlite3_result_zeroblob64'])(a0, a1, a2);
var _sqlite3_result_error_code = Module['_sqlite3_result_error_code'] = (a0, a1) => (_sqlite3_result_error_code = Module['_sqlite3_result_error_code'] = wasmExports['sqlite3_result_error_code'])(a0, a1);
var _sqlite3_result_error_nomem = Module['_sqlite3_result_error_nomem'] = (a0) => (_sqlite3_result_error_nomem = Module['_sqlite3_result_error_nomem'] = wasmExports['sqlite3_result_error_nomem'])(a0);
var _sqlite3_user_data = Module['_sqlite3_user_data'] = (a0) => (_sqlite3_user_data = Module['_sqlite3_user_data'] = wasmExports['sqlite3_user_data'])(a0);
var _sqlite3_context_db_handle = Module['_sqlite3_context_db_handle'] = (a0) => (_sqlite3_context_db_handle = Module['_sqlite3_context_db_handle'] = wasmExports['sqlite3_context_db_handle'])(a0);
var _sqlite3_vtab_nochange = Module['_sqlite3_vtab_nochange'] = (a0) => (_sqlite3_vtab_nochange = Module['_sqlite3_vtab_nochange'] = wasmExports['sqlite3_vtab_nochange'])(a0);
var _sqlite3_vtab_in_first = Module['_sqlite3_vtab_in_first'] = (a0, a1) => (_sqlite3_vtab_in_first = Module['_sqlite3_vtab_in_first'] = wasmExports['sqlite3_vtab_in_first'])(a0, a1);
var _sqlite3_vtab_in_next = Module['_sqlite3_vtab_in_next'] = (a0, a1) => (_sqlite3_vtab_in_next = Module['_sqlite3_vtab_in_next'] = wasmExports['sqlite3_vtab_in_next'])(a0, a1);
var _sqlite3_aggregate_context = Module['_sqlite3_aggregate_context'] = (a0, a1) => (_sqlite3_aggregate_context = Module['_sqlite3_aggregate_context'] = wasmExports['sqlite3_aggregate_context'])(a0, a1);
var _sqlite3_get_auxdata = Module['_sqlite3_get_auxdata'] = (a0, a1) => (_sqlite3_get_auxdata = Module['_sqlite3_get_auxdata'] = wasmExports['sqlite3_get_auxdata'])(a0, a1);
var _sqlite3_set_auxdata = Module['_sqlite3_set_auxdata'] = (a0, a1, a2, a3) => (_sqlite3_set_auxdata = Module['_sqlite3_set_auxdata'] = wasmExports['sqlite3_set_auxdata'])(a0, a1, a2, a3);
var _sqlite3_column_count = Module['_sqlite3_column_count'] = (a0) => (_sqlite3_column_count = Module['_sqlite3_column_count'] = wasmExports['sqlite3_column_count'])(a0);
var _sqlite3_data_count = Module['_sqlite3_data_count'] = (a0) => (_sqlite3_data_count = Module['_sqlite3_data_count'] = wasmExports['sqlite3_data_count'])(a0);
var _sqlite3_column_blob = Module['_sqlite3_column_blob'] = (a0, a1) => (_sqlite3_column_blob = Module['_sqlite3_column_blob'] = wasmExports['sqlite3_column_blob'])(a0, a1);
var _sqlite3_column_bytes = Module['_sqlite3_column_bytes'] = (a0, a1) => (_sqlite3_column_bytes = Module['_sqlite3_column_bytes'] = wasmExports['sqlite3_column_bytes'])(a0, a1);
var _sqlite3_column_bytes16 = Module['_sqlite3_column_bytes16'] = (a0, a1) => (_sqlite3_column_bytes16 = Module['_sqlite3_column_bytes16'] = wasmExports['sqlite3_column_bytes16'])(a0, a1);
var _sqlite3_column_double = Module['_sqlite3_column_double'] = (a0, a1) => (_sqlite3_column_double = Module['_sqlite3_column_double'] = wasmExports['sqlite3_column_double'])(a0, a1);
var _sqlite3_column_text = Module['_sqlite3_column_text'] = (a0, a1) => (_sqlite3_column_text = Module['_sqlite3_column_text'] = wasmExports['sqlite3_column_text'])(a0, a1);
var _sqlite3_column_value = Module['_sqlite3_column_value'] = (a0, a1) => (_sqlite3_column_value = Module['_sqlite3_column_value'] = wasmExports['sqlite3_column_value'])(a0, a1);
var _sqlite3_column_text16 = Module['_sqlite3_column_text16'] = (a0, a1) => (_sqlite3_column_text16 = Module['_sqlite3_column_text16'] = wasmExports['sqlite3_column_text16'])(a0, a1);
var _sqlite3_column_type = Module['_sqlite3_column_type'] = (a0, a1) => (_sqlite3_column_type = Module['_sqlite3_column_type'] = wasmExports['sqlite3_column_type'])(a0, a1);
var _sqlite3_column_name = Module['_sqlite3_column_name'] = (a0, a1) => (_sqlite3_column_name = Module['_sqlite3_column_name'] = wasmExports['sqlite3_column_name'])(a0, a1);
var _sqlite3_column_name16 = Module['_sqlite3_column_name16'] = (a0, a1) => (_sqlite3_column_name16 = Module['_sqlite3_column_name16'] = wasmExports['sqlite3_column_name16'])(a0, a1);
var _sqlite3_bind_blob = Module['_sqlite3_bind_blob'] = (a0, a1, a2, a3, a4) => (_sqlite3_bind_blob = Module['_sqlite3_bind_blob'] = wasmExports['sqlite3_bind_blob'])(a0, a1, a2, a3, a4);
var _sqlite3_bind_blob64 = Module['_sqlite3_bind_blob64'] = (a0, a1, a2, a3, a4, a5) => (_sqlite3_bind_blob64 = Module['_sqlite3_bind_blob64'] = wasmExports['sqlite3_bind_blob64'])(a0, a1, a2, a3, a4, a5);
var _sqlite3_bind_double = Module['_sqlite3_bind_double'] = (a0, a1, a2) => (_sqlite3_bind_double = Module['_sqlite3_bind_double'] = wasmExports['sqlite3_bind_double'])(a0, a1, a2);
var _sqlite3_bind_int = Module['_sqlite3_bind_int'] = (a0, a1, a2) => (_sqlite3_bind_int = Module['_sqlite3_bind_int'] = wasmExports['sqlite3_bind_int'])(a0, a1, a2);
var _sqlite3_bind_int64 = Module['_sqlite3_bind_int64'] = (a0, a1, a2, a3) => (_sqlite3_bind_int64 = Module['_sqlite3_bind_int64'] = wasmExports['sqlite3_bind_int64'])(a0, a1, a2, a3);
var _sqlite3_bind_null = Module['_sqlite3_bind_null'] = (a0, a1) => (_sqlite3_bind_null = Module['_sqlite3_bind_null'] = wasmExports['sqlite3_bind_null'])(a0, a1);
var _sqlite3_bind_pointer = Module['_sqlite3_bind_pointer'] = (a0, a1, a2, a3, a4) => (_sqlite3_bind_pointer = Module['_sqlite3_bind_pointer'] = wasmExports['sqlite3_bind_pointer'])(a0, a1, a2, a3, a4);
var _sqlite3_bind_text = Module['_sqlite3_bind_text'] = (a0, a1, a2, a3, a4) => (_sqlite3_bind_text = Module['_sqlite3_bind_text'] = wasmExports['sqlite3_bind_text'])(a0, a1, a2, a3, a4);
var _sqlite3_bind_text64 = Module['_sqlite3_bind_text64'] = (a0, a1, a2, a3, a4, a5, a6) => (_sqlite3_bind_text64 = Module['_sqlite3_bind_text64'] = wasmExports['sqlite3_bind_text64'])(a0, a1, a2, a3, a4, a5, a6);
var _sqlite3_bind_text16 = Module['_sqlite3_bind_text16'] = (a0, a1, a2, a3, a4) => (_sqlite3_bind_text16 = Module['_sqlite3_bind_text16'] = wasmExports['sqlite3_bind_text16'])(a0, a1, a2, a3, a4);
var _sqlite3_bind_value = Module['_sqlite3_bind_value'] = (a0, a1, a2) => (_sqlite3_bind_value = Module['_sqlite3_bind_value'] = wasmExports['sqlite3_bind_value'])(a0, a1, a2);
var _sqlite3_bind_zeroblob = Module['_sqlite3_bind_zeroblob'] = (a0, a1, a2) => (_sqlite3_bind_zeroblob = Module['_sqlite3_bind_zeroblob'] = wasmExports['sqlite3_bind_zeroblob'])(a0, a1, a2);
var _sqlite3_bind_zeroblob64 = Module['_sqlite3_bind_zeroblob64'] = (a0, a1, a2, a3) => (_sqlite3_bind_zeroblob64 = Module['_sqlite3_bind_zeroblob64'] = wasmExports['sqlite3_bind_zeroblob64'])(a0, a1, a2, a3);
var _sqlite3_bind_parameter_count = Module['_sqlite3_bind_parameter_count'] = (a0) => (_sqlite3_bind_parameter_count = Module['_sqlite3_bind_parameter_count'] = wasmExports['sqlite3_bind_parameter_count'])(a0);
var _sqlite3_bind_parameter_name = Module['_sqlite3_bind_parameter_name'] = (a0, a1) => (_sqlite3_bind_parameter_name = Module['_sqlite3_bind_parameter_name'] = wasmExports['sqlite3_bind_parameter_name'])(a0, a1);
var _sqlite3_bind_parameter_index = Module['_sqlite3_bind_parameter_index'] = (a0, a1) => (_sqlite3_bind_parameter_index = Module['_sqlite3_bind_parameter_index'] = wasmExports['sqlite3_bind_parameter_index'])(a0, a1);
var _sqlite3_db_handle = Module['_sqlite3_db_handle'] = (a0) => (_sqlite3_db_handle = Module['_sqlite3_db_handle'] = wasmExports['sqlite3_db_handle'])(a0);
var _sqlite3_stmt_readonly = Module['_sqlite3_stmt_readonly'] = (a0) => (_sqlite3_stmt_readonly = Module['_sqlite3_stmt_readonly'] = wasmExports['sqlite3_stmt_readonly'])(a0);
var _sqlite3_stmt_isexplain = Module['_sqlite3_stmt_isexplain'] = (a0) => (_sqlite3_stmt_isexplain = Module['_sqlite3_stmt_isexplain'] = wasmExports['sqlite3_stmt_isexplain'])(a0);
var _sqlite3_stmt_explain = Module['_sqlite3_stmt_explain'] = (a0, a1) => (_sqlite3_stmt_explain = Module['_sqlite3_stmt_explain'] = wasmExports['sqlite3_stmt_explain'])(a0, a1);
var _sqlite3_stmt_busy = Module['_sqlite3_stmt_busy'] = (a0) => (_sqlite3_stmt_busy = Module['_sqlite3_stmt_busy'] = wasmExports['sqlite3_stmt_busy'])(a0);
var _sqlite3_next_stmt = Module['_sqlite3_next_stmt'] = (a0, a1) => (_sqlite3_next_stmt = Module['_sqlite3_next_stmt'] = wasmExports['sqlite3_next_stmt'])(a0, a1);
var _sqlite3_stmt_status = Module['_sqlite3_stmt_status'] = (a0, a1, a2) => (_sqlite3_stmt_status = Module['_sqlite3_stmt_status'] = wasmExports['sqlite3_stmt_status'])(a0, a1, a2);
var _sqlite3_sql = Module['_sqlite3_sql'] = (a0) => (_sqlite3_sql = Module['_sqlite3_sql'] = wasmExports['sqlite3_sql'])(a0);
var _sqlite3_expanded_sql = Module['_sqlite3_expanded_sql'] = (a0) => (_sqlite3_expanded_sql = Module['_sqlite3_expanded_sql'] = wasmExports['sqlite3_expanded_sql'])(a0);
var _sqlite3_value_numeric_type = Module['_sqlite3_value_numeric_type'] = (a0) => (_sqlite3_value_numeric_type = Module['_sqlite3_value_numeric_type'] = wasmExports['sqlite3_value_numeric_type'])(a0);
var _sqlite3_blob_open = Module['_sqlite3_blob_open'] = (a0, a1, a2, a3, a4, a5, a6, a7) => (_sqlite3_blob_open = Module['_sqlite3_blob_open'] = wasmExports['sqlite3_blob_open'])(a0, a1, a2, a3, a4, a5, a6, a7);
var _sqlite3_blob_close = Module['_sqlite3_blob_close'] = (a0) => (_sqlite3_blob_close = Module['_sqlite3_blob_close'] = wasmExports['sqlite3_blob_close'])(a0);
var _sqlite3_blob_read = Module['_sqlite3_blob_read'] = (a0, a1, a2, a3) => (_sqlite3_blob_read = Module['_sqlite3_blob_read'] = wasmExports['sqlite3_blob_read'])(a0, a1, a2, a3);
var _sqlite3_blob_write = Module['_sqlite3_blob_write'] = (a0, a1, a2, a3) => (_sqlite3_blob_write = Module['_sqlite3_blob_write'] = wasmExports['sqlite3_blob_write'])(a0, a1, a2, a3);
var _sqlite3_blob_bytes = Module['_sqlite3_blob_bytes'] = (a0) => (_sqlite3_blob_bytes = Module['_sqlite3_blob_bytes'] = wasmExports['sqlite3_blob_bytes'])(a0);
var _sqlite3_blob_reopen = Module['_sqlite3_blob_reopen'] = (a0, a1, a2) => (_sqlite3_blob_reopen = Module['_sqlite3_blob_reopen'] = wasmExports['sqlite3_blob_reopen'])(a0, a1, a2);
var _sqlite3_set_authorizer = Module['_sqlite3_set_authorizer'] = (a0, a1, a2) => (_sqlite3_set_authorizer = Module['_sqlite3_set_authorizer'] = wasmExports['sqlite3_set_authorizer'])(a0, a1, a2);
var _sqlite3_strglob = Module['_sqlite3_strglob'] = (a0, a1) => (_sqlite3_strglob = Module['_sqlite3_strglob'] = wasmExports['sqlite3_strglob'])(a0, a1);
var _sqlite3_strlike = Module['_sqlite3_strlike'] = (a0, a1, a2) => (_sqlite3_strlike = Module['_sqlite3_strlike'] = wasmExports['sqlite3_strlike'])(a0, a1, a2);
var _sqlite3_errmsg = Module['_sqlite3_errmsg'] = (a0) => (_sqlite3_errmsg = Module['_sqlite3_errmsg'] = wasmExports['sqlite3_errmsg'])(a0);
var _sqlite3_auto_extension = Module['_sqlite3_auto_extension'] = (a0) => (_sqlite3_auto_extension = Module['_sqlite3_auto_extension'] = wasmExports['sqlite3_auto_extension'])(a0);
var _sqlite3_cancel_auto_extension = Module['_sqlite3_cancel_auto_extension'] = (a0) => (_sqlite3_cancel_auto_extension = Module['_sqlite3_cancel_auto_extension'] = wasmExports['sqlite3_cancel_auto_extension'])(a0);
var _sqlite3_reset_auto_extension = Module['_sqlite3_reset_auto_extension'] = () => (_sqlite3_reset_auto_extension = Module['_sqlite3_reset_auto_extension'] = wasmExports['sqlite3_reset_auto_extension'])();
var _sqlite3_prepare = Module['_sqlite3_prepare'] = (a0, a1, a2, a3, a4) => (_sqlite3_prepare = Module['_sqlite3_prepare'] = wasmExports['sqlite3_prepare'])(a0, a1, a2, a3, a4);
var _sqlite3_prepare_v3 = Module['_sqlite3_prepare_v3'] = (a0, a1, a2, a3, a4, a5) => (_sqlite3_prepare_v3 = Module['_sqlite3_prepare_v3'] = wasmExports['sqlite3_prepare_v3'])(a0, a1, a2, a3, a4, a5);
var _sqlite3_prepare16 = Module['_sqlite3_prepare16'] = (a0, a1, a2, a3, a4) => (_sqlite3_prepare16 = Module['_sqlite3_prepare16'] = wasmExports['sqlite3_prepare16'])(a0, a1, a2, a3, a4);
var _sqlite3_prepare16_v2 = Module['_sqlite3_prepare16_v2'] = (a0, a1, a2, a3, a4) => (_sqlite3_prepare16_v2 = Module['_sqlite3_prepare16_v2'] = wasmExports['sqlite3_prepare16_v2'])(a0, a1, a2, a3, a4);
var _sqlite3_prepare16_v3 = Module['_sqlite3_prepare16_v3'] = (a0, a1, a2, a3, a4, a5) => (_sqlite3_prepare16_v3 = Module['_sqlite3_prepare16_v3'] = wasmExports['sqlite3_prepare16_v3'])(a0, a1, a2, a3, a4, a5);
var _sqlite3_get_table = Module['_sqlite3_get_table'] = (a0, a1, a2, a3, a4, a5) => (_sqlite3_get_table = Module['_sqlite3_get_table'] = wasmExports['sqlite3_get_table'])(a0, a1, a2, a3, a4, a5);
var _sqlite3_free_table = Module['_sqlite3_free_table'] = (a0) => (_sqlite3_free_table = Module['_sqlite3_free_table'] = wasmExports['sqlite3_free_table'])(a0);
var _sqlite3_create_module = Module['_sqlite3_create_module'] = (a0, a1, a2, a3) => (_sqlite3_create_module = Module['_sqlite3_create_module'] = wasmExports['sqlite3_create_module'])(a0, a1, a2, a3);
var _sqlite3_create_module_v2 = Module['_sqlite3_create_module_v2'] = (a0, a1, a2, a3, a4) => (_sqlite3_create_module_v2 = Module['_sqlite3_create_module_v2'] = wasmExports['sqlite3_create_module_v2'])(a0, a1, a2, a3, a4);
var _sqlite3_drop_modules = Module['_sqlite3_drop_modules'] = (a0, a1) => (_sqlite3_drop_modules = Module['_sqlite3_drop_modules'] = wasmExports['sqlite3_drop_modules'])(a0, a1);
var _sqlite3_declare_vtab = Module['_sqlite3_declare_vtab'] = (a0, a1) => (_sqlite3_declare_vtab = Module['_sqlite3_declare_vtab'] = wasmExports['sqlite3_declare_vtab'])(a0, a1);
var _sqlite3_vtab_on_conflict = Module['_sqlite3_vtab_on_conflict'] = (a0) => (_sqlite3_vtab_on_conflict = Module['_sqlite3_vtab_on_conflict'] = wasmExports['sqlite3_vtab_on_conflict'])(a0);
var _sqlite3_vtab_config = Module['_sqlite3_vtab_config'] = (a0, a1, a2) => (_sqlite3_vtab_config = Module['_sqlite3_vtab_config'] = wasmExports['sqlite3_vtab_config'])(a0, a1, a2);
var _sqlite3_vtab_collation = Module['_sqlite3_vtab_collation'] = (a0, a1) => (_sqlite3_vtab_collation = Module['_sqlite3_vtab_collation'] = wasmExports['sqlite3_vtab_collation'])(a0, a1);
var _sqlite3_vtab_in = Module['_sqlite3_vtab_in'] = (a0, a1, a2) => (_sqlite3_vtab_in = Module['_sqlite3_vtab_in'] = wasmExports['sqlite3_vtab_in'])(a0, a1, a2);
var _sqlite3_vtab_rhs_value = Module['_sqlite3_vtab_rhs_value'] = (a0, a1, a2) => (_sqlite3_vtab_rhs_value = Module['_sqlite3_vtab_rhs_value'] = wasmExports['sqlite3_vtab_rhs_value'])(a0, a1, a2);
var _sqlite3_vtab_distinct = Module['_sqlite3_vtab_distinct'] = (a0) => (_sqlite3_vtab_distinct = Module['_sqlite3_vtab_distinct'] = wasmExports['sqlite3_vtab_distinct'])(a0);
var _sqlite3_keyword_name = Module['_sqlite3_keyword_name'] = (a0, a1, a2) => (_sqlite3_keyword_name = Module['_sqlite3_keyword_name'] = wasmExports['sqlite3_keyword_name'])(a0, a1, a2);
var _sqlite3_keyword_count = Module['_sqlite3_keyword_count'] = () => (_sqlite3_keyword_count = Module['_sqlite3_keyword_count'] = wasmExports['sqlite3_keyword_count'])();
var _sqlite3_keyword_check = Module['_sqlite3_keyword_check'] = (a0, a1) => (_sqlite3_keyword_check = Module['_sqlite3_keyword_check'] = wasmExports['sqlite3_keyword_check'])(a0, a1);
var _sqlite3_complete = Module['_sqlite3_complete'] = (a0) => (_sqlite3_complete = Module['_sqlite3_complete'] = wasmExports['sqlite3_complete'])(a0);
var _sqlite3_complete16 = Module['_sqlite3_complete16'] = (a0) => (_sqlite3_complete16 = Module['_sqlite3_complete16'] = wasmExports['sqlite3_complete16'])(a0);
var _sqlite3_libversion = Module['_sqlite3_libversion'] = () => (_sqlite3_libversion = Module['_sqlite3_libversion'] = wasmExports['sqlite3_libversion'])();
var _sqlite3_libversion_number = Module['_sqlite3_libversion_number'] = () => (_sqlite3_libversion_number = Module['_sqlite3_libversion_number'] = wasmExports['sqlite3_libversion_number'])();
var _sqlite3_threadsafe = Module['_sqlite3_threadsafe'] = () => (_sqlite3_threadsafe = Module['_sqlite3_threadsafe'] = wasmExports['sqlite3_threadsafe'])();
var _sqlite3_initialize = Module['_sqlite3_initialize'] = () => (_sqlite3_initialize = Module['_sqlite3_initialize'] = wasmExports['sqlite3_initialize'])();
var _sqlite3_shutdown = Module['_sqlite3_shutdown'] = () => (_sqlite3_shutdown = Module['_sqlite3_shutdown'] = wasmExports['sqlite3_shutdown'])();
var _sqlite3_config = Module['_sqlite3_config'] = (a0, a1) => (_sqlite3_config = Module['_sqlite3_config'] = wasmExports['sqlite3_config'])(a0, a1);
var _sqlite3_db_mutex = Module['_sqlite3_db_mutex'] = (a0) => (_sqlite3_db_mutex = Module['_sqlite3_db_mutex'] = wasmExports['sqlite3_db_mutex'])(a0);
var _sqlite3_db_release_memory = Module['_sqlite3_db_release_memory'] = (a0) => (_sqlite3_db_release_memory = Module['_sqlite3_db_release_memory'] = wasmExports['sqlite3_db_release_memory'])(a0);
var _sqlite3_db_cacheflush = Module['_sqlite3_db_cacheflush'] = (a0) => (_sqlite3_db_cacheflush = Module['_sqlite3_db_cacheflush'] = wasmExports['sqlite3_db_cacheflush'])(a0);
var _sqlite3_db_config = Module['_sqlite3_db_config'] = (a0, a1, a2) => (_sqlite3_db_config = Module['_sqlite3_db_config'] = wasmExports['sqlite3_db_config'])(a0, a1, a2);
var _sqlite3_last_insert_rowid = Module['_sqlite3_last_insert_rowid'] = (a0) => (_sqlite3_last_insert_rowid = Module['_sqlite3_last_insert_rowid'] = wasmExports['sqlite3_last_insert_rowid'])(a0);
var _sqlite3_set_last_insert_rowid = Module['_sqlite3_set_last_insert_rowid'] = (a0, a1, a2) => (_sqlite3_set_last_insert_rowid = Module['_sqlite3_set_last_insert_rowid'] = wasmExports['sqlite3_set_last_insert_rowid'])(a0, a1, a2);
var _sqlite3_changes64 = Module['_sqlite3_changes64'] = (a0) => (_sqlite3_changes64 = Module['_sqlite3_changes64'] = wasmExports['sqlite3_changes64'])(a0);
var _sqlite3_changes = Module['_sqlite3_changes'] = (a0) => (_sqlite3_changes = Module['_sqlite3_changes'] = wasmExports['sqlite3_changes'])(a0);
var _sqlite3_total_changes64 = Module['_sqlite3_total_changes64'] = (a0) => (_sqlite3_total_changes64 = Module['_sqlite3_total_changes64'] = wasmExports['sqlite3_total_changes64'])(a0);
var _sqlite3_total_changes = Module['_sqlite3_total_changes'] = (a0) => (_sqlite3_total_changes = Module['_sqlite3_total_changes'] = wasmExports['sqlite3_total_changes'])(a0);
var _sqlite3_txn_state = Module['_sqlite3_txn_state'] = (a0, a1) => (_sqlite3_txn_state = Module['_sqlite3_txn_state'] = wasmExports['sqlite3_txn_state'])(a0, a1);
var _sqlite3_close = Module['_sqlite3_close'] = (a0) => (_sqlite3_close = Module['_sqlite3_close'] = wasmExports['sqlite3_close'])(a0);
var _sqlite3_close_v2 = Module['_sqlite3_close_v2'] = (a0) => (_sqlite3_close_v2 = Module['_sqlite3_close_v2'] = wasmExports['sqlite3_close_v2'])(a0);
var _sqlite3_busy_handler = Module['_sqlite3_busy_handler'] = (a0, a1, a2) => (_sqlite3_busy_handler = Module['_sqlite3_busy_handler'] = wasmExports['sqlite3_busy_handler'])(a0, a1, a2);
var _sqlite3_progress_handler = Module['_sqlite3_progress_handler'] = (a0, a1, a2, a3) => (_sqlite3_progress_handler = Module['_sqlite3_progress_handler'] = wasmExports['sqlite3_progress_handler'])(a0, a1, a2, a3);
var _sqlite3_busy_timeout = Module['_sqlite3_busy_timeout'] = (a0, a1) => (_sqlite3_busy_timeout = Module['_sqlite3_busy_timeout'] = wasmExports['sqlite3_busy_timeout'])(a0, a1);
var _sqlite3_interrupt = Module['_sqlite3_interrupt'] = (a0) => (_sqlite3_interrupt = Module['_sqlite3_interrupt'] = wasmExports['sqlite3_interrupt'])(a0);
var _sqlite3_is_interrupted = Module['_sqlite3_is_interrupted'] = (a0) => (_sqlite3_is_interrupted = Module['_sqlite3_is_interrupted'] = wasmExports['sqlite3_is_interrupted'])(a0);
var _sqlite3_create_function = Module['_sqlite3_create_function'] = (a0, a1, a2, a3, a4, a5, a6, a7) => (_sqlite3_create_function = Module['_sqlite3_create_function'] = wasmExports['sqlite3_create_function'])(a0, a1, a2, a3, a4, a5, a6, a7);
var _sqlite3_create_function_v2 = Module['_sqlite3_create_function_v2'] = (a0, a1, a2, a3, a4, a5, a6, a7, a8) => (_sqlite3_create_function_v2 = Module['_sqlite3_create_function_v2'] = wasmExports['sqlite3_create_function_v2'])(a0, a1, a2, a3, a4, a5, a6, a7, a8);
var _sqlite3_create_window_function = Module['_sqlite3_create_window_function'] = (a0, a1, a2, a3, a4, a5, a6, a7, a8, a9) => (_sqlite3_create_window_function = Module['_sqlite3_create_window_function'] = wasmExports['sqlite3_create_window_function'])(a0, a1, a2, a3, a4, a5, a6, a7, a8, a9);
var _sqlite3_create_function16 = Module['_sqlite3_create_function16'] = (a0, a1, a2, a3, a4, a5, a6, a7) => (_sqlite3_create_function16 = Module['_sqlite3_create_function16'] = wasmExports['sqlite3_create_function16'])(a0, a1, a2, a3, a4, a5, a6, a7);
var _sqlite3_overload_function = Module['_sqlite3_overload_function'] = (a0, a1, a2) => (_sqlite3_overload_function = Module['_sqlite3_overload_function'] = wasmExports['sqlite3_overload_function'])(a0, a1, a2);
var _sqlite3_trace_v2 = Module['_sqlite3_trace_v2'] = (a0, a1, a2, a3) => (_sqlite3_trace_v2 = Module['_sqlite3_trace_v2'] = wasmExports['sqlite3_trace_v2'])(a0, a1, a2, a3);
var _sqlite3_commit_hook = Module['_sqlite3_commit_hook'] = (a0, a1, a2) => (_sqlite3_commit_hook = Module['_sqlite3_commit_hook'] = wasmExports['sqlite3_commit_hook'])(a0, a1, a2);
var _sqlite3_update_hook = Module['_sqlite3_update_hook'] = (a0, a1, a2) => (_sqlite3_update_hook = Module['_sqlite3_update_hook'] = wasmExports['sqlite3_update_hook'])(a0, a1, a2);
var _sqlite3_rollback_hook = Module['_sqlite3_rollback_hook'] = (a0, a1, a2) => (_sqlite3_rollback_hook = Module['_sqlite3_rollback_hook'] = wasmExports['sqlite3_rollback_hook'])(a0, a1, a2);
var _sqlite3_autovacuum_pages = Module['_sqlite3_autovacuum_pages'] = (a0, a1, a2, a3) => (_sqlite3_autovacuum_pages = Module['_sqlite3_autovacuum_pages'] = wasmExports['sqlite3_autovacuum_pages'])(a0, a1, a2, a3);
var _sqlite3_wal_autocheckpoint = Module['_sqlite3_wal_autocheckpoint'] = (a0, a1) => (_sqlite3_wal_autocheckpoint = Module['_sqlite3_wal_autocheckpoint'] = wasmExports['sqlite3_wal_autocheckpoint'])(a0, a1);
var _sqlite3_wal_hook = Module['_sqlite3_wal_hook'] = (a0, a1, a2) => (_sqlite3_wal_hook = Module['_sqlite3_wal_hook'] = wasmExports['sqlite3_wal_hook'])(a0, a1, a2);
var _sqlite3_wal_checkpoint_v2 = Module['_sqlite3_wal_checkpoint_v2'] = (a0, a1, a2, a3, a4) => (_sqlite3_wal_checkpoint_v2 = Module['_sqlite3_wal_checkpoint_v2'] = wasmExports['sqlite3_wal_checkpoint_v2'])(a0, a1, a2, a3, a4);
var _sqlite3_wal_checkpoint = Module['_sqlite3_wal_checkpoint'] = (a0, a1) => (_sqlite3_wal_checkpoint = Module['_sqlite3_wal_checkpoint'] = wasmExports['sqlite3_wal_checkpoint'])(a0, a1);
var _sqlite3_error_offset = Module['_sqlite3_error_offset'] = (a0) => (_sqlite3_error_offset = Module['_sqlite3_error_offset'] = wasmExports['sqlite3_error_offset'])(a0);
var _sqlite3_errmsg16 = Module['_sqlite3_errmsg16'] = (a0) => (_sqlite3_errmsg16 = Module['_sqlite3_errmsg16'] = wasmExports['sqlite3_errmsg16'])(a0);
var _sqlite3_errcode = Module['_sqlite3_errcode'] = (a0) => (_sqlite3_errcode = Module['_sqlite3_errcode'] = wasmExports['sqlite3_errcode'])(a0);
var _sqlite3_extended_errcode = Module['_sqlite3_extended_errcode'] = (a0) => (_sqlite3_extended_errcode = Module['_sqlite3_extended_errcode'] = wasmExports['sqlite3_extended_errcode'])(a0);
var _sqlite3_system_errno = Module['_sqlite3_system_errno'] = (a0) => (_sqlite3_system_errno = Module['_sqlite3_system_errno'] = wasmExports['sqlite3_system_errno'])(a0);
var _sqlite3_errstr = Module['_sqlite3_errstr'] = (a0) => (_sqlite3_errstr = Module['_sqlite3_errstr'] = wasmExports['sqlite3_errstr'])(a0);
var _sqlite3_limit = Module['_sqlite3_limit'] = (a0, a1, a2) => (_sqlite3_limit = Module['_sqlite3_limit'] = wasmExports['sqlite3_limit'])(a0, a1, a2);
var _sqlite3_open = Module['_sqlite3_open'] = (a0, a1) => (_sqlite3_open = Module['_sqlite3_open'] = wasmExports['sqlite3_open'])(a0, a1);
var _sqlite3_open_v2 = Module['_sqlite3_open_v2'] = (a0, a1, a2, a3) => (_sqlite3_open_v2 = Module['_sqlite3_open_v2'] = wasmExports['sqlite3_open_v2'])(a0, a1, a2, a3);
var _sqlite3_open16 = Module['_sqlite3_open16'] = (a0, a1) => (_sqlite3_open16 = Module['_sqlite3_open16'] = wasmExports['sqlite3_open16'])(a0, a1);
var _sqlite3_create_collation = Module['_sqlite3_create_collation'] = (a0, a1, a2, a3, a4) => (_sqlite3_create_collation = Module['_sqlite3_create_collation'] = wasmExports['sqlite3_create_collation'])(a0, a1, a2, a3, a4);
var _sqlite3_create_collation_v2 = Module['_sqlite3_create_collation_v2'] = (a0, a1, a2, a3, a4, a5) => (_sqlite3_create_collation_v2 = Module['_sqlite3_create_collation_v2'] = wasmExports['sqlite3_create_collation_v2'])(a0, a1, a2, a3, a4, a5);
var _sqlite3_create_collation16 = Module['_sqlite3_create_collation16'] = (a0, a1, a2, a3, a4) => (_sqlite3_create_collation16 = Module['_sqlite3_create_collation16'] = wasmExports['sqlite3_create_collation16'])(a0, a1, a2, a3, a4);
var _sqlite3_collation_needed = Module['_sqlite3_collation_needed'] = (a0, a1, a2) => (_sqlite3_collation_needed = Module['_sqlite3_collation_needed'] = wasmExports['sqlite3_collation_needed'])(a0, a1, a2);
var _sqlite3_collation_needed16 = Module['_sqlite3_collation_needed16'] = (a0, a1, a2) => (_sqlite3_collation_needed16 = Module['_sqlite3_collation_needed16'] = wasmExports['sqlite3_collation_needed16'])(a0, a1, a2);
var _sqlite3_get_clientdata = Module['_sqlite3_get_clientdata'] = (a0, a1) => (_sqlite3_get_clientdata = Module['_sqlite3_get_clientdata'] = wasmExports['sqlite3_get_clientdata'])(a0, a1);
var _sqlite3_set_clientdata = Module['_sqlite3_set_clientdata'] = (a0, a1, a2, a3) => (_sqlite3_set_clientdata = Module['_sqlite3_set_clientdata'] = wasmExports['sqlite3_set_clientdata'])(a0, a1, a2, a3);
var _sqlite3_get_autocommit = Module['_sqlite3_get_autocommit'] = (a0) => (_sqlite3_get_autocommit = Module['_sqlite3_get_autocommit'] = wasmExports['sqlite3_get_autocommit'])(a0);
var _sqlite3_table_column_metadata = Module['_sqlite3_table_column_metadata'] = (a0, a1, a2, a3, a4, a5, a6, a7, a8) => (_sqlite3_table_column_metadata = Module['_sqlite3_table_column_metadata'] = wasmExports['sqlite3_table_column_metadata'])(a0, a1, a2, a3, a4, a5, a6, a7, a8);
var _sqlite3_sleep = Module['_sqlite3_sleep'] = (a0) => (_sqlite3_sleep = Module['_sqlite3_sleep'] = wasmExports['sqlite3_sleep'])(a0);
var _sqlite3_extended_result_codes = Module['_sqlite3_extended_result_codes'] = (a0, a1) => (_sqlite3_extended_result_codes = Module['_sqlite3_extended_result_codes'] = wasmExports['sqlite3_extended_result_codes'])(a0, a1);
var _sqlite3_file_control = Module['_sqlite3_file_control'] = (a0, a1, a2, a3) => (_sqlite3_file_control = Module['_sqlite3_file_control'] = wasmExports['sqlite3_file_control'])(a0, a1, a2, a3);
var _sqlite3_test_control = Module['_sqlite3_test_control'] = (a0, a1) => (_sqlite3_test_control = Module['_sqlite3_test_control'] = wasmExports['sqlite3_test_control'])(a0, a1);
var _sqlite3_create_filename = Module['_sqlite3_create_filename'] = (a0, a1, a2, a3, a4) => (_sqlite3_create_filename = Module['_sqlite3_create_filename'] = wasmExports['sqlite3_create_filename'])(a0, a1, a2, a3, a4);
var _sqlite3_free_filename = Module['_sqlite3_free_filename'] = (a0) => (_sqlite3_free_filename = Module['_sqlite3_free_filename'] = wasmExports['sqlite3_free_filename'])(a0);
var _sqlite3_uri_parameter = Module['_sqlite3_uri_parameter'] = (a0, a1) => (_sqlite3_uri_parameter = Module['_sqlite3_uri_parameter'] = wasmExports['sqlite3_uri_parameter'])(a0, a1);
var _sqlite3_uri_key = Module['_sqlite3_uri_key'] = (a0, a1) => (_sqlite3_uri_key = Module['_sqlite3_uri_key'] = wasmExports['sqlite3_uri_key'])(a0, a1);
var _sqlite3_uri_boolean = Module['_sqlite3_uri_boolean'] = (a0, a1, a2) => (_sqlite3_uri_boolean = Module['_sqlite3_uri_boolean'] = wasmExports['sqlite3_uri_boolean'])(a0, a1, a2);
var _sqlite3_uri_int64 = Module['_sqlite3_uri_int64'] = (a0, a1, a2, a3) => (_sqlite3_uri_int64 = Module['_sqlite3_uri_int64'] = wasmExports['sqlite3_uri_int64'])(a0, a1, a2, a3);
var _sqlite3_filename_database = Module['_sqlite3_filename_database'] = (a0) => (_sqlite3_filename_database = Module['_sqlite3_filename_database'] = wasmExports['sqlite3_filename_database'])(a0);
var _sqlite3_filename_journal = Module['_sqlite3_filename_journal'] = (a0) => (_sqlite3_filename_journal = Module['_sqlite3_filename_journal'] = wasmExports['sqlite3_filename_journal'])(a0);
var _sqlite3_filename_wal = Module['_sqlite3_filename_wal'] = (a0) => (_sqlite3_filename_wal = Module['_sqlite3_filename_wal'] = wasmExports['sqlite3_filename_wal'])(a0);
var _sqlite3_db_name = Module['_sqlite3_db_name'] = (a0, a1) => (_sqlite3_db_name = Module['_sqlite3_db_name'] = wasmExports['sqlite3_db_name'])(a0, a1);
var _sqlite3_db_filename = Module['_sqlite3_db_filename'] = (a0, a1) => (_sqlite3_db_filename = Module['_sqlite3_db_filename'] = wasmExports['sqlite3_db_filename'])(a0, a1);
var _sqlite3_db_readonly = Module['_sqlite3_db_readonly'] = (a0, a1) => (_sqlite3_db_readonly = Module['_sqlite3_db_readonly'] = wasmExports['sqlite3_db_readonly'])(a0, a1);
var _sqlite3_compileoption_used = Module['_sqlite3_compileoption_used'] = (a0) => (_sqlite3_compileoption_used = Module['_sqlite3_compileoption_used'] = wasmExports['sqlite3_compileoption_used'])(a0);
var _sqlite3_compileoption_get = Module['_sqlite3_compileoption_get'] = (a0) => (_sqlite3_compileoption_get = Module['_sqlite3_compileoption_get'] = wasmExports['sqlite3_compileoption_get'])(a0);
var _sqlite3_sourceid = Module['_sqlite3_sourceid'] = () => (_sqlite3_sourceid = Module['_sqlite3_sourceid'] = wasmExports['sqlite3_sourceid'])();
var _malloc = Module['_malloc'] = (a0) => (_malloc = Module['_malloc'] = wasmExports['malloc'])(a0);
var _free = Module['_free'] = (a0) => (_free = Module['_free'] = wasmExports['free'])(a0);
var _RegisterExtensionFunctions = Module['_RegisterExtensionFunctions'] = (a0) => (_RegisterExtensionFunctions = Module['_RegisterExtensionFunctions'] = wasmExports['RegisterExtensionFunctions'])(a0);
var _getSqliteFree = Module['_getSqliteFree'] = () => (_getSqliteFree = Module['_getSqliteFree'] = wasmExports['getSqliteFree'])();
var _main = Module['_main'] = (a0, a1) => (_main = Module['_main'] = wasmExports['main'])(a0, a1);
var _libauthorizer_set_authorizer = Module['_libauthorizer_set_authorizer'] = (a0, a1, a2) => (_libauthorizer_set_authorizer = Module['_libauthorizer_set_authorizer'] = wasmExports['libauthorizer_set_authorizer'])(a0, a1, a2);
var _libfunction_create_function = Module['_libfunction_create_function'] = (a0, a1, a2, a3, a4, a5, a6, a7) => (_libfunction_create_function = Module['_libfunction_create_function'] = wasmExports['libfunction_create_function'])(a0, a1, a2, a3, a4, a5, a6, a7);
var _libhook_commit_hook = Module['_libhook_commit_hook'] = (a0, a1, a2) => (_libhook_commit_hook = Module['_libhook_commit_hook'] = wasmExports['libhook_commit_hook'])(a0, a1, a2);
var _libhook_update_hook = Module['_libhook_update_hook'] = (a0, a1, a2) => (_libhook_update_hook = Module['_libhook_update_hook'] = wasmExports['libhook_update_hook'])(a0, a1, a2);
var _libprogress_progress_handler = Module['_libprogress_progress_handler'] = (a0, a1, a2, a3) => (_libprogress_progress_handler = Module['_libprogress_progress_handler'] = wasmExports['libprogress_progress_handler'])(a0, a1, a2, a3);
var _libvfs_vfs_register = Module['_libvfs_vfs_register'] = (a0, a1, a2, a3, a4, a5) => (_libvfs_vfs_register = Module['_libvfs_vfs_register'] = wasmExports['libvfs_vfs_register'])(a0, a1, a2, a3, a4, a5);
var _emscripten_builtin_memalign = (a0, a1) => (_emscripten_builtin_memalign = wasmExports['emscripten_builtin_memalign'])(a0, a1);
var __emscripten_timeout = (a0, a1) => (__emscripten_timeout = wasmExports['_emscripten_timeout'])(a0, a1);
var __emscripten_tempret_set = (a0) => (__emscripten_tempret_set = wasmExports['_emscripten_tempret_set'])(a0);
var __emscripten_tempret_get = () => (__emscripten_tempret_get = wasmExports['_emscripten_tempret_get'])();
var __emscripten_stack_restore = (a0) => (__emscripten_stack_restore = wasmExports['_emscripten_stack_restore'])(a0);
var __emscripten_stack_alloc = (a0) => (__emscripten_stack_alloc = wasmExports['_emscripten_stack_alloc'])(a0);
var _emscripten_stack_get_current = () => (_emscripten_stack_get_current = wasmExports['emscripten_stack_get_current'])();
var ___cxa_increment_exception_refcount = (a0) => (___cxa_increment_exception_refcount = wasmExports['__cxa_increment_exception_refcount'])(a0);
var dynCall_vijii = Module['dynCall_vijii'] = (a0, a1, a2, a3, a4, a5) => (dynCall_vijii = Module['dynCall_vijii'] = wasmExports['dynCall_vijii'])(a0, a1, a2, a3, a4, a5);
var dynCall_iiiij = Module['dynCall_iiiij'] = (a0, a1, a2, a3, a4, a5) => (dynCall_iiiij = Module['dynCall_iiiij'] = wasmExports['dynCall_iiiij'])(a0, a1, a2, a3, a4, a5);
var dynCall_viji = Module['dynCall_viji'] = (a0, a1, a2, a3, a4) => (dynCall_viji = Module['dynCall_viji'] = wasmExports['dynCall_viji'])(a0, a1, a2, a3, a4);
var dynCall_viiiij = Module['dynCall_viiiij'] = (a0, a1, a2, a3, a4, a5, a6) => (dynCall_viiiij = Module['dynCall_viiiij'] = wasmExports['dynCall_viiiij'])(a0, a1, a2, a3, a4, a5, a6);
var dynCall_iij = Module['dynCall_iij'] = (a0, a1, a2, a3) => (dynCall_iij = Module['dynCall_iij'] = wasmExports['dynCall_iij'])(a0, a1, a2, a3);
var dynCall_iijii = Module['dynCall_iijii'] = (a0, a1, a2, a3, a4, a5) => (dynCall_iijii = Module['dynCall_iijii'] = wasmExports['dynCall_iijii'])(a0, a1, a2, a3, a4, a5);
var dynCall_iiji = Module['dynCall_iiji'] = (a0, a1, a2, a3, a4) => (dynCall_iiji = Module['dynCall_iiji'] = wasmExports['dynCall_iiji'])(a0, a1, a2, a3, a4);
var dynCall_iiiiiij = Module['dynCall_iiiiiij'] = (a0, a1, a2, a3, a4, a5, a6, a7) => (dynCall_iiiiiij = Module['dynCall_iiiiiij'] = wasmExports['dynCall_iiiiiij'])(a0, a1, a2, a3, a4, a5, a6, a7);
var dynCall_ji = Module['dynCall_ji'] = (a0, a1) => (dynCall_ji = Module['dynCall_ji'] = wasmExports['dynCall_ji'])(a0, a1);
var _sqlite3_version = Module['_sqlite3_version'] = 13824;

// include: postamble.js
// === Auto-generated postamble setup entry stuff ===

Module['getTempRet0'] = getTempRet0;
Module['ccall'] = ccall;
Module['cwrap'] = cwrap;
Module['addFunction'] = addFunction;
Module['setValue'] = setValue;
Module['getValue'] = getValue;
Module['UTF8ToString'] = UTF8ToString;
Module['stringToUTF8'] = stringToUTF8;
Module['lengthBytesUTF8'] = lengthBytesUTF8;
Module['intArrayFromString'] = intArrayFromString;
Module['intArrayToString'] = intArrayToString;
Module['AsciiToString'] = AsciiToString;
Module['UTF16ToString'] = UTF16ToString;
Module['stringToUTF16'] = stringToUTF16;
Module['UTF32ToString'] = UTF32ToString;
Module['stringToUTF32'] = stringToUTF32;
Module['writeArrayToMemory'] = writeArrayToMemory;


var calledRun;

dependenciesFulfilled = function runCaller() {
  // If run has never been called, and we should call run (INVOKE_RUN is true, and Module.noInitialRun is not false)
  if (!calledRun) run();
  if (!calledRun) dependenciesFulfilled = runCaller; // try this again later, after new deps are fulfilled
};

function callMain() {

  var entryFunction = _main;

  var argc = 0;
  var argv = 0;

  try {

    var ret = entryFunction(argc, argv);

    // if we're not running an evented main loop, it's time to exit
    exitJS(ret, /* implicit = */ true);
    return ret;
  }
  catch (e) {
    return handleException(e);
  }
}

function run() {

  if (runDependencies > 0) {
    return;
  }

  preRun();

  // a preRun added a dependency, run will be called later
  if (runDependencies > 0) {
    return;
  }

  function doRun() {
    // run may have just been called through dependencies being fulfilled just in this very frame,
    // or while the async setStatus time below was happening
    if (calledRun) return;
    calledRun = true;
    Module['calledRun'] = true;

    if (ABORT) return;

    initRuntime();

    preMain();

    readyPromiseResolve(Module);
    Module['onRuntimeInitialized']?.();

    if (shouldRunNow) callMain();

    postRun();
  }

  if (Module['setStatus']) {
    Module['setStatus']('Running...');
    setTimeout(() => {
      setTimeout(() => Module['setStatus'](''), 1);
      doRun();
    }, 1);
  } else
  {
    doRun();
  }
}

if (Module['preInit']) {
  if (typeof Module['preInit'] == 'function') Module['preInit'] = [Module['preInit']];
  while (Module['preInit'].length > 0) {
    Module['preInit'].pop()();
  }
}

// shouldRunNow refers to calling main(), not run().
var shouldRunNow = true;

if (Module['noInitialRun']) shouldRunNow = false;

run();

// end include: postamble.js

// include: /home/roy/wa-sqlite/src/libauthorizer.js
// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
// This file should be included in the build with --post-js.

(function() {
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  let pAsyncFlags = 0;

  Module['set_authorizer'] = function(db, xAuthorizer, pApp) {
    if (pAsyncFlags) {
      Module['deleteCallback'](pAsyncFlags);
      Module['_sqlite3_free'](pAsyncFlags);
      pAsyncFlags = 0;
    }

    pAsyncFlags = Module['_sqlite3_malloc'](4);
    setValue(pAsyncFlags, xAuthorizer instanceof AsyncFunction ? 1 : 0, 'i32');

    const result = ccall(
      'libauthorizer_set_authorizer',
      'number',
      ['number', 'number', 'number'],
      [db, xAuthorizer ? 1 : 0, pAsyncFlags]);
    if (!result && xAuthorizer) {
      Module['setCallback'](pAsyncFlags, (_, iAction, p3, p4, p5, p6) => {
        return xAuthorizer(pApp, iAction, p3, p4, p5, p6);
      });
    }
    return result;
  };
})();// end include: /home/roy/wa-sqlite/src/libauthorizer.js

// include: /home/roy/wa-sqlite/src/libfunction.js
// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
// This file should be included in the build with --post-js.

(function() {
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

  // This list of methods must match exactly with libfunction.c.
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
      'libfunction_create_function',
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
        Module['deleteCallback'](oldKey);
      }
      mapFunctionNameToKey.set(zFunctionName, pAsyncFlags);
      Module['setCallback'](pAsyncFlags, { xFunc, xStep, xFinal });
    }
    return result;
  };
})();// end include: /home/roy/wa-sqlite/src/libfunction.js

// include: /home/roy/wa-sqlite/src/libhook.js
// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
// This file should be included in the build with --post-js.

(function() {
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  let pAsyncFlags = 0;

  Module['update_hook'] = function(db, xUpdateHook) {
    if (pAsyncFlags) {
      Module['deleteCallback'](pAsyncFlags);
      Module['_sqlite3_free'](pAsyncFlags);
      pAsyncFlags = 0;
    }

    pAsyncFlags = Module['_sqlite3_malloc'](4);
    setValue(pAsyncFlags, xUpdateHook instanceof AsyncFunction ? 1 : 0, 'i32');

    ccall(
      'libhook_update_hook',
      'void',
      ['number', 'number', 'number'],
      [db, xUpdateHook ? 1 : 0, pAsyncFlags]);
    if (xUpdateHook) {
      Module['setCallback'](pAsyncFlags, (_, iUpdateType, dbName, tblName, lo32, hi32) => {
        return xUpdateHook(iUpdateType, dbName, tblName, lo32, hi32);
      });
    }
  };
})();

(function() {
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  let pAsyncFlags = 0;

  Module['commit_hook'] = function(db, xCommitHook) {
    if (pAsyncFlags) {
      Module['deleteCallback'](pAsyncFlags);
      Module['_sqlite3_free'](pAsyncFlags);
      pAsyncFlags = 0;
    }

    pAsyncFlags = Module['_sqlite3_malloc'](4);
    setValue(pAsyncFlags, xCommitHook instanceof AsyncFunction ? 1 : 0, 'i32');

    ccall(
      'libhook_commit_hook',
      'void',
      ['number', 'number', 'number'],
      [db, xCommitHook ? 1 : 0, pAsyncFlags]);
    if (xCommitHook) {
      Module['setCallback'](pAsyncFlags, (_) => {
        return xCommitHook();
      });
    }
  };
})();
// end include: /home/roy/wa-sqlite/src/libhook.js

// include: /home/roy/wa-sqlite/src/libprogress.js
// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
// This file should be included in the build with --post-js.

(function() {
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  let pAsyncFlags = 0;

  Module['progress_handler'] = function(db, nOps, xProgress, pApp) {
    if (pAsyncFlags) {
      Module['deleteCallback'](pAsyncFlags);
      Module['_sqlite3_free'](pAsyncFlags);
      pAsyncFlags = 0;
    }

    pAsyncFlags = Module['_sqlite3_malloc'](4);
    setValue(pAsyncFlags, xProgress instanceof AsyncFunction ? 1 : 0, 'i32');

    ccall(
      'libprogress_progress_handler',
      'number',
      ['number', 'number', 'number', 'number'],
      [db, nOps, xProgress ? 1 : 0, pAsyncFlags]);
    if (xProgress) {
      Module['setCallback'](pAsyncFlags, _ => xProgress(pApp));
    }
  };
})();// end include: /home/roy/wa-sqlite/src/libprogress.js

// include: /home/roy/wa-sqlite/src/libvfs.js
// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
// This file should be included in the build with --post-js.

(function() {
  // This list of methods must match exactly with libvfs.c.
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

  const mapVFSNameToKey = new Map();

  Module['vfs_register'] = function(vfs, makeDefault) {
    // Determine which methods exist and which are asynchronous. This is
    // needed for the C wrapper to know which relaying function to call.
    let methodMask = 0;
    let asyncMask = 0;
    VFS_METHODS.forEach((method, i) => {
      if (vfs[method]) {
        methodMask |= 1 << i;
        if (vfs['hasAsyncMethod'](method)) {
          asyncMask |= 1 << i;
        }
      }
    });

    // Allocate space for libvfs_vfs_register to write the sqlite3_vfs
    // pointer. This pointer will be used to look up the JavaScript VFS
    // object.
    const vfsReturn = Module['_sqlite3_malloc'](4);
    try {
      // Call the C function that makes the sqlite3_vfs_register() call.
      const result = ccall(
        'libvfs_vfs_register',
        'number',
        ['string', 'number', 'number', 'number', 'number', 'number'],
        [vfs.name, vfs.mxPathname, methodMask, asyncMask, makeDefault ? 1 : 0, vfsReturn]);
      if (!result) {
        if (mapVFSNameToKey.has(vfs.name)) {
          // Reclaim the old resources used with this name.
          const oldKey = mapVFSNameToKey.get(vfs.name);
          Module['deleteCallback'](oldKey);
        }

        // Associate the sqlite3_vfs* pointer with the JavaScript VFS instance.
        const key = getValue(vfsReturn, '*');
        mapVFSNameToKey.set(vfs.name, key);
        Module['setCallback'](key, vfs);
      }
      return result;
    } finally {
      Module['_sqlite3_free'](vfsReturn);
    }
  };
})();// end include: /home/roy/wa-sqlite/src/libvfs.js

// include: postamble_modularize.js
// In MODULARIZE mode we wrap the generated code in a factory function
// and return either the Module itself, or a promise of the module.
//
// We assign to the `moduleRtn` global here and configure closure to see
// this as and extern so it won't get minified.

moduleRtn = readyPromise;

// end include: postamble_modularize.js



  return moduleRtn;
}
);
})();
export default Module;
