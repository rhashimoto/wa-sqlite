# dependencies

SQLITE_AMALGAMATION = sqlite-amalgamation-3400100
SQLITE_AMALGAMATION_ZIP_URL = https://www.sqlite.org/2022/${SQLITE_AMALGAMATION}.zip
SQLITE_AMALGAMATION_ZIP_SHA3 = 2618a7f311ce3f8307c45035bce31805185d632241b2af6c250b4531f09edccb

EXTENSION_FUNCTIONS = extension-functions.c
EXTENSION_FUNCTIONS_URL = https://www.sqlite.org/contrib/download/extension-functions.c?get=25
EXTENSION_FUNCTIONS_SHA3 = ee39ddf5eaa21e1d0ebcbceeab42822dd0c4f82d8039ce173fd4814807faabfa

# source files

LIBRARY_FILES = src/libauthorizer.js src/libfunction.js src/libmodule.js src/libprogress.js src/libvfs.js
EXPORTED_FUNCTIONS = src/exported_functions.json
EXPORTED_RUNTIME_METHODS = src/extra_exported_runtime_methods.json
ASYNCIFY_IMPORTS = src/asyncify_imports.json

# intermediate files

OBJ_FILES_DEBUG = \
	tmp/obj/debug/sqlite3.o tmp/obj/debug/extension-functions.o \
	tmp/obj/debug/libauthorizer.o \
	tmp/obj/debug/libfunction.o \
	tmp/obj/debug/libmodule.o \
	tmp/obj/debug/libprogress.o \
	tmp/obj/debug/libvfs.o

OBJ_FILES_DIST = \
	tmp/obj/dist/sqlite3.o tmp/obj/dist/extension-functions.o \
	tmp/obj/dist/libauthorizer.o \
	tmp/obj/dist/libfunction.o \
	tmp/obj/dist/libmodule.o \
	tmp/obj/dist/libprogress.o \
	tmp/obj/dist/libvfs.o

# build options

EMCC ?= emcc

CFLAGS_COMMON = \
	-I'deps/$(SQLITE_AMALGAMATION)' \
	-Wno-non-literal-null-conversion

CFLAGS_DEBUG = $(CFLAGS_COMMON) -g

CFLAGS_DIST = $(CFLAGS_COMMON) -Oz -flto

EMFLAGS_COMMON = \
	-s ALLOW_MEMORY_GROWTH=1 \
	-s WASM=1 \
	-s INVOKE_RUN \
	-s ENVIRONMENT="web,worker" \
	-s STACK_SIZE=512KB

EMFLAGS_DEBUG = $(EMFLAGS_COMMON) \
	-s ASSERTIONS=1 \
	-g

EMFLAGS_DIST = $(EMFLAGS_COMMON) \
	-Oz \
	-flto \
	--closure 1

EMFLAGS_INTERFACES = \
	-s EXPORTED_FUNCTIONS=@$(EXPORTED_FUNCTIONS) \
	-s EXPORTED_RUNTIME_METHODS=@$(EXPORTED_RUNTIME_METHODS)

EMFLAGS_LIBRARIES = \
	--js-library src/libauthorizer.js \
	--js-library src/libfunction.js \
	--js-library src/libmodule.js \
	--js-library src/libprogress.js \
	--js-library src/libvfs.js

EMFLAGS_ASYNCIFY_COMMON = \
	-s ASYNCIFY \
	-s ASYNCIFY_IMPORTS=@src/asyncify_imports.json

EMFLAGS_ASYNCIFY_DEBUG = \
	$(EMFLAGS_ASYNCIFY_COMMON) \
	-s ASYNCIFY_STACK_SIZE=24576

EMFLAGS_ASYNCIFY_DIST = \
	$(EMFLAGS_ASYNCIFY_COMMON) \
	-s ASYNCIFY_STACK_SIZE=16384

# https://www.sqlite.org/compile.html
WASQLITE_DEFINES ?= \
	-DSQLITE_DEFAULT_MEMSTATUS=0 \
	-DSQLITE_DEFAULT_WAL_SYNCHRONOUS=1 \
	-DSQLITE_DQS=0 \
	-DSQLITE_LIKE_DOESNT_MATCH_BLOBS \
	-DSQLITE_MAX_EXPR_DEPTH=0 \
	-DSQLITE_OMIT_AUTOINIT \
	-DSQLITE_OMIT_DECLTYPE \
	-DSQLITE_OMIT_DEPRECATED \
	-DSQLITE_OMIT_LOAD_EXTENSION \
	-DSQLITE_OMIT_SHARED_CACHE \
	-DSQLITE_THREADSAFE=0 \
	-DSQLITE_USE_ALLOCA \
	-DSQLITE_ENABLE_BATCH_ATOMIC_WRITE

