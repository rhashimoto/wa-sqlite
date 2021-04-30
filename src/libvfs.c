// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
#include <emscripten.h>
#include <sqlite3.h>
#include <string.h>

// sqlite3_io_methods javascript handlers
// 64-bit integer parameters are passed by pointer.
extern int vfsClose(sqlite3_file* file);
extern int vfsRead(sqlite3_file* file, void* pData, int iAmt, const sqlite3_int64* iOffset);
extern int vfsWrite(sqlite3_file* file, const void* pData, int iAmt, const sqlite3_int64* iOffset);
extern int vfsTruncate(sqlite3_file* file, const sqlite3_int64* size);
extern int vfsSync(sqlite3_file* file, int flags);
extern int vfsFileSize(sqlite3_file* file, sqlite3_int64* pSize);
extern int vfsLock(sqlite3_file* file, int flags);
extern int vfsUnlock(sqlite3_file* file, int flags);
extern int vfsCheckReservedLock(sqlite3_file* file, int* pResOut);
extern int vfsFileControl(sqlite3_file* file, int flags, void* pOut);
extern int vfsSectorSize(sqlite3_file* file);
extern int vfsDeviceCharacteristics(sqlite3_file* file);

extern int vfsOpen(sqlite3_vfs* vfs, const char *zName, sqlite3_file* file, int flags, int *pOutFlags);
extern int vfsDelete(sqlite3_vfs* vfs, const char *zName, int syncDir);
extern int vfsAccess(sqlite3_vfs* vfs, const char *zName, int flags, int *pResOut);

// Glue functions to pass 64-bit integers by pointer.
static int xRead(sqlite3_file* file, void* pData, int iAmt, sqlite3_int64 iOffset) {
  return vfsRead(file, pData, iAmt, &iOffset);
}
static int xWrite(sqlite3_file* file, const void* pData, int iAmt, sqlite3_int64 iOffset) {
  return vfsWrite(file, pData, iAmt, &iOffset);
}
static int xTruncate(sqlite3_file* file, sqlite3_int64 size) {
  return vfsTruncate(file, &size);
}

static int xOpen(sqlite3_vfs* vfs, const char* zName, sqlite3_file* file, int flags, int* pOutFlags) {
  static sqlite3_io_methods io_methods = {
    1,
    vfsClose,
    xRead,
    xWrite,
    xTruncate,
    vfsSync,
    vfsFileSize,
    vfsLock,
    vfsUnlock,
    vfsCheckReservedLock,
    vfsFileControl,
    vfsSectorSize,
    vfsDeviceCharacteristics
  };
  file->pMethods = &io_methods;

  return vfsOpen(vfs, zName, file, flags, pOutFlags);
}

static int xFullPathname(sqlite3_vfs* vfs, const char* zName, int nOut, char* zOut) {
  strncpy(zOut, zName, nOut);
  return SQLITE_OK;
}

const sqlite3_vfs* EMSCRIPTEN_KEEPALIVE register_vfs(
  const char* zName,
  int mxPathName,
  int makeDefault) {
  sqlite3_vfs* vfs = (sqlite3_vfs*)sqlite3_malloc(sizeof(sqlite3_vfs));
  vfs->iVersion = 1;
  vfs->szOsFile = sizeof(sqlite3_file);
  vfs->mxPathname = mxPathName;
  vfs->pNext = NULL;
  vfs->zName = strdup(zName);
  vfs->pAppData = NULL;
  vfs->xOpen = xOpen;
  vfs->xDelete = vfsDelete;
  vfs->xAccess = vfsAccess;
  vfs->xFullPathname = xFullPathname;

  // Get remaining functionality from the default VFS.
  sqlite3_vfs* defer = sqlite3_vfs_find(0);
#define COPY_FIELD(NAME) vfs->NAME = defer->NAME
  COPY_FIELD(xDlOpen);
  COPY_FIELD(xDlError);
  COPY_FIELD(xDlSym);
  COPY_FIELD(xDlClose);
  COPY_FIELD(xRandomness);
  COPY_FIELD(xSleep);
  COPY_FIELD(xCurrentTime);
  COPY_FIELD(xGetLastError);
#undef COPY_FIELD

  sqlite3_vfs_register(vfs, makeDefault);
  return vfs;
}

void* EMSCRIPTEN_KEEPALIVE getSqliteFree() {
  return sqlite3_free;
}

extern void jsFunc(void* pApp, sqlite3_context* pContext, int iCount, sqlite3_value** ppValues);
extern void jsStep(void* pApp, sqlite3_context* pContext, int iCount, sqlite3_value** ppValues);
extern void jsFinal(void* pApp, sqlite3_context* pContext);

static void xFunc(sqlite3_context* pContext, int iCount, sqlite3_value** ppValues) {
  jsFunc(sqlite3_user_data(pContext), pContext, iCount, ppValues);
}

static void xStep(sqlite3_context* pContext, int iCount, sqlite3_value** ppValues) {
  jsStep(sqlite3_user_data(pContext), pContext, iCount, ppValues);
}

static void xFinal(sqlite3_context* pContext) {
  jsFinal(sqlite3_user_data(pContext), pContext);
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

int main() {
  sqlite3_initialize();
  return 0;
}