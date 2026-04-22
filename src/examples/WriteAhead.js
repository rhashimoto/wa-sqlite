import { Lock } from './Lock.js';

const DEFAULT_JOURNAL_SIZE_LIMIT = 1000;
const DEFAULT_BACKSTOP_INTERVAL = 30_000;

const MAGIC = 0x377f0684;
const FILE_HEADER_SIZE = 32;
const FRAME_HEADER_SIZE = 32;
const FRAME_TYPE_PAGE = 0;
const FRAME_TYPE_COMMIT = 1;
const FRAME_TYPE_END = 2;

/**
 * @typedef PageEntry
 * @property {number} waOffset location in WAL file
 * @property {number} waSalt1 WAL2 file identifier
 * @property {number} pageSize
 * @property {Uint8Array} [pageData]
 */

/**
 * @typedef Transaction
 * @property {number} id
 * @property {Map<number, PageEntry>} pages address to page data mapping
 * @property {number} dbFileSize
 * @property {number} [newPageSize]
 * @property {number} waSalt1 WAL2 file identifier
 * @property {number} waOffsetEnd
 */

/**
 * @typedef WriteAheadOptions
 * @property {number} [autoCheckpoint]
 * @property {number} [backstopInterval]
 * @property {number} [journalSizeLimit]
 */

export class WriteAhead {

  log = null;
  /** @type {WriteAheadOptions} */ options = {
    autoCheckpoint: 1,
    backstopInterval: DEFAULT_BACKSTOP_INTERVAL,
    journalSizeLimit: DEFAULT_JOURNAL_SIZE_LIMIT,
  };

  #zName;
  #dbHandle;

  /** @type {FileSystemSyncAccessHandle[]} */ #waHandles;
  /** @type {FileSystemSyncAccessHandle} */ #activeHandle;
  /** @type {{nextTxId: number, salt1: number, salt2: number}} */ #activeHeader;
  /** @type {number} */ #activeOffset;
  /** @type {number} */ #txId = 0;
  /** @type {Transaction} */ #txInProgress = null;

  #dbFileSize = 0;

  /** @type {Promise<any>} */ #ready;
  /** @type {'read'|'write'} */ #isolationState = null;

  /** @type {Lock} */ #txIdLock = null;

  /** @type {Map<number, PageEntry>} */ #waOverlay = new Map();
  /** @type {Map<number, Transaction>} */ #mapIdToTx = new Map();
  /** @type {Map<number, Transaction>} */ #mapIdToPendingTx = new Map();
  #approxPageCount = 0;

  /** @type {BroadcastChannel} */ #broadcastChannel;

  /** @type {number} */ #backstopTimer;
  /** @type {number} */ #backstopTimestamp = 0;

  #abortController = new AbortController();

  /**
   * @param {string} zName
   * @param {FileSystemSyncAccessHandle} dbHandle
   * @param {FileSystemSyncAccessHandle[]} waHandles
   * @param {WriteAheadOptions} options
   */
  constructor(zName, dbHandle, waHandles, options = {}) {
    this.#zName = zName;
    this.#dbHandle = dbHandle;
    this.#waHandles = waHandles;
    this.options = Object.assign(this.options, options);

    // All the asynchronous initialization is done here.
    this.#ready = (async () => {
      // Set our advertised txId to zero until we know the proper value.
      await this.#updateTxIdLock();

      // Listen for transactions and checkpoints from other connections.
      this.#broadcastChannel = new BroadcastChannel(`${zName}#wa`);
      this.#broadcastChannel.onmessage = (event) => {
        this.#handleMessage(event);
      };

