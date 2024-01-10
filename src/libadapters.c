// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
#include <stdio.h>
#include <emscripten.h>
#include <sqlite3.h>

extern int ii(void*, const char*, int i);
extern int async_ii(void*, const char*, int i);

int main() {
  sqlite3_initialize();

  {
    const int result = ii((void*)42, "testSync", 10);
    printf("result: %d\n", result);
  }

  {
    const int result = async_ii((void*)42, "testAsync", 15);
    printf("result: %d\n", result);
  }
  return 0;
}