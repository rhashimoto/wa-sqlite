import { coalesceReads, coalesceWrites } from '../src/examples/WriteAhead.js';

const PAGE_SIZE = 4096;
const FRAME_SIZE = 32 + PAGE_SIZE;
const WAL2_KEY_OFFSET = 2 ** 52;

// The checkpoint from this SQL, with the base plan's single-page actions:
//   INSERT INTO t VALUES (0, RANDOMBLOB(4080));
//   INSERT INTO t VALUES (1, RANDOMBLOB(4080));
//   REPLACE INTO t VALUES (0, RANDOMBLOB(4080));
const BASE_PLAN = basePlan([
  [0, 33184],
  [4096, 37312],
  [8192, 41440],
  [16384, 45568],
  [12288, 29024],
]);

/**
 * @param {[number, number][]} writes database offset and WAL key
 */
function basePlan(writes) {
  return {
    pageSize: PAGE_SIZE,
    actions: writes.flatMap(([at, page]) => [
      { action: 'read', pages: [page] },
      { action: 'write', at, pages: [page] },
    ]),
  };
}

// Execute a plan against a model: returns database offset -> WAL key.
function execute(plan) {
  const buffered = new Set();
  const db = new Map();
  for (const { action, at, pages } of plan.actions) {
    if (action === 'read') {
      pages.forEach(page => buffered.add(page));
    } else {
      pages.forEach((page, i) => {
        if (!buffered.delete(page)) throw new Error(`page ${page} not read`);
        db.set(at + i * plan.pageSize, page);
      });
    }
  }
  expect(buffered.size).withContext('unwritten reads').toBe(0);
  return db;
}

// Peak buffer usage: unretired reads plus the next write.
function bufferUsage(plan) {
  const reads = [];
  let peak = 0;
  for (const { action, pages } of plan.actions) {
    if (action === 'read') {
      reads.push({ pages: new Set(pages), size: Math.max(...pages) - Math.min(...pages) + plan.pageSize });
    } else {
      const unretired = reads.filter(read => read.pages.size).reduce((sum, read) => sum + read.size, 0);
      peak = Math.max(peak, unretired + pages.length * plan.pageSize);
      reads.forEach(read => pages.forEach(page => read.pages.delete(page)));
    }
  }
  return peak;
}

function randomPlan(nPages, random) {
  const offsets = [...Array(nPages).keys()].map(i => i * PAGE_SIZE);
  offsets.sort(() => random() - 0.5);
  let key = 32 + 32;
  return basePlan(offsets.map(offset => {
    key += random() < 0.7 ? FRAME_SIZE : 3 * FRAME_SIZE;
    if (random() < 0.05) key += WAL2_KEY_OFFSET * (key < WAL2_KEY_OFFSET ? 1 : 0);
    return [offset, key];
  }));
}

function lcg(seed) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

describe('WriteAhead checkpoint plan', function() {
  it('coalesceWrites groups contiguous database pages', function() {
    const plan = coalesceWrites(BASE_PLAN, { bufferSize: 1 << 20 });
    expect(plan.actions).toEqual([
      { action: 'read', pages: [33184] },
      { action: 'read', pages: [37312] },
      { action: 'read', pages: [41440] },
      { action: 'read', pages: [29024] },
      { action: 'read', pages: [45568] },
      { action: 'write', at: 0, pages: [33184, 37312, 41440, 29024, 45568] },
    ]);
  });

  it('coalesceWrites splits runs to fit the buffer', function() {
    // Room for two pages, their reads, and the frame headers between
    // them should coalesceReads join those reads.
    const plan = coalesceWrites(BASE_PLAN, { bufferSize: 2 * (2 * PAGE_SIZE + 32) });
    expect(plan.actions).toEqual([
      { action: 'read', pages: [33184] },
      { action: 'read', pages: [37312] },
      { action: 'write', at: 0, pages: [33184, 37312] },
      { action: 'read', pages: [41440] },
      { action: 'read', pages: [29024] },
      { action: 'write', at: 8192, pages: [41440, 29024] },
      { action: 'read', pages: [45568] },
      { action: 'write', at: 16384, pages: [45568] },
    ]);
  });

  it('coalesceWrites leaves discontiguous pages apart', function() {
    const plan = coalesceWrites(basePlan([[8192, 64], [0, 4192]]), { bufferSize: 1 << 20 });
    expect(plan.actions).toEqual([
      { action: 'read', pages: [4192] },
      { action: 'write', at: 0, pages: [4192] },
      { action: 'read', pages: [64] },
      { action: 'write', at: 8192, pages: [64] },
    ]);
  });

  it('coalesceReads joins consecutive frames that supply one write', function() {
    const plan = coalesceReads(coalesceWrites(BASE_PLAN, { bufferSize: 2 * (2 * PAGE_SIZE + 32) }));
    expect(plan.actions).toEqual([
      { action: 'read', pages: [33184, 37312] },
      { action: 'write', at: 0, pages: [33184, 37312] },
      { action: 'read', pages: [29024] },
      { action: 'read', pages: [41440] },
      { action: 'write', at: 8192, pages: [41440, 29024] },
      { action: 'read', pages: [45568] },
      { action: 'write', at: 16384, pages: [45568] },
    ]);
  });

  it('coalesceReads never joins frames from different WAL files', function() {
    const page = 64 + FRAME_SIZE;
    const plan = coalesceReads(coalesceWrites(
      basePlan([[0, 64], [4096, page], [8192, WAL2_KEY_OFFSET + page + FRAME_SIZE]]),
      { bufferSize: 1 << 20 }));
    expect(plan.actions.filter(({ action }) => action === 'read')).toEqual([
      { action: 'read', pages: [64, page] },
      { action: 'read', pages: [WAL2_KEY_OFFSET + page + FRAME_SIZE] },
    ]);
  });

  it('planners write the same pages within the buffer size', function() {
    const random = lcg(361);
    for (const bufferSize of [1, 3 * PAGE_SIZE, 16 * FRAME_SIZE, 1 << 20]) {
      for (let trial = 0; trial < 20; trial++) {
        const base = randomPlan(1 + Math.floor(random() * 300), random);
        const expected = execute(base);
        const writes = coalesceWrites(base, { bufferSize });
        const reads = coalesceReads(writes);
        expect(execute(writes)).toEqual(expected);
        expect(execute(reads)).toEqual(expected);

        // A single page is the floor, whatever the buffer size.
        const limit = Math.max(bufferSize, 2 * PAGE_SIZE);
        expect(bufferUsage(writes)).toBeLessThanOrEqual(limit);
        expect(bufferUsage(reads)).toBeLessThanOrEqual(limit);
      }
    }
  });
});
