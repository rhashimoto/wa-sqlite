// @ts-ignore
import ModuleFactory from '../dist/wa-sqlite.mjs';
import { MemoryVFS } from '../test/MemoryVFS.js';
import { Database } from '../test/Database.js';

const MY_VFS_NAME = "myvfs";

ModuleFactory().then(async Module => {
  Database.initialize(Module);

  // Create and register VFS.
  const vfs = new MemoryVFS(Module);
  Module.registerVFS(MY_VFS_NAME, vfs);

  const db = new Database("foo", MY_VFS_NAME);
  try {
    console.log(await db.sql`SELECT 1 + 1`);
  } finally {
    db.close();
  }
});
