import { TestContext } from "./TestContext.js";
import { vfs_xOpen } from "./vfs_xOpen.js";
import { vfs_xAccess } from "./vfs_xAccess.js";
import { vfs_xClose } from "./vfs_xClose.js";
import { vfs_xRead } from "./vfs_xRead.js";
import { vfs_xWrite } from "./vfs_xWrite.js";
import { vfs_open_lock_recovery } from "./vfs_open_lock_recovery.js";

const CONFIG = 'OPFSAdaptiveVFS';
const BUILDS = ['asyncify', 'jspi'];

const supportsJSPI = await TestContext.supportsJSPI();

describe(CONFIG, function() {
  it('should load where FileSystemSyncAccessHandle is unavailable', async function() {
    // The interface exists in dedicated workers only, so this page lacks it,
    // as do Node and a page that is not a secure context.
    expect(globalThis.FileSystemSyncAccessHandle).toBeUndefined();
    let error;
    try {
      await import('../src/examples/OPFSAdaptiveVFS.js');
    } catch (e) {
      error = e;
    }
    expect(error?.message).toBeUndefined();
  });

  for (const build of BUILDS) {
    if (build === 'jspi' && !supportsJSPI) return;

    describe(build, function() {
      const context = new TestContext({ build, config: CONFIG });
    
      vfs_xAccess(context);
      vfs_xOpen(context);
      vfs_xClose(context);
      vfs_xRead(context);
      vfs_xWrite(context);
      vfs_open_lock_recovery({ build });
    });
  }
});
