import * as VFS from '../src/VFS.js';
import { WebLocksExclusive, WebLocksShared } from "../src/examples/WebLocks.js";

function commonSpecs(builder) {
  async function clearLocks() {
    const results = await navigator.locks.query();
    await Promise.all([...results.held, ...results.pending].map(lock => {
      return new Promise(resolve => {
        navigator.locks.request(lock.name, { steal: true }, resolve);
      });
    }));
  }
  beforeEach(clearLocks);
  afterEach(clearLocks);

  it('should lock and unlock', async function() {
    // console.log(JSON.stringify(await navigator.locks.query(), null, 2));

    let result;
    const objectUnderTest = builder('test');
    expect(objectUnderTest.state).toEqual(VFS.SQLITE_LOCK_NONE);

    result = await objectUnderTest.lock(VFS.SQLITE_LOCK_SHARED);
    expect(result).toEqual(VFS.SQLITE_OK);
    expect(objectUnderTest.state).toEqual(VFS.SQLITE_LOCK_SHARED);

    result = await objectUnderTest.unlock(VFS.SQLITE_LOCK_NONE)
    expect(result).toEqual(VFS.SQLITE_OK);
    expect(objectUnderTest.state).toEqual(VFS.SQLITE_LOCK_NONE);

    await objectUnderTest.lock(VFS.SQLITE_LOCK_SHARED);
    result = await objectUnderTest.lock(VFS.SQLITE_LOCK_RESERVED);
    expect(result).toEqual(VFS.SQLITE_OK);
    expect(objectUnderTest.state).toEqual(VFS.SQLITE_LOCK_RESERVED);

    result = await objectUnderTest.lock(VFS.SQLITE_LOCK_EXCLUSIVE);
    expect(result).toEqual(VFS.SQLITE_OK);
    expect(objectUnderTest.state).toEqual(VFS.SQLITE_LOCK_EXCLUSIVE);

    result = await objectUnderTest.unlock(VFS.SQLITE_LOCK_SHARED);
    expect(result).toEqual(VFS.SQLITE_OK);
    expect(objectUnderTest.state).toEqual(VFS.SQLITE_LOCK_SHARED);

    result = await objectUnderTest.unlock(VFS.SQLITE_LOCK_NONE)
    expect(result).toEqual(VFS.SQLITE_OK);
    expect(objectUnderTest.state).toEqual(VFS.SQLITE_LOCK_NONE);

    await new Promise(resolve => setTimeout(resolve));
    const queryResults = await navigator.locks.query();
    expect(queryResults.held.length).toEqual(0);
    expect(queryResults.pending.length).toEqual(0);
  });

  it('should noop on setting same state', async function() {
    let result;
    const objectUnderTest = builder('test');

    result = await objectUnderTest.lock(VFS.SQLITE_LOCK_NONE)
    expect(result).toEqual(VFS.SQLITE_OK);
    expect(objectUnderTest.state).toEqual(VFS.SQLITE_LOCK_NONE);

    await objectUnderTest.lock(VFS.SQLITE_LOCK_SHARED);
    result = await objectUnderTest.lock(VFS.SQLITE_LOCK_SHARED);
    expect(result).toEqual(VFS.SQLITE_OK);
    expect(objectUnderTest.state).toEqual(VFS.SQLITE_LOCK_SHARED);

    await objectUnderTest.lock(VFS.SQLITE_LOCK_RESERVED);
    result = await objectUnderTest.lock(VFS.SQLITE_LOCK_RESERVED);
    expect(result).toEqual(VFS.SQLITE_OK);
    expect(objectUnderTest.state).toEqual(VFS.SQLITE_LOCK_RESERVED);

    await objectUnderTest.lock(VFS.SQLITE_LOCK_EXCLUSIVE);
    result = await objectUnderTest.lock(VFS.SQLITE_LOCK_EXCLUSIVE);
    expect(result).toEqual(VFS.SQLITE_OK);
    expect(objectUnderTest.state).toEqual(VFS.SQLITE_LOCK_EXCLUSIVE);

    await objectUnderTest.unlock(VFS.SQLITE_LOCK_SHARED);
    result = await objectUnderTest.unlock(VFS.SQLITE_LOCK_SHARED);
    expect(result).toEqual(VFS.SQLITE_OK);
    expect(objectUnderTest.state).toEqual(VFS.SQLITE_LOCK_SHARED);

    await objectUnderTest.unlock(VFS.SQLITE_LOCK_NONE)
    result = await objectUnderTest.unlock(VFS.SQLITE_LOCK_NONE)
    expect(result).toEqual(VFS.SQLITE_OK);
    expect(objectUnderTest.state).toEqual(VFS.SQLITE_LOCK_NONE);
  });

  it('should block SHARED request when RESERVED', async function() {
    const blocker = builder('test');
    await blocker.lock(VFS.SQLITE_LOCK_SHARED);
    await blocker.lock(VFS.SQLITE_LOCK_RESERVED);

    const objectUnderTest = builder('test');
    objectUnderTest.timeoutMillis = 10;

    const start = Date.now();
    const result = await objectUnderTest.lock(VFS.SQLITE_LOCK_SHARED);
    expect(Date.now() - start).toBeGreaterThanOrEqual(objectUnderTest.timeoutMillis);
    expect(result).toEqual(VFS.SQLITE_BUSY);
    expect(objectUnderTest.state).toEqual(VFS.SQLITE_LOCK_NONE);
  });

  it('should block SHARED request when EXCLUSIVE', async function() {
    const blocker = builder('test');
    await blocker.lock(VFS.SQLITE_LOCK_SHARED);
    await blocker.lock(VFS.SQLITE_LOCK_RESERVED);
    await blocker.lock(VFS.SQLITE_LOCK_EXCLUSIVE);

    const objectUnderTest = builder('test');
    objectUnderTest.timeoutMillis = 10;

    const start = Date.now();
    const result = await objectUnderTest.lock(VFS.SQLITE_LOCK_SHARED);
    expect(Date.now() - start).toBeGreaterThanOrEqual(objectUnderTest.timeoutMillis);
    expect(result).toEqual(VFS.SQLITE_BUSY);
    expect(objectUnderTest.state).toEqual(VFS.SQLITE_LOCK_NONE);
  });
}

