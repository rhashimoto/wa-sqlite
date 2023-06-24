import { SharedService } from "./SharedService/SharedService.js";

const DEFAULT_DURATION_SECONDS = 10;

const DEFAULT_CONFIG = {
  seconds: DEFAULT_DURATION_SECONDS,
  perRun: `
-- This query is used to initialize the database.
-- It runs only on the initiating tab.
CREATE TABLE IF NOT EXISTS kv (key PRIMARY KEY, value);
REPLACE INTO kv VALUES ('counter', 0);

CREATE TABLE IF NOT EXISTS log (time, tabId, count);
DELETE FROM log;
  `.trim(),

  perTab: `
-- This query is used for per-tab initialization.
-- AccessHandlePoolVFS uses a single shared database connection
-- so use per run initialization instead.
  `.trim(),

  perJob: `
-- This query is repeated on each tab until time expires.
BEGIN IMMEDIATE;
UPDATE kv SET value = value + 1 WHERE key='counter';
INSERT INTO log VALUES
  ((SELECT (julianday('now') - 2440587.5)*86400000.0), :tabId, (SELECT value FROM kv WHERE key='counter'));
COMMIT;
  `.trim(),

  results: `
-- This query is used to extract results from the database.
DELETE FROM log WHERE time > :deadline;

WITH counts AS (SELECT COUNT(1) AS count FROM log GROUP BY tabId)
SELECT JSON_GROUP_ARRAY(count) AS "count by tab", SUM(count) AS "sum", SUM(count)/CAST(:seconds AS REAL) AS "per second" FROM counts;  `.trim()
};

const DATE_OPTIONS = {
  hour12: false,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3
};

const SHARED_SERVICE_NAME = 'ahp-demo';
const SUBS_REGEX = /:[A-Za-z][A-Za-z0-9_]*/g;

class ContentionDemo extends EventTarget {
  #label;
  #tabId = Math.random().toString(36).replace('0.', '');
  #sharedWorker = new SharedWorker('./contention-sharedworker.js');

  #dbProxy;

  constructor() {
    super();

    const params = new URLSearchParams(window.location.search);
    this.#prepare(params.has('clear'));

    this.#sharedWorker.port.start();

    new BroadcastChannel('clients').addEventListener('message', ({data}) => {
      if (data.label === this.#label) {
        this.dispatchEvent(new CustomEvent('clients', { detail: data }));
      }
    });
  
    document.getElementById('newtab').addEventListener('click', () => {
      window.open(window.location.href, '_blank');
    });
  }

