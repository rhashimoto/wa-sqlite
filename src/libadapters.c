// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
#include <stdio.h>
#include <string.h>
#include <strings.h>
#include <emscripten.h>
#include <sqlite3.h>

// Declarations for synchronous and asynchronous JavaScript relay methods.
// The function name contains the C signature of the JavaScript function.
// The first two arguments of each relay method is the target (e.g. VFS)
// and method name (e.g. xOpen) to call. The remaining arguments are the
// parameters to the method.
//
// Relaying is necessary because Emscripten only allows calling a statically
// defined JavaScript function via a C function pointer.
extern int ip(const void*, const char*, const void*);
extern int ip_async(const void*, const char*, const void*);
extern void vp(const void*, const char*, const void*);
extern void vp_async(const void*, const char*, const void*);
extern int ipI(const void*, const char*, const void*, int64_t);
extern int ipI_async(const void*, const char*, const void*, int64_t);
extern int ipi(const void*, const char*, const void*, int);
extern int ipi_async(const void*, const char*, const void*, int);
extern int ipp(const void*, const char*, const void*, const void*);
extern int ipp_async(const void*, const char*, const void*, const void*);
extern int ipip(const void*, const char*, const void*, int, const void*);
extern int ipip_async(const void*, const char*, const void*, int, const void*);
extern int ippi(const void*, const char*, const void*, const void*, int);
extern int ippi_async(const void*, const char*, const void*, const void*, int);
extern int ipiii(const void*, const char*, const void*, int, int, int);
extern int ipiii_async(const void*, const char*, const void*, int, int, int);
extern int ippiI(const void*, const char*, const void*, const void*, int, int64_t);
extern int ippiI_async(const void*, const char*, const void*, const void*, int, int64_t);
extern int ippip(const void*, const char*, const void*, const void*, int, const void*);
extern int ippip_async(const void*, const char*, const void*, const void*, int, const void*);
extern int ipppip(const void*, const char*, const void*, const void*, const void*, int, const void*);
extern int ipppip_async(const void*, const char*, const void*, const void*, const void*, int, const void*);
extern int ipiiip(const void*, const char*, const void*, int, int, int, const void*);
extern int ipiiip_async(const void*, const char*, const void*, int, int, int, const void*);

// This list of methods must match exactly with libadapters.js.
enum {
  xOpen,
  xDelete,
  xAccess,
  xFullPathname,
  xCurrentTime,
  xGetLastError,
  xCurrentTimeInt64,

  xClose,
  xRead,
  xWrite,
  xTruncate,
  xSync,
  xFileSize,
  xLock,
  xUnlock,
  xCheckReservedLock,
  xFileControl,
  xSectorSize,
  xDeviceCharacteristics,
  xShmMap,
  xShmLock,
  xShmBarrier,
  xShmUnmap
};

// Attach extra information to the VFS and file objects.
typedef struct VFS {
  sqlite3_vfs base;
  int methodMask; // Bitmask of methods defined in JavaScript.
  int asyncMask;  // Bitmask of methods that are asynchronous.
} VFS;

typedef struct VFSFile {
  sqlite3_file base;
  VFS* pVfs; // Pointer back to the VFS.
} VFSFile;

