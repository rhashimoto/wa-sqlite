import * as VFS from './VFS.js';

export const WebLocksExclusive = superclass => class extends superclass {
  #mapNameToReleaser = new Map();

  constructor(...args) {
    super(...args);
  }

  async jLock(fileId, lockType) {
    const name = this.getLockName(fileId);
    if (!this.#mapNameToReleaser.has(name)) {
      const release = await acquireLock(name);
      this.#mapNameToReleaser.set(name, release);
    }
  }

  async jUnlock(fileId, lockType) {
    if (lockType === VFS.SQLITE_LOCK_NONE) {
      const name = this.getLockName(fileId);
      this.#mapNameToReleaser.get(name)?.();
      this.#mapNameToReleaser.delete(name);
    }
  }

  async jCheckReservedLock(fileId, pResOut) {
    // Poll the lock. If we get it, no other connection has a lock.
    const name = this.getLockName(fileId);
    const release = await acquireLock(name, { mode: 'shared', ifAvailable: true });
    release();
    pResOut.setInt32(0, release ? 0 : 1);
  } 
}

/**
 * @param {string} name 
 * @param {LockOptions} options 
 * @returns {Promise<(value?: any) => void>}
 */
function acquireLock(name, options = {}) {
  return new Promise(resolve => {
    navigator.locks.request(name, options, lock => {
      if (lock) {
        return new Promise(release => {
          resolve(release);
        });
      }
      resolve(null);
    });
  });
}