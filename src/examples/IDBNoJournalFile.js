import * as VFS from '../VFS.js';

// This "journal file" does not actually store more than a small portion
// (1 page entry) of journal data written to it. When it detects a rollback
// instead of returning a complete journal it signals its IDBDatabaseFile
// directly. This saves both time and space.
//
// The drawback with this approach is that on rollback the SQLite internal
// cache of the database file becomes inconsistent because it does not
// receive complete rollback data. IDBDatabaseFile works around this by
// incrementing the file change counter to force reloading the cache, but
// note that this does not work with PRAGMA locking_mode=exclusive (unless
// also using PRAGMA cache_size=0).
export class IDBNoJournalFile extends VFS.Base {
  journal = new Int8Array();
  maxJournalSize = 0;

  constructor(name, mapIdToFile) {
    super();

    // Find the corresponding open database file.
    const dbName = name.replace(/-journal$/, '');
    for (const [dbFileId, dbFile] of mapIdToFile) {
      if (dbFile.name === dbName) {
        this.dbFileId = dbFileId;
        this.dbFile = dbFile;
      }
    }
    if (!this.dbFile) throw new Error(`open database "${dbName} not found`);
  }

  get name() { return this.metadata.name; }
  get type() { return this.flags & VFS.FILE_TYPE_MASK; }

  async xOpen(name, fileId, flags, pOutFlags) {
    this.flags = flags;
    this.metadata = {
      name
    };

    pOutFlags.set(0);
    return VFS.SQLITE_OK;
  }

  xClose() {
    return VFS.SQLITE_OK;
  }

  async xRead(fileId, pData, iOffset) {
    // Check for read past the end of data.
    if (iOffset >= this.journal.byteLength) {
      pData.value.fill(0, pData.size);
      return VFS.SQLITE_IOERR_SHORT_READ;
    }

    // Whenever the header is read, ensure that the page count is
    // consistent.
    if (iOffset <= 8 && iOffset + pData.size >= 12) {
      const view = new DataView(this.journal.buffer);
      view.setUint32(8, -1);
    }

    pData.value.set(this.journal.subarray(iOffset, iOffset + pData.size));
    this.dbFile.rollbackOOB = true;
    return VFS.SQLITE_OK;
  }

  xWrite(fileId, pData, iOffset) {
    // Collect journal layout info from the header.
    // https://www.sqlite.org/fileformat.html#the_rollback_journal
    if (!this.maxJournalSize && iOffset >= 28) {
      const view = new DataView(this.journal.buffer);
      const sectorSize = view.getInt32(20);
      const pageSize = view.getInt32(24);

      // Limit the journal to 1 page entry.
      this.maxJournalSize = sectorSize + pageSize + 8;
    }

    // Discard writes past the first page record.
    if (!this.maxJournalSize || iOffset < this.maxJournalSize) {
      if (pData.size + iOffset > this.journal.byteLength) {
        const oldJournal = this.journal;
        this.journal = new Int8Array(pData.size + iOffset);
        this.journal.set(oldJournal);
      }
      this.journal.set(pData.value, iOffset);
    }
    return VFS.SQLITE_OK;
  }

  xTruncate(fileId, iSize) {
    console.assert(iSize <= this.journal.byteLength);
    this.journal = this.journal.slice(0, iSize);
    return VFS.SQLITE_OK;
  }

  xSync(fileId, flags) {
    return VFS.SQLITE_OK;
  }

  xFileSize(fileId, pSize64) {
    pSize64.set(this.journal.byteLength);
    return VFS.SQLITE_OK
  }

  xSectorSize(fileId) {
    return this.dbFile.xSectorSize(fileId);
  }

  xDeviceCharacteristics(fileId) {
    return VFS.SQLITE_IOCAP_SAFE_APPEND |
           VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN;
  }
}