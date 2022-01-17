/**
 * Convert IDBRequest to a Promise.
 * @param {IDBRequest} request 
 * @param {object} listeners 
 * @returns 
 */
export function promisify(request, listeners = {}) {
  return new Promise(function(resolve, reject) {
    for (const [key, listener] of Object.entries(listeners)) {
      request.addEventListener(key, listener);
    }
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.result), { once: true });
  });
}

/**
 * Convenience class to cache and reuse transactions for a single object store.
 */
export class StoreManager {
  /** @type {?IDBTransaction} */ tx = null;

  /**
   * @param {IDBDatabase} db 
   * @param {string} storeName 
   */
  constructor(db, storeName) {
    this.db = db;
    this.storeName = storeName;
  }

  reset() {
    this.tx = null;
  }

  writable() {
    if (this.tx?.mode !== 'readwrite') {
      console.log(`transaction ${this.storeName} readwrite`);
      this.tx = this.db.transaction(this.storeName, 'readwrite');
    }
  }

  get(key) {
    console.log(`get`, key);
    return this.#call(store => store.get(key));
  }

  getAll(key) {
    console.log(`getAll`, key);
    return this.#call(store => store.getAll(key));
  }

  add(value, key) {
    console.log(`add`, value, key);
    return this.#call(store => store.add(value, key), 'readwrite');
  }

  put(value, key) {
    console.log(`put`, value, key);
    return this.#call(store => store.put(value, key), 'readwrite');
  }

  delete(key) {
    console.log(`delete`, key);
    return this.#call(store => store.delete(key), 'readwrite');
  }

  clear() {
    console.log(`clear`);
    return this.#call(store => store.clear(), 'readwrite');
  }

  /**
   * Helper to implement IDB request with retry.
   * @param {(store: IDBObjectStore) => IDBRequest} f 
   * @param {'readwrite'} [mode] 
   * @returns {Promise}
   */
  #call(f, mode) {
    // Retry once to handle inactive transaction.
    for (let i = 0; i < 2; ++i) {
      // Create a new transaction if the current mode doesn't match.
      if (!this.tx || (mode && this.tx.mode !== mode)) {
        console.log(`transaction ${this.storeName} ${mode}`);
        this.tx = this.db.transaction(this.storeName, mode);
        this.tx.oncomplete = ({ target }) => {
          if (this.tx === target) {
            this.tx = null;
          }
        };
      }

      try {
        const request = f(this.tx.objectStore(this.storeName));
        return promisify(request);
      } catch (e) {
        if (i) throw e;
        console.log(`new transaction (${e.message})`);
        this.tx = null;
      }
    }
  }
}