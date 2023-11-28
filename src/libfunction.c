// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
#include <emscripten.h>
#include <sqlite3.h>

extern void jsFunc(void* pApp, sqlite3_context* pContext, int iCount, sqlite3_value** ppValues);
extern void jsStep(void* pApp, sqlite3_context* pContext, int iCount, sqlite3_value** ppValues);
extern void jsFinal(void* pApp, sqlite3_context* pContext);
extern int jsUpdateHook(void *pApp, int updateType, const char *dbName, const char *tblName, int lo32, int hi32);

static void xFunc(sqlite3_context* pContext, int iCount, sqlite3_value** ppValues) {
  jsFunc(sqlite3_user_data(pContext), pContext, iCount, ppValues);
}

static void xStep(sqlite3_context* pContext, int iCount, sqlite3_value** ppValues) {
  jsStep(sqlite3_user_data(pContext), pContext, iCount, ppValues);
}

static void xFinal(sqlite3_context* pContext) {
  jsFinal(sqlite3_user_data(pContext), pContext);
}

static void xUpdateHook(void *pApp, int updateType, const char *dbName, const char *tblName, sqlite3_int64 rowid) {
  int hi32 = ((rowid & 0xFFFFFFFF00000000LL) >> 32);
  int lo32 = (rowid & 0xFFFFFFFFLL);
  jsUpdateHook(pApp, updateType, dbName, tblName, lo32, hi32);
}

int EMSCRIPTEN_KEEPALIVE create_function(
  sqlite3* db,
  const char* zFunctionName,
  int nArg,
  int eTextRep,
  void* pApp,
  int functionType) {
  return sqlite3_create_function(
    db,
    zFunctionName,
    nArg,
    eTextRep,
    pApp,
    functionType == 0 ? &xFunc : 0,
    functionType == 0 ? 0 : &xStep,
    functionType == 0 ? 0 : &xFinal);
}

void EMSCRIPTEN_KEEPALIVE update_hook(
    sqlite3 *db,
    void *pApp) {
  sqlite3_update_hook(db, &xUpdateHook, pApp);
}