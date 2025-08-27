# wa-sqlite Build Information

This dist directory was built with the following configuration:

## Build Environment
- **Built on:** 2025-08-27 07:27:51 UTC
- **Emscripten:** emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 4.0.12-git
- **SQLite Version:** 3.50.1
- **SQLite Commit:** 27aa8309d6882286a398388d54d786031587e26e

## SQLite Features Enabled
- Session extension (changesets/sync)
- Preupdate hooks  
- Bytecode virtual table
- FTS5 full-text search (in fts5/ variant)

## Build Variants

### Standard Builds
- **wa-sqlite.mjs + .wasm**: Web/Worker build with all features
- **wa-sqlite-async.mjs + .wasm**: Async build for Promise-based usage
- **wa-sqlite-jspi.mjs + .wasm**: JSPI build for JavaScript Promise Integration
- **wa-sqlite.node.mjs + .wasm**: Node.js build

### FTS5 Builds
- **fts5/wa-sqlite.mjs + .wasm**: Web build with FTS5 full-text search
- **fts5/wa-sqlite.node.mjs + .wasm**: Node.js build with FTS5

## Session/Changeset API Available
The following session functions are exported and available:
- `sqlite3session_create` - Create session objects
- `sqlite3session_attach` - Attach tables to sessions  
- `sqlite3session_enable` - Enable session recording
- `sqlite3session_changeset` - Generate changesets
- `sqlite3session_delete` - Clean up sessions
- `sqlite3changeset_start` - Process changesets
- `sqlite3changeset_finalize` - Finalize changeset processing
- `sqlite3changeset_invert` - Invert changesets
- `sqlite3changeset_apply` - Apply changesets

## Build Script
Generated via: `nix run ./nix/wa-sqlite-build#default`

## File Sizes

### Standard Build Sizes
- **wa-sqlite-async.mjs**: 113K (gzip: 27.5K, brotli: 23.9K)
- **wa-sqlite-jspi.mjs**: 115K (gzip: 27.1K, brotli: 23.5K)
- **wa-sqlite.mjs**: 107K (gzip: 25.9K, brotli: 22.6K)
- **wa-sqlite.node.mjs**: 108K (gzip: 26.1K, brotli: 22.7K)
- **wa-sqlite-async.wasm**: 1.3M (gzip: 452.8K, brotli: 357.8K)
- **wa-sqlite-jspi.wasm**: 611K (gzip: 297.7K, brotli: 256.1K)
- **wa-sqlite.node.wasm**: 605K (gzip: 296.1K, brotli: 254.6K)
- **wa-sqlite.wasm**: 605K (gzip: 296.1K, brotli: 254.6K)

### FTS5 Variant Sizes  
- **fts5/wa-sqlite.mjs**: 107K (gzip: 26.0K, brotli: 22.6K)
- **fts5/wa-sqlite.node.mjs**: 108K (gzip: 26.1K, brotli: 22.8K)
- **fts5/wa-sqlite.node.wasm**: 719K (gzip: 352.7K, brotli: 303.4K)
- **fts5/wa-sqlite.wasm**: 719K (gzip: 352.7K, brotli: 303.4K)

## Notes
- All builds include session extension for data synchronization
- mayCreate fixes applied to prevent filesystem errors
