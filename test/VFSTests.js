import * as VFS from '../src/VFS.js';

const FILE_ID = 0xdeadbeef;
const TEXT = `
Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis
nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore
eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt
in culpa qui officia deserunt mollit anim id est laborum.`
  .trim().replace(/\n/g, ' ');

/**
 * 
 * @param {() => any} build 
 * @param {() => void|Promise<void>} clear 
 * @param {Iterable} skip 
 */
export function configureTests(build, clear, skip = []) {
  beforeEach(async function() {
    await clear();
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
    const objectUnderTest = await build();

    const filename = 'foo';
    await objectUnderTest.xAccess(filename, VFS.SQLITE_ACCESS_EXISTS, pOut.pass());
    expect(pOut.value).toBeFalsy();

    result = await objectUnderTest.xOpen(
      filename, FILE_ID,
      VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE,
      pOut.pass());
    expect(result).toEqual(VFS.SQLITE_OK);
    expect(pOut.value & VFS.SQLITE_OPEN_READONLY).toEqual(0);

    result = await objectUnderTest.xAccess(filename, VFS.SQLITE_ACCESS_EXISTS, pOut.pass());
    expect(result).toEqual(VFS.SQLITE_OK);
    expect(pOut.value).toBeTruthy();

    result = await objectUnderTest.xClose(FILE_ID);
    expect(result).toEqual(VFS.SQLITE_OK);
    result = await objectUnderTest.xAccess(filename, VFS.SQLITE_ACCESS_EXISTS, pOut.pass());
    expect(result).toEqual(VFS.SQLITE_OK);
    expect(pOut.value).toBeTruthy();
  });

  it('should delete a file', async function() {
    const objectUnderTest = await build();
    
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
    const objectUnderTest = await build();
    
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
    const objectUnderTest = await build();
    
    const filename = 'foo';
    await objectUnderTest.xOpen(
      filename, FILE_ID,
      VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE,
      pOut.pass());

    result = await objectUnderTest.xFileSize(FILE_ID, pOut);
    expect(result).toBe(VFS.SQLITE_OK);
    expect(pOut.value).toBe(0);

    let expectedSize = 0;
    for (const s of TEXT.split(/\s/)) {
      await writeString(objectUnderTest, FILE_ID, s, expectedSize);
      expectedSize += s.length;

      result = await objectUnderTest.xFileSize(FILE_ID, pOut);
      expect(result).toBe(VFS.SQLITE_OK);
      expect(pOut.value).toBe(expectedSize);
    }

    for (let i = 0; i < 20; ++i) {
      await writeString(objectUnderTest, FILE_ID, TEXT, expectedSize);
      expectedSize += TEXT.length;

      result = await objectUnderTest.xFileSize(FILE_ID, pOut);
      expect(result).toBe(VFS.SQLITE_OK);
      expect(pOut.value).toBe(expectedSize);
    }
  });

  it('should truncate a file', async function() {
    const objectUnderTest = await build();
    
    const filename = 'foo';
    await objectUnderTest.xOpen(
      filename, FILE_ID,
      VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE,
      pOut.pass());

    let expectedSize = 0;
    for (let i = 0; i < 20; ++i) {
      await writeString(objectUnderTest, FILE_ID, TEXT, expectedSize);
      expectedSize += TEXT.length;
    }

    const truncatedSize = expectedSize - TEXT.length;
    result = await objectUnderTest.xTruncate(FILE_ID, truncatedSize);
    expect(result).toBe(VFS.SQLITE_OK);

    result = await objectUnderTest.xFileSize(FILE_ID, pOut);
    expect(result).toBe(VFS.SQLITE_OK);
    expect(pOut.value).toBe(truncatedSize);
  });

  it('should return a valid sector size', async function() {
    const objectUnderTest = await build();
    
    const filename = 'foo';
    await objectUnderTest.xOpen(
      filename, FILE_ID,
      VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE,
      pOut.pass());

    result = await objectUnderTest.xSectorSize(FILE_ID);
    expect(result).toBeGreaterThanOrEqual(512);
    expect(result).toBeLessThanOrEqual(65536);
    expect(result & (result - 1)).toBe(0); // power of 2
  });

  it('should delete on close', async function() {
    const objectUnderTest = await build();
    
    const filename = 'foo';
    await objectUnderTest.xOpen(
      filename, FILE_ID,
      VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE | VFS.SQLITE_OPEN_DELETEONCLOSE,
      pOut.pass());
    await writeString(objectUnderTest, FILE_ID, TEXT, 0);
    const s = await readString(objectUnderTest, FILE_ID, TEXT.length, 0);
    expect(s).toEqual(TEXT);

    result = await objectUnderTest.xClose(FILE_ID);
    expect(result).toBe(VFS.SQLITE_OK);

    result = await objectUnderTest.xAccess(filename, VFS.SQLITE_ACCESS_EXISTS, pOut);
    expect(result).toBe(VFS.SQLITE_OK);
    expect(pOut.value).toBeFalsy();
  });

  it('should open with null filename', async function() {
    const objectUnderTest = await build();
    
    result = await objectUnderTest.xOpen(
      null, FILE_ID,
      VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE | VFS.SQLITE_OPEN_DELETEONCLOSE,
      pOut.pass());

    await writeString(objectUnderTest, FILE_ID, TEXT, 0);
    const s = await readString(objectUnderTest, FILE_ID, TEXT.length, 0);
    expect(s).toEqual(TEXT);

    result = await objectUnderTest.xClose(FILE_ID);
    expect(result).toBe(VFS.SQLITE_OK);
  });

  it('should handle short read from empty file', async function() {
    const objectUnderTest = await build();
    
    result = await objectUnderTest.xOpen(
      null, FILE_ID,
      VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE | VFS.SQLITE_OPEN_DELETEONCLOSE,
      pOut.pass());

    const pData = { value: new Int8Array(16), size: 16 };
    pData.value.fill(-1);
    result = await objectUnderTest.xRead(FILE_ID, pData, 24);
    expect(result).toBe(VFS.SQLITE_IOERR_SHORT_READ);
    expect(Array.from(pData.value)).toEqual(new Array(16).fill(0));
  });

  it('should batch atomic commit if configured', async function() {
    const objectUnderTest = await build();
    
    const characteristics = await objectUnderTest.xDeviceCharacteristics(FILE_ID);
    if (characteristics & VFS.SQLITE_IOCAP_BATCH_ATOMIC) {

    }
  });;

  it('should batch atomic rollback if configured ', async function() {
    const objectUnderTest = await build();
    
    const characteristics = await objectUnderTest.xDeviceCharacteristics(FILE_ID);
    if (characteristics & VFS.SQLITE_IOCAP_BATCH_ATOMIC) {

    }
  });

  it('should allow contention', async function() {
    const objectUnderTest = await build();
    
    const nInstances = 8;
    const nIterations = 5;
    async function go(filename, fileId) {
      await objectUnderTest.xOpen(
        filename,
        fileId,
        VFS.SQLITE_OPEN_READWRITE | VFS.SQLITE_OPEN_MAIN_JOURNAL,
        pOut.pass());
      for (let i = 0; i < nIterations; ++i) {
        const pDataA = { value: new Int8Array(4), size: 4 };
        const pDataB = { value: new Int8Array(4), size: 4 };

        let maybeBusy;
        do {
          maybeBusy = await transact(objectUnderTest, fileId, async function() {
            // Read two ints.
            await objectUnderTest.xRead(fileId, pDataA, 0);
            await new Promise(resolve => setTimeout(resolve));
            await objectUnderTest.xRead(fileId, pDataB, 4);
            await new Promise(resolve => setTimeout(resolve));

            expect(Array.from(pDataA.value)).toEqual(Array.from(pDataB.value));
          }, async function() {
            // Increment ints.
            const viewA = new DataView(pDataA.value.buffer);
            const viewB = new DataView(pDataB.value.buffer);
            viewA.setInt32(0, viewA.getInt32(0) + 1);
            viewB.setInt32(0, viewB.getInt32(0) + 1);

            // Store ints.
            await objectUnderTest.xWrite(fileId, pDataA, 0);
            await new Promise(resolve => setTimeout(resolve));
            await objectUnderTest.xWrite(fileId, pDataB, 4);
            await new Promise(resolve => setTimeout(resolve));
          });
        } while (maybeBusy === VFS.SQLITE_BUSY);
      }
    }

    await objectUnderTest.xOpen(
      'foo', FILE_ID,
      VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE | VFS.SQLITE_OPEN_MAIN_JOURNAL,
      pOut.pass());

    const pData = { value: new Int8Array(4), size: 4 };
    await objectUnderTest.xWrite(FILE_ID, pData, 0);
    await objectUnderTest.xWrite(FILE_ID, pData, 4);
    await objectUnderTest.xClose(FILE_ID);

    const instances = [];
    for (let i = 0; i < nInstances; ++i) {
      instances.push(go('foo', i));
    }

    await Promise.all(instances);

    await objectUnderTest.xOpen(
      'foo', FILE_ID,
      VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE,
      pOut.pass());

    const view = new DataView(pData.value.buffer);
    await objectUnderTest.xRead(FILE_ID, pData, 0);
    expect(view.getInt32(0)).toBe(nInstances * nIterations);
    await objectUnderTest.xRead(FILE_ID, pData, 4);
    expect(view.getInt32(0)).toBe(nInstances * nIterations);
    await objectUnderTest.xClose(FILE_ID);
  });
}

