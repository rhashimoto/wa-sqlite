// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
import * as VFS from '../VFS.js';
import { MemoryVFS } from './MemoryVFS.js';
import { IDBDatabaseFile } from './IDBDatabaseFile.js';
import { IDBNoJournalFile } from './IDBNoJournalFile.js';

function log(...args) {
  // console.debug(...args);
}

// Use IndexedDB as a block device.
export class IndexedDbVFS extends VFS.Base {
  name = 'idb';

  fallback = new MemoryVFS();

  /** @type {Promise<IDBDatabase>} */ dbReady;
  mapIdToFile = new Map();
  closedFileIds = new Set();

  constructor(idbDatabaseName = 'sqlite') {
    super();

    // Open IDB database.
    this.dbReady = wrapRequest(globalThis.indexedDB.open(idbDatabaseName, 4), {
      async upgradeneeded(event) {
      // Most of this function handles migrating a now obsolete IndexedDB
      // schema, to make sure that users of newly updated pages (e.g. the
      // demo on GitHub) won't have to clear their browser state for that
      // site origin. This can be simplified to just object store creation
      // if that were not a consideration.
      const { oldVersion, newVersion } = event;
        console.log(`Upgrading "${idbDatabaseName}" ${oldVersion} -> ${newVersion}`);
        /** @type {IDBDatabase} */ const db = event.target.result;
        /** @type {IDBTransaction} */ const tx = event.target.transaction;
        switch (oldVersion) {
          case 0:
            db.createObjectStore('blocks');
          case 1:
            db.createObjectStore('database', {
              keyPath: ['name', 'index']
            });
            
            // Transfer objects from previous version.
            await new Promise(complete => {
              const blocks = tx.objectStore('blocks');
              const database = tx.objectStore('database');
              blocks.openCursor().addEventListener('success', (/** @type {*} */ event) => {
                const cursor = event.target.result;
                if (cursor) {
                  const key = cursor.key.split('\u00a7');
                  const index = key.pop() || 'metadata';
                  const name = key.join('\u00a7');
                  if (index === 'metadata') {
                    database.put({
                      name,
                      index: 'metadata',
                      blockSize: cursor.value.blockSize,
                      fileSize: cursor.value.size
                    });
                  } else {
                    database.put({
                      name,
                      index: Number(`0x${index}`),
                      data: cursor.value
                    });
                  }
                  cursor.continue();
                } else {
                  complete();
                }
              });
            });
            db.deleteObjectStore('blocks');
          case 2:
            db.createObjectStore('spill', {
              keyPath: ['name', 'index']
            });
            db.createObjectStore('journal', {
              keyPath: ['name', 'address', 'order']
            });
          case 3:
            await new Promise(complete => {
              const database = tx.objectStore('database');
              database.openCursor().addEventListener('success', async (event) => {
                // @ts-ignore
                /** @type {IDBCursorWithValue} */ const cursor = event.target.result;
                if (cursor) {
                  if (cursor.value.index === 'metadata') {
                    const block0 = await new Promise((resolve, reject) => {
                      const request = database.get([cursor.value.name, 0]);
                      request.addEventListener('success', () => resolve(request.result));
                      request.addEventListener('error', () => reject(request.error));
                    })
                    database.put(Object.assign({}, cursor.value, block0));
                    cursor.delete();
                  }
                  cursor.continue();
                } else {
                  complete();
                }
              });
            });
        }
      },

      blocked() {
        console.warn('IndexedDB upgrade blocked by open connection');
      }
    });
  }

  xOpen(name, fileId, flags, pOutFlags) {
    log(`xOpen ${name} ${fileId} 0x${flags.toString(16)}`);

    // Clear any closed fileId instances. This is deferred from xClose()
    // for correct Asyncify behavior.
    for (const id of this.closedFileIds) {
      this.mapIdToFile.delete(id);
    }
    this.closedFileIds.clear();

    switch (flags & VFS.FILE_TYPE_MASK) {
      case VFS.SQLITE_OPEN_MAIN_DB:
        return this.handleAsync(async () => {
          const db = await this.dbReady;
          const file = new IDBDatabaseFile(db);
          this.mapIdToFile.set(fileId, file);
          return file.xOpen(name, fileId, flags, pOutFlags);
        });
      case VFS.SQLITE_OPEN_MAIN_JOURNAL:
        return this.handleAsync(async () => {
          const db = await this.dbReady;
          const file = new IDBNoJournalFile(name, this.mapIdToFile);
          this.mapIdToFile.set(fileId, file);
          return file.xOpen(name, fileId, flags, pOutFlags);
        });
    }
    return this.fallback.xOpen(name, fileId, flags, pOutFlags);
  }

  xClose(fileId) {
    const file = this.mapIdToFile.get(fileId);
    log(`xClose ${file?.name ?? fileId}`);

    this.closedFileIds.add(fileId);
    switch (file?.type) {
      case VFS.SQLITE_OPEN_MAIN_DB:
      case VFS.SQLITE_OPEN_MAIN_JOURNAL:
        return file.xClose();
    }
    return this.fallback.xClose(fileId);
  }

