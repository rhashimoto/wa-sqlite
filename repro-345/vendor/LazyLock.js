import { Lock } from './Lock.js';

export class LazyLock extends Lock {
  #channel;
  #isBusy = false;
  #hasReleaseRequest = false;

  /**
   * @param {string} name 
   */
  constructor(name) {
    super(name);
    this.#channel = new BroadcastChannel(name);
    this.#channel.onmessage = (event) => {
      if (this.#isBusy) {
        // We're using the lock so postpone the release.
        this.#hasReleaseRequest = true;
      } else {
        this.release();
      }
    }
  }

  close() {
    super.close();
    this.#channel.onmessage = null;
    this.#channel.close();
  }

  /**
   * @param {LockMode} mode 
   * @param {number} timeout 
   * @returns {Promise<boolean>}
   */
  async acquire(mode, timeout = -1) {
    this.#isBusy = true;
    try {
      if (mode === this.mode) {
        // We never had to release the lock.
        return true;
      }

      if (this.mode) {
        // Release the lock to acquire it in a different mode.
        super.release();
      } else {
        // Poll for the lock. This isn't necessary but if it works it avoids
        // the BroadcastChannel traffic.
        if (await super.acquire(mode, 0)) {
          return true;
        }
      }

      // Request the lock.
      const pResult = super.acquire(mode, timeout)
      this.#channel.postMessage({});

      return await pResult;
    } catch (e) {
      this.release();
      throw e;
    }
  }

  /**
   * @param {LockMode} mode 
   * @returns {boolean}
   */
  acquireIfHeld(mode) {
    if (mode === this.mode) {
      this.#isBusy = true;
      return true;
    }
    return false;
  }

  release() {
    super.release();
    this.#isBusy = false;
    this.#hasReleaseRequest = false;
  }

  releaseLazy() {
    // Release the lock only if someone else wants it.
    this.#isBusy = false;
    if (this.#hasReleaseRequest) {
      this.release();
    }
  }
}