// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
// @ts-ignore
import SQLiteESMFactory from '../dist/wa-sqlite.mjs';
// @ts-ignore
import SQLiteAsyncESMFactory from '../dist/wa-sqlite-async.mjs';

import * as SQLite from '../src/sqlite-api.js';

import { MemoryVFS } from '../src/examples/MemoryVFS.js';
import { MemoryAsyncVFS } from '../src/examples/MemoryAsyncVFS.js';
import { IDBBatchAtomicVFS } from '../src/examples/IDBBatchAtomicVFS.js';
import { IDBMinimalVFS } from '../src/examples/IDBMinimalVFS.js';
import { ArrayModule } from '../src/examples/ArrayModule.js';
import { ArrayAsyncModule } from '../src/examples/ArrayAsyncModule.js';

import { tag } from '../src/examples/tag.js';
import GOOG from '../test/GOOG.js';

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

(async function() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('clear')) {
    const dbNames = indexedDB.databases
      ? (await indexedDB.databases()).map(database => database.name)
      : ['sqlite', 'idb-demo'];
    await Promise.all(dbNames.map(dbName => indexedDB.deleteDatabase(dbName)));
    console.log('IndexedDB cleared by URL parameter');
  }

  // Initialize SQLite and Monaco in parallel because both are slow.
  const [SQLiteModule, SQLiteAsyncModule, editor] = await Promise.all([
    SQLiteESMFactory(),
    SQLiteAsyncESMFactory(),
    createEditor()
  ]);

  // Build API objects for each module.
  const sqlite3s = SQLite.Factory(SQLiteModule);
  const sqlite3a = SQLite.Factory(SQLiteAsyncModule);

  // Register Virtual File Systems with the SQLite runtimes. A
  // synchronous VFS will work in both the synchronous and asynchronous
  // runtimes; an asynchronous VFS will work only in the asynchronous
  // runtime.
  sqlite3s.vfs_register(new MemoryVFS());
  sqlite3a.vfs_register(new MemoryVFS());
  sqlite3a.vfs_register(new MemoryAsyncVFS());
  sqlite3a.vfs_register(new IDBMinimalVFS('idb-minimal-demo', { durability: 'relaxed' }));
  sqlite3a.vfs_register(new IDBBatchAtomicVFS('idb-batch-atomic-demo', { durability: 'relaxed' }));

  // Create the set of databases with respective runtime and VFS. For
  // each database we generate a template tag function that is used
  // to submit SQL queries. The tag is an example of an application-level
  // API that can be built on top of the low-level SQLite API.
  const mapNameToTag = new Map();

  async function addTag(key, /** @type {SQLiteAPI}*/sqlite3, vfs) {
    const db = await sqlite3.open_v2(
      vfs,
      SQLite.SQLITE_OPEN_CREATE | SQLite.SQLITE_OPEN_READWRITE | SQLite.SQLITE_OPEN_URI,
      vfs);
    const t = tag(sqlite3, db);
    mapNameToTag.set(key, t);

    // Add an example module with an array back-end.
    // @ts-ignore
    sqlite3.create_module(db, 'array', new ArrayModule(sqlite3, db, GOOG.rows, GOOG.columns));
    if (sqlite3 === sqlite3a) {
      // @ts-ignore
      sqlite3.create_module(
        db,
        'arrayasync',
        // @ts-ignore
        new ArrayAsyncModule(sqlite3, db, GOOG.rows, GOOG.columns));
    }

    // Add example functions regex and regex_replace.
    sqlite3.create_function(
      db,
      'regexp', 2,
      SQLite.SQLITE_UTF8 | SQLite.SQLITE_DETERMINISTIC, 0,
      function(context, values) {
        const pattern = new RegExp(sqlite3.value_text(values[0]))
        const s = sqlite3.value_text(values[1]);
        sqlite3.result(context, pattern.test(s) ? 1 : 0);
      },
      null, null);

    sqlite3.create_function(
      db,
      'regexp_replace', -1,
      SQLite.SQLITE_UTF8 | SQLite.SQLITE_DETERMINISTIC, 0,
      function(context, values) {
        // Arguments are
        // (pattern, s, replacement) or
        // (pattern, s, replacement, flags).
        if (values.length < 3) {
          sqlite3.result(context, '');
          return;  
        }
        const pattern = sqlite3.value_text(values[0]);
        const s = sqlite3.value_text(values[1]);
        const replacement = sqlite3.value_text(values[2]);
        const flags = values.length > 3 ? sqlite3.value_text(values[3]) : '';
        sqlite3.result(context, s.replace(new RegExp(pattern, flags), replacement));
      },
      null, null);
  }
  await addTag('unix', sqlite3s, 'unix');
  await addTag('mem', sqlite3s, 'memory');
  await addTag('mem-async', sqlite3a, 'memory-async');
  await addTag('idb-minimal', sqlite3a, 'idb-minimal-demo');
  await addTag('idb', sqlite3a, 'idb-batch-atomic-demo');

  // The selector widget determines the active template tag function.
  // It is also attached to the window so SQL queries can be easily
  // entered on the browser Dev Tools console.
  const selectDB = document.getElementById('vfs');
  let sql = window['sql'] = mapNameToTag.get(selectDB['value']);

  // Execute SQL on button click.
  const button = /** @type {HTMLButtonElement} */(document.getElementById('execute'));
  document.getElementById('execute').addEventListener('click', async function() {
    button.disabled = true;

    // Get SQL from editor.
    const selection = editor.getSelection();
    const queries = selection.isEmpty() ?
      editor.getValue() :
      editor.getModel().getValueInRange(selection);

    // Clear any previous output on the page.
    const output = document.getElementById('output');
    while (output.firstChild) output.removeChild(output.lastChild);

    const timestamp = document.getElementById('timestamp');
    timestamp.textContent = new Date().toLocaleTimeString();

    let time = Date.now();
    try {
      // Execute the SQL using the template tag function.
      const results = await sql`${queries}`;
      time = Date.now() - time;

      // Everything below this point is just user interface stuff.
      results.map(formatTable).forEach(table => output.append(table));
    } catch (e) {
      // Adjust for browser differences in Error.stack().
      const report = (window['chrome'] ? '' : `${e.message}\n`) + e.stack;
      output.innerHTML = `<pre>${report}</pre>`;
    }
    timestamp.textContent += ` ${time / 1000} seconds`;
    button.disabled = false;
  });

  // Change the button text with selection.
  editor.onDidChangeCursorSelection(({selection}) => {
    document.getElementById('execute').textContent = selection.isEmpty() ?
      'Execute' :
      'Execute selection';
  });

  // Persist editor content across page loads.
  /** @type {*} */ let change = 0;
  editor.onDidChangeModelContent(function() {
    clearTimeout(change);
    change = setTimeout(function() {
      change = 0;
      localStorage.setItem('wa-sqlite demo', editor.getValue());
    }, 1000);
  });
  editor.setValue(localStorage.getItem('wa-sqlite demo') ?? DEFAULT_SQL);

  // Choose VFS.
  selectDB.addEventListener('input', event => {
    sql = window['sql'] = mapNameToTag.get(event.target['value']);
  });
})();

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
  /** @type {any} */ const require = globalThis.require;
  require.config({ paths: { vs: MONACO_VS } });
  const monaco = await new Promise(resolve => {
    require(['vs/editor/editor.main'], resolve);
  });

  // Create editor.
  // https://microsoft.github.io/monaco-editor/api/modules/monaco.editor.html#create
  return monaco.editor.create(document.getElementById('editor-container'), {
    language: 'sql',
    minimap: { enabled: false },
    automaticLayout: true
  });
}

function formatTable({ columns, rows }) {
  const table = document.createElement('table');

  const thead = table.appendChild(document.createElement('thead'));
  thead.appendChild(formatRow(columns, 'th'));

  const tbody = table.appendChild(document.createElement('tbody'));
  for (const row of rows) {
    tbody.appendChild(formatRow(row));
  }

  return table;
}

function formatRow(data, tag = 'td') {
  const row = document.createElement('tr');
  for (const value of data) {
    const cell = row.appendChild(document.createElement(tag));
    cell.textContent = value !== null ? value.toString() : 'null';
  }
  return row;
}