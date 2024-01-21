import { TestContext } from "./TestContext.js";
import { vfs_xOpen } from "./vfs_xOpen.js";
import { vfs_xAccess } from "./vfs_xAccess.js";
import { vfs_xClose } from "./vfs_xClose.js";
import { vfs_xRead } from "./vfs_xRead.js";
import { vfs_xWrite } from "./vfs_xWrite.js";

describe('IDBBatchAtomicVFS asyncify', function() {
  const context = new TestContext('asyncify', 'IDBBatchAtomicVFS');

  vfs_xAccess(context);
  vfs_xOpen(context);
  vfs_xClose(context);
  vfs_xRead(context);
  vfs_xWrite(context);  
});

describe('OriginPrivateVFS jspi', function() {
  const context = new TestContext('jspi', 'OriginPrivateVFS');

  vfs_xAccess(context);
  vfs_xOpen(context);
  vfs_xClose(context);
  vfs_xRead(context);
  vfs_xWrite(context);  
});