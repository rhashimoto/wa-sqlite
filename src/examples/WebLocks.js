// Copyright 2022 Roy T. Hashimoto. All Rights Reserved.
import * as VFS from '../VFS.js';

const WEB_LOCKS = navigator['locks'] ?? console.warn('concurrency is unsafe without Web Locks API');
const LOCK_TYPE_MASK =
  VFS.SQLITE_LOCK_NONE |
  VFS.SQLITE_LOCK_SHARED |
  VFS.SQLITE_LOCK_RESERVED |
  VFS.SQLITE_LOCK_PENDING |
  VFS.SQLITE_LOCK_EXCLUSIVE;

export class WebLocksBase {
  get name() { return this.#name }
  #name;

  get state() { return this.#state; }
  #state = VFS.SQLITE_LOCK_NONE;

  timeoutMillis = 0;

  /** @type {Map<string, (value: any) => void>} */ #releasers = new Map();
  /** @type {Promise<0|5|3850>} */ #pending = Promise.resolve(0);

  /**
   * @param {string} name 
   */
  constructor(name) {
    this.#name = name;
  }

  /**
   * @param {number} flags 
   * @returns {Promise<0|5|3850>} SQLITE_OK, SQLITE_BUSY, SQLITE_IOERR_LOCK
   */
  async lock(flags) {
    return this.#apply(this.#lock, flags);
  }

  /**
   * @param {number} flags 
   * @returns {Promise<0|5|3850>} SQLITE_OK, SQLITE_IOERR_LOCK
   */
  async unlock(flags) {
    return this.#apply(this.#unlock, flags);
  }

  /**
   * 
   * @param {(targetState: number) => void} method 
   * @param {number} flags 
   */
  async #apply(method, flags) {
    const targetState = flags & LOCK_TYPE_MASK;
    try {
      // Force locks and unlocks to run sequentially. This allows not
      // waiting for unlocks to complete.
      const call = () => method.call(this, targetState);
      await (this.#pending = this.#pending.then(call, call));
      this.#state = targetState;
      return VFS.SQLITE_OK;
    } catch (e) {
      if (e.name === 'AbortError') {
        return VFS.SQLITE_BUSY;
      }
      console.error(e);
      return VFS.SQLITE_IOERR_LOCK;
    }
  }

  async #lock(targetState) {
    if (targetState === this.#state) return VFS.SQLITE_OK;
    switch (this.#state) {
      case VFS.SQLITE_LOCK_NONE:
        switch (targetState) {
          case VFS.SQLITE_LOCK_SHARED:
            return this._NONEtoSHARED();
          default:
            throw new Error(`unexpected transition ${this.#state} -> ${targetState}`);
        }

      case VFS.SQLITE_LOCK_SHARED:
        switch (targetState) {
          case VFS.SQLITE_LOCK_RESERVED:
            return this._SHAREDtoRESERVED();
          case VFS.SQLITE_LOCK_EXCLUSIVE:
            return this._SHAREDtoEXCLUSIVE();
          default:
            throw new Error(`unexpected transition ${this.#state} -> ${targetState}`);
        }
      
      case VFS.SQLITE_LOCK_RESERVED:
        switch (targetState) {
          case VFS.SQLITE_LOCK_EXCLUSIVE:
            return this._RESERVEDtoEXCLUSIVE();
          default:
            throw new Error(`unexpected transition ${this.#state} -> ${targetState}`);
        }

      default:
        throw new Error(`unexpected transition ${this.#state} -> ${targetState}`);
    }
  }

  async #unlock(targetState) {
    if (targetState === this.#state)  return VFS.SQLITE_OK;
    switch (this.#state) {
      case VFS.SQLITE_LOCK_EXCLUSIVE:
        switch (targetState) {
          case VFS.SQLITE_LOCK_SHARED:
            return this._EXCLUSIVEtoSHARED();
          default:
            throw new Error(`unexpected transition ${this.#state} -> ${targetState}`);
        }
      
      case VFS.SQLITE_LOCK_SHARED:
        switch (targetState) {
          case VFS.SQLITE_LOCK_NONE:
            return this._SHAREDtoNONE();
          default:
            throw new Error(`unexpected transition ${this.#state} -> ${targetState}`);
        }

      default:
        throw new Error(`unexpected transition ${this.#state} -> ${targetState}`);
    }
  }

  async _NONEtoSHARED() {
  }

  async _SHAREDtoEXCLUSIVE() {
    await this._SHAREDtoRESERVED();
    await this._RESERVEDtoEXCLUSIVE();
  }

  async _SHAREDtoRESERVED() {
  }

  async _RESERVEDtoEXCLUSIVE() {
  }

  async _EXCLUSIVEtoSHARED() {
  }

  async _SHAREDtoNONE() {
  }

  /**
   * @param {string} lockName 
   * @param {LockOptions} options 
   * @returns {Promise<?Lock>}
   */
  _acquireWebLock(lockName, options) {
    return new Promise(async (resolve, reject) => {
      try {
        await navigator.locks.request(lockName, options, lock => {
          resolve(lock);
          if (lock) {
            return new Promise(release => this.#releasers.set(lockName, release));
          }
        });
      } catch(e) {
        reject(e);
      }
    });
  }

  /**
   * @param {string} name 
   */
  _releaseWebLock(name) {
    this.#releasers.get(name)?.();
    this.#releasers.delete(name);
  }

  /**
   * @returns {?AbortSignal}
   */
  _getTimeoutSignal() {
    if (this.timeoutMillis) {
      const abortController = new AbortController();
      setTimeout(() => abortController.abort(), this.timeoutMillis);
      return abortController.signal;
    }
    return undefined;
  }
}


export class WebLocksExclusive extends WebLocksBase {
  /**
   * @param {string} name 
   */
  constructor(name) {
    super(name);
  }

   async _NONEtoSHARED() {
    await this._acquireWebLock(this.name, {
      mode: 'exclusive',
      signal: this._getTimeoutSignal()
    });
  }

  async _SHAREDtoNONE() {
    this._releaseWebLock(this.name);
  }
}

export class WebLocksShared extends WebLocksBase {
  maxRetryMillis = 1000;

  /**
   * @param {string} name 
   */
  constructor(name) {
    super(name);
    this._outerName = name + '-outer';
    this._innerName = name + '-inner';
  }

  async _NONEtoSHARED() {
    await this._acquireWebLock(this._outerName, {
      mode: 'shared',
      signal: this._getTimeoutSignal()
    });
    await this._acquireWebLock(this._innerName, {
      mode: 'shared',
      signal: this._getTimeoutSignal()
    });
    this._releaseWebLock(this._outerName);
  }

  async _SHAREDtoRESERVED() {
    let timeoutMillis = 1;
    while (true) {
      // Attempt to get the outer lock without blocking.
      const isLocked = await this._acquireWebLock(this._outerName, {
        mode: 'exclusive',
        ifAvailable: true
      });
      if (isLocked) break;

      if (await this._isReserved()) {
        // Someone else has a reserved lock so retry cannot succeed.
        throw new DOMException('', 'AbortError');
      }

      await new Promise(resolve => setTimeout(resolve, timeoutMillis));
      timeoutMillis = Math.min(2 * timeoutMillis, this.maxRetryMillis);
    }
    this._releaseWebLock(this._innerName);
  }

  async _RESERVEDtoEXCLUSIVE() {
    await this._acquireWebLock(this._innerName, {
      mode: 'exclusive',
      signal: this._getTimeoutSignal()
    });
  }

  async _EXCLUSIVEtoSHARED() {
    this._releaseWebLock(this._innerName);
    await this._acquireWebLock(this._innerName, { mode: 'shared' });
    this._releaseWebLock(this._outerName);
  }

  async _SHAREDtoNONE() {
    this._releaseWebLock(this._innerName);
  }

  async _isReserved() {
    const query = await navigator.locks.query();
    return query.held.find(({name}) => name === this._outerName)?.mode === 'exclusive';
  }
}

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