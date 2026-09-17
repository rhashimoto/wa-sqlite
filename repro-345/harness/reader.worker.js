import * as SQLite from '../../src/sqlite-api.js';
import { OPFSWriteAheadVFS } from '../vendor/OPFSWriteAheadVFS.js';

const DB_NAME = 'repro.db';
let sqlite3, db, vfs;

function diag(record) {
  postMessage({ kind: 'diag', record });
}

async function init(myTag) {
  const { default: moduleFactory } = await import('../../dist/wa-sqlite-async.mjs');
  const module = await moduleFactory();
  sqlite3 = SQLite.Factory(module);

  vfs = await OPFSWriteAheadVFS.create(DB_NAME, module, {});
  vfs.tag = myTag || 'reader';
  vfs.diagnosticLog = diag;
  sqlite3.vfs_register(vfs, true);

  db = await sqlite3.open_v2(DB_NAME);
  postMessage({ kind: 'ready' });
}

async function writeOne(label) {
  let error = null;
  try {
    await sqlite3.exec(db, "INSERT INTO t (id, payload) VALUES (99999999, NULL)");
  } catch (e) {
    error = { name: e.name, message: e.message, stack: e.stack };
  }
  postMessage({ kind: 'write', label, error });
}

async function count(label, table) {
  const results = { rows: [] };
  let error = null;
  try {
    await sqlite3.exec(db, `SELECT COUNT(*) FROM ${table ?? 't'}`, (row) => results.rows.push(row));
  } catch (e) {
    error = { name: e.name, message: e.message, stack: e.stack };
  }
  postMessage({ kind: 'count', label, value: results.rows[0]?.[0] ?? null, error });
}

// A synchronous busy-wait. This blocks the worker's OWN event loop for
// `ms` milliseconds: no timers fire, no postMessage/BroadcastChannel
// deliveries are processed, exactly like a frozen/backgrounded tab. It does
// NOT terminate the worker or drop its already-held Web Locks.
function freeze(ms) {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    // spin
  }
}

let pollTimer = null;
let pollN = 0;

self.onmessage = async (event) => {
  const { cmd, ms, label, ids, intervalMs, table } = event.data;
  if (cmd === 'init') {
    await init(event.data.tag);
  } else if (cmd === 'count') {
    await count(label, table);
  } else if (cmd === 'write-one') {
    await writeOne(label);
  } else if (cmd === 'freeze') {
    postMessage({ kind: 'freeze-start', ms });
    freeze(ms);
    postMessage({ kind: 'freeze-end', ms });
  } else if (cmd === 'drop') {
    // Simulate specific broadcasts genuinely never arriving (loss, not
    // delay) while this connection stays fully responsive otherwise.
    for (const id of ids) vfs.testDropTxIds.add(id);
    postMessage({ kind: 'drop-armed', ids });
  } else if (cmd === 'start-poll') {
    // Poll repeatedly so we see exactly which query first observes trouble,
    // without depending on the main page's own timing.
    clearInterval(pollTimer);
    pollN = 0;
    pollTimer = setInterval(() => count(`poll-${pollN++}`, table), intervalMs || 200);
  } else if (cmd === 'stop-poll') {
    clearInterval(pollTimer);
    pollTimer = null;
  } else if (cmd === 'pause-consumption') {
    // Deterministic stand-in for "this connection's BroadcastChannel
    // listener is not running right now" -- every 'tx' broadcast is
    // ignored entirely while true, no busy-loop needed.
    vfs.testPauseConsumption = true;
    postMessage({ kind: 'paused' });
  } else if (cmd === 'unpause-consumption') {
    vfs.testPauseConsumption = false;
    postMessage({ kind: 'unpaused' });
  } else if (cmd === 'force-active-header-salt1') {
    const file = vfs.mapPathToFile.get(DB_NAME);
    file.writeAhead.testForceActiveHeaderSalt1(event.data.salt1);
    postMessage({ kind: 'forced-active-header', salt1: event.data.salt1 });
  } else if (cmd === 'inject-pending-tx') {
    const file = vfs.mapPathToFile.get(DB_NAME);
    file.writeAhead.testInjectPendingTx(event.data.id, event.data.waSalt1);
    postMessage({ kind: 'injected-pending-tx', id: event.data.id });
  }
};
