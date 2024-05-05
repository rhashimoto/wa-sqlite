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
This IndexedDB VFS is the most general and compatible implementation.

Changing the page size after the database is created is not supported.

### OPFSAdaptiveVFS
This OPFS VFS supports multiple connections without the proposed "readwrite-unsafe" locking mode, but is more performant if it is available.

If the new mode is not supported then only journaling modes "delete" (default), "memory", and "off" are allowed.

### AccessHandlePoolVFS
This OPFS VFS can be used with the synchronous WebAssembly build.

### OPFSCoopSyncVFS
This is a new VFS that works with the synchronous WebAssembly build but also supports multiple connections.

Transactions involving more than one main (non-temporary) database are not supported.

### FLOOR
This is an experimental hybrid OPFS/IndexedDB VFS that uses write-ahead-logging (but not the SQLite WAL implementation). It requires the proposed "readwrite-unsafe" locking mode for OPFS access handles.

Changing the page size after the database is created is not supported. Write transaction durability is not guaranteed.

## VFS Comparison

||MemoryVFS|MemoryAsyncVFS|IDBBatchAtomicVFS|OPFSAdaptiveVFS|AccessHandlePoolVFS|OPFSCoopSyncVFS|FLOOR|
|-|-|-|-|-|-|-|-|
|Storage|RAM|RAM|IndexedDB|OPFS|OPFS|OPFS|OPFS/IndexedDB|
|Synchronous build|✅|:x:|:x:|:x:|✅|✅|:x:|
|Asyncify build|✅|✅|✅|✅|✅|✅|✅|
|JSPI build|✅|✅|✅|✅|✅|✅|✅|
|Contexts|All|All|All|Worker|Worker|Worker|Worker|
|Multiple connections|:x:|:x:|✅|✅|:x:|✅|✅[^1]|
|Full durability|✅|✅|✅|✅|✅|✅|:x:|
|Relaxed durability|:x:|:x:|✅|:x:|:x:|:x:|✅|
|Filesystem transparency|:x:|:x:|:x:|✅|:x:|✅|✅|
|Write-ahead logging|:x:|:x:|:x:|:x:|:x:|:x:|✅|
|Multi-database transactions|✅|✅|✅|✅|✅|:x:|✅|
|Change page size|✅|✅|:x:|✅|✅|✅|:x:|
|No COOP/COEP requirements|✅|✅|✅|✅|✅|✅|✅|

[^1]: Requires FileSystemSyncAccessHandle readwrite-unsafe locking mode support.
