import * as VFS from '../VFS.js';
import { WebLocksMixin } from './WebLocksMixin.js';
import * as IDBUtils from './IDBUtils.js';

// Default block size for new databases.
const BLOCK_SIZE = 8192;

export class IDBDatabaseFile extends WebLocksMixin() {
  writeCache = new Map();

  constructor(db) {
    super();
    this.store = new IDBUtils.StoreManager(db, 'database');
  }

  get name() { return this.metadata.name; }
  get type() { return this.flags & VFS.FILE_TYPE_MASK; }

  async xOpen(name, fileId, flags, pOutFlags) {
    this.flags = flags;

    // Fetch metadata.
    this.metadata = await this.store.get([name, 'metadata']);
    if (!this.metadata) {
      // File doesn't exist, create if requested.
      if (flags & VFS.SQLITE_OPEN_CREATE) {
        this.metadata = {
          name,
          index: 'metadata',
          fileSize: 0,
          blockSize: BLOCK_SIZE
        };
        this.store.put(this.metadata);
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
      this.writeCache.set('metadata', this.metadata);
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
      this.writeCache.set(blockIndex, block);
    }

    const blockOffset = iOffset % this.metadata.blockSize;
    new Int8Array(block.data, blockOffset).set(pData.value);
    return VFS.SQLITE_OK;
  }

  xTruncate(fileId, iSize) {
    this.metadata.fileSize = iSize;
    this.writeCache.set('metadata', this.metadata);
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
      for (const block of this.writeCache.values()) {
        // Skip blocks past EOF. Be careful: metadata has index 'metadata'.
        if (!(block.index * this.metadata.blockSize >= this.metadata.fileSize)) {
          this.store.put(block);
        }
      }
      this.writeCache.clear();
  
      // Remove blocks lost by truncation.
      const range = IDBKeyRange.bound(
        [this.name, (this.metadata.fileSize / this.metadata.blockSize) | 0],
        [this.name, Number.MAX_VALUE])
      await this.store.delete(range);
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
    const block = this.writeCache.get(index);
    if (block) return block;
    return this.store.get([this.name, index]);
  }
}