// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
// @ts-ignore
import SQLiteESMFactory from '../dist/wa-sqlite.mjs';
// @ts-ignore
import SQLiteAsyncESMFactory from '../dist/wa-sqlite-async.mjs';

import * as SQLite from '../src/sqlite-api.js';

import { MemoryVFS } from '../src/examples/MemoryVFS.js';
import { MemoryAsyncVFS } from '../src/examples/MemoryAsyncVFS.js';
import { IndexedDbVFS } from '../src/examples/IndexedDbVFS.js';
import { WebTorrentVFS } from '../src/examples/WebTorrentVFS.js';
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
  sqlite3a.vfs_register(new IndexedDbVFS());

  const webseedUrl = new URL("./GOOG.db", document.URL).toString();

  // ws is not used without peers, because meta (piece info) is missing
  // instead we have to use a full torrent file
  const magnetUri = `magnet:?xt=urn:btih:a40d817caba3681fe50022b0dda5fbf5d31f3ca9&dn=GOOG.db&ws=${encodeURIComponent(webseedUrl)}&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com`;

  const b64toBlob = (base64, type = "application/octet-stream") => fetch(`data:${type};base64,${base64}`).then(res => res.blob())
  const torrentBase64 = "ZDg6YW5ub3VuY2U0MDp1ZHA6Ly90cmFja2VyLmxlZWNoZXJzLXBhcmFkaXNlLm9yZzo2OTY5MTM6YW5ub3VuY2UtbGlzdGxsNDA6dWRwOi8vdHJhY2tlci5sZWVjaGVycy1wYXJhZGlzZS5vcmc6Njk2OWVsMzQ6dWRwOi8vdHJhY2tlci5jb3BwZXJzdXJmZXIudGs6Njk2OWVsMzM6dWRwOi8vdHJhY2tlci5vcGVudHJhY2tyLm9yZzoxMzM3ZWwyMzp1ZHA6Ly9leHBsb2RpZS5vcmc6Njk2OWVsMzE6dWRwOi8vdHJhY2tlci5lbXBpcmUtanMudXM6MTMzN2VsMjY6d3NzOi8vdHJhY2tlci5idG9ycmVudC54eXplbDMyOndzczovL3RyYWNrZXIub3BlbndlYnRvcnJlbnQuY29tZWUxMDpjcmVhdGVkIGJ5MzQ6V2ViVG9ycmVudCA8aHR0cHM6Ly93ZWJ0b3JyZW50LmlvPjEzOmNyZWF0aW9uIGRhdGVpMTYyMTc3OTU3N2U4OmVuY29kaW5nNTpVVEYtODQ6aW5mb2Q2Omxlbmd0aGk5NDIwOGU0Om5hbWU3OkdPT0cuZGIxMjpwaWVjZSBsZW5ndGhpMTYzODRlNjpwaWVjZXMxMjA63UmSQ5U1eLDJpHHzQ9cXWV4+ldkUiJV5VCL4UX5xyXgvbFMlW0hxtAosaxG1T5FNTIBwTmyeAXG+kc51XgtE4XFwZ5flrqZ9GZUp1LxOGRxqECW95MIA82jEsuRrjpYxXVvXGpgVpGqhFiLJgYWf797sguFdeQB5Nzpwcml2YXRlaTBlZWU=";
  const torrentBlob = await b64toBlob(torrentBase64);

  // cut off last endmarker & add the dynamic webseed url
  const torrent = new Blob([torrentBlob.slice(0, -1), `8:url-listl${webseedUrl.length}:${webseedUrl}ee`], {type:"application/x-bittorrent"});

  sqlite3a.vfs_register(new WebTorrentVFS(torrent));

  // Create the set of databases with respective runtime and VFS. For
  // each database we generate a template tag function that is used
  // to submit SQL queries. The tag is an example of an application-level
  // API that can be built on top of the low-level SQLite API.
  const mapNameToTag = new Map();

  async function addTag(key, /** @type {SQLiteAPI}*/sqlite3, vfs) {
    let name = vfs;
    if (vfs === "webtorrent") {
      name = "GOOG.db";
    }
    const db = await sqlite3.open_v2(name, undefined, vfs);
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
  }
  await addTag('unix', sqlite3s, 'unix');
  await addTag('mem', sqlite3s, 'memory');
  await addTag('mem-async', sqlite3a, 'memory-async');
  await addTag('idb', sqlite3a, 'idb');
  await addTag('webtorrent', sqlite3a, 'webtorrent');

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

      if (e.code === SQLite.SQLITE_BUSY) {
        document.getElementById('busy').style.display = 'block';
      }
    }
    timestamp.textContent += ` ${time / 1000} seconds`;
    button.disabled = false;
  });

  document.getElementById('unlock').addEventListener('click', async () => {
    const vfs = new IndexedDbVFS();
    await vfs.forceClearLock('idb');
    vfs.close();
    document.getElementById('busy').style.display = 'none';
  });

  document.getElementById('delete').addEventListener('click', async () => {
    const vfs = new IndexedDbVFS();
    await vfs.deleteFile('idb');
    vfs.close();
    window.location.reload();
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