  xRead(fileId, pData, iOffset) {
    const file = this.mapIdToFile.get(fileId);
    log(`xRead ${file?.name ?? fileId} ${pData.size} ${iOffset}`);
    switch (file?.type) {
      case VFS.SQLITE_OPEN_MAIN_DB:
      case VFS.SQLITE_OPEN_MAIN_JOURNAL:
        return this.handleAsync(() => {
          return file.xRead(fileId, pData, iOffset);
        });
    }
    return this.fallback.xRead(fileId, pData, iOffset);
  }

  xWrite(fileId, pData, iOffset) {
    const file = this.mapIdToFile.get(fileId);
    log(`xWrite ${file?.name ?? fileId} ${pData.size} ${iOffset}`);
    switch (file?.type) {
      case VFS.SQLITE_OPEN_MAIN_DB:
      case VFS.SQLITE_OPEN_MAIN_JOURNAL:
        return file.xWrite(fileId, pData, iOffset);
    }
    return this.fallback.xWrite(fileId, pData, iOffset);
  }

  xTruncate(fileId, iSize) {
    const file = this.mapIdToFile.get(fileId);
    log(`xTruncate ${file?.name ?? fileId} ${iSize}`);
    switch (file?.type) {
      case VFS.SQLITE_OPEN_MAIN_DB:
      case VFS.SQLITE_OPEN_MAIN_JOURNAL:
        return file.xTruncate(fileId, iSize);
    }
    return this.fallback.xTruncate(fileId, iSize);
  }

  xSync(fileId, flags) {
    const file = this.mapIdToFile.get(fileId);
    log(`xSync ${file?.name ?? fileId} ${flags}`);
    switch (file?.type) {
      case VFS.SQLITE_OPEN_MAIN_DB:
      case VFS.SQLITE_OPEN_MAIN_JOURNAL:
        return file.xSync(fileId, flags);
    }
    return this.fallback.xSync(fileId, flags);
  }

  xFileSize(fileId, pSize64) {
    const file = this.mapIdToFile.get(fileId);
    log(`xFileSize ${file?.name ?? fileId}`);
    switch (file?.type) {
      case VFS.SQLITE_OPEN_MAIN_DB:
      case VFS.SQLITE_OPEN_MAIN_JOURNAL:
        return file.xFileSize(fileId, pSize64);
    }
    return this.fallback.xFileSize(fileId, pSize64);
  }

  xLock(fileId, flags) {
    const file = this.mapIdToFile.get(fileId);
    log(`xLock ${file?.name ?? fileId} ${flags}`);
    switch (file?.type) {
      case VFS.SQLITE_OPEN_MAIN_DB:
        return this.handleAsync(async () => {
          return file.xLock(fileId, flags);
        });
      case VFS.SQLITE_OPEN_MAIN_JOURNAL:
        console.assert(false);
    }
    return this.fallback.xLock(fileId, flags);
  }

  xUnlock(fileId, flags) {
    const file = this.mapIdToFile.get(fileId);
    log(`xUnlock ${file?.name ?? fileId} ${flags}`);
    switch (file?.type) {
      case VFS.SQLITE_OPEN_MAIN_DB:
        return this.handleAsync(async () => {
          return file.xUnlock(fileId, flags);
        });
      case VFS.SQLITE_OPEN_MAIN_JOURNAL:
        console.assert(false);
    }
    return this.fallback.xUnlock(fileId, flags);
  }

  xSectorSize(fileId) {
    const file = this.mapIdToFile.get(fileId);
    log(`xSectorSize ${file?.name ?? fileId}`);
    switch (file?.type) {
      case VFS.SQLITE_OPEN_MAIN_DB:
      case VFS.SQLITE_OPEN_MAIN_JOURNAL:
        return file.xSectorSize(fileId);
    }
    return this.fallback.xSectorSize(fileId);
  }

  xDeviceCharacteristics(fileId) {
    const file = this.mapIdToFile.get(fileId);
    log(`xDeviceCharacteristics ${file?.name ?? fileId}`);
    switch (file?.type) {
      case VFS.SQLITE_OPEN_MAIN_DB:
      case VFS.SQLITE_OPEN_MAIN_JOURNAL:
        return file.xDeviceCharacteristics(fileId);
    }
    return this.fallback.xDeviceCharacteristics(fileId);
  }

  xDelete(name, syncDir) {
    log(`xDelete ${name} ${syncDir}`);
    if (name.endsWith('-journal') || name.endsWith('-wal')) {
      // IDBDatabaseFile is always consistent in IndexedDB so
      // not deleting journal data is safe.
      return VFS.SQLITE_OK
    }
    return this.fallback.xDelete(name, syncDir);
  }

  xAccess(name, flags, pResOut) {
    log(`xAccess ${name} ${flags}`);
    if (name.endsWith('-journal') || name.endsWith('-wal')) {
      // Journal files aren't considered persistent in this VFS.
      pResOut.set(0);
    }
    return this.fallback.xAccess(name, flags, pResOut);
  }
}

function wrapRequest(request, listeners) {
  return new Promise(function(resolve, reject) {
    for (const [key, listener] of Object.entries(listeners)) {
      request.addEventListener(key, listener);
    }
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}