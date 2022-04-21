import * as VFS from '../VFS.js';

const WEB_LOCKS = navigator['locks'] ?? console.warn('concurrency is unsafe without Web Locks API');

export class WebLocks {
  /** @type {Map<number, number>} */ #mapIdToState = new Map();
  /** @type {Map<string, (any) => void>} */ #mapNameToReleaser = new Map();

  // Two locks are used, an outer lock and an inner lock, where holding
  // the outer lock is a prerequisite to acquire the inner lock.
  //
  // For read-only access, the inner lock must be held with 'shared'
  // mode.
  //
  // For read-write access, both outer and inner locks must be held
  // with 'exclusive' mode.

  async lock(name, flags) {
    const lockState = this.#mapIdToState.get(name) ?? VFS.SQLITE_LOCK_NONE;

    switch (flags) {
      case VFS.SQLITE_LOCK_SHARED:
        switch (lockState) {
          case VFS.SQLITE_LOCK_NONE:
            await this.#acquireWebLock(`${name}-outer`, 'exclusive');
            await this.#acquireWebLock(`${name}-inner`, 'shared');
            this.#releaseWebLock(`${name}-outer`);
            break;
        }
        break;
      case VFS.SQLITE_LOCK_RESERVED:
        switch (lockState) {
          case VFS.SQLITE_LOCK_SHARED:
            await this.#acquireWebLock(`${name}-outer`, 'exclusive');
            break;
          default:
            console.error(`unexpected lock transition ${lockState} -> ${flags}`);
            return VFS.SQLITE_ERROR;
        }
        break;
      case VFS.SQLITE_LOCK_EXCLUSIVE:
        switch (lockState) {
          case VFS.SQLITE_LOCK_RESERVED:
            this.#releaseWebLock(`${name}-inner`);
            await this.#acquireWebLock(`${name}-inner`, 'exclusive');
            break;
          default:
            console.error(`unexpected lock transition ${lockState} -> ${flags}`);
            return VFS.SQLITE_ERROR;
          }
        break;
      default:
        console.error(`unexpected lock flag ${flags}`);
        return VFS.SQLITE_ERROR;
    }
    this.#mapIdToState.set(name, flags);
    return VFS.SQLITE_OK
  }

  async unlock(fileId, flags) {
    const lockState = this.#mapIdToState.get(fileId) ?? VFS.SQLITE_LOCK_NONE;

    switch (flags) {
      case VFS.SQLITE_LOCK_RESERVED:  // only happens with OOB rollback
        switch (lockState) {
          case VFS.SQLITE_LOCK_EXCLUSIVE:
            this.#releaseWebLock(`${fileId}-inner`);
            await this.#acquireWebLock(`${fileId}-inner`, 'shared');
            break;
        }
        break;
      case VFS.SQLITE_LOCK_SHARED:
        switch (lockState) {
          case VFS.SQLITE_LOCK_EXCLUSIVE:  // intentional case fall-through
            this.#releaseWebLock(`${fileId}-inner`);
            await this.#acquireWebLock(`${fileId}-inner`, 'shared');
          case VFS.SQLITE_LOCK_RESERVED:
            this.#releaseWebLock(`${fileId}-outer`);
            break;
        }
        break;
      case VFS.SQLITE_LOCK_NONE:
        switch (lockState) {
          case VFS.SQLITE_LOCK_EXCLUSIVE:  // intentional case fall-through
          case VFS.SQLITE_LOCK_RESERVED:
            this.#releaseWebLock(`${fileId}-outer`);
          case VFS.SQLITE_LOCK_SHARED:
            this.#releaseWebLock(`${fileId}-inner`);
            break;
        }
        break;
      default:
        console.error(`unexpected lock flag ${flags}`);
        return VFS.SQLITE_ERROR;
    }

    if (flags !== VFS.SQLITE_LOCK_NONE) {
      this.#mapIdToState.set(fileId, flags);
    } else {
      this.#mapIdToState.delete(fileId);
    }
    return VFS.SQLITE_OK
  }

  async #acquireWebLock(name, mode) {
    if (WEB_LOCKS) {
      const lockName = `lock-${name}`;
      return new Promise(hasLock => {
        WEB_LOCKS.request(lockName, { mode }, () => new Promise(release => {
          hasLock();
          this.#mapNameToReleaser.set(name, release);
        }));
      });
    }
  }

  #releaseWebLock(name) {
    this.#mapNameToReleaser.get(name)?.();
    this.#mapNameToReleaser.delete(name);
  }
};