// Copyright 2022 Roy T. Hashimoto. All Rights Reserved.
import * as VFS from '../VFS.js';

const WEB_LOCKS = navigator['locks'] ?? console.warn('concurrency is unsafe without Web Locks API');

export class WebLocks {
  /** @type {Map<number, number>} */ #mapIdToState = new Map();
  /** @type {Map<string, (any) => void>} */ #mapNameToReleaser = new Map();

  // Use a single exclusive lock.

  async lock(name, flags) {
    const lockState = this.#mapIdToState.get(name) ?? VFS.SQLITE_LOCK_NONE;
    if (lockState === VFS.SQLITE_LOCK_NONE) {
      await this.#acquireWebLock(name, 'exclusive');
    }
    this.#mapIdToState.set(name, flags);
    return VFS.SQLITE_OK
  }

  async unlock(name, flags) {
    if (flags === VFS.SQLITE_LOCK_NONE) {
      this.#releaseWebLock(name);
      this.#mapIdToState.delete(name);
    } else {
      this.#mapIdToState.set(name, flags);
    }
    return VFS.SQLITE_OK
  }

  async #acquireWebLock(name, mode, signal) {
    if (WEB_LOCKS) {
      const lockName = `sqlite-${name}`;
      return new Promise(async (hasLock, aborted) => {
        try {
          await WEB_LOCKS.request(lockName, { mode, signal }, () => new Promise(release => {
            hasLock();
            this.#mapNameToReleaser.set(name, release);
          }));
        } catch(e) {
          aborted(e);
        }
      });
    }
  }

  #releaseWebLock(name) {
    this.#mapNameToReleaser.get(name)?.();
    this.#mapNameToReleaser.delete(name);
  }
};