import * as VFS from './VFS.js';

export const WebLocksExclusive = superclass => class extends superclass {
  #mapIdToReleaser = new Map();

  constructor(...args) {
    super(...args);
  }

  async jLock(pFile, lockType) {
    if (!this.#mapIdToReleaser.has(pFile)) {
      const name = this.getLockName(pFile);
      const release = await acquireLock(name);
      this.#mapIdToReleaser.set(pFile, release);
    }
    return VFS.SQLITE_OK;
  }

  async jUnlock(pFile, lockType) {
    if (lockType === VFS.SQLITE_LOCK_NONE) {
      this.#mapIdToReleaser.get(pFile)?.();
      this.#mapIdToReleaser.delete(pFile);
    }
    return VFS.SQLITE_OK;
  }

  async jCheckReservedLock(pFile, pResOut) {
    // xCheckReservedLock is called only with an acquired SHARED lock.
    // There can be no other connection with a lock of any level.
    pResOut.setInt32(0, 0);
    return VFS.SQLITE_OK;
  } 
}

export const WebLocksShared = superclass => class extends superclass {
  #mapIdToState = new Map();
  
  constructor(...args) {
    super(...args);
  }

  async jLock(fileId, lockType) {
    const state = this.#mapIdToState.get(fileId) || {
      lockType: VFS.SQLITE_LOCK_NONE,
      outerRelease: null,
      innerRelease: null,
    };
    if (lockType <= state.lockType) return VFS.SQLITE_IOERR_LOCK;

    switch (state.lockType) {
      case VFS.SQLITE_LOCK_NONE:
        switch (lockType) {
          case VFS.SQLITE_LOCK_SHARED:
            // We need a shared inner lock. We can only acquire the inner
            // lock when we hold the outer lock.
            const name = this.getLockName(fileId);
            const outerRelease = await acquireLock(outer(name), { mode: 'shared' });
            state.innerRelease = await acquireLock(inner(name), { mode: 'shared' });
            outerRelease();

            state.lockType = lockType;
            this.#mapIdToState.set(fileId, state);
            break;
          default:
            return VFS.SQLITE_IOERR_LOCK
        }
        break;
      case VFS.SQLITE_LOCK_SHARED:
        switch (lockType) {
          case VFS.SQLITE_LOCK_RESERVED:
            while (true) {
              // We need an exclusive outer lock. Poll for it.
              const name = this.getLockName(fileId);
              state.outerRelease = await acquireLock(outer(name), { ifAvailable: true });
              if (state.outerRelease) break;

              // We failed to get the outer lock. This could mean we have
              // deadlock. Verify by checking whether someone does hold a
              // reserved lock.
              if (await isSomewhereReserved(name)) {
                // Deadlock confirmed. We are blocking them with our shared
                // inner lock and they are blocking us with their exclusive
                // outer lock.
                return VFS.SQLITE_BUSY
              }

              // No deadlock, keep trying.
              await new Promise(resolve => setTimeout(resolve));
            }  
            state.innerRelease();
            state.innerRelease = null;

            state.lockType = lockType;
            this.#mapIdToState.set(fileId, state);
            break;
          default:
            await this.jLock(fileId, VFS.SQLITE_LOCK_RESERVED);
            await this.jLock(fileId, lockType);
            break;
        }
        break;
      case VFS.SQLITE_LOCK_RESERVED:
        switch (lockType) {
          case VFS.SQLITE_LOCK_EXCLUSIVE:
            // Get exclusive inner lock once everyone holding a shared lock
            // releases it.
            const name = this.getLockName(fileId);
            state.innerRelease = await acquireLock(inner(name));

            state.lockType = lockType;
            this.#mapIdToState.set(fileId, state);
            break;
        }
        break;
    }
    return VFS.SQLITE_OK;
  }

  async jUnlock(fileId, lockType) {
    const state = this.#mapIdToState.get(fileId);
    if (!state) return VFS.SQLITE_IOERR_UNLOCK;
    if (lockType >= state.lockType) return VFS.SQLITE_IOERR_UNLOCK;

    switch (state.lockType) {
      case VFS.SQLITE_LOCK_EXCLUSIVE:
        switch (lockType) {
          case VFS.SQLITE_LOCK_RESERVED:
            state.innerRelease();
            state.innerRelease = null;

            state.lockType = lockType;
            this.#mapIdToState.set(fileId, state);
            break;
          default:
            await this.jUnlock(fileId, VFS.SQLITE_LOCK_RESERVED);
            await this.jUnlock(fileId, lockType);
            break;
        }
        break;
      case VFS.SQLITE_LOCK_RESERVED:
        switch (lockType) {
          case VFS.SQLITE_LOCK_SHARED:
            const name = this.getLockName(fileId);
            state.innerRelease = await acquireLock(inner(name), { mode: 'shared' });
            state.outerRelease();
            state.outerRelease = null;
            
            state.lockType = lockType;
            this.#mapIdToState.set(fileId, state);
            break;
          default:
            await this.jUnlock(fileId, VFS.SQLITE_LOCK_SHARED);
            await this.jUnlock(fileId, lockType);
            break;
        }
        break;
      case VFS.SQLITE_LOCK_SHARED:
        switch (lockType) {
          case VFS.SQLITE_LOCK_NONE:
            state.innerRelease();
            state.innerRelease = null;

            this.#mapIdToState.delete(fileId);
            break;
        }
        break;
    }
    return VFS.SQLITE_OK;
  }

  async jCheckReservedLock(fileId, pResOut) {
    const name = this.getLockName(fileId);
    pResOut.setInt32(0, await isSomewhereReserved(name) ? 1 : 0); 
    return VFS.SQLITE_OK;
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

/**
 * @param {string} name 
 * @returns {string}
 */
function outer(name) {
  return `${name}-outer`;
}

/**
 * @param {string} name 
 * @returns {string}
 */
function inner(name) {
  return `${name}-inner`;
}

/**
 * @param {string} name 
 * @returns {Promise<boolean>}
 */
async function isSomewhereReserved(name) {
  const outerName = outer(name);
  const query = await navigator.locks.query();
  return query.held.find(({name}) => name === outerName)?.mode === 'exclusive';
}
