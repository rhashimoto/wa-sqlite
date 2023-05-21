// Copyright 2023 Roy T. Hashimoto. All Rights Reserved.
#include <emscripten.h>
#include <sqlite3.h>

extern int jsProgress(void* db);

void EMSCRIPTEN_KEEPALIVE progress_handler(sqlite3* db, int nProgressOps) {
  sqlite3_progress_handler(db, nProgressOps, nProgressOps ? &jsProgress : 0, db);
}