import { TestContext } from "./TestContext.js";
import { vfs_xOpen } from "./vfs_xOpen.js";
import { vfs_xAccess } from "./vfs_xAccess.js";
import { vfs_xClose } from "./vfs_xClose.js";
import { vfs_xRead } from "./vfs_xRead.js";
import { vfs_xWrite } from "./vfs_xWrite.js";

describe('MemoryVFS', function() {
  const context = new TestContext('default', 'MemoryVFS');

  vfs_xAccess(context);
  vfs_xOpen(context);
  vfs_xClose(context);
  vfs_xRead(context);
  vfs_xWrite(context);  
});