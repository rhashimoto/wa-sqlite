import * as VFS from '../VFS.js';

const WEB_LOCKS = navigator['locks'] ?? console.warn('concurrency is unsafe without Web Locks API');
const DEFAULT_TIMEOUT_SECONDS = 30;

export class WebLocksShared {
  /** @type {Map<number, number>} */ #mapIdToState = new Map();
  /** @type {Map<string, (any) => void>} */ #mapNameToReleaser = new Map();

  /** @type {number} exclusive lock timeout */
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS;

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
          default:
            console.error(`unexpected lock transition ${lockState} -> ${flags}`);
            return VFS.SQLITE_ERROR;
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
          case VFS.SQLITE_LOCK_SHARED:
            await this.#acquireWebLock(`${name}-outer`, 'exclusive');
            // intentional case fall-through
          case VFS.SQLITE_LOCK_RESERVED:
            this.#releaseWebLock(`${name}-inner`);
            try {
              // There is a potential deadlock if two connections hold a
              // shared lock and want to upgrade to an exclusive lock. Break
              // deadlock with a timeout.
              const abortController = new AbortController();
              setTimeout(() => abortController.abort(), this.timeoutSeconds * 1000);
              await this.#acquireWebLock(`${name}-inner`, 'exclusive', abortController.signal);
            } catch (e) {
              await this.#acquireWebLock(`${name}-inner`, 'shared');
              if (lockState === VFS.SQLITE_LOCK_SHARED) {
                this.#releaseWebLock(`${name}-outer`);
              }
              return VFS.SQLITE_BUSY;
            }
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

  async unlock(name, flags) {
    const lockState = this.#mapIdToState.get(name) ?? VFS.SQLITE_LOCK_NONE;

    switch (flags) {
      case VFS.SQLITE_LOCK_RESERVED:
        switch (lockState) {
          case VFS.SQLITE_LOCK_EXCLUSIVE:
            this.#releaseWebLock(`${name}-inner`);
            await this.#acquireWebLock(`${name}-inner`, 'shared');
            break;
        }
        break;
      case VFS.SQLITE_LOCK_SHARED:
        switch (lockState) {
          case VFS.SQLITE_LOCK_EXCLUSIVE:
            this.#releaseWebLock(`${name}-inner`);
            await this.#acquireWebLock(`${name}-inner`, 'shared');
            // intentional case fall-through
          case VFS.SQLITE_LOCK_RESERVED:
            this.#releaseWebLock(`${name}-outer`);
            break;
        }
        break;
      case VFS.SQLITE_LOCK_NONE:
        switch (lockState) {
          case VFS.SQLITE_LOCK_EXCLUSIVE:
          case VFS.SQLITE_LOCK_RESERVED:
            this.#releaseWebLock(`${name}-outer`);
            // intentional case fall-through
          case VFS.SQLITE_LOCK_SHARED:
            this.#releaseWebLock(`${name}-inner`);
            break;
        }
        break;
      default:
        console.error(`unexpected lock flag ${flags}`);
        return VFS.SQLITE_ERROR;
    }

    if (flags !== VFS.SQLITE_LOCK_NONE) {
      this.#mapIdToState.set(name, flags);
    } else {
      this.#mapIdToState.delete(name);
    }
    return VFS.SQLITE_OK
  }

  async #acquireWebLock(name, mode, signal) {
    if (WEB_LOCKS) {
      const lockName = `lock-${name}`;
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