/**
 * @param {VFS.Base} vfs 
 * @param {number} fileId 
 * @param {(vfs?: VFS.Base, fileId?: number) => Promise<number|void>} [shared]
 * @param {(vfs?: VFS.Base, fileId?: number) => Promise<number|void>} [exclusive]
 * @returns {Promise<*>}
 */
 async function transact(vfs, fileId, shared, exclusive) {
  try {
    /** @type {number} */ let result;
    result = await vfs.xLock(fileId, VFS.SQLITE_LOCK_SHARED)
    if (result === VFS.SQLITE_BUSY) return result;
    if (result !== VFS.SQLITE_OK) throw new Error(`xLock returned ${result}`);

    if (shared) {
      await shared(vfs, fileId);
    }

    if (exclusive) {
      result = await vfs.xLock(fileId, VFS.SQLITE_LOCK_RESERVED)
      if (result === VFS.SQLITE_BUSY) return result;
      if (result !== VFS.SQLITE_OK) throw new Error(`xLock returned ${result}`);

      result = await vfs.xLock(fileId, VFS.SQLITE_LOCK_EXCLUSIVE)
      if (result === VFS.SQLITE_BUSY) return result;
      if (result !== VFS.SQLITE_OK) throw new Error(`xLock returned ${result}`);

      await exclusive(vfs, fileId);

      const pOut = { value: new Int8Array() };
      result = await vfs.xFileControl(fileId, VFS.SQLITE_FCNTL_SYNC, pOut);

      result = await vfs.xSync(fileId, VFS.SQLITE_SYNC_NORMAL);
      if (result !== VFS.SQLITE_OK) throw new Error(`xSync returned ${result}`);

      result = await vfs.xFileControl(fileId, VFS.SQLITE_FCNTL_COMMIT_PHASETWO, pOut);
      
      result = await vfs.xUnlock(fileId, VFS.SQLITE_LOCK_SHARED);
      if (result !== VFS.SQLITE_OK) throw new Error(`xUnlock returned ${result}`);

      result = await vfs.xUnlock(fileId, VFS.SQLITE_LOCK_NONE);
      if (result !== VFS.SQLITE_OK) throw new Error(`xUnlock returned ${result}`);
    }
  } catch (e) {
    debugger;
    throw e;
  }
  return VFS.SQLITE_OK;
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

  const result = await vfs.xRead(fileId, pData, iOffset);
  if (result !== VFS.SQLITE_OK) throw new Error('read failed');
  return new TextDecoder().decode(pData.value);
}