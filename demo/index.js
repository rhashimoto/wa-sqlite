// @ts-ignore
import SQLiteFactory from '../dist/wa-sqlite.mjs';
import { MemoryVFS } from '../test/MemoryVFS.js';
import { Database } from '../test/Database.js';

const MONACO_VS = '/.yarn/unplugged/monaco-editor-npm-0.23.0-f10184dc03/node_modules/monaco-editor/dev/vs';
const DEFAULT_SQL = 'SELECT 6 * 7;';

(async function() {
  // Create database and editor in parallel.
  const [db, editor] = await Promise.all([createDatabase(), createEditor()]);

  // Execute SQL on button click.
  document.getElementById('execute').addEventListener('click', async () => {
    const sql = editor.getValue();
    const results = await db.sql`${sql}`
      .then(results => JSON.stringify(results, null, 2))
      .catch(e => e.stack);
    document.getElementById('results').textContent = results;
  });

  // Persist SQL across page loads.
  let change = 0;
  editor.onDidChangeModelContent(() => {
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
  Database.initialize(SQLite);

  // Create and register VFS.
  const vfs = new MemoryVFS(SQLite);
  SQLite.registerVFS("my_vfs", vfs);

  // Create a database.
  return new Database("foo", "my_vfs");
}

async function createEditor() {
  // Load Monaco.
  await new Promise(resolve => {
    // Insert a script element to bootstrap the monaco loader.
    // configured path from a document meta element.
    const loader = document.createElement('script');
    loader.src = `${MONACO_VS}/loader.js`;
    loader.async = true;
    loader.addEventListener('load', resolve, { once: true });
    document.head.appendChild(loader);
  });

  globalThis.require.config({ paths: { vs: MONACO_VS } });
  const monaco = await new Promise(resolve => {
    globalThis.require(['vs/editor/editor.main'], resolve);
  });

  // Create editor.
  return monaco.editor.create(document.getElementById('editor-container'), {
    language: 'sql',
    minimap: { enabled: false },
    automaticLayout: true
  });
}
