// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
// @ts-ignore
import SQLiteFactory from '../dist/wa-sqlite.mjs';
import { MemoryVFS } from '../test/MemoryVFS.js';
import { Database } from '../test/Database.js';

// This is the path to the local monaco-editor installed via devDependencies.
// This will need to be changed if using a package manager other than Yarn 2.
// The value can also reference an external CDN, e.g.
// https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.23.0/min/vs
const MONACO_VS = '/.yarn/unplugged/monaco-editor-npm-0.23.0-f10184dc03/node_modules/monaco-editor/dev/vs';

const DEFAULT_SQL = 'SELECT 6 * 7;';

(async function() {
  // Create database and editor in parallel because both are slow.
  const [db, editor] = await Promise.all([createDatabase(), createEditor()]);

  // Execute SQL on button click.
  document.getElementById('execute').addEventListener('click', async function() {
    const sql = editor.getValue();
    const results = await db.sql`${sql}`
      .then(results => JSON.stringify(results, null, 2))
      .catch(e => e.stack);
    document.getElementById('results').textContent = results;
  });

  // Persist SQL across page loads.
  let change = 0;
  editor.onDidChangeModelContent(function() {
    clearTimeout(change);
    change = setTimeout(function() {
      change = 0;
      localStorage.setItem('wa-sqlite demo', editor.getValue());
    }, 1000);
  });
  editor.setValue(localStorage.getItem('wa-sqlite demo') ?? DEFAULT_SQL);
})();

async function createDatabase() {
  const SQLite = await SQLiteFactory();

  // Create and register a VFS.
  const vfs = new MemoryVFS(SQLite);
  SQLite.registerVFS("my_vfs", vfs);

  // Create a database. This class was developed for testing and is not
  // considered ready for use in production code.
  Database.initialize(SQLite);
  return new Database("foo", "my_vfs");
}

async function createEditor() {
  // Insert a script element to bootstrap the monaco loader.
  await new Promise(resolve => {
    const loader = document.createElement('script');
    loader.src = `${MONACO_VS}/loader.js`;
    loader.async = true;
    loader.addEventListener('load', resolve, { once: true });
    document.head.appendChild(loader);
  });

  // Load monaco itself.
  globalThis.require.config({ paths: { vs: MONACO_VS } });
  const monaco = await new Promise(resolve => {
    globalThis.require(['vs/editor/editor.main'], resolve);
  });

  // Create editor.
  // https://microsoft.github.io/monaco-editor/api/modules/monaco.editor.html#create
  return monaco.editor.create(document.getElementById('editor-container'), {
    language: 'sql',
    minimap: { enabled: false },
    automaticLayout: true
  });
}