WASQLITE_KS_DEFINES ?= $(WASQLITE_DEFINES) \
  -DSQLITE_ENABLE_FTS5 \
  -DSQLITE_ENABLE_RTREE \
  -DSQLITE_ENABLE_EXPLAIN_COMMENTS \
  -DSQLITE_ENABLE_UNKNOWN_SQL_FUNCTION \
  -DSQLITE_ENABLE_STMTVTAB \
  -DSQLITE_ENABLE_DBPAGE_VTAB \
  -DSQLITE_ENABLE_DBSTAT_VTAB \
  -DSQLITE_ENABLE_BYTECODE_VTAB \
  -DSQLITE_ENABLE_OFFSET_SQL_FUNC

# directories
.PHONY: all
all: dist

.PHONY: clean
clean:
	rm -rf dist dist-xl debug tmp

.PHONY: spotless
spotless:
	rm -rf dist dist-xl debug tmp deps cache

## cache
.PHONY: clean-cache
clean-cache:
	rm -rf cache

cache/$(SQLITE_AMALGAMATION).zip:
	mkdir -p cache
	curl -LsSf '$(SQLITE_AMALGAMATION_ZIP_URL)' -o $@

cache/$(EXTENSION_FUNCTIONS):
	mkdir -p cache
	curl -LsSf '$(EXTENSION_FUNCTIONS_URL)' -o $@

## deps
.PHONY: clean-deps
clean-deps:
	rm -rf deps

.PHONY: deps
deps: deps/$(SQLITE_AMALGAMATION) deps/$(EXTENSION_FUNCTIONS) deps/$(EXPORTED_FUNCTIONS)

deps/$(SQLITE_AMALGAMATION): cache/$(SQLITE_AMALGAMATION).zip
	mkdir -p deps
	openssl dgst -sha3-256 -r cache/$(SQLITE_AMALGAMATION).zip | sed -e 's/\s.*//' > deps/sha3
	echo $(SQLITE_AMALGAMATION_ZIP_SHA3) | cmp deps/sha3
	rm -rf deps/sha3 $@
	unzip 'cache/$(SQLITE_AMALGAMATION).zip' -d deps/
	touch $@

deps/$(EXTENSION_FUNCTIONS): cache/$(EXTENSION_FUNCTIONS)
	mkdir -p deps
	openssl dgst -sha3-256 -r cache/$(EXTENSION_FUNCTIONS) | sed -e 's/\s.*//' > deps/sha3
	echo $(EXTENSION_FUNCTIONS_SHA3) | cmp deps/sha3
	rm -rf deps/sha3 $@
	cp 'cache/$(EXTENSION_FUNCTIONS)' $@

## tmp
.PHONY: clean-tmp
clean-tmp:
	rm -rf tmp

tmp/obj/debug/sqlite3.o: deps/$(SQLITE_AMALGAMATION)
	mkdir -p tmp/obj/debug
	$(EMCC) $(CFLAGS_DEBUG) $(WASQLITE_DEFINES) $^/sqlite3.c -c -o $@

tmp/obj/debug/extension-functions.o: deps/$(EXTENSION_FUNCTIONS)
	mkdir -p tmp/obj/debug
	$(EMCC) $(CFLAGS_DEBUG) $(WASQLITE_DEFINES) $^ -c -o $@

tmp/obj/debug/libfunction.o: src/libfunction.c
	mkdir -p tmp/obj/debug
	$(EMCC) $(CFLAGS_DEBUG) $(WASQLITE_DEFINES) $^ -c -o $@

tmp/obj/debug/libauthorizer.o: src/libauthorizer.c
	mkdir -p tmp/obj/debug
	$(EMCC) $(CFLAGS_DEBUG) $(WASQLITE_DEFINES) $^ -c -o $@

tmp/obj/debug/libmodule.o: src/libmodule.c
	mkdir -p tmp/obj/debug
	$(EMCC) $(CFLAGS_DEBUG) $(WASQLITE_DEFINES) $^ -c -o $@

tmp/obj/debug/libprogress.o: src/libprogress.c
	mkdir -p tmp/obj/debug
	$(EMCC) $(CFLAGS_DEBUG) $(WASQLITE_DEFINES) $^ -c -o $@

tmp/obj/debug/libvfs.o: src/libvfs.c
	mkdir -p tmp/obj/debug
	$(EMCC) $(CFLAGS_DEBUG) $(WASQLITE_DEFINES) $^ -c -o $@

tmp/obj/dist/sqlite3.o: deps/$(SQLITE_AMALGAMATION)
	mkdir -p tmp/obj/dist
	$(EMCC) $(CFLAGS_DIST) $(WASQLITE_DEFINES) $^/sqlite3.c -c -o $@

tmp/obj/dist/extension-functions.o: deps/$(EXTENSION_FUNCTIONS)
	mkdir -p tmp/obj/dist
	$(EMCC) $(CFLAGS_DIST) $(WASQLITE_DEFINES) $^ -c -o $@

