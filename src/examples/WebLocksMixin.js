import * as VFS from '../VFS.js';

const WEB_LOCKS = navigator['locks'] ?? console.warn('IndexedDB concurrency is unsafe without Web Locks API');

export const WebLocksMixin = (Base = Object) => class extends Base {
  lockState = VFS.SQLITE_LOCK_NONE;
  lockReleasers = new Map();

  // Override this accessor in client class.
  get name() { return 'missing-override'; }

  constructor() {
    super()
  }

  // Two locks are used, an outer lock and an inner lock, where holding
  // the outer lock is a prerequisite to acquire the inner lock.
  //
  // For read-only access, the inner lock must be held with 'shared'
  // mode.
  //
  // For read-write access, both outer and inner locks must be held
  // with 'exclusive' mode.

  async xLock(fileId, flags) {
    switch (flags) {
      case VFS.SQLITE_LOCK_SHARED:
        switch (this.lockState) {
          case VFS.SQLITE_LOCK_NONE:
            await this.#acquireWebLock('Outer', 'exclusive');
            await this.#acquireWebLock('Inner', 'shared');
            this.#releaseWebLock('Outer');
            break;
        }
        break;
      case VFS.SQLITE_LOCK_RESERVED:
        switch (this.lockState) {
          case VFS.SQLITE_LOCK_SHARED:
            await this.#acquireWebLock('Outer', 'exclusive');
            break;
          default:
            console.error(`unexpected lock transition ${this.lockState} -> ${flags}`);
            return VFS.SQLITE_ERROR;
        }
        break;
      case VFS.SQLITE_LOCK_EXCLUSIVE:
        switch (this.lockState) {
          case VFS.SQLITE_LOCK_RESERVED:
            this.#releaseWebLock('Inner');
            await this.#acquireWebLock('Inner', 'exclusive');
            break;
          default:
            console.error(`unexpected lock transition ${this.lockState} -> ${flags}`);
            return VFS.SQLITE_ERROR;
          }
        break;
      default:
        console.error(`unexpected lock flag ${flags}`);
        return VFS.SQLITE_ERROR;
    }
    this.lockState = flags;
    return VFS.SQLITE_OK
  }

  async xUnlock(fileId, flags) {
    switch (flags) {
      case VFS.SQLITE_LOCK_RESERVED:  // only happens with OOB rollback
        switch (this.lockState) {
          case VFS.SQLITE_LOCK_EXCLUSIVE:
            this.#releaseWebLock('Inner');
            await this.#acquireWebLock('Inner', 'shared');
            break;
        }
        break;
      case VFS.SQLITE_LOCK_SHARED:
        switch (this.lockState) {
          case VFS.SQLITE_LOCK_EXCLUSIVE:  // intentional case fall-through
            this.#releaseWebLock('Inner');
            await this.#acquireWebLock('Inner', 'shared');
          case VFS.SQLITE_LOCK_RESERVED:
            this.#releaseWebLock('Outer');
            break;
        }
        break;
      case VFS.SQLITE_LOCK_NONE:
        switch (this.lockState) {
          case VFS.SQLITE_LOCK_EXCLUSIVE:  // intentional case fall-through
          case VFS.SQLITE_LOCK_RESERVED:
            this.#releaseWebLock('Outer');
          case VFS.SQLITE_LOCK_SHARED:
            this.#releaseWebLock('Inner');
            break;
        }
        break;
      default:
        console.error(`unexpected lock flag ${flags}`);
        return VFS.SQLITE_ERROR;
    }
    this.lockState = flags;
    return VFS.SQLITE_OK
  }

  async #acquireWebLock(name, mode) {
    if (WEB_LOCKS) {
      const lockName = `${this.name}-lock-${name}`;
      return new Promise(hasLock => {
        WEB_LOCKS.request(lockName, { mode }, () => new Promise(release => {
          hasLock();
          this.lockReleasers.set(name, release);
        }));
      });
    }
  }

  #releaseWebLock(name) {
    this.lockReleasers.get(name)?.();
    this.lockReleasers.delete(name);
  }
};