import * as VFS from '../src/VFS.js';

const FILE_ID = 42;
const FILE_ID1 = 43;

const TEXT = `
Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis
nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore
eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt
in culpa qui officia deserunt mollit anim id est laborum.`
  .trim().replace(/\n/g, ' ');

const LOCK_TYPE_MASK =
  VFS.SQLITE_LOCK_NONE |
  VFS.SQLITE_LOCK_SHARED |
  VFS.SQLITE_LOCK_RESERVED |
  VFS.SQLITE_LOCK_EXCLUSIVE;

export class Skip {
}

/**
 * 
 * @param {() => any} build 
 * @param {() => void|Promise<void>} clear 
 * @param {Iterable} skip 
 */
export function configureTests(build, clear, skip = []) {
  const skipSet = new Set(skip);

  /** @type {VFS.Base} */ let objectUnderTest;
  beforeEach(async function() {
    await clear();
    objectUnderTest = wrapVFS(await build());
  });

  afterEach(async function() {
    await clear();
  });

  let result;
  const pOut = {
    value: null,
    set(value) { this.value = value; },
    pass() { this.value = null; return this; }
  };

  it('should create a file', async function() {
    const filename = 'foo';
    await objectUnderTest.xAccess(filename, VFS.SQLITE_ACCESS_EXISTS, pOut.pass());
    expect(pOut.value).toBeFalsy();

    result = await objectUnderTest.xOpen(
      filename, FILE_ID,
      VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE,
      pOut.pass());
    expect(result).toEqual(VFS.SQLITE_OK);
    expect(pOut.value & VFS.SQLITE_OPEN_READONLY).toEqual(0);

    await objectUnderTest.xAccess(filename, VFS.SQLITE_ACCESS_EXISTS, pOut.pass());
    expect(pOut.value).toBeTruthy();
  });

  it('should delete a file', async function() {
    const filename = 'foo';
    await objectUnderTest.xOpen(
      filename, FILE_ID,
      VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE,
      pOut.pass());
    await objectUnderTest.xClose(FILE_ID);
    await objectUnderTest.xAccess(filename, VFS.SQLITE_ACCESS_EXISTS, pOut.pass());
    expect(pOut.value).toBeTruthy();

    await objectUnderTest.xDelete(filename, 1);
    await objectUnderTest.xAccess(filename, VFS.SQLITE_ACCESS_EXISTS, pOut.pass());
    expect(pOut.value).toBeFalsy();
  });

  it('should write and read data', async function() {
    const filename = 'foo';
    await objectUnderTest.xOpen(
      filename, FILE_ID,
      VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE,
      pOut.pass());

    const text = 'the quick brown fox jumps over the lazy dog'.split(/\s/);

    // write
    let iOffset = 0;
    for (const s of text) {
      await writeString(objectUnderTest, FILE_ID, s, iOffset);
      iOffset += s.length;
    }

    // read
    iOffset = 0;
    for (const s of text) {
      const sRead = await readString(objectUnderTest, FILE_ID, s.length, iOffset);
      iOffset += s.length;

      expect(sRead).toBe(s);
    }

    // done
    await objectUnderTest.xClose(FILE_ID);
  });

  it('should track file size', async function() {
    const filename = 'foo';
    await objectUnderTest.xOpen(
      filename, FILE_ID,
      VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE,
      pOut.pass());

  });
}

/**
 * 
 * @param {VFS.Base} vfs 
 * @return {VFS.Base}
 */