tmp/obj/dist/libfunction.o: src/libfunction.c
	mkdir -p tmp/obj/dist
	$(EMCC) $(CFLAGS_DIST) $(WASQLITE_DEFINES) $^ -c -o $@

tmp/obj/dist/libauthorizer.o: src/libauthorizer.c
	mkdir -p tmp/obj/dist
	$(EMCC) $(CFLAGS_DIST) $(WASQLITE_DEFINES) $^ -c -o $@

tmp/obj/dist/libmodule.o: src/libmodule.c
	mkdir -p tmp/obj/dist
	$(EMCC) $(CFLAGS_DIST) $(WASQLITE_DEFINES) $^ -c -o $@

tmp/obj/dist/libprogress.o: src/libprogress.c
	mkdir -p tmp/obj/dist
	$(EMCC) $(CFLAGS_DIST) $(WASQLITE_DEFINES) $^ -c -o $@

tmp/obj/dist/libvfs.o: src/libvfs.c
	mkdir -p tmp/obj/dist
	$(EMCC) $(CFLAGS_DIST) $(WASQLITE_DEFINES) $^ -c -o $@

## debug
.PHONY: clean-debug
clean-debug:
	rm -rf debug

.PHONY: debug
debug: debug/wa-sqlite.mjs debug/wa-sqlite-async.mjs

debug/wa-sqlite.mjs: $(OBJ_FILES_DEBUG) $(LIBRARY_FILES) $(EXPORTED_FUNCTIONS) $(EXPORTED_RUNTIME_METHODS)
	mkdir -p debug
	$(EMCC) $(EMFLAGS_DEBUG) \
	  $(EMFLAGS_INTERFACES) \
	  $(EMFLAGS_LIBRARIES) \
	  $(OBJ_FILES_DEBUG) -o $@

debug/wa-sqlite-async.mjs: $(OBJ_FILES_DEBUG) $(LIBRARY_FILES) $(EXPORTED_FUNCTIONS) $(EXPORTED_RUNTIME_METHODS) $(ASYNCIFY_IMPORTS)
	mkdir -p debug
	$(EMCC) $(EMFLAGS_DEBUG) \
	  $(EMFLAGS_INTERFACES) \
	  $(EMFLAGS_LIBRARIES) \
	  $(EMFLAGS_ASYNCIFY_DEBUG) \
	  $(OBJ_FILES_DEBUG) -o $@

## dist
.PHONY: clean-dist
clean-dist:
	rm -rf dist

.PHONY: dist
dist: dist/wa-sqlite.mjs dist/wa-sqlite-async.mjs

dist/wa-sqlite.mjs: $(OBJ_FILES_DIST) $(LIBRARY_FILES) $(EXPORTED_FUNCTIONS) $(EXPORTED_RUNTIME_METHODS)
	mkdir -p dist
	$(EMCC) $(EMFLAGS_DIST) \
	  $(EMFLAGS_INTERFACES) \
	  $(EMFLAGS_LIBRARIES) \
	  $(OBJ_FILES_DIST) -o $@

dist/wa-sqlite-async.mjs: $(OBJ_FILES_DIST) $(LIBRARY_FILES) $(EXPORTED_FUNCTIONS) $(EXPORTED_RUNTIME_METHODS) $(ASYNCIFY_IMPORTS)
	mkdir -p dist
	$(EMCC) $(EMFLAGS_DIST) \
	  $(EMFLAGS_INTERFACES) \
	  $(EMFLAGS_LIBRARIES) \
	  $(EMFLAGS_ASYNCIFY_DIST) \
	  $(OBJ_FILES_DIST) -o $@

# dist-xl
.PHONY: clean-dist-xl
clean-dist-xl:
	rm -f dist-xl.zip
	rm -rf dist-xl

.PHONY: dist-xl
dist-xl: dist-xl/wa-sqlite.mjs dist-xl/wa-sqlite-async.mjs
	zip -r dist-xl dist-xl/
	
dist-xl/wa-sqlite.mjs: deps/$(SQLITE_AMALGAMATION)/sqlite3.c deps/$(EXTENSION_FUNCTIONS) src/*.c
	mkdir -p dist-xl
	$(EMCC) $(CFLAGS_DIST) $(WASQLITE_KS_DEFINES) $(EMFLAGS_DIST) \
	  $(EMFLAGS_INTERFACES) \
	  $(EMFLAGS_LIBRARIES) \
	  $^ -o $@

dist-xl/wa-sqlite-async.mjs: deps/$(SQLITE_AMALGAMATION)/sqlite3.c deps/$(EXTENSION_FUNCTIONS) src/*.c
	mkdir -p dist-xl
	$(EMCC) $(CFLAGS_DIST) $(WASQLITE_KS_DEFINES) $(EMFLAGS_DIST) \
	  $(EMFLAGS_INTERFACES) \
	  $(EMFLAGS_LIBRARIES) \
	  $(EMFLAGS_ASYNCIFY_DIST) \
	  $^ -o $@
