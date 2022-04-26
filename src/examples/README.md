# wa-sqlite example code
These examples are intended to help developers get started with writing extensions,
and to experiment with interesting approaches and techniques. Using them as-is in
production is not prohibited but that isn't their primary purpose.

## VFS examples
### MemoryVFS and MemoryAsyncVFS
These are minimal working examples for writing a VFS. First-time implementers should
probably start by looking at these classes, as well as the
[SQLite documentation](https://www.sqlite.org/vfs.html).

### IndexedDbVFS
This is a VFS implementation that stores
[versioned blocks on IndexedDB](https://github.com/rhashimoto/wa-sqlite/discussions/37).

### IDBMinimalVFS
This is another implementation of VFS on IndexedDB that provides less performance
but is smaller, simpler, and more general. It is described
[here](https://github.com/rhashimoto/wa-sqlite/discussions/46).

### OriginPrivateFileSystemVFS
This VFS uses the proposed
[Origin Private File System](https://wicg.github.io/file-system-access/#wellknowndirectory-origin-private-file-system)
with the
[Access Handle](https://github.com/WICG/file-system-access/blob/main/AccessHandle.md)
dependent proposal. Note that this works only in a Worker and is not implemented
on all browsers.

## Module examples
### ArrayModule and ArrayAsyncModule
These are minimal working examples for writing a
[SQLite module](https://www.sqlite.org/c3ref/module.html),
which is a virtual table creator. They expose a 2D Javascript
array as a SQLite table.

## Utility examples
### WebLocks
This is a helper class for VFS implementers that use the
[Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
to provide
[SQLite locking semantics](https://www.sqlite.org/lockingv3.html)
for the `xLock()` and `xUnlock()` methods. IndexedDbVFS and OriginPrivateFileSystemVFS
show how to incorporate it.

### IDBContext
This is a helper class for IndexedDB VFS implementers that scopes
IndexedDB transactions to reduce the number of transactions needed.
See its use in IndexedDbVFS and IDBMinimalVFS.

### tag
This is a template tag function generator that can be used to
provide syntactic sugar for embedding SQL in Javascript.
