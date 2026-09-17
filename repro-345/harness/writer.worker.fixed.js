import * as SQLite from '../../src/sqlite-api.js';
import { OPFSWriteAheadVFS } from '../vendor-fixed/OPFSWriteAheadVFS.js';

const DB_NAME = 'repro.db';
let sqlite3, db, running = false, tag = 'writer';

function diag(record) {
  postMessage({ kind: 'diag', record });
}

async function init(myTag) {
  tag = myTag || 'writer';
  const { default: moduleFactory } = await import('../../dist/wa-sqlite-async.mjs');
  const module = await moduleFactory();
  sqlite3 = SQLite.Factory(module);

  const vfs = await OPFSWriteAheadVFS.create(DB_NAME, module, {});
  vfs.tag = tag;
  vfs.diagnosticLog = diag;
  sqlite3.vfs_register(vfs, true);

  db = await sqlite3.open_v2(DB_NAME);
  // No journal_mode pragma: OPFSWriteAheadVFS's own user-space WAL is always
  // active for any file it opens (there is no case for journal_mode in its
  // pragma switch, and it throws on SQLITE_OPEN_WAL entirely).
  await sqlite3.exec(db, 'CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, writerTag TEXT, payload BLOB)');
  postMessage({ kind: 'ready' });
}

async function insertLoop({ count, blobSize, delayMs } = {}) {
  running = true;
  // No explicit id: with multiple concurrent writer connections, SQLite's
  // own rowid autoincrement is what has to serialize correctly across them
  // -- assigning our own ids would just mask a real collision as a
  // different-looking failure.
  let n = 0;
  const start = performance.now();
  const target = count ?? Infinity;
  try {
    while (running && n < target) {
      n++;
      const sql = blobSize
        ? `INSERT INTO t (writerTag, payload) VALUES ('${tag}', zeroblob(${blobSize}))`
        : `INSERT INTO t (writerTag, payload) VALUES ('${tag}', NULL)`;
      await sqlite3.exec(db, sql);
      if (n % 100 === 0) postMessage({ kind: 'progress', n, ms: Math.round(performance.now() - start) });
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    }
  } catch (e) {
    postMessage({ kind: 'error', n, error: { name: e.name, message: e.message, stack: e.stack } });
  } finally {
    running = false;
    postMessage({ kind: 'stopped', n });
  }
}

// Matches the community repro's churn pattern exactly (bulk insert via a
// recursive CTE, then trim), which is what actually drives fast, sustained
// WAL swaps -- a one-row-per-await loop never got close to their observed
// ~1.5s swap cadence.
const CHURN_TABLE_SQL = 'CREATE TABLE IF NOT EXISTS churn (id INTEGER PRIMARY KEY, data TEXT)';
const CHURN_INSERT_SQL = `
  WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 150)
  INSERT INTO churn (data) SELECT hex(randomblob(256)) FROM seq`;
const CHURN_TRIM_SQL = 'DELETE FROM churn WHERE id IN (SELECT id FROM churn LIMIT 100)';

async function churnLoop(tickMs) {
  running = true;
  await sqlite3.exec(db, CHURN_TABLE_SQL);
  postMessage({ kind: 'churn-ready' });
  while (running) {
    try {
      await sqlite3.exec(db, CHURN_INSERT_SQL);
      await sqlite3.exec(db, CHURN_TRIM_SQL);
    } catch (e) {
      postMessage({ kind: 'error', error: { name: e.name, message: e.message, stack: e.stack } });
      running = false;
      break;
    }
    await new Promise(r => setTimeout(r, tickMs));
  }
}

self.onmessage = async (event) => {
  const { cmd } = event.data;
  if (cmd === 'init') {
    await init(event.data.tag);
  } else if (cmd === 'start') {
    insertLoop(event.data.opts || {});
  } else if (cmd === 'churn') {
    churnLoop(event.data.tickMs ?? 400);
  } else if (cmd === 'stop') {
    running = false;
  } else if (cmd === 'count') {
    const results = { rows: [] };
    let error = null;
    try {
      await sqlite3.exec(db, 'SELECT COUNT(*) FROM t', (row) => results.rows.push(row));
    } catch (e) {
      error = { name: e.name, message: e.message };
    }
    postMessage({ kind: 'count', value: results.rows[0]?.[0], error });
  } else if (cmd === 'raw-sql') {
    let error = null;
    try {
      await sqlite3.exec(db, event.data.sql);
    } catch (e) {
      error = { name: e.name, message: e.message };
    }
    postMessage({ kind: 'raw-sql-done', sql: event.data.sql, error });
  }
};
