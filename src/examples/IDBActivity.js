const RETRYABLE_EXCEPTIONS = new Set(['TransactionInactiveError', 'InvalidStateError']);

// For debugging.
let nextTxId = 0;
const mapTxToId = new WeakMap();
function log(...args) {
  // console.debug(...args);
}

// This class manages IDBTransaction and IDBRequest instances. It tries
// to reuse transactions to minimize transaction overhead.
export class IDBActivity {
  /** @type {IDBTransaction} */ #tx = null;
  /** @type {Promise} */ #txComplete = null;
  /** @type {IDBRequest} */ #request = null;
  #chain = Promise.resolve();

  /**
   * @param {IDBDatabase} db
   * @param {string|string[]} storeNames 
   */
  constructor(db, storeNames) {
    this.db = db;
    this.storeNames = [storeNames].flat();
  }

  /**
   * Run a function with the provided object stores. The function
   * should be idempotent in case it is passed an expired transaction.
   * @param {IDBTransactionMode} mode
   * @param {(stores: Object.<string, Store>) => any} f 
   */
  async run(mode, f) {
    // Ensure that functions run sequentially.
    return this.#chain = this.#chain.then(() => {
      return this.#run(mode, f);
    });
  }

  /**
   * @param {IDBTransactionMode} mode
   * @param {(stores: Object.<string, Store>) => any} f 
   * @returns 
   */
  async #run(mode, f) {
    if (mode !== 'readonly' && this.#tx && this.#tx.mode === 'readonly') {
      this.#tx = null;
    } else if (this.#request && this.#request.readyState === 'pending') {
      // Wait for pending IDBRequest so the IDBTransaction is active.
      await new Promise(done => {
        this.#request.addEventListener('success', done);
        this.#request.addEventListener('error', done);
      });
    }

    // Run the user function with a retry in case the transaction is invalid.
    for (let i = 0; i < 2; ++i) {
      if (!this.#tx) {
        this.#tx = this.db.transaction(this.storeNames, mode);
        this.#txComplete = new Promise(resolve => {
          this.#tx.addEventListener('complete', event => {
            if (this.#tx === event.target) {
              this.#tx = null
            }
            resolve();
            log(`transaction ${mapTxToId.get(event.target)} complete`);
          });
        });
        log(`new transaction ${nextTxId}`, this.storeNames, mode);
        mapTxToId.set(this.#tx, nextTxId++);
      }

      try {
        const stores = Object.fromEntries(this.storeNames.map(name => {
          const objectStore = this.#tx.objectStore(name);
          const store = new Store(objectStore, request => this.#setRequest(request));
          return [name, store];
        }));
        return await f(stores);
      } catch (e) {
        if (i || !RETRYABLE_EXCEPTIONS.has(e.name)) {
          // On failure make sure nothing is committed.
          try { this.#tx.abort() } catch (ignored) {}
          throw e;
        }
        this.#tx = null;
      }
    }
  }

  async sync() {
    const request = this.#request;
    if (request && request.readyState === 'pending') {
      await new Promise(done => {
        request.addEventListener('success', done);
        request.addEventListener('error', done);
      });
      request.transaction.commit();
    }
    return this.#txComplete;
  }

  /**
   * @param {IDBRequest} request 
   */
  #setRequest(request) {
    this.#request = request;
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}

// IDBStore wrapper passed to IDBActivity run functions.
class Store {
  /**
   * @param {IDBObjectStore} store 
   * @param {(request: IDBRequest) => Promise} addRequest
   */
  constructor(store, addRequest) {
    this.store = store;
    this.addRequest = addRequest;
  }

  /**
   * @param {IDBValidKey|IDBKeyRange} query 
   * @returns {Promise}
   */
  get(query) {
    log(`get ${this.store.name}`, query);
    const request = this.store.get(query);
    return this.addRequest(request);
  }

  /**
   * @param {IDBValidKey|IDBKeyRange} query 
   * @param {number} [count]
   * @returns {Promise}
   */
   getAll(query, count) {
    log(`getAll ${this.store.name}`, query, count);
    const request = this.store.getAll(query);
    return this.addRequest(request);
  }

  /**
   * @param {IDBValidKey|IDBKeyRange} query 
   * @returns {Promise<IDBValidKey>}
   */
  getKey(query) {
    log(`getKey ${this.store.name}`, query);
    const request = this.store.getKey(query);
    return this.addRequest(request);
  }

  /**
   * @param {IDBValidKey|IDBKeyRange} query 
   * @param {number} [count]
   * @returns {Promise}
   */
   getAllKeys(query, count) {
    log(`getAllKeys ${this.store.name}`, query, count);
    const request = this.store.getAllKeys(query);
    return this.addRequest(request);
  }

  /**
   * @param {any} value
   * @param {IDBValidKey} [key] 
   * @returns {Promise}
   */
   put(value, key) {
    log(`put ${this.store.name}`, value, key);
    const request = this.store.put(value, key);
    return this.addRequest(request);
  }

  /**
   * @param {IDBValidKey|IDBKeyRange} query 
   * @returns {Promise}
   */
   delete(query) {
    log(`delete ${this.store.name}`, query);
    const request = this.store.delete(query);
    return this.addRequest(request);
  }

  clear() {
    log(`clear ${this.store.name}`);
    const request = this.store.clear();
    return this.addRequest(request);
  }

  index(name) {
    return new Index(this.store.index(name), request => this.addRequest(request));
  }
}

class Index {
  /**
   * @param {IDBIndex} index 
   * @param {(request: IDBRequest) => Promise} addRequest
   */
   constructor(index, addRequest) {
    this.index = index;
    this.addRequest = addRequest;
  }

  /**
   * @param {IDBValidKey|IDBKeyRange} query 
   * @param {number} [count]
   * @returns {Promise<IDBValidKey[]>}
   */
  getAllKeys(query, count) {
    log(`IDBIndex.getAllKeys ${this.index.objectStore.name}<${this.index.name}>`, query, count);
    const request = this.index.getAllKeys(query, count);
    return this.addRequest(request);
  }
}