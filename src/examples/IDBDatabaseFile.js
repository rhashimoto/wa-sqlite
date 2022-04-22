import * as VFS from '../VFS.js';
import { WebLocksMixin } from './WebLocksMixin.js';
import { IDBActivity } from './IDBActivity.js';

// Default block size for new databases.
const BLOCK_SIZE = 8192;

// This implementation of a SQLite database file buffers writes (in
// memory spilling to IndexedDB), and writes the SQLite transaction
// in a single IndexedDB transaction at commit. File data is stored
// to IndexedDB in fixed-size blocks, plus a special object for
// file metadata.
export class IDBDatabaseFile extends WebLocksMixin() {
  purge = new Set();

  block0 = null;
  truncateRange = null;

  inTransaction = false;

  constructor(/** @type {IDBDatabase} */ db) {
    super();
    this.db = db;
    this.idb = new IDBActivity(db, ['pages']);
  }

  get name() { return this.block0.name; }
  get type() { return this.flags & VFS.FILE_TYPE_MASK; }
  get blockSize() { return this.block0.data.byteLength }

  async xOpen(name, fileId, flags, pOutFlags) {
    this.flags = flags;

    // Fetch metadata.
    this.block0 = await this.idb.run('readonly', ({ pages }) => {
      return pages.get(IDBKeyRange.bound([name, 0], [name, 0, []]));
    });
    if (!this.block0) {
      // File doesn't exist, create if requested.
      if (flags & VFS.SQLITE_OPEN_CREATE) {
        this.block0 = {
          name,
          index: 0,
          version: 0,
          purgeVersion: 0,
          fileSize: 0,
          data: new ArrayBuffer(BLOCK_SIZE)
        };
        this.idb.run('readwrite', ({ pages }) => pages.put(this.block0));
        await this.idb.sync();
      } else {
        return VFS.SQLITE_CANTOPEN;
      }
    }
    pOutFlags.set(0);
    return VFS.SQLITE_OK;
  }

  xClose() {
    return VFS.SQLITE_OK;
  }

  async xRead(fileId, pData, iOffset) {
    const blockIndex = (iOffset / this.blockSize) | 0;
    if (iOffset + pData.size > (blockIndex + 1) * this.blockSize) {
      console.assert(false, 'unexpected read across block boundary');
      return VFS.SQLITE_IOERR;
    }

    // Check for read past the end of data.
    if (iOffset >= this.block0.fileSize) {
      pData.value.fill(0, pData.size);
      return VFS.SQLITE_IOERR_SHORT_READ;
    }

    // Fetch the file data.
    const block = blockIndex === 0 ? this.block0 : await this.getBlock(blockIndex);
    const blockOffset = iOffset % this.blockSize;
    pData.value.set(new Int8Array(block.data, blockOffset, pData.size));
    return VFS.SQLITE_OK;
  }

  xWrite(fileId, pData, iOffset) {
    const blockIndex = (iOffset / this.blockSize) | 0;
    if (iOffset !== blockIndex * this.blockSize ||
        pData.size !== this.blockSize) {
      // Not a single complete block write.
      console.assert(false, 'unexpected write parameters');
      return VFS.SQLITE_IOERR;
    }

    // Extend the file when writing past the end.
    this.block0.fileSize = Math.max(this.block0.fileSize, iOffset + pData.size);

    this.prepare();
    const block = blockIndex === 0 ? this.block0 : {
      name: this.name,
      index: blockIndex,
      data: new ArrayBuffer(this.blockSize)
    };
    new Int8Array(block.data).set(pData.value);
    this.#putBlock(block);
    return VFS.SQLITE_OK;
  }

  xTruncate(fileId, iSize) {
    // If the SQLite transaction has already been closed, e.g. because
    // the journal closed, create a fake transaction.
    const isTransactionClosed = !this.inTransaction;
    if (isTransactionClosed) {
      this.prepare();
    }

    this.idb.run('readwrite', () => {
      this.block0.fileSize = iSize;
      this.truncateRange = IDBKeyRange.bound(
        [this.name, (this.block0.fileSize / this.blockSize) | 0],
        [this.name, Number.MAX_VALUE, Number.MAX_VALUE]);
    });

    if (isTransactionClosed) {
      this.commit();
    }
    return VFS.SQLITE_OK;
  }

  xSync(fileId, flags) {
    return VFS.SQLITE_OK;
  }

  xFileSize(fileId, pSize64) {
    pSize64.set(this.block0.fileSize);
    return VFS.SQLITE_OK
  }

  async xLock(fileId, flags) {
    const result = (super.xLock && await super.xLock(fileId, flags)) ?? VFS.SQLITE_OK;
    switch (this.lockState) {
      case VFS.SQLITE_LOCK_SHARED: // read lock
        this.block0 = await this.idb.run('readonly', ({ pages }) => {
          return pages.get(IDBKeyRange.bound([this.name, 0], [this.name, 0, []]));
        });
        break;
      case VFS.SQLITE_LOCK_EXCLUSIVE: // write lock
        // Remove any blocks newer than the version. This would be leftover
        // from an interrupted transaction.
        this.idb.run('readwrite', async ({ pages }) => {
          const keys = await pages.index('version')
            .getAllKeys(IDBKeyRange.bound(
              [this.name],
              [this.name, this.block0.version],
              false, true));
          if (keys.length) {
            console.log(`Removing ${keys.length} previously uncommitted pages.`);
            for (const key of keys) {
              pages.delete(key);
            }
          }
        });
        this.prepare();
        break;
    }
    return result;
  }

  async xUnlock(fileId, flags) {
    if (this.lockState === VFS.SQLITE_LOCK_EXCLUSIVE) {
      await this.commit();
    }

    return (super.xUnlock && super.xUnlock(fileId, flags)) ?? VFS.SQLITE_OK;
  }

  xSectorSize(fileId) {
    return this.blockSize;
  }

  xDeviceCharacteristics(fileId) {
    return VFS.SQLITE_IOCAP_SAFE_APPEND |
           VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN;
  }

  prepare() {
    if (this.inTransaction) return;
    this.inTransaction = true;

    this.idb.run('readwrite', () => {
      this.block0.version--;
    });
  }

  commit() {
    if (!this.inTransaction) return;
    this.inTransaction = false;

    // All file changes, except creation, take place here.
    return this.idb.run('readwrite', ({ pages }) => {
      // Flush metadata. This publishes the new version.
      pages.put(this.block0);

      // Remove blocks truncated from the file.
      if (this.truncateRange) {
        pages.delete(this.truncateRange);
        this.truncateRange = null;
      }

      // Purge obsolete blocks.
      this.purge.add(0);
      for (const index of this.purge) {
        if (index * this.blockSize < this.block0.fileSize) {
          pages.delete(IDBKeyRange.bound(
            [this.name, index, this.block0.version],
            [this.name, index, Number.MAX_VALUE],
            true));
        }
      }
      this.purge.clear();
    }, true);
  }

  /**
   * 
   * @param {string|number} index 
   * @param {boolean} [open] 
   * @returns 
   */
  getBlock(index, open = false) {
    console.assert(index !== 0 || open, 'invalid block 0 access');
    return this.idb.run('readonly', ({ pages }) => {
      const query = IDBKeyRange.lowerBound(
        [this.name, index, this.block0.version],
        open)
      return pages.get(query);
    });
  }

  #putBlock(block) {
    if (block.index > 0) {
      return this.idb.run('readwrite', ({ pages }) => {
        this.purge.add(block.index);
        block.version = this.block0.version;
        pages.put(block);
      });
    }
  }
}