function wrapVFS(vfs) {
  // Create a Proxy wrapper to track the lock state and add a convenience
  // function to set the state in one call.
  let lockState = VFS.SQLITE_LOCK_NONE;
  return new Proxy(vfs, {
    get(target, property, receiver) {
      switch (property) {
        case 'xLock':
          return async function(fileId, flags) {
            const targetState = flags & LOCK_TYPE_MASK;
            const result = await vfs.xLock(fileId, flags);
            if (result === VFS.SQLITE_OK) {
              lockState = targetState;
            }
            return result;
          };
        
        case 'xUnlock':
          return async function(fileId, flags) {
            const targetState = flags & LOCK_TYPE_MASK;
            const result = await vfs.xUnlock(fileId, flags);
            if (result === VFS.SQLITE_OK) {
              lockState = targetState;
            }
            return result;
          };
        
        case 'setLockState':
          return async function(fileId, targetState) {
            if (targetState > lockState) {
              // lock
              switch (targetState) {
                case VFS.SQLITE_LOCK_SHARED:
                  switch (lockState) {
                    case VFS.SQLITE_LOCK_NONE:
                      await receiver.xLock(fileId, VFS.SQLITE_LOCK_SHARED);
                  }
                  break;
                
                case VFS.SQLITE_LOCK_RESERVED:
                  switch(lockState) {
                    case VFS.SQLITE_LOCK_NONE:
                      await receiver.xLock(fileId, VFS.SQLITE_LOCK_SHARED);
                    case VFS.SQLITE_LOCK_SHARED:
                      await receiver.xLock(fileId, VFS.SQLITE_LOCK_RESERVED);
                  }
                  break;
        
                case VFS.SQLITE_LOCK_EXCLUSIVE:
                  switch(lockState) {
                    case VFS.SQLITE_LOCK_NONE:
                      await receiver.xLock(fileId, VFS.SQLITE_LOCK_SHARED);
                    case VFS.SQLITE_LOCK_SHARED:
                      await receiver.xLock(fileId, VFS.SQLITE_LOCK_RESERVED);
                    case VFS.SQLITE_LOCK_EXCLUSIVE:
                      await receiver.xLock(fileId, VFS.SQLITE_LOCK_EXCLUSIVE);
                  }
                  break;
              }
            } else if (targetState < lockState) {
              // unlock
              switch (targetState) {
                case VFS.SQLITE_LOCK_NONE:
                  switch (lockState) {
                    case VFS.SQLITE_LOCK_EXCLUSIVE:
                      await receiver.xUnlock(fileId, VFS.SQLITE_LOCK_SHARED);
                    case VFS.SQLITE_LOCK_SHARED:
                      await receiver.xUnlock(fileId, VFS.SQLITE_LOCK_NONE);
                  }
                  break;
                
                case VFS.SQLITE_LOCK_SHARED:
                  switch (lockState) {
                    case VFS.SQLITE_LOCK_EXCLUSIVE:
                      await receiver.xUnlock(fileId, VFS.SQLITE_LOCK_SHARED);
                  }
                  break;

                case VFS.SQLITE_LOCK_RESERVED:
                  switch (lockState) {
                    case VFS.SQLITE_LOCK_EXCLUSIVE:
                      await receiver.xUnlock(fileId, VFS.SQLITE_LOCK_SHARED);
                      await receiver.xLock(fileId, VFS.SQLITE_LOCK_RESERVED);
                  }
                  break;
              }
            }
          };

        default:
          const value = Reflect.get(target, property, receiver);
          return typeof value == 'function' ? value.bind(target) : value;
      }
    }
  });
}

/**
 * @param {VFS.Base} vfs 
 * @param {number} fileId 
 * @param {string} s 
 * @param {number} iOffset 
 */
async function writeString(vfs, fileId, s, iOffset) {
  const encoded = new TextEncoder().encode(s);
  const pData = {
    size: encoded.byteLength,
    value: new Int8Array(encoded.buffer)
  };

  // @ts-ignore
  await vfs.setLockState(FILE_ID, VFS.SQLITE_LOCK_EXCLUSIVE);

  const result = await vfs.xWrite(fileId, pData, iOffset);
  if (result !== VFS.SQLITE_OK) throw new Error('write failed');
}

/**
 * @param {VFS.Base} vfs 
 * @param {number} fileId 
 * @param {number} size
 * @param {number} iOffset 
 */
async function readString(vfs, fileId, size, iOffset) {
  const pData = {
    size,
    value: new Int8Array(size)
  };

  // @ts-ignore
  await vfs.setLockState(FILE_ID, VFS.SQLITE_LOCK_SHARED);

  const result = await vfs.xRead(fileId, pData, iOffset);
  if (result !== VFS.SQLITE_OK) throw new Error('read failed');
  return new TextDecoder().decode(pData.value);
}