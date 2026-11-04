// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
#include <emscripten.h>
#include <sqlite3.h>

// Some SQLite API functions take a pointer to a function that frees
// memory. Although we could add a C binding to a JavaScript function
// that calls sqlite3_free(), it is more efficient to pass the sqlite3_free
// function pointer directly. This function provides the C pointer to
// JavaScript.
void* EMSCRIPTEN_KEEPALIVE getSqliteFree() {
  return sqlite3_free;
}

#ifdef SQLITE_WASM_EXTRA_INIT
int SQLITE_WASM_EXTRA_INIT(void);
#endif

int main() {
  int rc = sqlite3_initialize();
#ifdef SQLITE_WASM_EXTRA_INIT
  if (rc == SQLITE_OK) rc = SQLITE_WASM_EXTRA_INIT();
#endif
  return rc;
}