describe('WebLocksExclusive', function() {
  const lockName = 'test-exclusive';
  commonSpecs(() => new WebLocksExclusive(lockName));

  it('should block SHARED request when SHARED', async function() {
    const blocker = new WebLocksExclusive(lockName);
    await blocker.lock(VFS.SQLITE_LOCK_SHARED);

    const objectUnderTest = new WebLocksExclusive(lockName);
    objectUnderTest.timeoutMillis = 10;

    const start = Date.now();
    const result = await objectUnderTest.lock(VFS.SQLITE_LOCK_SHARED);
    expect(Date.now() - start).toBeGreaterThanOrEqual(objectUnderTest.timeoutMillis);
    expect(result).toEqual(VFS.SQLITE_BUSY);
    expect(objectUnderTest.state).toEqual(VFS.SQLITE_LOCK_NONE);
  });

  it('should allow pending locks to succeed', async function() {
    let objectsUnderTest = Array(16).fill(null).map(() => new WebLocksExclusive(lockName));

    // Attempt to lock all objects SHARED.
    objectsUnderTest.forEach(objectUnderTest => objectUnderTest.lock(VFS.SQLITE_LOCK_SHARED));

    while (objectsUnderTest.length) {
      await new Promise(resolve => setTimeout(resolve));

      // Remove objects in SHARED state.
      const startCount = objectsUnderTest.length;
      objectsUnderTest = objectsUnderTest.filter(objectUnderTest => {
        if (objectUnderTest.state === VFS.SQLITE_LOCK_SHARED) {
          objectUnderTest.unlock(VFS.SQLITE_LOCK_NONE);
          return false;
        }
        return true;
      });

      // Check that at most one was removed.
      expect(startCount - objectsUnderTest.length).toBeLessThanOrEqual(1);
    }
  });
});