      // Read headers from both WAL files and use the one with the
      // lower nextTxId. If neither header is valid, create a new header.
      const fileHeader = this.#waHandles
        .map(handle => this.#readFileHeader(handle))
        .filter(h => h)
        .sort((a, b) => a.nextTxId - b.nextTxId)[0]
        ?? this.#writeFileHeader(Math.floor(Math.random() * 0xffffffff));

      this.#activeHeader = fileHeader;
      this.#activeHandle = this.#waHandles[fileHeader.salt1 & 1];
      this.#activeOffset = FILE_HEADER_SIZE;
      this.#txId = fileHeader.nextTxId - 1;

      // Load all the transactions from the WAL.
      for (const tx of this.#readAllTx()) {
        this.#activateTx(tx);
      }
      this.#updateTxIdLock(); // doesn't need await

      // Schedule backstop. The backstop is a guard against a crash in
      // another context between persisting a transaction and broadcasting
      // it.
      this.#backstopTimestamp = performance.now();
      this.#backstop();
    })();
  }

  /**
   * @returns {Promise<void>}
   */
  ready() {
    return this.#ready;
  }

  close() {
    this.#abortController.abort();

    // Stop asynchronous maintenance.
    this.#broadcastChannel.onmessage = null;
    clearTimeout(this.#backstopTimer);

    this.#txIdLock?.release();
    this.#broadcastChannel.close();
  }

  /**
   * Freeze our view of the database.
   * The view includes the transactions received so far but is not
   * guaranteed to be completely up to date. Unfreeze the view with rejoin().
   */
  isolateForRead() {
    if (this.#isolationState !== null) {
      throw new Error('Already in isolated state');
    }
    this.#isolationState = 'read';

    // Disable backstop during isolation.
    clearTimeout(this.#backstopTimer);
    this.#backstopTimer = null;
  }

  /**
   * Freeze our view of the database for writing.
   * The view includes all transactions. Unfreeze the view with rejoin().
   */
  isolateForWrite() {
    if (this.#isolationState !== null) {
      throw new Error('Already in isolated state');
    }
    this.#isolationState = 'write';

    // Disable backstop during isolation.
    clearTimeout(this.#backstopTimer);
    this.#backstopTimer = null;

    // A writer needs all previous transactions assimilated.
    this.#advanceTxId({ readToCurrent: true });
  }

  rejoin() {
    if (this.#isolationState === 'read') {
      // Catch up on new transactions that arrived while isolated.
      this.#advanceTxId({ autoCheckpoint: true });
    }
    this.#isolationState = null;

    // Resume backstop after isolation.
    this.#backstop();
  }

  /**
   * @param {number} offset
   * @return {Uint8Array?}
   */
  read(offset) {
    // First look for the page in any write transaction in progress.
    // If the page is not found in the transaction overlay, look in the
    // write-ahead overlay.
    const pageEntry = this.#txInProgress?.pages.get(offset) ?? this.#waOverlay.get(offset);
    if (pageEntry) {
      if (pageEntry.pageData) {
        // Page data is cached.
        this.log?.(`%cread page at ${offset} from WAL ${pageEntry.waSalt1 & 1}:${pageEntry.waOffset} (cached)`, 'background-color: gold;');
        return pageEntry.pageData;
      }

      // Read the page from the WAL file.
      this.log?.(`%cread page at ${offset} from WAL ${pageEntry.waSalt1 & 1}:${pageEntry.waOffset}`, 'background-color: gold;');
      return this.#fetchPage(pageEntry);
    }
    return null;
  }

  /**
   * @param {number} offset
   * @param {Uint8Array} data
   * @param {{dstPageSize: number?}} options
   */
  write(offset, data, options) {
    if (this.#isolationState !== 'write') {
      throw new Error('Not in write isolated state');
    }

    if (!this.#txInProgress) {
      // There is no active transaction so we need to create one. But
      // first check whether to move to the other WAL file.
      const nPageThreshold = this.options.journalSizeLimit > 0 ?
        this.options.journalSizeLimit :
        DEFAULT_JOURNAL_SIZE_LIMIT;
      if (this.#approxPageCount >= nPageThreshold && this.#isInactiveFileEmpty()) {
        this.log?.(`%cchange WAL file at ${this.#approxPageCount} pages`, 'background-color: lightskyblue;');
        this.#swapActiveFile();
      }

      this.#beginTx();
      if (options.dstPageSize !== data.byteLength) {
        // This is a VACUUM to a new page size. The incoming writes are at
        // the old page size, but we want to write to the WAL with the new
        // size.
        this.#txInProgress.newPageSize = options.dstPageSize;
      }
    }

    if (this.#txInProgress.newPageSize) {
      // The incoming data is not a single page because the page size
      // is changing. The two cases are when the new page size is
      // smaller or larger than the old page size.
      const frameSize = FRAME_HEADER_SIZE + this.#txInProgress.newPageSize;
      if (data.byteLength > this.#txInProgress.newPageSize) {
        // New page size is smaller. Write multiple pages of the new
        // page size.
        for (let i = 0; i < data.byteLength; i += this.#txInProgress.newPageSize) {
          const pageData = data.slice(i, i + this.#txInProgress.newPageSize);
          const waOffset = this.#writePage(offset + i, pageData);
          this.log?.(`%cwrite page at ${offset + i} to WAL ${this.#activeHeader.salt1 & 1}:${waOffset}`, 'background-color: lightskyblue;');
        }
      } else {
        // New page size is larger. Save the page data to the WAL file
        // so it can be read back and rewritten as frames with the new
        // page size.
        const pageOffset = offset % this.#txInProgress.newPageSize;
        const waOffset = this.#activeOffset +
          (offset - pageOffset) / this.#txInProgress.newPageSize * frameSize +
          FRAME_HEADER_SIZE +
          pageOffset;
        this.#activeHandle.write(data.subarray(), { at: waOffset });
        this.log?.(`%cwrite page at ${offset} to WAL ${this.#activeHeader.salt1 & 1}:${waOffset}`, 'background-color: lightskyblue;');
      }
    } else {
      // This is the normal case without a page size change.
      const waOffset = this.#writePage(offset, data.slice());
      this.log?.(`%cwrite page at ${offset} to WAL ${this.#activeHeader.salt1 & 1}:${waOffset}`, 'background-color: lightskyblue;');
    }
  }

  /**
   * @param {number} newSize
   */
  truncate(newSize) {
    // Ignore truncation that happens outside of a transaction. That
    // only happens (e.g. post-VACUUM) to ensure the file size matches
    // the database header.
    if (this.#txInProgress) {
      // Remove any pages past the truncation point.
      for (const offset of this.#txInProgress.pages.keys()) {
        if (offset >= newSize) {
          this.#txInProgress.pages.delete(offset);
        }
      }
    }
  }

  getFileSize() {
    return this.#txInProgress?.dbFileSize ?? this.#dbFileSize;
  }

  commit() {
    const tx = this.#txInProgress;
    if (tx.newPageSize && tx.pages.size === 0) {
      // This transaction is a VACUUM with a page size increase. All
      // the database pages have been written to the WAL file at their
      // new size with blank frame headers. Read the page data back
      // from the WAL file and rewrite as frames.
      let pageCount = 1; // to be replaced on the first iteration
      for (let i = 0; i < pageCount; i++) {
        // Read the page data.
        const pageData = new Uint8Array(tx.newPageSize);
        const waOffset = this.#activeOffset +
          i * (FRAME_HEADER_SIZE + tx.newPageSize) +
          FRAME_HEADER_SIZE;
        this.#activeHandle.read(pageData, { at: waOffset });

        if (i === 0) {
          // Get the actual page count from the file header.
          const headerView = new DataView(pageData.buffer);
          pageCount = headerView.getUint32(28);
        }

        // Write back as a frame.
        this.#writePage(i * tx.newPageSize, pageData);
      }
    }

    const page1 = this.#txInProgress.pages.get(0)?.pageData;
    if (page1) {
      const page1View = new DataView(page1.buffer, page1.byteOffset, page1.byteLength);
      const pageCount = page1View.getUint32(28);
      this.#txInProgress.dbFileSize = pageCount * page1.byteLength;
    } else {
      // The transaction doesn't include page 1, so this must be a
      // non-batch-atomic rollback.
      this.rollback();
      return;
    }

    // Persist the final pending transaction page with the database size.
    this.#commitTx();

    // Incorporate the transaction locally.
    this.#activateTx(tx);
    this.#updateTxIdLock();

    // Send the transaction to other connections.
    const payload = { type: 'tx', tx };
    this.#broadcastChannel.postMessage(payload);

    this.#autoCheckpoint();
    this.#backstopTimestamp = performance.now();
  }

  rollback() {
    // Discard transaction pages.
    this.#abortTx();
  }

  /**
   * @param {{durability: 'strict'|'relaxed'}} options
   */
  sync(options) {
    if (options.durability === 'strict') {
      this.#flushActiveFile();
    }
  }

  /**
   * Move pages from write-ahead to main database file.
   *
   * @param {{isPassive: boolean}} options
   */
  async checkpoint(options = { isPassive: true }) {
    // Passive checkpointing is abandoned if another connection is
    // already checkpointing.
    const lockOptions = {
      ifAvailable: options.isPassive,
    };

    await navigator.locks.request(`${this.#zName}#ckpt`, lockOptions, async lock => {
      if (!lock) return;
      if (this.#abortController.signal.aborted) return;

      let ckptId = this.#getActiveFileStartingTxId() - 1;
      if (options.isPassive) {
        if (!this.#mapIdToTx.has(ckptId)) {
          // There are no transactions to checkpoint.
          return;
        }

        // Scan the txId locks to find the oldest txId.
        const busyTxId = (await this.#getTxIdLocks())
          .reduce((min, value) => Math.min(min, value.maxTxId), this.#txId);

        if (busyTxId < ckptId) {
          // The inactive WAL file is still being used.
          return;
        }
      } else {
        // Wait for all connections to reach the current txId.
        await this.#waitForTxIdLocks(value => value.maxTxId >= this.#txId);
        ckptId = this.#txId;
      }
      this.log?.(`%ccheckpoint through txId ${ckptId}`, 'background-color: lightgreen;');

      // Sync the WAL file. This ensures that if there is a crash after
      // part of the WAL has been copied, the uncopied part will still be
      // available afterwards.
      this.#flushInactiveFile();
      if (!options.isPassive) {
        this.#flushActiveFile();
      }

      // Starting at ckptId and going backwards (higher to lower txId),
      // write transaction pages to the main database file. Do not overwrite
      // a page written by a more recent transaction.
      const writtenOffsets = new Set();
      let dbFileSize = this.#dbHandle.getSize();
      for (let tx = this.#mapIdToTx.get(ckptId); tx; tx = this.#mapIdToTx.get(tx.id - 1)) {
        if (tx.id === ckptId && dbFileSize !== tx.dbFileSize) {
          // Set the file size from the latest transaction.
          dbFileSize = tx.dbFileSize;
          this.#dbHandle.truncate(dbFileSize);
        }

        for (const [offset, pageEntry] of tx.pages) {
          if (offset < dbFileSize && !writtenOffsets.has(offset)) {
            // Fetch the page data from the WAL file if not cached.
            const pageData = pageEntry.pageData ?? this.#fetchPage(pageEntry);

            // Write the page to the database file.
            const nWritten = this.#dbHandle.write(pageData, { at: offset });
            if (nWritten !== pageData.byteLength) {
              throw new Error('Checkpoint write failed');
            }
            writtenOffsets.add(offset);
            this.log?.(`%ccheckpoint wrote txId ${tx.id} page at ${offset} to database`, 'background-color: lightgreen;');
          }
        }

        if (tx.newPageSize) {
          // This transaction used a new page size to overwrite the entire
          // database file so no older pages need to be written. This is
          // not just an optimization; it prevents incorrectly writing
          // older smaller pages at addresses that aren't multiples of
          // the new page size.
          break;
        }
      }

      // Ensure that database writes are durable.
      this.log?.(`%ccheckpoint flush database file`, 'background-color: lightgreen;');
      this.#dbHandle.flush();

      // Notify other connections and ourselves of the checkpoint.
      this.#broadcastChannel.postMessage({
        type: 'ckpt',
        ckptId,
      });
      this.#handleCheckpoint(ckptId);

      // Wait for all connections to update their overlay.
      this.log?.(`%ccheckpoint waiting for connection updates`, 'background-color: lightgreen;');
      await this.#waitForTxIdLocks(value => value.minTxId > ckptId);

      // Truncate the inactive WAL file. This prevents new connections from
      // unnecessarily reading checkpointed data, and allows writers to make
      // it active when their conditions are met.
      this.#truncateInactiveFile();
      this.log?.(`%ccheckpoint complete`, 'background-color: lightgreen;');
    });
  }

  /**
   * Return the approximate number of write-ahead pages. This is the
   * sum of the number of unique page indices for each transaction,
   * so it can be fewer than the number of pages if any transaction
   * contains multiple frames for the same page.
   * @returns {number}
   */
  getWriteAheadSize() {
    return this.#approxPageCount;
  }

  isTransactionPending() {
    return !!this.#txInProgress;
  }

  setBackstopInterval(intervalMillis) {
    this.options.backstopInterval = intervalMillis;
    if (intervalMillis > 0 && this.#isolationState) {
      this.#backstop();
    }
  }

  /**
   * Incorporate a transaction into our view of the database.
   * @param {Transaction} tx
   */
  #activateTx(tx) {
    // Transfer to the active collection of transactions.
    this.#mapIdToTx.set(tx.id, tx);
    this.#approxPageCount += tx.pages.size;

    // Add transaction pages to the write-ahead overlay.
    for (const [offset, pageEntry] of tx.pages) {
      this.#waOverlay.set(offset, pageEntry);
    }
    this.#dbFileSize = tx.dbFileSize;
  }

  /**
   * Advance the local view of the database. By default, advance to the
   * last broadcast transaction. Optionally, also advance through any
   * additional transactions in the WAL file to be fully current.
   *
   * @param {{readToCurrent?: boolean, autoCheckpoint?: boolean}} options
   */
  #advanceTxId(options = {}) {
    let didAdvance = false;
    while (this.#mapIdToPendingTx.size) {
      // Fetch the next transaction in sequence. Usually this will come
      // from pendingTx, but if it is missing then read it from the file.
      const nextTxId = this.#txId + 1;
      let tx;
      if (this.#mapIdToPendingTx.has(nextTxId)) {
        // This transaction arrived via message.
        tx = this.#mapIdToPendingTx.get(nextTxId);
        this.#mapIdToPendingTx.delete(tx.id);

        // Move the WAL file offset past this transaction.
        this.#skipTx(tx);
      } else {
        // Read the transaction from the WAL file.
        tx = this.#readTx();
      }

      this.#activateTx(tx);
      didAdvance = true;
    }

    if (options.readToCurrent) {
      // Read all additional transactions from the WAL file.
      for (const tx of this.#readAllTx()) {
        this.#activateTx(tx);
        didAdvance = true;
      }
    }

    if (didAdvance) {
      // Publish our new view txId.
      this.#updateTxIdLock();

      if (options.autoCheckpoint) {
        this.#autoCheckpoint();
      }
    }

    if (options.readToCurrent || didAdvance) {
      // The WAL has been accessed, so reset the backstop.
      // Calling #backstop() here is not necessary because if we are
      // in an isolated state then rejoin() will schedule the next call,
      // and if we are not in an isolated state then the next call
      // should already be scheduled.
      this.#backstopTimestamp = performance.now();
    }
  }

  #autoCheckpoint() {
    if (this.options.autoCheckpoint > 0) {
      this.checkpoint({ isPassive: true });
    }
  }

  /**
   * After a checkpoint, remove checkpointed pages from write-ahead.
   * The checkpoint may be been done locally or by another connection.
   * @param {number} ckptId
   */
  #handleCheckpoint(ckptId) {
    this.log?.(`%capply checkpoint through txId ${ckptId}`, 'background-color: lightgreen;');

    // Loop backwards from ckptId.
    for (let tx = this.#mapIdToTx.get(ckptId); tx; tx = this.#mapIdToTx.get(tx.id - 1)) {
      // Remove pages from write-ahead overlay.
      for (const [offset, pageEntry] of tx.pages.entries()) {
        // Be sure not to remove a newer version of the page.
        const overlayEntry = this.#waOverlay.get(offset);
        if (overlayEntry === pageEntry) {
          this.log?.(`%cremove txId ${tx.id} page at offset ${offset}`, 'background-color: lightgreen;');
          this.#waOverlay.delete(offset);
        }
      }

      // Remove transaction.
      this.#mapIdToTx.delete(tx.id);
      this.#approxPageCount -= tx.pages.size;
    }
    this.#updateTxIdLock();
  }

  /**
   * @param {MessageEvent} event
   */
  #handleMessage(event) {
    if (event.data.type === 'tx') {
      // New transaction from another connection. Don't use it if we
      // already have it.
      /** @type {Transaction} */ const tx = event.data.tx;
      if (tx.id > this.#txId) {
        this.#mapIdToPendingTx.set(tx.id, tx);
        if (this.#isolationState === null) {
          // Not in an isolated state, so advance our view of the database.
          this.#advanceTxId({ autoCheckpoint: true });
        }
      }
    } else if (event.data.type === 'ckpt') {
      // Checkpoint notification from another connection.
      /** @type {number} */ const ckptId = event.data.ckptId;
      this.#handleCheckpoint(ckptId);
    }
  }

  /**
   * Periodic check for recovering from lost transaction broadcasts.
   */
  #backstop() {
    if (this.options.backstopInterval <= 0) {
      // Backstop is disabled.
      return;
    }

    if (this.#isolationState) {
      throw new Error('Backstop was invoked in an isolated state');
    }

    const now = performance.now();
    if (now >= this.#backstopTimestamp + this.options.backstopInterval) {
      // The time since the last WAL access (read, write, or skip) has
      // exceeded the backstop interval. Check for transactions in the
      // write-ahead log that have not arrived via message.
      const oldTxId = this.#txId;
      this.#advanceTxId({ readToCurrent: true });
      if (this.#txId > oldTxId) {
        this.log?.(`%cbackstop txId ${oldTxId} -> ${this.#txId}`, 'background-color: lightyellow;');
      }
      this.#backstopTimestamp = performance.now();
    }

    // Schedule next backstop.
    const delay = this.#backstopTimestamp + this.options.backstopInterval - performance.now();
    clearTimeout(this.#backstopTimer);
    this.#backstopTimer = self.setTimeout(() => {
      this.#backstop();
    }, delay);
  }

  /**
   * Update the lock that publishes our current txId.
   */
  async #updateTxIdLock() {
    // Our view of the database, i.e. the txId, is encoded into the name
    // of a lock so other connections can see it. When our txId changes,
    // we acquire a new lock and release the old one. We must not release
    // the old lock until the new one is in place.
    const oldLock = this.#txIdLock;
    const newLockName = this.#encodeTxIdLockName();
    if (oldLock?.name !== newLockName) {
      this.#txIdLock = new Lock(newLockName);
      await this.#txIdLock.acquire('shared').then(() => {
        // The new lock is acquired.
        oldLock?.release();
      });

      if (this.log) {
        const { minTxId, maxTxId } = this.#decodeTxIdLockName(newLockName);
        this.log?.(`%ctxId to ${minTxId}:${maxTxId}`, 'background-color: pink;');
      }
    }
  }

  /**
   * Get all txId locks for this database.
   * @returns {Promise<{name: string, minTxId: number, maxTxId: number, encoded: string}[]>}
   */
  async #getTxIdLocks() {
    const { held } = await navigator.locks.query();
    return held
      .map(lock => this.#decodeTxIdLockName(lock.name))
      .filter(value => value !== null);
  }

  /**
   * @returns {string}
   */
  #encodeTxIdLockName() {
    // The maxTxId is our current view of the database. The minTxId is
    // the lowest txId we get pages from the WAL for, which is the lowest
    // key in mapIdToTx. If mapIdToTx is empty then we aren't reading
    // from the WAL at all - in this case we arbitrarily set minTxId to
    // invalid value maxTxId + 1.
    //
    // Use radix 36 to encode integer values to reduce the lock name length.
    const maxTxId = this.#txId;
    const minTxId = this.#mapIdToTx.keys().next().value ?? (maxTxId + 1);
    return `${this.#zName}-txId<${minTxId.toString(36)}:${maxTxId.toString(36)}>`;
  }

  /**
   * @param {string} lockName
   * @returns {{name: string, minTxId: number, maxTxId: number, encoded: string}?}
   */
  #decodeTxIdLockName(lockName) {
    const match = lockName.match(/^(.*)-txId<([0-9a-z]+):([0-9a-z]+)>$/);
    if (match?.[1] === this.#zName) {
      // This txId lock is for this database.
      return {
        name: match[1],
        minTxId: parseInt(match[2], 36),
        maxTxId: parseInt(match[3], 36),
        encoded: lockName
      };
    }
    return null;
  }

  /**
   * Wait for all txId locks that fail the provided predicate.
   * @param {(lock: {name: string, minTxId: number, maxTxId: number}) => boolean} predicate
   */
  async #waitForTxIdLocks(predicate) {
    /** @type {string[]} */ let failingLockNames = [];
    do {
      // Wait for all connections that fail the predicate.
      if (failingLockNames.length > 0) {
        await Promise.all(
          failingLockNames.map(name => navigator.locks.request(name, async () => {}))
        );
      }

      // Refresh the list of failing locks.
      failingLockNames = (await this.#getTxIdLocks())
        .filter(value => !predicate(value))
        .map(value => value.encoded);
    } while (failingLockNames.length > 0);
  }

  /**
   * @param {PageEntry} pageEntry
   * @returns {Uint8Array}
   */
  #fetchPage(pageEntry) {
    // Get the appropriate access handle based on salt parity.
    const accessHandle = this.#waHandles[pageEntry.waSalt1 & 1];

    // Read the page.
    const pageData = new Uint8Array(pageEntry.pageSize);
    const nBytesRead = accessHandle.read(pageData, { at: pageEntry.waOffset });

    if (nBytesRead !== pageEntry.pageSize) {
      throw new Error(`Short WAL read: expected ${pageEntry.pageSize} bytes, got ${nBytesRead}`);
    }
    return pageData;
  }

  *#readAllTx() {
    while (true) {
      const tx = this.#readTx();
      if (!tx) break;
      yield tx;
    }
  }

  /**
   * @returns {Transaction?}
   */
  #readTx() {
    // Read the next complete transaction or return null.
    /** @type {Transaction} */ const tx = {
      id: 0, // placeholder
      pages: new Map(),
      dbFileSize: 0, // placeholder
      waSalt1: 0, // placeholder
      waOffsetEnd: 0, // placeholder
    };

    // The property this.#activeOffset is only advanced on a successful
    // transition to the other WAL file or on reading a complete
    // transaction. Use a local variable to track our progress.
    let offset = this.#activeOffset;
    while (true) {
      const frame = this.#readFrame(offset);
      if (!frame) return null;

      if (frame.frameType === FRAME_TYPE_PAGE) {
        tx.pages.set(
          frame.pageOffset,
          {
            pageSize: frame.pageData.byteLength,
            waOffset: offset + FRAME_HEADER_SIZE,
            waSalt1: this.#activeHeader.salt1,
          }
        );
      } else if (frame.frameType === FRAME_TYPE_COMMIT) {
        // The transaction is complete. Update the instance state.
        this.#txId += 1;
        this.#activeOffset = offset + frame.byteLength;

        // Finalize the transaction fields and return it.
        tx.id = this.#txId;
        tx.dbFileSize = frame.dbFileSize;
        tx.waSalt1 = this.#activeHeader.salt1;
        tx.newPageSize = (frame.flags & 1) ? tx.pages.get(0).pageSize : null;
        tx.waOffsetEnd = this.#activeOffset;
        return tx;
      } else if (frame.frameType === FRAME_TYPE_END) {
        // No more transactions on the current WAL file. Switch to the
        // other file.
        this.#followFileChange(frame.fileHeader);
        offset = this.#activeOffset;
        continue;
      }

      offset += frame.byteLength;
    }
  }

  /**
   * This method is called when transaction(s) have been received by other
   * means than readTx(), e.g. via BroadcastChannel.
   *
   * @param {Transaction} tx
   */
  #skipTx(tx) {
    if (tx.waSalt1 !== this.#activeHeader.salt1) {
      // This transaction is on the other WAL file.
      if (!this.#followFileChange(null)) {
        throw new Error('invalid WAL file');
      }
    }

    this.#txId = tx.id;
    this.#activeOffset = tx.waOffsetEnd;
  }

  /**
   * @param {{overwrite?: boolean}} options
   * @returns {Transaction}
   */
  #beginTx(options = {}) {
    this.#txInProgress = {
      id: this.#txId + 1,
      pages: new Map(),
      dbFileSize: this.#dbFileSize,
      waSalt1: this.#activeHeader.salt1,
      waOffsetEnd: this.#activeOffset,
    };
    return this.#txInProgress;
  }

  /**
   * Write a page frame to the WAL file.
   *
   * @param {number} pageOffset
   * @param {Uint8Array} pageData
   */
  #writePage(pageOffset, pageData) {
    const headerView = new DataView(new ArrayBuffer(FRAME_HEADER_SIZE));
    headerView.setUint8(0, FRAME_TYPE_PAGE);
    headerView.setUint16(2, pageData.byteLength === 65536 ? 1 : pageData.byteLength);
    headerView.setBigUint64(8, BigInt(pageOffset));
    headerView.setUint32(16, this.#activeHeader.salt1);
    headerView.setUint32(20, this.#activeHeader.salt2);

    const checksum = new Checksum();
    checksum.update(new Uint8Array(headerView.buffer, 0, FRAME_HEADER_SIZE - 8));
    checksum.update(pageData);
    headerView.setUint32(24, checksum.s0);
    headerView.setUint32(28, checksum.s1);

    const bytesWritten =
      this.#activeHandle.write(headerView, { at: this.#txInProgress.waOffsetEnd }) +
      this.#activeHandle.write(pageData, {
        at: this.#txInProgress.waOffsetEnd + FRAME_HEADER_SIZE,
      });
    if (bytesWritten !== headerView.byteLength + pageData.byteLength) {
      throw new Error('write failed');
    }

    // Cache page 1 as a performance optimization and to exercise the
    // cache code path.
    const pageEntry = {
      pageSize: pageData.byteLength,
      waOffset: this.#txInProgress.waOffsetEnd + FRAME_HEADER_SIZE,
      waSalt1: this.#activeHeader.salt1,
      pageData: pageOffset === 0 ? pageData : undefined
    };
    this.#txInProgress.pages.set(pageOffset, pageEntry);
    this.#txInProgress.waOffsetEnd += bytesWritten;

    return pageEntry.waOffset;
  }

  /**
   * @returns {Transaction}
   */
  #commitTx() {
    // Write a commit frame - which is a special frame header with no
    // body - to the WAL file.
    const headerView = new DataView(new ArrayBuffer(FRAME_HEADER_SIZE));
    headerView.setUint8(0, FRAME_TYPE_COMMIT);
    headerView.setUint8(1, this.#txInProgress.newPageSize ? 1 : 0);
    headerView.setBigUint64(8, BigInt(this.#txInProgress.dbFileSize));
    headerView.setUint32(16, this.#activeHeader.salt1);
    headerView.setUint32(20, this.#activeHeader.salt2);

    const checksum = new Checksum();
    checksum.update(new Uint8Array(headerView.buffer, 0, FRAME_HEADER_SIZE - 8));
    headerView.setUint32(24, checksum.s0);
    headerView.setUint32(28, checksum.s1);

    const bytesWritten = this.#activeHandle.write(headerView, {
      at: this.#txInProgress.waOffsetEnd,
    });
    if (bytesWritten !== headerView.byteLength) {
      throw new Error('write failed');
    }
    this.#txInProgress.waOffsetEnd += bytesWritten;

    const tx = this.#txInProgress;
    this.#txInProgress = null;
    this.#activeOffset = tx.waOffsetEnd;
    this.#txId = tx.id;
    return tx;
  }

  #abortTx() {
    this.#txInProgress = null;
    this.#activeHandle.truncate(this.#activeOffset);
  }

  /**
   * Switch the active WAL file prior to writing the next transaction.
   */
  #swapActiveFile() {
    // Write an end frame to terminate the currently active WAL file.
    const frameView = new DataView(new ArrayBuffer(FRAME_HEADER_SIZE));
    frameView.setUint8(0, FRAME_TYPE_END);
    frameView.setUint32(16, this.#activeHeader.salt1);
    frameView.setUint32(20, this.#activeHeader.salt2);

    const checksum = new Checksum();
    checksum.update(new Uint8Array(frameView.buffer, 0, FRAME_HEADER_SIZE - 8));
    frameView.setUint32(24, checksum.s0);
    frameView.setUint32(28, checksum.s1);

    const bytesWritten = this.#activeHandle.write(frameView, { at: this.#activeOffset });
    if (bytesWritten !== frameView.byteLength) {
      throw new Error('write failed');
    }

    // Initialize the other WAL file and make it active.
    this.#activeHeader = this.#writeFileHeader();
    this.#activeHandle = this.#getInactiveHandle();
    this.#activeOffset = FILE_HEADER_SIZE;
  }

  #getActiveFileStartingTxId() {
    return this.#activeHeader.nextTxId;
  }

  #flushActiveFile() {
    this.#activeHandle.flush();
  }

  #flushInactiveFile() {
    const accessHandle = this.#getInactiveHandle();
    accessHandle.flush();
  }

  #isInactiveFileEmpty() {
    if (this.#mapIdToTx.has(this.#activeHeader.nextTxId - 1)) {
      // At least one transaction on the inactive file has not been
      // checkpointed.
      return false;
    }

    const inactiveHandle = this.#getInactiveHandle();
    if (inactiveHandle.getSize() < FILE_HEADER_SIZE) {
      // The inactive file is smaller than the minimum size for a valid
      // WAL file.
      return true;
    }

    // This test is sufficient by itself but the previous tests are
    // less expensive.
    return this.#readFileHeader(inactiveHandle) === null;
  }

  #truncateInactiveFile() {
    const accessHandle = this.#getInactiveHandle();
    accessHandle.truncate(0);
  }

  /**
   * This method is called after reading an end frame to switch to the
   * other WAL file.
   * @param {{nextTxId: number, salt1: number, salt2: number}?} fileHeader
   */
  #followFileChange(fileHeader) {
    // As an optimization, the file header can be passed as an argument
    // if it has already been read and validated. Otherwise that is
    // done here.
    const accessHandle = this.#getInactiveHandle();
    if (!fileHeader) {
      fileHeader = this.#readFileHeader(accessHandle);
      if (fileHeader?.salt1 !== ((this.#activeHeader.salt1 + 1) >>> 0)) return null;
    }

    this.#activeHandle = accessHandle;
    this.#activeHeader = fileHeader;
    this.#activeOffset = FILE_HEADER_SIZE;
    return fileHeader;
  }

  #getInactiveHandle() {
    return this.#activeHandle !== this.#waHandles[0] ?
      this.#waHandles[0] :
      this.#waHandles[1];
  }

  /**
   * @param {FileSystemSyncAccessHandle} accessHandle
   */
  #readFileHeader(accessHandle) {
    const headerView = new DataView(new ArrayBuffer(FILE_HEADER_SIZE));
    if (accessHandle.read(headerView, { at: 0 }) !== headerView.byteLength) {
      return null;
    }

    if (headerView.getUint32(0) !== MAGIC) return null;

    const checksum = new Checksum();
    checksum.update(new Uint8Array(headerView.buffer, 0, FILE_HEADER_SIZE - 8));
    if (!checksum.matches(headerView.getUint32(24), headerView.getUint32(28))) {
      return null;
    }

    return {
      nextTxId: Number(headerView.getBigUint64(8)),
      salt1: headerView.getUint32(16),
      salt2: headerView.getUint32(20),
    };
  }

  /**
   * @param {number} offset
   */
  #readFrame(offset) {
    const headerView = new DataView(new ArrayBuffer(FRAME_HEADER_SIZE));
    if (this.#activeHandle.read(headerView, { at: offset }) !== headerView.byteLength) {
      // EOF, not an error.
      return null;
    }

    // Verify the frame header salt values match the file header.
    const frameSalt1 = headerView.getUint32(16);
    const frameSalt2 = headerView.getUint32(20);
    if (frameSalt1 !== this.#activeHeader.salt1 || frameSalt2 !== this.#activeHeader.salt2) {
      // Not necessarily an error, could be from a restart without truncation.
      return null;
    }

    const payloadSize = (size => size === 1 ? 65536 : size)(headerView.getUint16(2));
    /** @type {Uint8Array} */ let payloadData;
    if (payloadSize) {
      payloadData = new Uint8Array(payloadSize);
      const payloadBytesRead = this.#activeHandle.read(
        payloadData,
        { at: offset + FRAME_HEADER_SIZE }
      );
      if (payloadBytesRead !== payloadSize) return null;
    }

    const checksum = new Checksum();
    checksum.update(new Uint8Array(headerView.buffer, 0, FRAME_HEADER_SIZE - 8));
    if (payloadData) {
      checksum.update(payloadData);
    }
    if (!checksum.matches(headerView.getUint32(24), headerView.getUint32(28))) {
      // Not necessarily an error, could be from a restart without truncation.
      return null;
    }

    const frameType = headerView.getUint8(0);
    if (frameType === FRAME_TYPE_PAGE) {
      return {
        frameType,
        byteLength: FRAME_HEADER_SIZE + payloadSize,
        pageOffset: Number(headerView.getBigUint64(8)),
        pageData: payloadData,
      };
    } else if (frameType === FRAME_TYPE_COMMIT) {
      return {
        frameType,
        byteLength: FRAME_HEADER_SIZE,
        flags: headerView.getUint8(1),
        dbFileSize: Number(headerView.getBigUint64(8)),
      };
    } else if (frameType === FRAME_TYPE_END) {
      // Handling the end frame and new file header must be atomic, so
      // we validate the new file header before returning the frame.
      // If the file header is corrupt, the end frame effectively does
      // not exist.
      //
      // A corrupt file header should be repaired by the next writer
      // that attempts to swap WAL files.
      const fileHeader = this.#readFileHeader(this.#getInactiveHandle());
      if (fileHeader?.salt1 !== ((this.#activeHeader.salt1 + 1) >>> 0)) return null;

      return {
        frameType,
        byteLength: FRAME_HEADER_SIZE,
        fileHeader,
      };
    }
    throw new Error(`Invalid frame type: ${frameType}`);
  }

  #writeFileHeader(prevSalt1 = this.#activeHeader.salt1) {
    // Derive new values from the previous values.
    const nextTxId = this.#txId + 1;
    const salt1 = (prevSalt1 + 1) >>> 0;
    const salt2 = Math.floor(Math.random() * 0xffffffff) >>> 0;
    const headerView = new DataView(new ArrayBuffer(FILE_HEADER_SIZE));
    headerView.setUint32(0, MAGIC);
    headerView.setBigUint64(8, BigInt(nextTxId));
    headerView.setUint32(16, salt1);
    headerView.setUint32(20, salt2);

    const checksum = new Checksum();
    checksum.update(new Uint8Array(headerView.buffer, 0, FILE_HEADER_SIZE - 8));
    headerView.setUint32(24, checksum.s0);
    headerView.setUint32(28, checksum.s1);

    // The even/odd parity of salt1 determines which file is written to.
    const accessHandle = this.#waHandles[salt1 & 1];
    const bytesWritten = accessHandle.write(headerView, { at: 0 });
    if (bytesWritten !== headerView.byteLength) {
      throw new Error('write failed');
    }

    return { nextTxId, salt1, salt2 };
  }
}

// https://www.sqlite.org/fileformat.html#checksum_algorithm
class Checksum {
  /** @type {number} */ s0 = 0;
  /** @type {number} */ s1 = 0;

  /**
   * @param {ArrayBuffer|ArrayBufferView} data
   */
  update(data) {
    if ((data.byteLength % 8) !== 0) throw new Error('Data must be a multiple of 8 bytes');
    const words = ArrayBuffer.isView(data) ?
      new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4) :
      new Uint32Array(data);
    for (let i = 0; i < words.length; i += 2) {
      this.s0 = (this.s0 + words[i] + this.s1) >>> 0;
      this.s1 = (this.s1 + words[i + 1] + this.s0) >>> 0;
    }
  }

  matches(s0, s1) {
    return this.s0 === s0 && this.s1 === s1;
  }
}
