# wa-sqlite
This is a WebAssembly build of SQLite with experimental support for writing SQLite virtual file systems and modules (virtual tables) in Javascript. This allows alternative browser storage options such as IndexedDB.

A [sample IndexedDB VFS](https://github.com/rhashimoto/wa-sqlite/blob/master/src/examples/IndexedDbVFS.js) is provided, but note that this implementation simply returns a busy error when another database connection holds the file lock (instead of waiting to acquire the lock). More advanced lock handling is possible if an application requires it, but that is left as an exercise as the options vary in complexity and browser support.

[Javascript wrappers for core SQLITE C API functions](https://github.com/rhashimoto/wa-sqlite/blob/master/src/sqlite-api.js) (and some others) are provided. Note that some behavior and function signatures have been slightly altered to be more Javascript-friendly and for safety - e.g. exceptions are thrown on errors and C pointers are converted to values and arrays - but the functionality mapping is one-to-one. Also note that some API functions return a `Promise` in order to enable asynchronous VFS implementations.

An application-level API can be easily built on the core API, but that is outside the scope of this project. The [demo page](https://github.com/rhashimoto/wa-sqlite/tree/master/demo) uses a [simple tagged template function](https://github.com/rhashimoto/wa-sqlite/blob/master/src/examples/tag.js) for its SQL queries that may be useful as a coding example.

## Prerequisites
If you don't want to build the Emscripten components, use the 'buildless' branch that has pre-built artifacts checked in. This is also advisable when including this project as a dependency.

* Building on Linux is known to work, compatibility with other platforms is unknown.
* `yarn` - If you use a different package manager (e.g. `npm`) then file paths in the demo will need adjustment.
* [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html) - Note that there is a [regression in EMSDK 2.0.14](https://github.com/emscripten-core/emscripten/issues/13858) that prevents building.
* `curl`, `make`, `openssl`, `sed`, `unzip`

## Build
* Make sure `emcc` works.
* `git clone ...`
* `cd wa-sqlite`
* `yarn install`
* `make` (or `yarn prepack`)

All builds produce ES6 modules + WASM, synchronous and asynchronous (using Asyncify) in `dist/`.

## Demo page
* `yarn start`
* Open a modern browser on http://localhost:8000/demo/

The demo page provides access to databases on multiple VFS implementations.

For convenience, if any text region is selected in the editor, only that region will be executed. In addition, the editor contents are restored across page reloads using browser localStorage.