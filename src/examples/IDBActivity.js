let nextTxId = 0;
const mapTxToId = new WeakMap();

/**
 * This classes manages IDBTransaction and IDBRequest instances. It tries
 * to chain requests to reduce the number of transactions.
 */
export class IDBActivity {
  /** @type {Array<() => any>} */ #jobs = [];
  /** @type {IDBTransaction} */ #tx = null;
  /** @type {IDBRequest} */ #request = null;

  /**
   * @param {IDBDatabase} db
   * @param {string|string[]} storeNames 
   * @param {IDBTransactionMode} mode 
   */
  constructor(db, storeNames, mode) {
    this.db = db;
    this.storeNames = [storeNames].flat();
    this.mode = mode;
  }

  /**
   * @param {IDBTransactionMode} mode 
   */
  async updateTxMode(mode) {
    // If the transition is from readwrite to readonly, wait until
    // all changes are visible to the new transaction.
    if (this.#tx?.mode === 'readwrite' && mode === 'readonly') {
      await new Promise(complete => {
        this.#tx.addEventListener('complete', complete);
      });
    } else if (mode === 'readwrite' && mode !== this.#tx?.mode) {
      this.#tx = null;
    }
    this.mode = mode;
  }

  /**
   * Run a function with the provided object stores. The function
   * should be idempotent if it is passed an expired transaction.
   * @param {(stores: Object.<string, Store>) => any} f 
   */
  async run(f) {
    // If the last IDBRequest is pending, wait until it is done.
    if (this.#request && this.#request.readyState === 'pending') {
      await new Promise(done => {
        this.#request.addEventListener('success', done);
        this.#request.addEventListener('error', done);
      });
    }

    // Run the user function with a retry in case the transaction is invalid.
    for (let i = 0; i < 2; ++i) {
      if (!this.#tx) {
        this.#tx = this.db.transaction(this.storeNames, this.mode);
        this.#tx.addEventListener('complete', event => {
          if (this.#tx === event.target) {
            this.#tx = null
          }
          // console.log(`transaction ${mapTxToId.get(event.target)} complete`);
        });
        // console.log(`new transaction ${nextTxId}`, this.storeNames, this.mode);
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
        if (i) throw e;
        this.#tx = null;
      }
    }
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
    // console.log(`get ${this.store.name}`, query);
    const request = this.store.get(query);
    return this.addRequest(request);
  }

  /**
   * @param {IDBValidKey|IDBKeyRange} query 
   * @param {number} [count]
   * @returns {Promise}
   */
   getAll(query, count) {
    // console.log(`getAll ${this.store.name}`, query, count);
    const request = this.store.getAll(query);
    return this.addRequest(request);
  }

  /**
   * @param {IDBValidKey|IDBKeyRange} query 
   * @returns {Promise<IDBValidKey>}
   */
  getKey(query) {
    // console.log(`getKey ${this.store.name}`, query);
    const request = this.store.getKey(query);
    return this.addRequest(request);
  }

  /**
   * @param {IDBValidKey|IDBKeyRange} query 
   * @param {number} [count]
   * @returns {Promise}
   */
   getAllKeys(query, count) {
    // console.log(`getAllKeys ${this.store.name}`, query, count);
    const request = this.store.getAllKeys(query);
    return this.addRequest(request);
  }

  /**
   * @param {any} value
   * @param {IDBValidKey} [key] 
   * @returns {Promise}
   */
   put(value, key) {
    // console.log(`put ${this.store.name}`, value, key);
    const request = this.store.put(value, key);
    return this.addRequest(request);
  }

  /**
   * @param {IDBValidKey|IDBKeyRange} query 
   * @returns {Promise}
   */
   delete(query) {
    // console.log(`delete ${this.store.name}`, query);
    const request = this.store.delete(query);
    return this.addRequest(request);
  }

  clear() {
    const request = this.store.clear();
    return this.addRequest(request);
  }
}