# Deterministic reproduction for #345

This directory reproduces all three symptoms reported in
[#345](https://github.com/rhashimoto/wa-sqlite/issues/345) — `invalid WAL
file`, `disk I/O error`, and `database disk image is malformed` — without
relying on a real multi-tab reload race. It directly engineers the internal
precondition each one needs and delivers it through the real, unmodified
`#handleMessage` code path via a genuine `BroadcastChannel` message (the same
shape a real peer's commit broadcast takes — nothing forged beyond ordinary
public fields, no SDK internals called directly).

It also includes a tested fix (see below), which the same harness runs
against and confirms resolves.

## The mechanism, in short

`WriteAhead`'s `#skipTx` only accepts a broadcast whose file generation
(`salt1`) is exactly one ahead of the connection's own — `#followFileChange`
checks `salt1 + 1` and nothing else. A connection that has fallen behind by
more than one swap gets `throw new Error('invalid WAL file')`.

That alone would be recoverable, except `#advanceTxId` deletes the
transaction from `#mapIdToPendingTx` **before** calling `#skipTx`. When the
throw fires, the id is already gone — nothing else ever re-adds a given id
once its broadcast has been seen — so `#txId` can never advance past it.
Every later broadcast falls through to `#readTx()`, which returns `null`
(the frame it reads no longer matches, since the file has moved on), and
`#activateTx(null)` dereferences it.

`#advanceTxId` and `rejoin()` are both plain synchronous functions, so that
crash — if it happens during `rejoin()` (a broadcast arrived while a read
was isolated) or during `isolateForWrite()` (a write's own catch-up call) —
propagates synchronously into `jUnlock`/`jLock`'s own try/catch, which
converts it to `SQLITE_IOERR_UNLOCK`/`SQLITE_IOERR_LOCK` → `disk I/O error`.

A second, quieter path through the same code produces `malformed` instead of
a throw: at *exactly* one generation behind (not further), the `+1` check in
`#followFileChange` can match a real file by coincidence — the **wrong**
one relative to what the transaction actually names. `#skipTx` doesn't
verify the file it adopted matches `tx.waSalt1`, so it silently continues
with `#activeHandle` pointing at one file and `#activeOffset` describing a
position in a different one. The next real page read pulls real,
checksum-valid bytes from the wrong file at the wrong offset, and SQLite's
own page-structure check reports corruption.

## Layout

```
repro-345/
  vendor/          WriteAhead.js + OPFSWriteAheadVFS.js, UNPATCHED, with a
                   small set of test-only hooks added (see below) — used to
                   demonstrate the bug.
  vendor-fixed/    The same files, WITH the fix from this PR's
                   src/examples/WriteAhead.js applied — used to demonstrate
                   the fix resolves it.
  harness/         The actual reproduction pages.
```

The test-only hooks in `vendor/*` (`testPauseConsumption`,
`testDropTxIds`, `testForceActiveHeaderSalt1`, `testInjectPendingTx`, and a
`diagnosticLog` callback used for observability) are **not** part of the
proposed fix — they only exist to engineer the reproduction deterministically
instead of waiting on real reload timing. The actual fix
(`src/examples/WriteAhead.js` in this PR, outside `repro-345/`) has none of
them.

## Running it

No build step. Serve the repo root over plain HTTP (OPFS needs a secure
context; `http://localhost` qualifies without TLS) and open the pages:

```bash
python3 -m http.server 8935
```

Then, in a Chromium-based browser:

1. `http://localhost:8935/repro-345/harness/clear.html` — wipes OPFS for a
   clean run (do this before each of the pages below; they don't share
   state cleanly across repeated runs otherwise, since some intentionally
   leave a connection in a broken state to observe it).
2. `http://localhost:8935/repro-345/harness/deterministic.html` — phase 1
   reproduces `invalid WAL file`; phase 2, right after, reproduces
   `disk I/O error`. Open the devtools console or read the on-page log.
3. `http://localhost:8935/repro-345/harness/malformed.html` — reproduces
   `database disk image is malformed`.
4. `http://localhost:8935/repro-345/harness/verify-fix.html` — runs against
   `vendor-fixed/`: pauses a connection *before* a writer even starts,
   lets it miss a real swap and every real transaction while blind, then
   unpauses it with the writer still running live, and confirms it
   self-heals with the correct row count, no synthetic data at all.

### What each one actually shows, verified this session

| Page | Result |
|---|---|
| `deterministic.html` phase 1 | `invalid WAL file` — 5/5 runs |
| `deterministic.html` phase 2 | `disk I/O error` — 2/2 runs |
| `malformed.html` | `database disk image is malformed` — 3/3 runs |
| `verify-fix.html` (against the fix) | `sawThrow=false sawUncaught=null readError=null writerRows=500 victimSees=500` |

Re-running `deterministic.html`/`malformed.html` against `vendor-fixed/`
instead of `vendor/` (swap the import in `harness/*.worker.js`) no longer
reproduces either: `#skipTx` finds and adopts the real target generation
(`skipTx-followed`, with `activeHeaderSalt1After` exactly equal to the
transaction's own `waSalt1`) instead of throwing or silently adopting the
wrong file.

## The fix

See `src/examples/WriteAhead.js` in this PR for the actual diff. Three
changes, in order of importance:

1. **Adopt by verified salt match, not by generation hop.** `#skipTx` now
   calls a new `#adoptFileForSalt1(targetSalt1)`, which checks both
   physical WAL files' real on-disk headers for the one that actually holds
   the target salt, instead of only ever accepting "the inactive file, if
   its header happens to read `salt1 + 1`". There are only ever two
   physical files, so if the transaction is still recoverable from disk at
   all, one of them names it exactly. This is what closes the `malformed`
   case: it never adopts on a coincidental match, only a confirmed one.

2. **Don't lose the transaction on a throw.** The pending-map delete moves
   to *after* `#skipTx` succeeds. If it throws, the id stays queued, so a
   retry (the next broadcast, or the backstop) can still make progress
   instead of repeating the identical failure at that `#txId` forever.

3. **Never activate a null transaction.** If `#readTx()` returns `null`,
   `#advanceTxId` now stops advancing for that call instead of falling
   through to `#activateTx(null)`. The pending entries stay queued for the
   next broadcast or the backstop's `readToCurrent` pass.
