# wa-sqlite
This is a WebAssembly build of SQLite with experimental support for writing SQLite Virtual File Systems in Javascript.

## Prerequisites
* Building on Linux is known to work, compatibility with other platforms is unknown.
* [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html) - Note that there is a [regression in EMSDK 2.0.14](https://github.com/emscripten-core/emscripten/issues/13858) that prevents building.
* `curl`, `make`, `openssl`, `sed`, `unzip`

## Build
* Make sure `emcc` works.
* `git clone ...`
* `cd wa-sqlite`
* `yarn install`
* `make`

All builds produce ES6 modules + WASM, synchronous and asynchronous (using Asyncify).

## Demo page
* `yarn start`
* Open a modern browser on http://localhost:8000/demo/

The demo page provides access to databases on multiple VFS types.

For convenience, if any text region is selected in the editor, only that region will be executed. In addition, the editor contents are restored across page reloads using browser localStorage.
