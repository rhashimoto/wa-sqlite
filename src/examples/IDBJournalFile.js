import * as VFS from '../VFS.js';
import * as IDBUtils from './IDBUtils.js';

const BLOCK_SIZE = 8192;

export class IDBJournalFile extends VFS.Base {
  nWrites = 0;
  maxWriteBytes = 0;

  constructor(/** @type {IDBDatabase} */ db) {
    super();
    this.journalStore = new IDBUtils.StoreManager(db, 'journal');
  }

  get name() { return this.metadata.name; }
  get type() { return this.flags & VFS.FILE_TYPE_MASK; }

  async xOpen(name, fileId, flags, pOutFlags) {
    this.flags = flags;
    this.metadata = {
      name,
      fileSize: 0,
      blockSize: BLOCK_SIZE
    };

    this.clearJournalContents();
    pOutFlags.set(0);
    return VFS.SQLITE_OK;
  }

  xClose() {
    this.clearJournalContents();
    return VFS.SQLITE_OK;
  }

  async xRead(fileId, pData, iOffset) {
    // Check for read past the end of data.
    if (iOffset >= this.metadata.fileSize) {
      pData.value.fill(0, pData.size);
      return VFS.SQLITE_IOERR_SHORT_READ;
    }

    // Fetch all writes that could overlap the request.
    const addressLo = Math.max(iOffset - this.maxWriteBytes + 1, 0);
    const addressHi = iOffset + pData.size;
    const range = IDBKeyRange.bound(
     [this.name, addressLo],
     [this.name, addressHi],
     false, true);
    const blocks = await this.journalStore.getAll(range);
    
    // Apply all the writes to the output.
    for (const block of blocks) {
      if (block.address + block.data.byteLength > iOffset) {
        const targetOffset = Math.max(block.address - iOffset, 0);
        const sourceOffset = Math.max(iOffset - block.address, 0);
        const sourceLength = Math.min(
          block.data.byteLength - sourceOffset,
          pData.size - targetOffset);
        const source = new Int8Array(block.data, sourceOffset, sourceLength);
        pData.value.set(source, targetOffset)
      }
    }
    return VFS.SQLITE_OK;
  }

  xWrite(fileId, pData, iOffset) {
    // Check for write past the end of data.
    if (iOffset + pData.size >= this.metadata.fileSize) {
      this.metadata.fileSize = iOffset + pData.size;
    }

    const block = {
      name: this.name,
      address: iOffset,
      order: this.nWrites++,
      data: pData.value.slice().buffer
    }
    this.journalStore.put(block);
    this.maxWriteBytes = Math.max(this.maxWriteBytes, pData.size);
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

  xSectorSize(fileId) {
    return this.metadata.blockSize;
  }

  xDeviceCharacteristics(fileId) {
    return VFS.SQLITE_IOCAP_SAFE_APPEND |
           VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN;
  }

  clearJournalContents() {
    const range = IDBKeyRange.bound([this.name], [this.name, Number.MAX_VALUE]);
    this.journalStore.delete(range);
    this.metadata.fileSize = 0;
  }
}