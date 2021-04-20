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
const VFS_NAME = "myVFS";

(async function() {
  // Initialize SQLite and Monaco in parallel because both are slow.
  const [_, editor] = await Promise.all([initSQLite(), createEditor()]);

  // Execute SQL on button click.
  document.getElementById('execute').addEventListener('click', async function() {
    const sql = editor.getValue();

    // Open and close the database on every execution to test data persistence.
    const db = new Database('foo', VFS_NAME);
    try {
      const results = await db.sql`${sql}`
        .then(results => JSON.stringify(results, null, 2))
        .catch(e => e.stack);
      document.getElementById('results').textContent = results;
    } finally {
      db.close();
    }
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

async function initSQLite() {
  const SQLite = await SQLiteFactory();

  // Create and register a VFS.
  const vfs = new MemoryVFS(SQLite);
  SQLite.registerVFS(VFS_NAME, vfs);

  // Attach SQLite to the Database class.
  Database.initialize(SQLite);
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
