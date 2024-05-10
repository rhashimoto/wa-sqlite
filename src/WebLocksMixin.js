import * as VFS from './VFS.js';

/** @type {LockOptions} */ const SHARED = { mode: 'shared' };
/** @type {LockOptions} */ const POLL_SHARED = { ifAvailable: true, mode: 'shared' };
/** @type {LockOptions} */ const POLL_EXCLUSIVE = { ifAvailable: true, mode: 'exclusive' };

/**
 * @typedef LockState
 * @property {string} baseName
 * @property {number} type
 * @property {function?} [gate]
 * @property {function?} [access]
 * @property {function?} [reserved]
 */

/**
 * @param {*} superclass 
 * @returns 
 */
export const WebLocksMixin = superclass => class extends superclass {
  #options = {
    lockPolicy: 'exclusive',
    lockTimeout: Infinity
  };

  /** @type {Map<number, LockState>} */ #mapIdToState = new Map();

  constructor(name, module, options) {
    super(name, module, options);
    Object.assign(this.#options, options);
    if (['exclusive', 'shared'].indexOf(this.#options.lockPolicy) === -1) {
      throw new Error(`WebLocksMixin: invalid lock mode: ${options.lockPolicy}`);
    }
  }

  /**
   * @param {number} fileId 
   * @param {number} lockType 
   * @returns {Promise<number>}
   */
  async jLock(fileId, lockType) {
    try {
      // Create state on first lock.
      if (!this.#mapIdToState.has(fileId)) {
        const name = this.getFilename(fileId);
        const state = {
          baseName: name,
          type: VFS.SQLITE_LOCK_NONE
        };
        this.#mapIdToState.set(fileId, state);
      }

      const lockState = this.#mapIdToState.get(fileId);
      if (lockType <= lockState.type) return VFS.SQLITE_OK;
  
      switch (this.#options.lockPolicy) {
        case 'exclusive':
          return await this.#lockExclusive(lockState, lockType);
        case 'shared':
          return await this.#lockShared(lockState, lockType);
      }
    } catch (e) {
      console.error('WebLocksMixin: lock error', e);
      return VFS.SQLITE_IOERR_LOCK;
    }
  }
  
  /**
   * @param {number} fileId 
   * @param {number} lockType 
   * @returns {Promise<number>}
   */
  async jUnlock(fileId, lockType) {
    try {
      const lockState = this.#mapIdToState.get(fileId);
      if (lockType >= lockState.type) return VFS.SQLITE_OK;
  
      switch (this.#options.lockPolicy) {
        case 'exclusive':
          return await this.#unlockExclusive(lockState, lockType);
        case 'shared':
          return await this.#unlockShared(lockState, lockType);
      }
    } catch (e) {
      console.error('WebLocksMixin: unlock error', e);
      return VFS.SQLITE_IOERR_UNLOCK;
    }
  }

  /**
   * @param {number} fileId 
   * @param {DataView} pResOut 
   * @returns {Promise<number>}
   */
  async jCheckReservedLock(fileId, pResOut) {
    try {
      const lockState = this.#mapIdToState.get(fileId);
      switch (this.#options.lockPolicy) {
        case 'exclusive':
          return this.#checkExclusive(lockState, pResOut);
        case 'shared':
          return await this.#checkShared(lockState, pResOut);
      }
    } catch (e) {
      console.error('WebLocksMixin: check reserved lock error', e);
      return VFS.SQLITE_IOERR_CHECKRESERVEDLOCK;
    }
    pResOut.setInt32(0, 0, true);
    return VFS.SQLITE_OK;
  }

  /**
   * @param {LockState} lockState 
   * @param {number} lockType 
   * @returns 
   */
  async #lockExclusive(lockState, lockType) {
    switch (lockState.type) {
      case VFS.SQLITE_LOCK_NONE:
        switch (lockType) {
          case VFS.SQLITE_LOCK_SHARED:
            if (!await this.#acquire(lockState, 'access')) {
              return VFS.SQLITE_BUSY;
            }
            console.assert(lockState.access);
            break;
          default:
            throw new Error('unsupported lock transition');
        }
        break;
      case VFS.SQLITE_LOCK_SHARED:
        switch (lockType) {
          case VFS.SQLITE_LOCK_RESERVED:
            break;
            case VFS.SQLITE_LOCK_EXCLUSIVE:
              break;
            default:
            throw new Error('unsupported lock transition');
        }
        break;
      case VFS.SQLITE_LOCK_RESERVED:
        switch (lockType) {
          case VFS.SQLITE_LOCK_EXCLUSIVE:
            break;
          default:
            throw new Error('unsupported lock transition');
        }
        break;
    }
    lockState.type = lockType;
    return VFS.SQLITE_OK;
  }

  /**
   * @param {LockState} lockState 
   * @param {number} lockType 
   * @returns {number}
   */
  #unlockExclusive(lockState, lockType) {
    switch (lockState.type) {
      case VFS.SQLITE_LOCK_EXCLUSIVE:
        switch (lockType) {
          case VFS.SQLITE_LOCK_SHARED:
            break;
          default:
            throw new Error('unsupported lock transition');
        }
        break;
      case VFS.SQLITE_LOCK_RESERVED:
        switch (lockType) {
          case VFS.SQLITE_LOCK_SHARED:
            break;
          default:
            throw new Error('unsupported lock transition');
        }
        break;

      case VFS.SQLITE_LOCK_SHARED:
        switch (lockType) {
          case VFS.SQLITE_LOCK_NONE:
            lockState.access();
            console.assert(!lockState.access);
            break;
          default:
            throw new Error('unsupported lock transition');
        }
        break;
    }
    lockState.type = lockType;
    return VFS.SQLITE_OK;
  }

  /**
   * @param {LockState} lockState 
   * @param {DataView} pResOut 
   * @returns {number}
   */
  #checkExclusive(lockState, pResOut) {
    pResOut.setInt32(0, 0, true);
    return VFS.SQLITE_OK;
  }

  /**
   * @param {LockState} lockState 
   * @param {number} lockType 
   * @returns 
   */
  async #lockShared(lockState, lockType) {
    switch (lockState.type) {
      case VFS.SQLITE_LOCK_NONE:
        switch (lockType) {
          case VFS.SQLITE_LOCK_SHARED:
            // Must have the gate lock to request the access lock.
            if (!await this.#acquire(lockState, 'gate', SHARED)) {
              return VFS.SQLITE_BUSY;
            }
            await this.#acquire(lockState, 'access', SHARED);
            lockState.gate();
            console.assert(!lockState.gate);
            console.assert(lockState.access);
            console.assert(!lockState.reserved);
            break;

          default:
            throw new Error('unsupported lock transition');
        }
        break;
      case VFS.SQLITE_LOCK_SHARED:
        switch (lockType) {
          case VFS.SQLITE_LOCK_RESERVED:
            // Poll for the reserved lock. If this fails, we're in deadlock.
            // The connection holding the reserved lock blocks us, and it
            // can't acquire an exclusive access lock because we hold a
            // shared access lock.
            if (!await this.#acquire(lockState, 'reserved', POLL_EXCLUSIVE)) {
              return VFS.SQLITE_BUSY;
            }
            lockState.access();
            console.assert(!lockState.gate);
            console.assert(!lockState.access);
            console.assert(lockState.reserved);
            break;

          case VFS.SQLITE_LOCK_EXCLUSIVE:
            // Jumping directly from SHARED to EXCLUSIVE without passing
            // through RESERVED is only done with a hot journal.
            if (!await this.#acquire(lockState, 'gate')) {
              return VFS.SQLITE_BUSY;
            }
            lockState.access();
            if (!await this.#acquire(lockState, 'access')) {
              return VFS.SQLITE_BUSY;
            }
            console.assert(lockState.gate);
            console.assert(lockState.access);
            console.assert(!lockState.reserved);
            break;

          default:
            throw new Error('unsupported lock transition');
        }
        break;
      case VFS.SQLITE_LOCK_RESERVED:
        switch (lockType) {
          case VFS.SQLITE_LOCK_EXCLUSIVE:
            // Prevent other connections from entering the SHARED state.
            if (!await this.#acquire(lockState, 'gate')) {
              return VFS.SQLITE_BUSY;
            }

            // Block until all other connections exit the SHARED state.
            if (!await this.#acquire(lockState, 'access')) {
              lockState.gate();
              return VFS.SQLITE_BUSY;
            }
            console.assert(lockState.gate);
            console.assert(lockState.access);
            console.assert(lockState.reserved);
            break;

          default:
            throw new Error('unsupported lock transition');
        }
        break;
    }
    lockState.type = lockType;
    return VFS.SQLITE_OK;
  }

  /**
   * @param {LockState} lockState 
   * @param {number} lockType 
   * @returns 
   */
  async #unlockShared(lockState, lockType) {
    switch (lockState.type) {
      case VFS.SQLITE_LOCK_EXCLUSIVE:
        switch (lockType) {
          case VFS.SQLITE_LOCK_SHARED:
            // Release our exclusive access lock and reacquire it with a
            // shared lock.
            lockState.access();
            await this.#acquire(lockState, 'access', SHARED);

            // Release our gate and reserved locks. We might not have a
            // reserved lock if we were handling a hot journal.
            lockState.gate();
            lockState.reserved?.();
            console.assert(lockState.access);
            console.assert(!lockState.gate);
            console.assert(!lockState.reserved);
            break;

          default:
            throw new Error('unsupported lock transition');
        }
        break;
      case VFS.SQLITE_LOCK_RESERVED:
        switch (lockType) {
          case VFS.SQLITE_LOCK_SHARED:
            // This transition is rare, probably only on an I/O error
            // while writing to a journal file.
            await this.#acquire(lockState, 'access', SHARED);
            lockState.reserved();
            console.assert(lockState.access);
            console.assert(!lockState.gate);
            console.assert(!lockState.reserved);
            break;

          default:
            throw new Error('unsupported lock transition');
        }
        break;

      case VFS.SQLITE_LOCK_SHARED:
        switch (lockType) {
          case VFS.SQLITE_LOCK_NONE:
            lockState.access();
            console.assert(!lockState.access);
            console.assert(!lockState.gate);
            console.assert(!lockState.reserved);
            break;

          default:
            throw new Error('unsupported lock transition');
        }
        break;
    }
    lockState.type = lockType;
    return VFS.SQLITE_OK;
  }

  /**
   * 
   * @param {LockState} lockState 
   * @param {DataView} pResOut 
   * @returns {Promise<number>}
   */
  async #checkShared(lockState, pResOut) {
    if (await this.#acquire(lockState, 'reserved', POLL_SHARED)) {
      lockState.reserved();
      pResOut.setInt32(0, 1, true);
    } else {
      pResOut.setInt32(0, 0, true);
    }
    return VFS.SQLITE_OK;
  }

  /**
   * @param {LockState} lockState 
   * @param {'gate'|'access'|'reserved'} name
   * @param {LockOptions} options 
   * @returns {Promise<boolean>}
   */
  #acquire(lockState, name, options = {}) {
    console.assert(!lockState[name]);
    return new Promise(resolve => {
      if (!options.ifAvailable && this.#options.lockTimeout < Infinity) {
        // Add a timeout to the lock request.
        const controller = new AbortController();
        options = Object.assign({}, options, { signal: controller.signal });
        setTimeout(() => {
          controller.abort();
          resolve?.(false);
        }, this.#options.lockTimeout);
      }

      const lockName = `lock##${lockState.baseName}##${name}`;
      navigator.locks.request(lockName, options, lock => {
        if (lock) {
          return new Promise(release => {
            lockState[name] = () => {
              release();
              lockState[name] = null;
            };
            resolve(true);
            resolve = null;
          });
        } else {
          lockState[name] = null;
          resolve(false);
          resolve = null;
        }
      }).catch(e => {
        if (e.name !== 'AbortError') throw e;
      });
    });
  }
}
