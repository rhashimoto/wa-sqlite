// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
// @ts-ignore
import SQLiteESMFactory from '../dist/wa-sqlite.mjs';
// @ts-ignore
import SQLiteAsyncESMFactory from '../dist/wa-sqlite-async.mjs';

import * as SQLite from '../src/sqlite-api.js';

import { MemoryVFS } from '../src/examples/MemoryVFS.js';
import { IndexedDbVFS } from '../src/examples/IndexedDbVFS.js';

const TESTS = [
  test1,
  test2,
  test3,
  test4,
  test5,
  test6,
  test7,
  test8,
  test9,
  test10,
  test11,
  test12,
  test13,
  test14,
  test15,
  test16,
];

(async function() {
  const [SQLiteModule, SQLiteAsyncModule] = await Promise.all([
    SQLiteESMFactory(),
    SQLiteAsyncESMFactory()
  ]);

  // Build API objects for each module.
  const sqlite3s = SQLite.Factory(SQLiteModule);
  const sqlite3a = SQLite.Factory(SQLiteAsyncModule);

  // Register Virtual File Systems with the SQLite runtimes. A
  // synchronous VFS will work in both the synchronous and asynchronous
  // runtimes; an asynchronous VFS will work only in the asynchronous
  // runtime.
  sqlite3s.vfs_register(new MemoryVFS());
  sqlite3a.vfs_register(new IndexedDbVFS());

  /** @type {Array<[SQLiteAPI, string]>} */
  const configs = [
    [sqlite3s, undefined],
    [sqlite3s, 'memory'],
    [sqlite3a, 'idb']
  ];

  const button = document.getElementById('start');
  const preamble = document.getElementById('preamble');
  const error = document.getElementById('error');
  button.addEventListener('click', async function() {
    button['disabled'] = true;
    preamble['disabled'] = true;
    error.textContent = '';

    const testRows = document.querySelectorAll('tbody tr');
    for (const row of testRows) {
      while (row.childElementCount > 1) {
        row.removeChild(row.lastChild);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      for (const config of configs) {
        const rows = Array.from(testRows);
        for await (const result of benchmark(...config)) {
          const td = document.createElement('td');
          td.textContent = `${result / 1000} s`;
          rows.shift().append(td);
          await new Promise(resolve => setTimeout(resolve));
        }
      }
    } catch (e) {
      const report = (window['chrome'] ? '' : `${e.message}\n`) + e.stack;
      error.textContent = report;
    } finally {
      button['disabled'] = false;
      preamble['disabled'] = false;
    }
  });
  button['disabled'] = false;
})();

/**
 * @param {SQLiteAPI} sqlite3 
 * @param {string} vfs 
 */
async function* benchmark(sqlite3, vfs) {
  const db = await sqlite3.open_v2('benchmark', undefined, vfs);
  try {
    // Delete all tables.
    const tables = [];
    await sqlite3.exec(db, `
      SELECT name FROM sqlite_master WHERE type='table';
    `, row => {
      tables.push(row[0]);
    });
    for (const table of tables) {
      await sqlite3.exec(db, `DROP TABLE ${table}`);
    }

    // Execute the preamble.
    const preamble = document.getElementById('preamble')['value'];
    await sqlite3.exec(db, preamble);

    for (const test of TESTS) {
      const start = Date.now();
      await test(sqlite3, db);
      yield Date.now() - start;
    }
  }
  finally {
    await sqlite3.close(db);
  }
}

// Test 1: 1000 INSERTs
async function test1(sqlite3, db) {
  await sqlite3.exec(db, `
    CREATE TABLE t1(a INTEGER, b INTEGER, c VARCHAR(100));
  `);
  for (let i = 0; i < 1000; ++i) {
    const n = Math.floor(Math.random() * 100000);
    await sqlite3.exec(db, `
      INSERT INTO t1 VALUES(${i + 1}, ${n}, '${numberName(n)}');
    `);
  }
}

// Test 2: 25000 INSERTs in a transaction
async function test2(sqlite3, db) {
  await sqlite3.exec(db, `
    BEGIN;
    CREATE TABLE t2(a INTEGER, b INTEGER, c VARCHAR(100));
  `);
  for (let i = 0; i < 25000; ++i) {
    const n = Math.floor(Math.random() * 100000);
    await sqlite3.exec(db, `
      INSERT INTO t2 VALUES(${i + 1}, ${n}, '${numberName(n)}');
    `);
  }
  await sqlite3.exec(db, `
    COMMIT;
  `);
}

// Test 3: 25000 INSERTs into an indexed table
async function test3(sqlite3, db) {
  await sqlite3.exec(db, `
    BEGIN;
    CREATE TABLE t3(a INTEGER, b INTEGER, c VARCHAR(100));
    CREATE INDEX i3 ON t3(c);
  `);
  for (let i = 0; i < 25000; ++i) {
    const n = Math.floor(Math.random() * 100000);
    await sqlite3.exec(db, `
      INSERT INTO t3 VALUES(${i + 1}, ${n}, '${numberName(n)}');
    `);
  }
  await sqlite3.exec(db, `
    COMMIT;
  `);
}

// Test 4: 100 SELECTs without an index
async function test4(sqlite3, db) {
  await sqlite3.exec(db, `
    BEGIN;
  `);
  for (let i = 0; i < 100; ++i) {
    await sqlite3.exec(db, `
      SELECT count(*), avg(b) FROM t2 WHERE b>=${i * 100} AND b<${i * 100 + 1000};
    `);
  }
  await sqlite3.exec(db, `
    COMMIT;
  `);
}

// Test 5: 100 SELECTs on a string comparison
async function test5(sqlite3, db) {
  await sqlite3.exec(db, `
    BEGIN;
  `);
  for (let i = 0; i < 100; ++i) {
    await sqlite3.exec(db, `
    SELECT count(*), avg(b) FROM t2 WHERE c LIKE '%${numberName(i + 1)}%';
    `);
  }
  await sqlite3.exec(db, `
    COMMIT;
  `);
}

// Test 6: Creating an index
async function test6(sqlite3, db) {
  await sqlite3.exec(db, `
    CREATE INDEX i2a ON t2(a);
    CREATE INDEX i2b ON t2(b);
  `);
}

// Test 7: 5000 SELECTs with an index
async function test7(sqlite3, db) {
  await sqlite3.exec(db, `
    BEGIN;
  `);
  for (let i = 0; i < 5000; ++i) {
    await sqlite3.exec(db, `
      SELECT count(*), avg(b) FROM t2 WHERE b>=${i * 100} AND b<${i * 100 + 100};
    `);
  }
  await sqlite3.exec(db, `
    COMMIT;
  `);
}

// Test 8: 1000 UPDATEs without an index
async function test8(sqlite3, db) {
  await sqlite3.exec(db, `
    BEGIN;
  `);
  for (let i = 0; i < 1000; ++i) {
    await sqlite3.exec(db, `
      UPDATE t1 SET b=b*2 WHERE a>=${i * 10} AND a<${i * 10 + 10};
    `);
  }
  await sqlite3.exec(db, `
    COMMIT;
  `);
}

// Test 9: 25000 UPDATEs with an index
async function test9(sqlite3, db) {
  await sqlite3.exec(db, `
    BEGIN;
  `);
  for (let i = 0; i < 25000; ++i) {
    const n = Math.floor(Math.random() * 100000);
    await sqlite3.exec(db, `
      UPDATE t2 SET b=${n} WHERE a=${i + 1};
    `);
  }
  await sqlite3.exec(db, `
    COMMIT;
  `);
}

// Test 10: 25000 text UPDATEs with an index
async function test10(sqlite3, db) {
  await sqlite3.exec(db, `
    BEGIN;
  `);
  for (let i = 0; i < 25000; ++i) {
    const n = Math.floor(Math.random() * 100000);
    await sqlite3.exec(db, `
      UPDATE t2 SET c='${numberName(n)}' WHERE a=${i + 1};
    `);
  }
  await sqlite3.exec(db, `
    COMMIT;
  `);
}

// Test 11: INSERTs from a SELECT
async function test11(sqlite3, db) {
  await sqlite3.exec(db, `
    BEGIN;
    INSERT INTO t1 SELECT b,a,c FROM t2;
    INSERT INTO t2 SELECT b,a,c FROM t1;
    COMMIT;
  `);
}

// Test 12: DELETE without an index
async function test12(sqlite3, db) {
  await sqlite3.exec(db, `
    DELETE FROM t2 WHERE c LIKE '%fifty%';
  `);
}

// Test 13: DELETE with an index
async function test13(sqlite3, db) {
  await sqlite3.exec(db, `
    DELETE FROM t2 WHERE a>10 AND a<20000;
  `);
}

// Test 14: A big INSERT after a big DELETE
async function test14(sqlite3, db) {
  await sqlite3.exec(db, `
    INSERT INTO t2 SELECT * FROM t1;
  `);
}

// Test 15: A big DELETE followed by many small INSERTs
async function test15(sqlite3, db) {
  await sqlite3.exec(db, `
    BEGIN;
    DELETE FROM t1;
  `);
  for (let i = 0; i < 12000; ++i) {
    const n = Math.floor(Math.random() * 100000);
    await sqlite3.exec(db, `
      INSERT INTO t1 VALUES(${i + 1}, ${n}, '${numberName(n)}');
    `);
  }
  await sqlite3.exec(db, `
    COMMIT;
  `);
}

// Test 16: DROP TABLE
async function test16(sqlite3, db) {
  await sqlite3.exec(db, `
    INSERT INTO t2 SELECT * FROM t1;
  `);
}

const digits = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const names100 = [
  ...digits,
  ...['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'],
  ...digits.map(digit => `twenty${digit && '-' + digit}`),
  ...digits.map(digit => `thirty${digit && '-' + digit}`),
  ...digits.map(digit => `forty${digit && '-' + digit}`),
  ...digits.map(digit => `fifty${digit && '-' + digit}`),
  ...digits.map(digit => `sixty${digit && '-' + digit}`),
  ...digits.map(digit => `seventy${digit && '-' + digit}`),
  ...digits.map(digit => `eighty${digit && '-' + digit}`),
  ...digits.map(digit => `ninety${digit && '-' + digit}`),
]
function numberName(n) {
  if (n === 0) return 'zero';

  const name = [];
  const d43 = Math.floor(n / 1000);
  if (d43) {
    name.push(names100[d43]);
    name.push('thousand');
    n -= d43 * 1000;
  }

  const d2 = Math.floor(n / 100);
  if (d2) {
    name.push(names100[d2]);
    name.push('hundred');
    n -= d2 * 100;
  }

  const d10 = n;
  if (d10) {
    name.push(names100[d10]);
  }

  return name.join(' ');
}