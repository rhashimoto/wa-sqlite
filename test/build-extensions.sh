#!/bin/sh
# Run after a standard build, with emcc, emar, and node on PATH.
set -eu
cd "$(dirname "$0")/.."

fixture=$(mktemp -d "${TMPDIR:-/tmp}/wa-sqlite-extension.XXXXXX")
trap 'rm -rf "$fixture"' EXIT
trap 'exit 1' HUP INT TERM

# Build in isolation, keeping the registration source outside the build directory.
mkdir "$fixture/build"
cp Makefile "$fixture/build/"
ln -s "$PWD/src" "$fixture/build/src"
ln -s "$PWD/deps" "$fixture/build/deps"
ln -s "$PWD/cache" "$fixture/build/cache"
cd "$fixture/build"

cat > "$fixture/register-extension.c" <<'EOF'
#include <sqlite3.h>
extern int extension_value(void);

static void value(sqlite3_context *ctx, int argc, sqlite3_value **argv) {
  sqlite3_result_int(ctx, extension_value());
}

static int init(sqlite3 *db, char **err, const sqlite3_api_routines *api) {
  return sqlite3_create_function(db, "external_value", 0, SQLITE_UTF8, 0,
                                value, 0, 0);
}

__attribute__((constructor)) static void register_extension(void) {
  sqlite3_initialize();
  sqlite3_auto_extension((void (*)(void))init);
}
EOF

build_library() {
  echo "int extension_value(void) { return $1; }" > "$fixture/extension.c"
  emcc -c "$fixture/extension.c" -o "$fixture/extension.o"
  emar rcs "$fixture/libextension.a" "$fixture/extension.o"
}

extension_make() {
  make "$@" \
    CFILES_EXTRA=register-extension.c \
    VPATH="$fixture" \
    LIBS_EXTRA="$fixture/libextension.a" \
    EMFLAGS_EXTRA='-s ENVIRONMENT=web,worker,node'
}

check_value() {
  node --input-type=module - "$1" <<'EOF'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as SQLite from './src/sqlite-api.js';

const expected = Number(process.argv[2]);
for (const directory of ['dist', 'debug']) {
  for (const variant of ['wa-sqlite', 'wa-sqlite-async']) {
    const base = resolve(directory, variant);
    const { default: Factory } = await import(pathToFileURL(`${base}.mjs`));
    const sqlite3 = SQLite.Factory(await Factory({
      wasmBinary: readFileSync(`${base}.wasm`)
    }));
    for (let i = 0; i < 2; ++i) {
      const db = await sqlite3.open_v2(':memory:');
      try {
        const rows = [];
        await sqlite3.exec(db, 'SELECT external_value()', row => rows.push(row));
        assert.deepEqual(rows, [[expected]]);
      } finally {
        await sqlite3.close(db);
      }
    }
  }
}
EOF
}

build_library 1
extension_make dist debug
check_value 1

# Check actual file targets, avoiding the phony dist/debug targets.
set -- dist/*.mjs debug/*.mjs
extension_make -q "$@"

# Changing only the archive must relink every build variant.
sleep 1
build_library 2
extension_make dist debug
check_value 2
for output in "$@"; do
  test "$output" -nt "$fixture/libextension.a"
done
extension_make -q "$@"

echo 'External extension builds, registration, and relinking passed.'
