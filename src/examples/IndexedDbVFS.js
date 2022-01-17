// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
import * as VFS from '../VFS.js';
import { MemoryVFS } from './MemoryVFS.js';
import { IDBDatabaseFile } from './IDBDatabaseFile.js';
import * as IDBUtils from './IDBUtils.js';

function log(...args) {
  console.debug(...args);
}

// Use IndexedDB as a block device.
export class IndexedDbVFS extends VFS.Base {
  name = 'idb';

  fallback = new MemoryVFS();

  /** @type {Promise<IDBDatabase>} */ dbReady;
  mapIdToFile = new Map();

  constructor(idbDatabaseName = 'sqlite') {
    super();

    // Open IDB database.
    this.dbReady = IDBUtils.promisify(globalThis.indexedDB.open(idbDatabaseName, 3), {
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
            break;
        }
      },

      blocked() {
        console.warn('IndexedDB upgrade blocked by open connection');
      }
    });
  }

  xOpen(name, fileId, flags, pOutFlags) {
    log(`xOpen ${name} ${fileId} 0x${flags.toString(16)}`);
    switch (flags & VFS.FILE_TYPE_MASK) {
      case VFS.SQLITE_OPEN_MAIN_DB:
        return this.handleAsync(async () => {
          const db = await this.dbReady;
          const file = new IDBDatabaseFile(db);
          this.mapIdToFile.set(fileId, file);
          return file.xOpen(name, fileId, flags, pOutFlags);
        });
      case VFS.SQLITE_OPEN_MAIN_JOURNAL:
        this.mapIdToFile.set(fileId, {
          name,
          type: VFS.SQLITE_OPEN_MAIN_JOURNAL
        });
        return this.fallback.xOpen(name, fileId, flags, pOutFlags);
    }
    return this.fallback.xOpen(name, fileId, flags, pOutFlags);
  }

  xClose(fileId) {
    const file = this.mapIdToFile.get(fileId);
    log(`xClose ${file?.name ?? fileId}`);
    switch (file?.type) {
      case VFS.SQLITE_OPEN_MAIN_DB:
        this.mapIdToFile.delete(fileId)
        return file.xClose();
      case VFS.SQLITE_OPEN_MAIN_JOURNAL:
        this.mapIdToFile.delete(fileId)
        return this.fallback.xClose(fileId);
    }
    return this.fallback.xClose(fileId);
  }

  xRead(fileId, pData, iOffset) {
    const file = this.mapIdToFile.get(fileId);
    log(`xRead ${file?.name ?? fileId} ${pData.size} ${iOffset}`);
    switch (file?.type) {
      case VFS.SQLITE_OPEN_MAIN_DB:
        return this.handleAsync(() => {
          return file.xRead(fileId, pData, iOffset);
        });
      case VFS.SQLITE_OPEN_MAIN_JOURNAL:
        const result = this.fallback.xRead(fileId, pData, iOffset);
        // TODO: delete this
        if (((iOffset - 8192) % (8192 + 8)) === 0) {
          const view = new DataView(pData.value.buffer, pData.value.byteOffset);
          const index = view.getUint32(0);
          console.log(`journal index ${index}`);
        }
        return result;
    }
    return this.fallback.xRead(fileId, pData, iOffset);
  }

  xWrite(fileId, pData, iOffset) {
    const file = this.mapIdToFile.get(fileId);
    log(`xWrite ${file?.name ?? fileId} ${pData.size} ${iOffset}`);
    switch (file?.type) {
      case VFS.SQLITE_OPEN_MAIN_DB:
        return file.xWrite(fileId, pData, iOffset);
    }
    return this.fallback.xWrite(fileId, pData, iOffset);
  }

  xTruncate(fileId, iSize) {
    const file = this.mapIdToFile.get(fileId);
    log(`xTruncate ${file?.name ?? fileId} ${iSize}`);
    switch (file?.type) {
      case VFS.SQLITE_OPEN_MAIN_DB:
        return file.xTruncate(fileId, iSize);
    }
    return this.fallback.xTruncate(fileId, iSize);
  }

  xSync(fileId, flags) {
    const file = this.mapIdToFile.get(fileId);
    log(`xSync ${file?.name ?? fileId} ${flags}`);
    switch (file?.type) {
      case VFS.SQLITE_OPEN_MAIN_DB:
        return file.xSync(fileId, flags);
    }
    return this.fallback.xSync(fileId, flags);
  }

  xFileSize(fileId, pSize64) {
    const file = this.mapIdToFile.get(fileId);
    log(`xFileSize ${file?.name ?? fileId}`);
    switch (file?.type) {
      case VFS.SQLITE_OPEN_MAIN_DB:
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
    }
    return this.fallback.xUnlock(fileId, flags);
  }

  xSectorSize(fileId) {
    const file = this.mapIdToFile.get(fileId);
    log(`xSectorSize ${file?.name ?? fileId}`);
    switch (file?.type) {
      case VFS.SQLITE_OPEN_MAIN_DB:
        return file.xSectorSize(fileId);
    }
    return this.fallback.xSectorSize(fileId);
  }

  xDeviceCharacteristics(fileId) {
    const file = this.mapIdToFile.get(fileId);
    log(`xDeviceCharacteristics ${file?.name ?? fileId}`);
    switch (file?.type) {
      case VFS.SQLITE_OPEN_MAIN_DB:
        return file.xDeviceCharacteristics(fileId);
    }
    return this.fallback.xDeviceCharacteristics(fileId);
  }

  xDelete(name, syncDir) {
    log(`xDelete ${name} ${syncDir}`);
    // This is only used for journal files.
    return this.fallback.xDelete(name, syncDir);
  }

  xAccess(name, flags, pResOut) {
    log(`xAccess ${name} ${flags}`);
    // This is only used to detect journal files left by an unexpected
    // termination, which currently can't happen because journal files
    // aren't persistent.
    pResOut.set(0);
    return VFS.SQLITE_OK;
  }
}