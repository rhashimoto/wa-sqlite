// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
// @ts-ignore
import * as Comlink from "https://unpkg.com/comlink/dist/esm/comlink.mjs";

// This is the path to the local monaco-editor installed via devDependencies.
// This will need to be changed if using a package manager other than Yarn 2.
// The value can also reference an external CDN, e.g.
// https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.23.0/min/vs
const MONACO_VS = '/.yarn/unplugged/monaco-editor-npm-0.34.1-03d887d213/node_modules/monaco-editor/dev/vs';

const DEFAULT_SQL = `
-- Optionally select statements to execute.
CREATE TABLE IF NOT EXISTS tbl (x PRIMARY KEY, y);
REPLACE INTO tbl VALUES ('foo', 6), ('bar', 7);
SELECT y * y FROM tbl WHERE x = 'bar';
`.trim();

// Define the selectable configurations.
const DATABASE_CONFIGS = new Map([
  {
    label: 'unix / standard',
    isAsync: false,
  },
  {
    label: 'Memory / standard',
    isAsync: false,
    vfsModule: '../src/examples/MemoryVFS.js',
    vfsClass: 'MemoryVFS',
    vfsArgs: []
  },
  {
    label: 'MemoryAsync / asyncify',
    isAsync: true,
    vfsModule: '../src/examples/MemoryAsyncVFS.js',
    vfsClass: 'MemoryAsyncVFS',
    vfsArgs: []
  },
  {
    label: 'IDBMinimal / asyncify',
    isAsync: true,
    vfsModule: '../src/examples/IDBMinimalVFS.js',
    vfsClass: 'IDBMinimalVFS',
    vfsArgs: ['demo-IDBMinimalVFS']
  },
  {
    label: 'IDBBatchAtomic / asyncify',
    isAsync: true,
    vfsModule: '../src/examples/IDBBatchAtomicVFS.js',
    vfsClass: 'IDBBatchAtomicVFS',
    vfsArgs: ['demo-IDBBatchAtomicVFS']
  },
  {
    label: 'OriginPrivateFileSystem / asyncify',
    isAsync: true,
    vfsModule: '../src/examples/OriginPrivateFileSystemVFS.js',
    vfsClass: 'OriginPrivateFileSystemVFS',
    vfsArgs: []
  }
].map(obj => [obj.label, obj]));

window.addEventListener('DOMContentLoaded', async function() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('clear')) {
    localStorage.clear();
    const worker = new Worker('./clean-worker.js', { type: 'module' });
    await new Promise(resolve => {
      worker.addEventListener('message', resolve);
    });
    worker.terminate();
  }

  // Load the Monaco editor
  const button = /** @type {HTMLButtonElement} */(document.getElementById('execute'));
  const editorReady = createEditor().then(editor => {
    // Change the button text with selection.
    editor.onDidChangeCursorSelection(({selection}) => {
      button.textContent = selection.isEmpty() ?
        'Execute' :
        'Execute selection';
    });

    // Persist editor content across page loads.
    let change;
    editor.onDidChangeModelContent(function() {
      clearTimeout(change);
      change = setTimeout(function() {
        localStorage.setItem('wa-sqlite demo sql', editor.getValue());
      }, 1000);
    });
    editor.setValue(localStorage.getItem('wa-sqlite demo sql') ?? DEFAULT_SQL);

    return editor;
  });

  // Populate the VFS selector.
  const select = /** @type {HTMLSelectElement} */(document.getElementById('vfs'));
  for (const [key, config] of DATABASE_CONFIGS) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = config.label;
    select.appendChild(option);

    // Restore the last used config.
    const savedConfig = localStorage.getItem('wa-sqlite demo config');
    if (savedConfig === key) {
      option.selected = true;
    }
  }

  // Handle new VFS selection.
  let sql, worker;
  select.addEventListener('change', async (event) => {
    button.disabled = true;

    // Restart the worker.
    worker?.terminate();
    worker = new Worker('./demo-worker.js', { type: 'module' });

    // Configure the worker database.
    const config = DATABASE_CONFIGS.get(select.value);
    const workerProxy = Comlink.wrap(worker);
    sql = await workerProxy(config);

    // Remember the config for next page load.
    localStorage.setItem('wa-sqlite demo config', select.value);

    // Also expose the query function for use in the debug console.
    window['sql'] = sql;

    button.disabled = false;
  });
  select.dispatchEvent(new CustomEvent('change'));

  // Execute SQL on button click.
  button.addEventListener('click', async function() {
    button.disabled = true;

    // Get SQL from editor.
    const editor = await editorReady;
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
      results.map(formatTable).forEach(table => output.append(table));
    } catch (e) {
      // Adjust for browser differences in Error.stack().
      const report = (window['chrome'] ? '' : `${e.message}\n`) + e.stack;
      output.innerHTML = `<pre>${report}</pre>`;
    } finally {
      timestamp.textContent += ` ${(Date.now() - time) / 1000} seconds`;
      button.disabled = false;
    }
  });
});

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