  async requestStart(config) {
    try {
      config.label = this.#label;
      await this.#execute(config.perRun, { tabId: this.#tabId });
      this.#sharedWorker.port.postMessage({
        type: 'go',
        config
      });
    } catch (e) {
      this.#logError(e);
    }
  }

  async #prepare(clear) {
    try {
      if (clear) {
        this.#log('clearing storage');
        localStorage.clear();
        const worker = new Worker('./clean-worker.js', { type: 'module' });
        await new Promise(resolve => {
          worker.addEventListener('message', resolve);
        });
        worker.terminate();
      }

      // Instantiate the database Worker.
      const worker = new Worker('./ahp-worker.js', { type: 'module' });
      const sharedService = new SharedService(SHARED_SERVICE_NAME, async () => {
        const providerPort = await new Promise(resolve => {
          worker.addEventListener('message', event => {
            resolve(event.ports[0]);
          }, { once: true });
          worker.postMessage(null);
        });
        return providerPort;
      });
      sharedService.activate();

      this.#dbProxy = sharedService.proxy;

      navigator.locks.request(this.#tabId, () => new Promise(() => {
        // Register with the SharedWorker.
        this.#sharedWorker.port.postMessage({
          type: 'register',
          label: this.#label,
          name: this.#tabId
        });

        new BroadcastChannel('go').addEventListener('message', ({data}) => {
          if (data.label === this.#label) {
            this.#go(data);
          }
        });
        this.dispatchEvent(new CustomEvent('ready'));

        // This Promise never resolves so we keep the lock until exit.
      }));
    } catch (e) {
      this.#logError(e);
    }
  }

  async #go(config) {
    try {
      this.dispatchEvent(new CustomEvent('go', { detail: config }));

      const subs = {
        tabId: this.#tabId,
        deadline: config.deadline,
        seconds: config.seconds
      };
      await this.#execute(config.perTab, subs);
      while (Date.now() < config.deadline) {
        await this.#execute(config.perJob, subs);
      }

      const results = await this.#execute(config.results, subs);
      for (const result of results) {
        this.dispatchEvent(new CustomEvent('result', { detail: result }));
      }
    } catch (e) {
      this.#logError(e);
    }
    this.dispatchEvent(new CustomEvent('ready'));
  }

  #execute(query, subs = {}) {
    const sql = query.replaceAll(SUBS_REGEX, (match) => {
      const value = subs[match.substring(1)];
      return typeof value === 'string' ? `'${value}'` : value;
    });
    return this.#dbProxy.query(sql);
  }

  #log(s) {
    // @ts-ignore
    const timestamp = new Date().toLocaleTimeString(undefined, DATE_OPTIONS);
    const value = `${timestamp} ${s}`;
    this.dispatchEvent(new CustomEvent('log', { detail: value }));
  }

  #logError(e) {
    const s = e.stack.includes(e.message) ? e.stack : `${e.message}\n${e.stack}`;
    this.#log(s);
  }
}

const demo = new ContentionDemo();

demo.addEventListener('clients', function(/** @type {CustomEvent} */ event) {
  document.getElementById('clientCount').textContent = String(event.detail.size);
});

demo.addEventListener('ready', function(/** @type {CustomEvent} */ event) {
    // @ts-ignore
    document.getElementById('start').disabled = false;
});

demo.addEventListener('go', function countDown(/** @type {CustomEvent} */ event) {
  // @ts-ignore
  document.getElementById('start').disabled = true;
});

demo.addEventListener('go', function countDown(/** @type {CustomEvent} */ event) {
  const deadline = event.detail.deadline;
  const clock = document.getElementById('clock');

  const now = Date.now();
  if (now < deadline) {
    const value = Math.round((deadline - now) / 1000);
    clock.textContent = value.toString();
    setTimeout(() => countDown(event), 1000);
  } else {
    clock.textContent = '';
  }
});

demo.addEventListener('result', function(/** @type {CustomEvent} */ event) {
  const result = event.detail;

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);

  const tr = document.createElement('tr');
  thead.appendChild(tr);
  for (const column of result.columns) {
    const th = document.createElement('th');
    tr.appendChild(th);
    th.textContent = String(column);
  }

  for (const row of result.rows) {
    const tr = document.createElement('tr');
    tbody.appendChild(tr);
    for (const column of row) {
      const td = document.createElement('td');
      tr.appendChild(td);
      td.textContent = String(column);
    }
  }

  document.getElementById('output').appendChild(table);
});

demo.addEventListener('log', function countDown(/** @type {CustomEvent} */ event) {
  const output = document.getElementById('output');
  const pre = document.createElement('pre');
  output.appendChild(pre);

  pre.textContent = event.detail;
});

(function() {
  const seconds = document.getElementById('seconds');
  seconds['value'] = DEFAULT_CONFIG.seconds.toString();

  const textAreas = document.getElementsByClassName('sql');
  for (const textArea of Array.from(textAreas)) {
    // @ts-ignore
    textArea.value = DEFAULT_CONFIG[textArea.id];
  }
})();

document.getElementById('start').addEventListener('click', function() {
  const config = {};
  const seconds = document.getElementById('seconds');
  // @ts-ignore
  config.seconds = Number(seconds.value);

  const textAreas = document.getElementsByClassName('sql');
  for (const textArea of Array.from(textAreas)) {
    // @ts-ignore
    config[textArea.id] = textArea.value;
  }
  demo.requestStart(config);
});