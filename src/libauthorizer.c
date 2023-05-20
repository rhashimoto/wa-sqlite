// Copyright 2023 Roy T. Hashimoto. All Rights Reserved.
#include <emscripten.h>
#include <sqlite3.h>

extern int jsAuth(
  void* db,
  int iActionCode,
  const char* pParam3,
  const char* pParam4,
  const char* pParam5,
  const char* pParam6);

int EMSCRIPTEN_KEEPALIVE set_authorizer(sqlite3* db) {
  return sqlite3_set_authorizer(db, &jsAuth, db);
}