import { IDBMinimalVFS } from "../src/examples/IDBMinimalVFS.js";
import { configureTests } from "./VFSTests.js";

const IDB_DATABASE_NAME = 'IDBMinimalVFS_DB';

// jasmine.DEFAULT_TIMEOUT_INTERVAL = 300_000;

class TestVFS extends IDBMinimalVFS {
  constructor(options) {
    super(IDB_DATABASE_NAME, options);
    TestVFS.instances.push(this);
  }

  handleAsync(f) {
    return f();
  }

  static instances = [];

  static async clear() {
    // Close all IndexedDB open databases.
    for (const vfs of TestVFS.instances) {
      vfs.closeIDBContext();
    }
    TestVFS.instances = [];

    // Remove the IndexedDB database.
    await new Promise((resolve, reject) => {
      const db = indexedDB.deleteDatabase(IDB_DATABASE_NAME);
      db.addEventListener('success', resolve);
      db.addEventListener('error', reject);
    });

    // Clear all WebLocks.
    const locks = await navigator.locks.query();
    await Promise.all([...locks.held, ...locks.pending].map(lock => {
      return new Promise(resolve => {
        navigator.locks.request(lock.name, { steal: true }, resolve);
      });
    }));
  }
}

describe('IDBMinimalVFS strict', function() {
  configureTests(() => new TestVFS({ durability: 'strict' }), TestVFS.clear);
});

describe('IDBMinimalVFS relaxed', function() {
  configureTests(() => new TestVFS({ durability: 'relaxed' }), TestVFS.clear);
});