#include <emscripten.h>
#include <sqlite3.h>
#include <stdio.h>

#include "libadapters.h"

#define CALL_JS(SIGNATURE, KEY, ...)                                           \
  (asyncFlags ? SIGNATURE##_async(KEY, __VA_ARGS__)                            \
              : SIGNATURE(KEY, __VA_ARGS__))

static int libtrace_xTrace(unsigned opCode, void *pApp, void *P, void *X) {
  const int asyncFlags = pApp ? *(int *)pApp : 0;
  return CALL_JS(ippipp, pApp, pApp, opCode, P, X);
}

void EMSCRIPTEN_KEEPALIVE libtrace_trace(sqlite3 *db, unsigned mTrace,
                                         int xTrace, void *pApp) {
  sqlite3_trace_v2(db, mTrace, xTrace ? &libtrace_xTrace : NULL, pApp);
}
