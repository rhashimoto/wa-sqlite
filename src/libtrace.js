// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
// This file should be included in the build with --post-js.
(function() {
  const AsyncFunction = Object.getPrototypeOf(async function() { }).constructor;
  let pAsyncFlags = 0;

  Module['trace'] = function(db, mTrace, xTrace) {
    if (pAsyncFlags) {
      Module['deleteCallback'](pAsyncFlags);
      Module['_sqlite3_free'](pAsyncFlags);
      pAsyncFlags = 0;
    }

    pAsyncFlags = Module['_sqlite3_malloc'](4);
    setValue(pAsyncFlags, xTrace instanceof AsyncFunction ? 1 : 0, 'i32');

    ccall(
      'libtrace_trace',
      'void',
      ['number', 'number', 'number', 'number'],
      [db, mTrace, xTrace ? 1 : 0, pAsyncFlags]);
    if (xTrace) {
      Module['setCallback'](pAsyncFlags, (_, opCode, pP, pX) => {
        return xTrace(opCode, pP, pX)
      });
    }
  };
})();
