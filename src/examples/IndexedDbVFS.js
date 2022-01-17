// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
import * as VFS from '../VFS.js';
import { MemoryVFS } from './MemoryVFS.js';

const WEB_LOCKS = navigator['locks'] ?? console.warn('IndexedDB concurrency is unsafe without Web Locks API');

// Default block size for new databases.
const BLOCK_SIZE = 8192;

const FILE_TYPE_MASK = [
  VFS.SQLITE_OPEN_MAIN_DB,
  VFS.SQLITE_OPEN_MAIN_JOURNAL,
  VFS.SQLITE_OPEN_TEMP_DB,
  VFS.SQLITE_OPEN_TEMP_JOURNAL,
  VFS.SQLITE_OPEN_TRANSIENT_DB,
  VFS.SQLITE_OPEN_SUBJOURNAL,
  VFS.SQLITE_OPEN_SUPER_JOURNAL
].reduce((mask, element) => mask | element);

function log(...args) {
  // console.debug(...args);
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
    this.dbReady = idb(globalThis.indexedDB.open(idbDatabaseName, 2), {
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
    switch (flags & FILE_TYPE_MASK) {
      case VFS.SQLITE_OPEN_MAIN_DB:
        return this.handleAsync(async () => {
          const db = await this.dbReady;
          const file = new DatabaseFile(db);
          this.mapIdToFile.set(fileId, file);
          return file.xOpen(name, fileId, flags, pOutFlags);
        });
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

class DatabaseFile {
  writeCache = new Map();

  lockStatus = VFS.SQLITE_LOCK_NONE;
  lockReleasers = new Map();

  constructor(db) {
    /** @type {IDBDatabase} */ this.db = db;
  }

  get name() { return this.metadata.name; }
  get type() { return this.flags & FILE_TYPE_MASK; }

  async xOpen(name, fileId, flags, pOutFlags) {
    this.flags = flags;

    // Fetch metadata.
    const tx = this.db.transaction('database', 'readwrite');
    const store = tx.objectStore('database');
    this.metadata = await idb(store.get([name, 'metadata']));
    if (!this.metadata) {
      // Files doesn't exist, create if requested.
      if (flags & VFS.SQLITE_OPEN_CREATE) {
        this.metadata = {
          name,
          index: 'metadata',
          fileSize: 0,
          blockSize: BLOCK_SIZE
        };
        store.put(this.metadata);
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

  // xLock/xUnlock use Web Locks API (where supported). The implementation
  // uses two locks, an outer lock and an inner lock, where holding the
  // outer lock is a prerequisite to acquire the inner lock.
  //
  // For read-only access, the inner lock must be held with 'shared'
  // mode.
  //
  // For read-write access, both outer and inner locks must be held
  // with 'exclusive' mode.

  async xLock(fileId, flags) {
    switch (flags) {
      case VFS.SQLITE_LOCK_SHARED:
        switch (this.lockStatus) {
          case VFS.SQLITE_LOCK_NONE:
            await this.acquireWebLock('Outer', 'exclusive');
            await this.acquireWebLock('Inner', 'shared');
            this.releaseWebLock('Outer');
            break;
        }
        break;
      case VFS.SQLITE_LOCK_RESERVED:
        switch (this.lockStatus) {
          case VFS.SQLITE_LOCK_SHARED:
            await this.acquireWebLock('Outer', 'exclusive');
            break;
          default:
            console.error(`unexpected lock transition ${this.lockStatus} -> ${flags}`);
            return VFS.SQLITE_ERROR;
        }
        break;
      case VFS.SQLITE_LOCK_EXCLUSIVE:
        switch (this.lockStatus) {
          case VFS.SQLITE_LOCK_RESERVED:
            this.releaseWebLock('Inner');
            await this.acquireWebLock('Inner', 'exclusive');
            break;
          default:
            console.error(`unexpected lock transition ${this.lockStatus} -> ${flags}`);
            return VFS.SQLITE_ERROR;
          }
        break;
      default:
        console.error(`unexpected lock flag ${flags}`);
        return VFS.SQLITE_ERROR;
    }

    if (this.lockStatus === VFS.SQLITE_LOCK_NONE) {
      this.metadata = await this.getBlock('metadata');
    }

    this.lockStatus = flags;
    return VFS.SQLITE_OK
  }

  async xUnlock(fileId, flags) {
    if (this.lockStatus === VFS.SQLITE_LOCK_EXCLUSIVE && this.writeCache.size) {
      const tx = this.db.transaction('database', 'readwrite');
      const store = tx.objectStore('database');
      for (const block of this.writeCache.values()) {
        store.put(block);
      }
      this.writeCache.clear();
  
      // Remove blocks lost by truncation.
      const range = IDBKeyRange.bound(
        [this.name, (this.metadata.fileSize / this.metadata.blockSize) | 0],
        [this.name, Number.MAX_VALUE])
      store.delete(range);

      await new Promise(resolve => {
        tx.addEventListener('complete', resolve);
        tx.commit();
      });
    }

    switch (flags) {
      case VFS.SQLITE_LOCK_SHARED:
        switch (this.lockStatus) {
          case VFS.SQLITE_LOCK_EXCLUSIVE:  // intentional case fall-through
            this.releaseWebLock('Inner');
            await this.acquireWebLock('Inner', 'shared');
          case VFS.SQLITE_LOCK_RESERVED:
            this.releaseWebLock('Outer');
            break;
        }
        break;
      case VFS.SQLITE_LOCK_NONE:
        switch (this.lockStatus) {
          case VFS.SQLITE_LOCK_EXCLUSIVE:  // intentional case fall-through
          case VFS.SQLITE_LOCK_RESERVED:
            this.releaseWebLock('Outer');
          case VFS.SQLITE_LOCK_SHARED:
            this.releaseWebLock('Inner');
            break;
        }
        break;
      default:
        console.error(`unexpected lock flag ${flags}`);
        return VFS.SQLITE_ERROR;
    }
    this.lockStatus = flags;
    return VFS.SQLITE_OK
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

    // Reuse read transaction if possible. There is no API to determine
    // whether a transaction is active, so just use it and retry if it
    // fails.
    for (let i = 0; i < 2; ++i) {
      if (!this.tx) {
        this.tx = this.db.transaction('database');
        this.tx.oncomplete = ({ target }) => {
          if (this.tx === target) {
            this.tx = null;
          }
        };
      }

      try {
        return idb(this.tx.objectStore('database').get([this.name, index]));
      } catch (e) {
        if (i) throw e;
        log(`new transaction (${e.message})`);
        this.tx = null;
      }
    }
  }

  async acquireWebLock(name, mode) {
    if (WEB_LOCKS) {
      const lockName = `${this.name}-lock-${name}`;
      return new Promise(hasLock => {
        WEB_LOCKS.request(lockName, { mode }, () => new Promise(release => {
          hasLock();
          this.lockReleasers.set(name, release);
        }));
      });
    }
  }

  releaseWebLock(name) {
    this.lockReleasers.get(name)?.();
    this.lockReleasers.delete(name);
  }
}

// Convenience Promisification for IDBRequest.
function idb(request, listeners = {}) {
  return new Promise(function(resolve, reject) {
    listeners = Object.assign({
      'success': () => resolve(request.result),
      'error': () => reject(request.error)
    }, listeners);
    for (const [key, listener] of Object.entries(listeners)) {
      request.addEventListener(key, listener);
    }
  });
}