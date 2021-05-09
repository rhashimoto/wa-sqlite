# wa-sqlite
This is a WebAssembly build of SQLite with experimental support for writing SQLite virtual filesystems and virtual table modules completely in Javascript. This allows alternative browser storage options such as IndexedDB.

An [IndexedDB virtual filesystem](https://github.com/rhashimoto/wa-sqlite/blob/master/src/examples/IndexedDbVFS.js) and a [virtual table module that accesses Javascript arrays](https://github.com/rhashimoto/wa-sqlite/blob/master/src/examples/ArrayModule.js) are provided as proof of concept.

[Try the demo](https://rhashimoto.github.io/wa-sqlite/demo/) with a modern desktop web browser.

## Build
The primary motivation for this project is to enable additions to SQLite with only Javascript. Most developers should be able to use the "buildless" branch with pre-built artifacts checked in. This is also recommended when including the project as a dependency (e.g. `yarn add "wa-sqlite@rhashimoto/wa-sqlite#buildless"`).

If you do want to build - e.g. you want to change build flags or use a specific EMSDK version - here are the prerequisites:

* Building on Linux is known to work, compatibility with other platforms is unknown.
* `yarn` - If you use a different package manager (e.g. `npm`) then file paths in the demo will need adjustment.
* [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html) - Note that there is a [regression in EMSDK 2.0.14](https://github.com/emscripten-core/emscripten/issues/13858) that prevents building.
* `curl`, `make`, `openssl`, `sed`, `unzip`

Here are the build steps:
* Make sure `emcc` works.
* `git clone ...`
* `cd wa-sqlite`
* `yarn install`
* `make` (or `yarn prepack`)

The default build produces ES6 modules + WASM, [synchronous and asynchronous](https://github.com/rhashimoto/wa-sqlite/issues/7) (using Asyncify) in `dist/`.

## API
Javascript wrappers for core SQLITE C API functions (and some others) are provided. Higher-level APIs are outside the scope of this project, but the [demo page](https://github.com/rhashimoto/wa-sqlite/tree/master/demo) uses a [simple tagged template function](https://github.com/rhashimoto/wa-sqlite/blob/master/src/examples/tag.js) for its SQL queries that may be useful as a coding example.

[API reference](https://rhashimoto.github.io/wa-sqlite/docs/)

## Demo
To serve the demo directly from the source tree:
* `yarn start`
* Open a browser on http://localhost:8000/demo/

The demo page provides access to databases on multiple VFS implementations, including IndexedDB (which is the only one persistent across page loads and multiple tabs). In addition, in each database there is a SQLite module named "array" that provides some historical stock data from a common Javascript array - use it for virtual tables in SQL like this:
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS goog USING array;

-- Use it directly out of the Javascript array:
SELECT * FROM goog LIMIT 5;

-- Copy into a native table (on the current VFS):
CREATE TABLE IF NOT EXISTS tbl AS SELECT * FROM goog;
```

For convenience, if any text region is selected in the editor, only that region will be executed. In addition, the editor contents are restored across page reloads using browser localStorage.
