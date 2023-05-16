// Copyright 2022 Roy T. Hashimoto. All Rights Reserved.

const MAX_TRANSACTION_LIFETIME_MILLIS = 5_000;

// For debugging.
let nextTxId = 0;
const mapTxToId = new WeakMap();
function log(...args) {
  // console.debug(...args);
}

const mapTxToLastRequest = new WeakMap();

// This class manages IDBTransaction and IDBRequest instances. It tries
// to reuse transactions to minimize transaction overhead.
export class IDBContext {
  /** @type {IDBDatabase} */ #db;
  /** @type {Promise<IDBDatabase>} */ #dbReady;
  #txOptions;

  /** @type {IDBTransaction} */ #tx = null;
  #txTimestamp = 0;
  #chain = Promise.resolve();

  /**
   * @param {IDBDatabase|Promise<IDBDatabase>} idbDatabase
   */
  constructor(idbDatabase, txOptions = { durability: 'default' }) {
    this.#dbReady = Promise.resolve(idbDatabase).then(db => this.#db = db);
    this.#txOptions = txOptions;
  }

  async close() {
    const db = this.#db ?? await this.#dbReady;
    db.close();
  }
  
  /**
   * Run a function with the provided object stores. The function
   * should be idempotent in case it is passed an expired transaction.
   * @param {IDBTransactionMode} mode
   * @param {(stores: Object.<string, ObjectStore>) => any} f 
   */
  async run(mode, f) {
    // Ensure that functions run sequentially.
    const result = this.#chain.then(() => this.#run(mode, f));
    this.#chain = result.catch(() => {});
    return result;
  }

  /**
   * @param {IDBTransactionMode} mode
   * @param {(stores: Object.<string, ObjectStore>) => any} f 
   * @returns 
   */
  async #run(mode, f) {
    const db = this.#db ?? await this.#dbReady;
    if ((mode === 'readwrite' && this.#tx?.mode === 'readonly') ||
         performance.now() - this.#txTimestamp > MAX_TRANSACTION_LIFETIME_MILLIS) {
      // if (this.#tx?.mode === 'readwrite') {
      //   await new Promise(resolve => setTimeout(resolve));
      // }

      // Force creation of a new transaction.
      this.#tx = null;
    }

    // Run the user function with a retry in case the transaction is invalid.
    for (let i = 0; i < 2; ++i) {
      if (!this.#tx) {
        // @ts-ignore
        this.#tx = db.transaction(db.objectStoreNames, mode, this.#txOptions);
        this.#txTimestamp = performance.now();
        this.#tx.addEventListener('complete', event => {
          if (this.#tx === event.target) {
            this.#tx = null;
          }
          log(`transaction ${mapTxToId.get(event.target)} complete`);
        });
        this.#tx.addEventListener('abort', event => {
          if (this.#tx === event.target) {
            this.#tx = null;
          }
          // @ts-ignore
          log(`transaction ${mapTxToId.get(event.target)} aborted`, event.target.error);
        });

        log(`new transaction ${nextTxId} ${mode}`);
        mapTxToId.set(this.#tx, nextTxId++);
      }

      try {
        const stores = Object.fromEntries(Array.from(db.objectStoreNames, name => {
          return [name, new ObjectStore(this.#tx.objectStore(name))];
        }));
        return await f(stores);
      } catch (e) {
        this.#tx = null;
        if (i) throw e;
        // console.warn('retrying with new transaction');
      }
    }
  }

  async sync() {
    // Wait until all previously queued request functions have run.
    await this.#chain;
    if (this.#tx) {
      await new Promise(resolve => {
        this.#tx.addEventListener('complete', resolve);
        this.#tx.addEventListener('abort', resolve);
      });
    }
  }
}

/**
 * @param {IDBRequest} request 
 */
function wrapRequest(request) {
  mapTxToLastRequest.set(request.transaction, request);
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });
}

// IDBObjectStore wrapper passed to IDBActivity run functions.
class ObjectStore {
  #objectStore;

  /**
   * @param {IDBObjectStore} objectStore 
   */
  constructor(objectStore) {
    this.#objectStore = objectStore;
  }

  /**
   * @param {IDBValidKey|IDBKeyRange} query 
   * @returns {Promise}
   */
  get(query) {
    log(`get ${this.#objectStore.name}`, query);
    const request = this.#objectStore.get(query);
    return wrapRequest(request);
  }

  /**
   * @param {IDBValidKey|IDBKeyRange} query 
   * @param {number} [count]
   * @returns {Promise}
   */
   getAll(query, count) {
    log(`getAll ${this.#objectStore.name}`, query, count);
    const request = this.#objectStore.getAll(query, count);
    return wrapRequest(request);
  }

  /**
   * @param {IDBValidKey|IDBKeyRange} query 
   * @returns {Promise<IDBValidKey>}
   */
  getKey(query) {
    log(`getKey ${this.#objectStore.name}`, query);
    const request = this.#objectStore.getKey(query);
    return wrapRequest(request);
  }

  /**
   * @param {IDBValidKey|IDBKeyRange} query 
   * @param {number} [count]
   * @returns {Promise}
   */
   getAllKeys(query, count) {
    log(`getAllKeys ${this.#objectStore.name}`, query, count);
    const request = this.#objectStore.getAllKeys(query, count);
    return wrapRequest(request);
  }

  /**
   * @param {any} value
   * @param {IDBValidKey} [key] 
   * @returns {Promise}
   */
   put(value, key) {
    log(`put ${this.#objectStore.name}`, value, key);
    const request = this.#objectStore.put(value, key);
    return wrapRequest(request);
  }

  /**
   * @param {IDBValidKey|IDBKeyRange} query 
   * @returns {Promise}
   */
   delete(query) {
    log(`delete ${this.#objectStore.name}`, query);
    const request = this.#objectStore.delete(query);
    return wrapRequest(request);
  }

  clear() {
    log(`clear ${this.#objectStore.name}`);
    const request = this.#objectStore.clear();
    return wrapRequest(request);
  }

  index(name) {
    return new Index(this.#objectStore.index(name));
  }
}

class Index {
  /** @type {IDBIndex} */ #index;

  /**
   * @param {IDBIndex} index 
   */
   constructor(index) {
    this.#index = index;
  }

  /**
   * @param {IDBValidKey|IDBKeyRange} query 
   * @param {number} [count]
   * @returns {Promise<IDBValidKey[]>}
   */
  getAllKeys(query, count) {
    log(`IDBIndex.getAllKeys ${this.#index.objectStore.name}<${this.#index.name}>`, query, count);
    const request = this.#index.getAllKeys(query, count);
    return wrapRequest(request);
  }
}