describe('WebLocksShared', function() {
  const lockName = 'test-shared';
  commonSpecs(() => new WebLocksShared(lockName));

  it('should allow multiple SHARED', async function() {
    for (let i = 0; i < 16; ++i) {
      let objectUnderTest = new WebLocksShared(lockName);
      const result = await objectUnderTest.lock(VFS.SQLITE_LOCK_SHARED);
      expect(result).toEqual(VFS.SQLITE_OK);
      expect(objectUnderTest.state).toEqual(VFS.SQLITE_LOCK_SHARED);
    }
  });

  it('should block EXCLUSIVE request when SHARED', async function() {
    const blocker = new WebLocksShared(lockName);
    await blocker.lock(VFS.SQLITE_LOCK_SHARED);

    const objectUnderTest = new WebLocksShared(lockName);
  
    await objectUnderTest.lock(VFS.SQLITE_LOCK_SHARED);
    await objectUnderTest.lock(VFS.SQLITE_LOCK_RESERVED);

    objectUnderTest.timeoutMillis = 10;
    const start = Date.now();
    const result = await objectUnderTest.lock(VFS.SQLITE_LOCK_EXCLUSIVE);
    expect(Date.now() - start).toBeGreaterThanOrEqual(objectUnderTest.timeoutMillis);
    expect(result).toEqual(VFS.SQLITE_BUSY);
    expect(objectUnderTest.state).toEqual(VFS.SQLITE_LOCK_RESERVED);
  });

  it('should retry RESERVED while outer lock is shared', async function() {
    const objectUnderTest = new WebLocksShared(lockName);

    let releaseSharedLock;
    await new Promise(resolve => {
      navigator.locks.request(objectUnderTest._outerName, { mode: 'shared' }, lock => {
        resolve();
        return new Promise(release => releaseSharedLock = release);
      });
    });

    objectUnderTest.lock(VFS.SQLITE_LOCK_SHARED);
    const reserved = objectUnderTest.lock(VFS.SQLITE_LOCK_RESERVED);
    await new Promise(resolve => setTimeout(resolve, 1000));
    expect(objectUnderTest.state).not.toEqual(VFS.SQLITE_LOCK_RESERVED);

    // @ts-ignore
    releaseSharedLock();
    await reserved;
    expect(objectUnderTest.state).toEqual(VFS.SQLITE_LOCK_RESERVED);
  });

  it('should allow one RESERVED lock', async function() {
    let objectsUnderTest = Array(5).fill(null).map(() => new WebLocksShared(lockName));

    // Lock all objects shared.
    /** @type {Promise[]} */
    let requests = objectsUnderTest.map(objectUnderTest => {
      return objectUnderTest.lock(VFS.SQLITE_LOCK_SHARED);
    });
    await Promise.all(requests);
    for (const objectUnderTest of objectsUnderTest) {
      expect(objectUnderTest.state === VFS.SQLITE_LOCK_SHARED);
    }

    // Attempt to lock RESERVED.
    requests = objectsUnderTest.map(async objectUnderTest => {
      const result = await objectUnderTest.lock(VFS.SQLITE_LOCK_RESERVED);
      if (result === VFS.SQLITE_BUSY) {
        await objectUnderTest.unlock(VFS.SQLITE_LOCK_NONE);
      }
    });
    await Promise.all(requests);

    const reserved = objectsUnderTest.filter(objectUnderTest => {
      return objectUnderTest.state === VFS.SQLITE_LOCK_RESERVED;
    });
    expect(reserved.length).toEqual(1);

    const busy = objectsUnderTest.filter(objectUnderTest => {
      return objectUnderTest.state === VFS.SQLITE_LOCK_NONE;
    });
    expect(busy.length).toEqual(objectsUnderTest.length - 1);
  });
});