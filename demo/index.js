// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
// @ts-ignore
import SQLiteFactory from '../dist/wa-sqlite-async.mjs';
import { MemoryAsyncVFS } from '../test/MemoryAsyncVFS.js';
import { Database } from '../test/Database.js';

// This is the path to the local monaco-editor installed via devDependencies.
// This will need to be changed if using a package manager other than Yarn 2.
// The value can also reference an external CDN, e.g.
// https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.23.0/min/vs
const MONACO_VS = '/.yarn/unplugged/monaco-editor-npm-0.23.0-f10184dc03/node_modules/monaco-editor/dev/vs';

const DEFAULT_SQL = `
-- Optionally select statements to execute.
CREATE TABLE tbl (x PRIMARY KEY, y);
REPLACE INTO tbl VALUES ('foo', 6), ('bar', 7);
SELECT y * y FROM tbl WHERE x = 'bar';
`.trim();
const VFS_NAME = "myVFS";

(async function() {
  // Initialize SQLite and Monaco in parallel because both are slow.
  const [_, editor] = await Promise.all([initSQLite(), createEditor()]);

  // Execute SQL on button click.
  document.getElementById('execute').addEventListener('click', async function() {
    const selection = editor.getSelection();
    const sql = selection.isEmpty() ?
      editor.getValue() :
      editor.getModel().getValueInRange(selection);

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

  // Change the button text with selection.
  editor.onDidChangeCursorSelection(({selection}) => {
    document.getElementById('execute').textContent = selection.isEmpty() ?
      'Execute' :
      'Execute selection';
  });

  // Persist editor content across page loads.
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
  const vfs = new MemoryAsyncVFS(SQLite);
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
