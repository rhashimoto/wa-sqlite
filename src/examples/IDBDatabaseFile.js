import * as VFS from '../VFS.js';
import { WebLocksMixin } from './WebLocksMixin.js';
import * as IDBUtils from './IDBUtils.js';

// Default block size for new databases.
const BLOCK_SIZE = 8192;

const CACHE_SIZE = 4;

export class IDBDatabaseFile extends WebLocksMixin() {
  writeCache = new Map();
  spilled = new Set();

  constructor(/** @type {IDBDatabase} */ db) {
    super();
    this.db = db;
    this.databaseStore = new IDBUtils.StoreManager(db, 'database');
    this.spillStore = new IDBUtils.StoreManager(db, 'spill');
  }

  get name() { return this.metadata.name; }
  get type() { return this.flags & VFS.FILE_TYPE_MASK; }

  async xOpen(name, fileId, flags, pOutFlags) {
    this.flags = flags;

    // Fetch metadata.
    this.metadata = await this.databaseStore.get([name, 'metadata']);
    if (!this.metadata) {
      // File doesn't exist, create if requested.
      if (flags & VFS.SQLITE_OPEN_CREATE) {
        this.metadata = {
          name,
          index: 'metadata',
          fileSize: 0,
          blockSize: BLOCK_SIZE
        };
        this.databaseStore.put(this.metadata);
      } else {
        return VFS.SQLITE_CANTOPEN;
      }
    }
    pOutFlags.set(0);
    return VFS.SQLITE_OK;
  }

  xClose() {
    // All output is flushed on xUnlock so sync is unnecessary here.
    // TODO: Handle delete-on-close if used for temp databases.
    return VFS.SQLITE_OK;
  }

  async xRead(fileId, pData, iOffset) {
    // Check for read past the end of data.
    if (iOffset >= this.metadata.fileSize) {
      pData.value.fill(0, pData.size);
      return VFS.SQLITE_IOERR_SHORT_READ;
    }

    // Fetch the file data.
    const blockIndex = (iOffset / this.metadata.blockSize) | 0;
    let block = this.getBlock(blockIndex);
    block = block.name ? block : await block;

    const blockOffset = iOffset % this.metadata.blockSize;
    pData.value.set(new Int8Array(block.data, blockOffset, pData.size));
    return VFS.SQLITE_OK;
  }

  xWrite(fileId, pData, iOffset) {
    // Check for write past the end of data.
    if (iOffset + pData.size >= this.metadata.fileSize) {
      this.metadata.fileSize = iOffset + pData.size;
    }

    // Get the block from the cache, creating if necessary.
    const blockIndex = (iOffset / this.metadata.blockSize) | 0;
    let block = this.writeCache.get(blockIndex);
    if (!block) {
      block = {
        name: this.name,
        index: blockIndex,
        data: new ArrayBuffer(this.metadata.blockSize)
      };
      this.putBlock(blockIndex, block);
    }

    const blockOffset = iOffset % this.metadata.blockSize;
    new Int8Array(block.data, blockOffset).set(pData.value);
    return VFS.SQLITE_OK;
  }

  xTruncate(fileId, iSize) {
    this.metadata.fileSize = iSize;
    return VFS.SQLITE_OK;
  }

  xSync(fileId, flags) {
    return VFS.SQLITE_OK;
  }

  xFileSize(fileId, pSize64) {
    pSize64.set(this.metadata.fileSize);
    return VFS.SQLITE_OK
  }

  async xLock(fileId, flags) {
    const result = (super.xLock && super.xLock(fileId, flags)) ?? VFS.SQLITE_OK;
    if (this.lockState === VFS.SQLITE_LOCK_NONE) {
      this.metadata = await this.getBlock('metadata');
    }
    return result;
  }

  async xUnlock(fileId, flags) {
    if (this.lockState === VFS.SQLITE_LOCK_EXCLUSIVE && this.writeCache.size) {
      // Flush the (possibly spilled) cache in a single transaction.
      const tx = this.db.transaction(['database', 'spill'], 'readwrite');
      tx.objectStore('database').put(this.metadata);
      for (const block of this.writeCache.values()) {
        // Skip blocks past EOF.
        if (block.index * this.metadata.blockSize < this.metadata.fileSize) {
          console.log(`writeCache to database ${block.index}`, block);
          tx.objectStore('database').put(block);
        }
      }
      this.writeCache.clear();

      const spillRange = IDBKeyRange.bound(
        [this.name, 0],
        [this.name, Number.MAX_SAFE_INTEGER]);
      await new Promise((resolve, reject) => {
        // Iterate spilled blocks.
        const request = tx.objectStore('spill').openCursor(spillRange)
        request.addEventListener('success', event => {
          // @ts-ignore
          /** @type {IDBCursorWithValue} */ const cursor = event.target.result;
          if (cursor) {
            // Ignore unreferenced entries that occur when a block has
            // been overridden by a new write cache entry.
            const block = cursor.value;
            if (this.spilled.has(block.index)) {
              console.log(`spill to database ${block.index}`);
              tx.objectStore('database').put(block);
            }
            cursor.continue();
          } else {
            resolve();
          }
        });
        request.addEventListener('error', reject);
      });
      this.spilled.clear();
      tx.objectStore('spill').delete(spillRange);

      // Remove blocks truncated from the file.
      const truncateRange = IDBKeyRange.bound(
        [this.name, (this.metadata.fileSize / this.metadata.blockSize) | 0],
        [this.name, Number.MAX_VALUE])
      this.databaseStore.delete(truncateRange);
    }
    return (super.xUnlock && super.xUnlock(fileId, flags)) ?? VFS.SQLITE_OK;
  }

  xSectorSize(fileId) {
    return this.metadata.blockSize;
  }

  xDeviceCharacteristics(fileId) {
    return VFS.SQLITE_IOCAP_SAFE_APPEND |
           VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN;
  }

  getBlock(index) {
    console.log(`getBlock ${index}`);
    const block = this.writeCache.get(index);
    if (block) return block;

    if (this.spilled.has(index)) {
      console.log(`spill fetch ${index}`)
      return this.spillStore.get([this.name, index]);
    }
    console.log(`database fetch ${index}`);
    return this.databaseStore.get([this.name, index]);
  }

  putBlock(index, block) {
    console.log(`putBlock ${index}`, block);
    // Replace or insert at the end of the write cache.
    this.writeCache.delete(index);
    this.writeCache.set(index, block);

    // Remove the corresponding block from spill.
    if (this.spilled.has(index)) {
      // Just delete the in-memory reference and leave the block in
      // the object store.
      this.spilled.delete(index);
    }

    for (const candidate of this.writeCache.values()) {
      if (this.writeCache.size <= CACHE_SIZE) break;

      // Keep block 0 in the cache.
      if (candidate.index > 0) {
        console.log(`spilling ${candidate.index}`, candidate);
        this.spillStore.put(candidate);
        this.spilled.add(candidate.index);
        this.writeCache.delete(candidate.index);
      }
    }
  }
}