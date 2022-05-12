import * as VFS from '../VFS.js';

const WEB_LOCKS = navigator['locks'] ?? console.warn('concurrency is unsafe without Web Locks API');

const RETRY_DELAY_MILLIS = 16;

export class WebLocksShared {
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
            await this.#acquireWebLock(`${name}-outer`);
            await this.#acquireWebLock(`${name}-inner`, { mode: 'shared' });
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
            while (true) {
              // Attempt to acquire the lock without blocking.
              const isLocked = await this.#acquireWebLock(`${name}-outer`, { ifAvailable: true });
              if (isLocked) break;

              // Failed to get the lock so check if the reserved lock is taken.
              // If it is then another connection is already in the reserved
              // state so this is deadlock. Return SQLITE_BUSY to inform the
              // application to rollback.
              const query = await WEB_LOCKS.query();
              const reservedLockName = `${name}-reserved`;
              const isOccupied = query.held.some(({name}) => name === reservedLockName);
              if (isOccupied) return VFS.SQLITE_BUSY;

              // This might be contention with a connection acquiring a
              // shared lock which holds the outer lock only briefly, so
              // try again.
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MILLIS));
            }

            // Take the reserved lock. This isn't used as a lock - acquiring
            // it will never block - but instead as a signal to other
            // connections that the reserved state is occupied.
            await this.#acquireWebLock(`${name}-reserved`);
            break;
          default:
            console.error(`unexpected lock transition ${lockState} -> ${flags}`);
            return VFS.SQLITE_ERROR;
        }
        break;
      case VFS.SQLITE_LOCK_EXCLUSIVE:
        switch (lockState) {
          case VFS.SQLITE_LOCK_SHARED:
            await this.#acquireWebLock(`${name}-outer`);
            // intentional case fall-through
          case VFS.SQLITE_LOCK_RESERVED:
            this.#releaseWebLock(`${name}-inner`);
            await this.#acquireWebLock(`${name}-inner`);
            this.#releaseWebLock(`${name}-reserved`);
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
            await this.#acquireWebLock(`${name}-inner`, { mode: 'shared' });
            break;
        }
        break;
      case VFS.SQLITE_LOCK_SHARED:
        switch (lockState) {
          case VFS.SQLITE_LOCK_EXCLUSIVE:
            this.#releaseWebLock(`${name}-inner`);
            await this.#acquireWebLock(`${name}-inner`, { mode: 'shared' });
            // intentional case fall-through
          case VFS.SQLITE_LOCK_RESERVED:
            this.#releaseWebLock(`${name}-reserved`);
            this.#releaseWebLock(`${name}-outer`);
            break;
        }
        break;
      case VFS.SQLITE_LOCK_NONE:
        switch (lockState) {
          case VFS.SQLITE_LOCK_EXCLUSIVE:
          case VFS.SQLITE_LOCK_RESERVED:
            this.#releaseWebLock(`${name}-reserved`);
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

  async #acquireWebLock(name, options) {
    if (WEB_LOCKS) {
      const lockName = `${name}`;
      return new Promise(async (resolve, reject) => {
        try {
          await WEB_LOCKS.request(lockName, options, lock => {
            resolve(lock);
            if (lock) {
              return new Promise(release => {
                this.#mapNameToReleaser.set(name, release);
              });
            }
          });
        } catch(e) {
          // AbortController signal path.
          reject(e);
        }
      });
    }
  }

  #releaseWebLock(name) {
    this.#mapNameToReleaser.get(name)?.();
    this.#mapNameToReleaser.delete(name);
  }
};