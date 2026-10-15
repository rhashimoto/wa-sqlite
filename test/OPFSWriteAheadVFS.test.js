import { TestContext } from "./TestContext.js";
import { vfs_root } from "./vfs_root.js";
import { vfs_xOpen } from "./vfs_xOpen.js";
import { vfs_xAccess } from "./vfs_xAccess.js";
import { vfs_xClose } from "./vfs_xClose.js";
import { vfs_xRead } from "./vfs_xRead.js";
import { vfs_xWrite } from "./vfs_xWrite.js";
import { vfs_read_freshness } from "./vfs_read_freshness.js";
import { vfs_open_cleanup } from "./vfs_open_cleanup.js";

const CONFIG = 'OPFSWriteAheadVFS';
const BUILDS = ['default', 'asyncify', 'jspi'];

const supportsJSPI = await TestContext.supportsJSPI();

describe(CONFIG, function() {
  for (const build of BUILDS) {
    if (build === 'jspi' && !supportsJSPI) return;

    describe(build, function() {
      const context = new TestContext({ build, config: CONFIG });
    
      vfs_xAccess(context);
      vfs_xOpen(context);
      vfs_xClose(context);
      vfs_xRead(context);
      vfs_xWrite(context);
      vfs_read_freshness({ build });
      vfs_open_cleanup(context);
    });
  }
});

describe(`${CONFIG} with a custom root`, function() {
  // The default build only: where the files go does not depend on the build.
  const context = new TestContext({ config: `${CONFIG}-customRoot` });

  vfs_xAccess(context);
  vfs_xOpen(context);
  vfs_xClose(context);
  vfs_xRead(context);
  vfs_xWrite(context);
  vfs_root({ config: CONFIG });
});
