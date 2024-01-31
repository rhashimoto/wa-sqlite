# wa-sqlite example code
These examples are intended to help developers get started with writing extensions,
and to experiment with interesting approaches and techniques. Using them as-is in
production is not prohibited but that isn't their primary purpose.

## VFS examples
### MemoryVFS and MemoryAsyncVFS
These are minimal working examples for writing a VFS. First-time VFS implementers should
probably start by looking at these classes, as well as the
[SQLite VFS documentation](https://www.sqlite.org/vfs.html).

### IDBBatchAtomicVFS
This VFS works with older browsers and on all contexts (i.e. Window, Worker, Shared Worker, Service Worker).

### OriginPrivateVFS
This VFS uses the 
[Origin Private File System](https://wicg.github.io/file-system-access/#wellknowndirectory-origin-private-file-system)
with synchronous
[Access Handle](https://github.com/WICG/file-system-access/blob/main/AccessHandle.md).

### AccessHandlePoolVFS
This VFS is synchronous and so is faster than OriginPrivateVFS across the board, but does not have general multiple connection support.

### FLOOR
This is a hybrid OPFS/IndexedDB VFS that uses write-ahead-logging (but not the SQLite WAL implementation).

## VFS Comparison
||MemoryVFS|MemoryAsyncVFS|IDBBatchAtomicVFS|OriginPrivateVFS|AccessHandlePoolVFS|FLOOR|
|-|-|-|-|-|-|-|
|Storage|RAM|RAM|IndexedDB|OPFS|OPFS|OPFS/IndexedDB|
|Synchronous build|✅|:x:|:x:|:x:|✅|:x:|
|Asyncify build|✅|✅|✅|✅|✅|✅|
|JSPI build|✅|✅|✅|✅|✅|✅|
|Contexts|All|All|All|Worker|Worker|Worker|
|Multiple connections|:x:|:x:|✅|✅|✅[^1]|✅[^2]|
|Full durability|✅|✅|✅|✅|✅|:x:|
|Relaxed durability|:x:|:x:|✅|:x:|:x:|✅|
|Filesystem transparency|:x:|:x:|:x:|✅|✅|✅|
|Write-ahead logging|:x:|:x:|:x:|:x:|:x:|✅|
|Cross-origin isolation *not* required[^3]|✅|✅|✅|✅|✅|✅|

[^1]: Requires FileSystemSyncAccessHandle readwrite-unsafe locking mode support *and* application coordination.
[^2]: Requires FileSystemSyncAccessHandle readwrite-unsafe locking mode support.
[^3]: Using certain web APIs (e.g. SharedArrayBuffer, Atomics) requires strict cross-origin restrictions.
