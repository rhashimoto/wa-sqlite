// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
#include <stdio.h>
#include <emscripten.h>
#include <sqlite3.h>

extern int ii(int i);

int main() {
  sqlite3_initialize();
  const int result = ii(42);
  printf("result: %d\n", result);
  return 0;
}