#define VFS_JS(SIGNATURE, KEY, METHOD, ...) \
  (((VFS*)KEY)->asyncMask & (1 << METHOD) ? \
    SIGNATURE##_async(KEY, #METHOD, __VA_ARGS__) : \
    SIGNATURE(KEY, #METHOD, __VA_ARGS__))

static int adapter_xClose(sqlite3_file* file) {
  printf("adapter_xClose\n");
  return VFS_JS(ip, ((VFSFile*)file)->pVfs, xClose, file);
}

static int adapter_xRead(sqlite3_file* file, void* pData, int iAmt, sqlite3_int64 iOffset) {
  printf("adapter_xRead\n");
  return VFS_JS(ippiI, ((VFSFile*)file)->pVfs, xRead, file, pData, iAmt, iOffset);
}

static int adapter_xWrite(sqlite3_file* file, const void* pData, int iAmt, sqlite3_int64 iOffset) {
  printf("adapter_xWrite\n");
  return VFS_JS(ippiI, ((VFSFile*)file)->pVfs, xWrite, file, pData, iAmt, iOffset);
}

static int adapter_xTruncate(sqlite3_file* file, sqlite3_int64 size) {
  printf("adapter_xTruncate\n");
  return VFS_JS(ipI, ((VFSFile*)file)->pVfs, xTruncate, file, size);
}

static int adapter_xSync(sqlite3_file* file, int flags) {
  printf("adapter_xSync\n");
  return VFS_JS(ipi, ((VFSFile*)file)->pVfs, xSync, file, flags);
}

static int adapter_xFileSize(sqlite3_file* file, sqlite3_int64* pSize) {
  printf("adapter_xFileSize\n");
  return VFS_JS(ipp, ((VFSFile*)file)->pVfs, xFileSize, file, pSize);
}

static int adapter_xLock(sqlite3_file* file, int flags) {
  printf("adapter_xLock\n");
  return VFS_JS(ipi, ((VFSFile*)file)->pVfs, xLock, file, flags);
}

static int adapter_xUnlock(sqlite3_file* file, int flags) {
  printf("adapter_xUnlock\n");
  return VFS_JS(ipi, ((VFSFile*)file)->pVfs, xUnlock, file, flags);
}

static int adapter_xCheckReservedLock(sqlite3_file* file, int* pResOut) {
  printf("adapter_xCheckReservedLock\n");
  return VFS_JS(ipp, ((VFSFile*)file)->pVfs, xCheckReservedLock, file, pResOut);
}

static int adapter_xFileControl(sqlite3_file* file, int flags, void* pOut) {
  printf("adapter_xFileControl\n");
  return VFS_JS(ipip, ((VFSFile*)file)->pVfs, xFileControl, file, flags, pOut);
}

static int adapter_xSectorSize(sqlite3_file* file) {
  printf("adapter_xSectorSize\n");
  return VFS_JS(ip, ((VFSFile*)file)->pVfs, xSectorSize, file);
}

static int adapter_xDeviceCharacteristics(sqlite3_file* file) {
  printf("adapter_xDeviceCharacteristics\n");
  return VFS_JS(ip, ((VFSFile*)file)->pVfs, xDeviceCharacteristics, file);
}

static int adapter_xShmMap(sqlite3_file* file, int iPg, int pgsz, int unused, void volatile** p) {
  printf("adapter_xShmMap\n");
  return VFS_JS(ipiiip, ((VFSFile*)file)->pVfs, xShmMap, file, iPg, pgsz, unused, p);
}

static int adapter_xShmLock(sqlite3_file* file, int offset, int n, int flags) {
  printf("adapter_xShmLock\n");
  return VFS_JS(ipiii, ((VFSFile*)file)->pVfs, xShmLock, file, offset, n, flags);
}

static void adapter_xShmBarrier(sqlite3_file* file) {
  printf("adapter_xShmBarrier\n");
  VFS_JS(vp, ((VFSFile*)file)->pVfs, xShmBarrier, file);
}

static int adapter_xShmUnmap(sqlite3_file* file, int deleteFlag) {
  printf("adapter_xShmUnmap\n");
  return VFS_JS(ipi, ((VFSFile*)file)->pVfs, xShmUnmap, file, deleteFlag);
}


static int adapter_xOpen(sqlite3_vfs* vfs, const char* zName, sqlite3_file* file, int flags, int* pOutFlags) {
  printf("adapter_xOpen: %s\n", zName);
  const int result = VFS_JS(ipppip, vfs, xOpen, vfs, (void*)zName, file, flags, pOutFlags);

  VFS* pVfs = (VFS*)vfs;
  sqlite3_io_methods* pMethods = (sqlite3_io_methods*)sqlite3_malloc(sizeof(sqlite3_io_methods));
  pMethods->iVersion = 2;
#define METHOD(NAME) pMethods->NAME = (pVfs->methodMask & (1 << NAME)) ? adapter_##NAME : NULL
  METHOD(xClose);
  METHOD(xRead);
  METHOD(xWrite);
  METHOD(xTruncate);
  METHOD(xSync);
  METHOD(xFileSize);
  METHOD(xLock);
  METHOD(xUnlock);
  METHOD(xCheckReservedLock);
  METHOD(xFileControl);
  METHOD(xSectorSize);
  METHOD(xDeviceCharacteristics);
  METHOD(xShmMap);
  METHOD(xShmLock);
  METHOD(xShmBarrier);
  METHOD(xShmUnmap);
#undef METHOD
  file->pMethods = pMethods;
  ((VFSFile*)file)->pVfs = pVfs;
  return result;
}

static int adapter_xDelete(sqlite3_vfs* vfs, const char* zName, int syncDir) {
  printf("adapter_xDelete: %s\n", zName);
  return VFS_JS(ippi, vfs, xDelete, vfs, zName, syncDir);
}

static int adapter_xAccess(sqlite3_vfs* vfs, const char* zName, int flags, int* pResOut) {
  printf("adapter_xAccess: %s\n", zName);
  return VFS_JS(ippip, vfs, xAccess, vfs, zName, flags, pResOut);
}

static int adapter_xFullPathname(sqlite3_vfs* vfs, const char* zName, int nOut, char* zOut) {
  printf("adapter_xFullPathname: %s\n", zName);
  return VFS_JS(ippip, vfs, xFullPathname, vfs, zName, nOut, zOut);
}

static int adapter_xCurrentTime(sqlite3_vfs* vfs, double* pJulianDay) {
  printf("adapter_xCurrentTime\n");
  return VFS_JS(ipp, vfs, xCurrentTime, vfs, pJulianDay);
}

static int adapter_xGetLastError(sqlite3_vfs* vfs, int nBuf, char* zBuf) {
  printf("adapter_xGetLastError\n");
  return VFS_JS(ipip, vfs, xGetLastError, vfs, nBuf, zBuf);
}

static int adapter_xCurrentTimeInt64(sqlite3_vfs* vfs, sqlite3_int64* pTime) {
  printf("adapter_xCurrentTimeInt64\n");
  return VFS_JS(ipp, vfs, xCurrentTimeInt64, vfs, pTime);
}

int EMSCRIPTEN_KEEPALIVE adapter_vfs_register(
  const char* zName,
  int mxPathName,
  int methodMask,
  int asyncMask,
  int makeDefault,
  void** ppVfs) {
  // Get the current default VFS to use if methods are not defined.
  const sqlite3_vfs* backupVfs = sqlite3_vfs_find(NULL);

  // Allocate and populate the new VFS.
  VFS* vfs = (VFS*)sqlite3_malloc(sizeof(VFS));
  if (!vfs) return SQLITE_NOMEM;
  bzero(vfs, sizeof(VFS));

  vfs->base.iVersion = 2;
  vfs->base.szOsFile = sizeof(VFSFile);
  vfs->base.mxPathname = mxPathName;
  vfs->base.zName = strdup(zName);

  // The VFS methods go to the adapter implementations in this file,
  // or to the default VFS if the JavaScript method is not defined.
#define METHOD(NAME) vfs->base.NAME = \
  (methodMask & (1 << NAME)) ? adapter_##NAME : backupVfs->NAME

  METHOD(xOpen);
  METHOD(xDelete);
  METHOD(xAccess);
  METHOD(xFullPathname);
  METHOD(xCurrentTime);
  METHOD(xGetLastError);
  METHOD(xCurrentTimeInt64);
#undef METHOD

  vfs->methodMask = methodMask;
  vfs->asyncMask = asyncMask;

  printf("adapter_vfs_register: %s\n", zName);
  *ppVfs = vfs;
  return sqlite3_vfs_register(&vfs->base, makeDefault);
}

int main() {
  sqlite3_initialize();
  return 0;
}