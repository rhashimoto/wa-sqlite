// Copyright 2023 Roy T. Hashimoto. All Rights Reserved.
import { SharedService } from "./SharedService/SharedService.js";

// This is the path to the Monaco editor distribution. For development
// this loads from the local server (uses Yarn 2 path).
const MONACO_VS = location.hostname.endsWith('localhost') ?
  '/.yarn/unplugged/monaco-editor-npm-0.34.1-03d887d213/node_modules/monaco-editor/dev/vs' :
  'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.34.1/min/vs';

const DEFAULT_SQL = `
-- Optionally select statements to execute.

-- Example virtual table with some stock prices.
CREATE VIRTUAL TABLE IF NOT EXISTS goog USING array;

-- Copy virtual table into a native table (on the current VFS):
CREATE TABLE IF NOT EXISTS copied AS SELECT * FROM goog;
SELECT * FROM copied LIMIT 5;`.trim();

const SHARED_SERVICE_NAME = 'ahp-demo';
const SQL_KEY = 'wa-sqlite demo sql';

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
  const editorReady = createMonacoEditor().then(editor => {
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
        localStorage.setItem(SQL_KEY, editor.getValue());
      }, 1000);
    });
    editor.setValue(localStorage.getItem(SQL_KEY) ?? DEFAULT_SQL);

    return editor;
  });

  // Connect Worker and SharedService.
  const worker = new Worker('./ahp-worker.js', { type: 'module' });
  const sharedService = new SharedService(SHARED_SERVICE_NAME, async () => {
    const providerPort = await new Promise(resolve => {
      worker.addEventListener('message', event => {
        resolve(event.ports[0]);
      }, { once: true });
      worker.postMessage(null);
    });
    return providerPort;
  }, './SharedService/SharedService_SharedWorker.js');
  sharedService.activate();

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
      // Execute the SQL using the template tag proxy from the Worker.
      const results = await sharedService.proxy.query(queries);
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

async function createMonacoEditor() {
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