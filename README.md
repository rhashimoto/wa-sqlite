# wa-sqlite
## Prerequisites
* Building on Linux is known to work, compatibility with other platforms is unknown.
* [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html) - Note that there is a [regression in EMSDK 2.0.14](https://github.com/emscripten-core/emscripten/issues/13858) that prevents building.

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

The demo page provides access to a database backed by asynchronous in-memory storage. The database is opened and closed on each SQL execution to ensure that data is really persisted to storage.

For convenience, if any region is selected in the editor, only that region will be executed. In addition, the editor contents are persisted to browser localStorage.
