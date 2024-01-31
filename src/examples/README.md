# wa-sqlite example code
These examples are intended to help developers get started with writing extensions,
and to experiment with interesting approaches and techniques. Using them as-is in
production is not prohibited but that isn't their primary purpose.

## VFS examples
### MemoryVFS and MemoryAsyncVFS
These are minimal working examples for writing a VFS. First-time implementers should
probably start by looking at these classes, as well as the
[SQLite VFS documentation](https://www.sqlite.org/vfs.html).

### IDBBatchAtomicVFS
This VFS has the most browser compatibility and works on all contexts (i.e. Window, Worker, Shared Worker, Service Worker).

### OriginPrivateVFS
This VFS uses the 
[Origin Private File System](https://wicg.github.io/file-system-access/#wellknowndirectory-origin-private-file-system)
with synchronous
[Access Handle](https://github.com/WICG/file-system-access/blob/main/AccessHandle.md). Note that OPFS works only in a dedicated Worker. It requires a build that allows asynchronous WebAssembly calls (i.e. Asyncify or JSPI). This implementation supports multiple connections on Chrome 121+.

### FLOOR
This is an OPFS that uses write-ahead-logging (but not the SQLite WAL implementation). It uses both OPFS and IndexedDB, and so works only in a dedicated Worker. It requires a build that allows asynchronous WebAssembly calls (i.e. Asyncify or JSPI). This implementation supports multiple connections on Chrome 121+. Transactions are less durable (in the ACID sense) than in other classes.

## VFS Comparison
||MemoryVFS|MemoryAsyncVFS|IDBBatchAtomicVFS|OriginPrivateVFS|FLOOR|
|-|-|-|-|-|-|
|Storage|RAM|RAM|IndexedDB|OPFS|OPFS/IndexedDB|
|Synchronous build|✅|:x:|:x:|:x:|:x:|
|Asyncify build|✅|✅|✅|✅|✅|
|JSPI build|✅|✅|✅|✅|✅|
|Contexts|All|All|All|Worker|Worker|
|Multiple connections|:x:|:x:|✅|✅|✅[^1]|
|Full durability|✅|✅|✅|✅|:x:|
|Relaxed durability|:x:|:x:|✅|:x:|✅|
|Filesystem transparency|:x:|:x:|:x:|✅|✅|
|Write-ahead logging|:x:|:x:|:x:|:x:|✅|
|Cross-origin isolation *not* required[^2]|✅|✅|✅|✅|✅|

[^1]: Requires FileSystemSyncAccessHandle readwrite-unsafe locking mode
[^2]: Using some web APIs (e.g. SharedArrayBuffer, Atomics) are only available with cross-origin restrictions.
