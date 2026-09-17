// This is a convenience wrapper for the Web Locks API.
export class Lock {
  #name;
  /** @type {LockMode?} */ #mode = null;
  /** @type {Promise<Function|null>} */ #releaser = Promise.resolve(null);
  #isAcquiring = false;

  /**
   * @param {string} name 
   */
  constructor(name) {
    this.#name = name;
  }

  get name() { return this.#name; }
  get mode() { return this.#mode; }

  close() {
    this.release();
  }
  
  /**
   * @param {'shared'|'exclusive'} mode 
   * @param {number} timeout -1 for infinite, 0 for poll, >0 for milliseconds
   * @return {Promise<boolean>} true if lock acquired, false on failed poll
   */
  async acquire(mode, timeout = -1) {
    if (this.#isAcquiring) throw new Error('Lock is already being acquired');
    this.#isAcquiring = true;
    try {
      if (this.#mode) {
        throw new Error(`Lock ${this.#name} is already acquired`);
      }

      this.#releaser = new Promise((resolve, reject) => {
        /** @type {LockOptions} */
        const options = { mode, ifAvailable: timeout === 0 };
        if (timeout > 0) {
          options.signal = AbortSignal.timeout(timeout);
        }

        navigator.locks.request(this.#name, options, lock => {
          if (lock === null) {
            // Polling (with timeout = 0) did not acquire the lock.
            return resolve(null);
          }

          // Lock acquired. The lock is released when this returned
          // Promise is resolved.
          this.#mode = mode;
          return new Promise(releaser => {
            resolve(releaser);
          })
        }).catch(e => {
          return reject(e);
        });
      });

      return this.#releaser.then(releaser => !!releaser)
    } finally {
      this.#isAcquiring = false;
    }
  }

  release() {
    this.#releaser.then(releaser => releaser?.(), () => {});
    this.#mode = null;
  }
}
