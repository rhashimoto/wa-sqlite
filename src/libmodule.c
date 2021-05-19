// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
#include <stddef.h>
#include <string.h>
#include <emscripten.h>
#include <sqlite3.h>

extern int modStruct(const char* zName, int iSize, int nFields, int* pOffsets);

extern int modCreate(sqlite3*, void *pAux,
               int argc, const char *const*argv,
               sqlite3_vtab* pVTab, char**);
extern int modConnect(sqlite3*, void *pAux,
               int argc, const char *const*argv,
               sqlite3_vtab* pVTab, char**);
extern int modBestIndex(sqlite3_vtab *pVTab, sqlite3_index_info*);
extern int modDisconnect(sqlite3_vtab *pVTab);
extern int modDestroy(sqlite3_vtab *pVTab);
extern int modOpen(sqlite3_vtab *pVTab, sqlite3_vtab_cursor *pCursor);
extern int modClose(sqlite3_vtab_cursor*);
extern int modFilter(sqlite3_vtab_cursor*, int idxNum, const char *idxStr,
                int argc, sqlite3_value **argv);
extern int modNext(sqlite3_vtab_cursor*);
extern int modEof(sqlite3_vtab_cursor*);
extern int modColumn(sqlite3_vtab_cursor*, sqlite3_context*, int);
extern int modRowid(sqlite3_vtab_cursor*, sqlite3_int64 *pRowid);
extern int modUpdate(sqlite3_vtab *, int, sqlite3_value **, sqlite3_int64 *);
extern int modBegin(sqlite3_vtab *pVTab);
extern int modSync(sqlite3_vtab *pVTab);
extern int modCommit(sqlite3_vtab *pVTab);
extern int modRollback(sqlite3_vtab *pVTab);
// extern int modFindFunction(sqlite3_vtab *pVtab, int nArg, const char *zName,
//                        void (**pxFunc)(sqlite3_context*,int,sqlite3_value**),
//                        void **ppArg);
extern int modRename(sqlite3_vtab *pVtab, const char *zNew);

static int xCreate(
  sqlite3* db,
  void *pAux,
  int argc,
  const char *const*argv,
  sqlite3_vtab **ppVTab,
  char** pzErr) {
  *ppVTab = (sqlite3_vtab*)sqlite3_malloc(sizeof(sqlite3_vtab));
  const int result = modCreate(db, pAux, argc, argv, *ppVTab, pzErr);
  if (result != SQLITE_OK) {
    sqlite3_free(*ppVTab);
    *ppVTab = 0;
  }
  return result;
}

static int xConnect(
  sqlite3* db,
  void *pAux,
  int argc,
  const char *const*argv,
  sqlite3_vtab **ppVTab,
  char** pzErr) {
  *ppVTab = (sqlite3_vtab*)sqlite3_malloc(sizeof(sqlite3_vtab));
  const int result = modConnect(db, pAux, argc, argv, *ppVTab, pzErr);
  if (result != SQLITE_OK) {
    sqlite3_free(*ppVTab);
    *ppVTab = 0;
  }
  return result;
}

static int xOpen(sqlite3_vtab *pVTab, sqlite3_vtab_cursor **ppCursor) {
  *ppCursor = (sqlite3_vtab_cursor*)sqlite3_malloc(sizeof(sqlite3_vtab_cursor));
  return modOpen(pVTab, *ppCursor);
}

static void module_layout() {
#define LAYOUT_BEGIN(TYPE) \
  static int offsets_##TYPE[] = {
#define LAYOUT_DECLARE(TYPE, MEMBER) \
    offsetof(struct TYPE, MEMBER),
#define LAYOUT_END(TYPE) \
  }; \
  modStruct( \
    #TYPE, \
    sizeof(struct TYPE), \
    sizeof(offsets_##TYPE) / sizeof(int), \
    offsets_##TYPE);

  LAYOUT_BEGIN(sqlite3_index_info)
  LAYOUT_DECLARE(sqlite3_index_info, nConstraint)
  LAYOUT_DECLARE(sqlite3_index_info, aConstraint)
  LAYOUT_DECLARE(sqlite3_index_info, nOrderBy)
  LAYOUT_DECLARE(sqlite3_index_info, aOrderBy)
  LAYOUT_DECLARE(sqlite3_index_info, aConstraintUsage)
  LAYOUT_DECLARE(sqlite3_index_info, idxNum)
  LAYOUT_DECLARE(sqlite3_index_info, idxStr)
  LAYOUT_DECLARE(sqlite3_index_info, needToFreeIdxStr)
  LAYOUT_DECLARE(sqlite3_index_info, orderByConsumed)
  LAYOUT_DECLARE(sqlite3_index_info, estimatedCost)
  LAYOUT_DECLARE(sqlite3_index_info, estimatedRows)
  LAYOUT_DECLARE(sqlite3_index_info, idxFlags)
  LAYOUT_DECLARE(sqlite3_index_info, colUsed)
  LAYOUT_END(sqlite3_index_info)

  LAYOUT_BEGIN(sqlite3_index_constraint)
  LAYOUT_DECLARE(sqlite3_index_constraint, iColumn)
  LAYOUT_DECLARE(sqlite3_index_constraint, op)
  LAYOUT_DECLARE(sqlite3_index_constraint, usable)
  LAYOUT_DECLARE(sqlite3_index_constraint, iTermOffset)
  LAYOUT_END(sqlite3_index_constraint)

  LAYOUT_BEGIN(sqlite3_index_orderby)
  LAYOUT_DECLARE(sqlite3_index_orderby, iColumn)
  LAYOUT_DECLARE(sqlite3_index_orderby, desc)
  LAYOUT_END(sqlite3_index_orderby)

  LAYOUT_BEGIN(sqlite3_index_constraint_usage)
  LAYOUT_DECLARE(sqlite3_index_constraint_usage, argvIndex)
  LAYOUT_DECLARE(sqlite3_index_constraint_usage, omit)
  LAYOUT_END(sqlite3_index_constraint_usage)

#undef LAYOUT_BEGIN
#undef LAYOUT_DECLARE
#undef LAYOUT_END  
}

int EMSCRIPTEN_KEEPALIVE create_module(
  sqlite3* db,
  const char* zName,
  void* pClientData,
  int flags) {
  // Tell Javascript the layout of C structs.
  static int ready = 0;
  if (!ready) {
    module_layout();
    ready = 1;
  }

  sqlite3_module* module = (struct sqlite3_module*)sqlite3_malloc(sizeof(sqlite3_module));
  memset(module, 0, sizeof(sqlite3_module));
  module->iVersion = 1;
  if (flags & (1 << 0)) module->xCreate = xCreate;
  module->xConnect = xConnect;
  module->xBestIndex = modBestIndex;
  module->xDisconnect = modDisconnect;
  module->xDestroy = modDestroy;
  module->xOpen = xOpen;
  module->xClose = modClose;
  module->xFilter = modFilter;
  module->xNext = modNext;
  module->xEof = modEof;
  module->xColumn = modColumn;
  module->xRowid = modRowid;
  if (flags & (1 << 12)) module->xUpdate = modUpdate;
  if (flags & (1 << 13)) module->xBegin = modBegin;
  if (flags & (1 << 14)) module->xSync = modSync;
  if (flags & (1 << 15)) module->xCommit = modCommit;
  if (flags & (1 << 16)) module->xRollback = modRollback;
  // xFindFunction not supported
  if (flags & (1 << 18)) module->xRename = modRename;
  return sqlite3_create_module(db, zName, module, pClientData);
}
