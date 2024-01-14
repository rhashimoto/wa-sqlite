# wa-sqlite example code
These examples are intended to help developers get started with writing extensions,
and to experiment with interesting approaches and techniques. Using them as-is in
production is not prohibited but that isn't their primary purpose.

## VFS examples
### MemoryVFS and MemoryAsyncVFS
These are minimal working examples for writing a VFS. First-time implementers should
probably start by looking at these classes, as well as the
[SQLite VFS documentation](https://www.sqlite.org/vfs.html).

### OriginPrivateVFS
This VFS uses the proposed
[Origin Private File System](https://wicg.github.io/file-system-access/#wellknowndirectory-origin-private-file-system)
with the
[Access Handle](https://github.com/WICG/file-system-access/blob/main/AccessHandle.md)
dependent proposal. Note that OPFS works only in a Worker.

## Utility examples

### tag
This is a template tag function generator that can be used to
provide syntactic sugar for embedding SQL in Javascript.
