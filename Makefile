# dependencies

SQLITE_AMALGAMATION = sqlite-amalgamation-3360000
SQLITE_AMALGAMATION_ZIP_URL = https://www.sqlite.org/2021/${SQLITE_AMALGAMATION}.zip
SQLITE_AMALGAMATION_ZIP_SHA3 = d25609210ec93b3c8c7da66a03cf82e2c9868cfbd2d7d866982861855e96f972

EXTENSION_FUNCTIONS = extension-functions.c
EXTENSION_FUNCTIONS_URL = https://www.sqlite.org/contrib/download/extension-functions.c?get=25
EXTENSION_FUNCTIONS_SHA3 = ee39ddf5eaa21e1d0ebcbceeab42822dd0c4f82d8039ce173fd4814807faabfa

# source files

LIBRARY_FILES = src/libfunction.js src/libmodule.js src/libvfs.js
EXPORTED_FUNCTIONS = src/exported_functions.json
EXPORTED_RUNTIME_METHODS = src/extra_exported_runtime_methods.json
ASYNCIFY_IMPORTS = src/asyncify_imports.json

# intermediate files

BITCODE_FILES_DEBUG = \
	tmp/bc/debug/sqlite3.bc tmp/bc/debug/extension-functions.bc \
	tmp/bc/debug/libfunction.bc \
	tmp/bc/debug/libmodule.bc \
	tmp/bc/debug/libvfs.bc

BITCODE_FILES_DIST = \
	tmp/bc/dist/sqlite3.bc tmp/bc/dist/extension-functions.bc \
	tmp/bc/dist/libfunction.bc \
	tmp/bc/dist/libmodule.bc \
	tmp/bc/dist/libvfs.bc

# build options

EMCC ?= emcc

CFLAGS_COMMON = \
	-I'deps/$(SQLITE_AMALGAMATION)' \
	-Wno-non-literal-null-conversion

CFLAGS_DEBUG = $(CFLAGS_COMMON) -g

CFLAGS_DIST = $(CFLAGS_COMMON) -O3 -flto

EMFLAGS_COMMON = \
	-s ALLOW_MEMORY_GROWTH=1 \
	-s WASM=1 \
	-s INVOKE_RUN

EMFLAGS_DEBUG = $(EMFLAGS_COMMON) \
	-s INLINING_LIMIT=10 \
	-s ASSERTIONS=1 \
	-g

EMFLAGS_DIST = $(EMFLAGS_COMMON) \
	-s INLINING_LIMIT=50 \
	-O3 \
	-flto \
	--closure 1

EMFLAGS_INTERFACES = \
	-s EXPORTED_FUNCTIONS=@$(EXPORTED_FUNCTIONS) \
	-s EXPORTED_RUNTIME_METHODS=@$(EXPORTED_RUNTIME_METHODS)

EMFLAGS_LIBRARIES = \
	--js-library src/libfunction.js \
	--js-library src/libmodule.js \
	--js-library src/libvfs.js

EMFLAGS_ASYNCIFY_COMMON = \
	-s ASYNCIFY \
	-s ASYNCIFY_IMPORTS=@src/asyncify_imports.json

EMFLAGS_ASYNCIFY_DEBUG = \
	$(EMFLAGS_ASYNCIFY_COMMON) \
	-s ASYNCIFY_STACK_SIZE=24576

EMFLAGS_ASYNCIFY_DIST = \
	$(EMFLAGS_ASYNCIFY_COMMON) \
	-s ASYNCIFY_STACK_SIZE=12288

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
	-DSQLITE_OMIT_PROGRESS_CALLBACK \
	-DSQLITE_OMIT_SHARED_CACHE \
	-DSQLITE_THREADSAFE=0 \
	-DSQLITE_USE_ALLOCA

# directories
.PHONY: all
all: dist

.PHONY: clean
clean:
	rm -rf dist debug tmp

.PHONY: spotless
spotless:
	rm -rf dist debug tmp deps cache

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

tmp/bc/debug/sqlite3.bc: deps/$(SQLITE_AMALGAMATION)
	mkdir -p tmp/bc/debug
	$(EMCC) $(CFLAGS_DEBUG) $(WASQLITE_DEFINES) $^/sqlite3.c -c -o $@

tmp/bc/debug/extension-functions.bc: deps/$(EXTENSION_FUNCTIONS)
	mkdir -p tmp/bc/debug
	$(EMCC) $(CFLAGS_DEBUG) $(WASQLITE_DEFINES) $^ -c -o $@

tmp/bc/debug/libfunction.bc: src/libfunction.c
	mkdir -p tmp/bc/debug
	$(EMCC) $(CFLAGS_DEBUG) $(WASQLITE_DEFINES) $^ -c -o $@

tmp/bc/debug/libmodule.bc: src/libmodule.c
	mkdir -p tmp/bc/debug
	$(EMCC) $(CFLAGS_DEBUG) $(WASQLITE_DEFINES) $^ -c -o $@

tmp/bc/debug/libvfs.bc: src/libvfs.c
	mkdir -p tmp/bc/debug
	$(EMCC) $(CFLAGS_DEBUG) $(WASQLITE_DEFINES) $^ -c -o $@

tmp/bc/dist/sqlite3.bc: deps/$(SQLITE_AMALGAMATION)
	mkdir -p tmp/bc/dist
	$(EMCC) $(CFLAGS_DIST) $(WASQLITE_DEFINES) $^/sqlite3.c -c -o $@

tmp/bc/dist/extension-functions.bc: deps/$(EXTENSION_FUNCTIONS)
	mkdir -p tmp/bc/dist
	$(EMCC) $(CFLAGS_DIST) $(WASQLITE_DEFINES) $^ -c -o $@

tmp/bc/dist/libfunction.bc: src/libfunction.c
	mkdir -p tmp/bc/dist
	$(EMCC) $(CFLAGS_DIST) $(WASQLITE_DEFINES) $^ -c -o $@

tmp/bc/dist/libmodule.bc: src/libmodule.c
	mkdir -p tmp/bc/dist
	$(EMCC) $(CFLAGS_DIST) $(WASQLITE_DEFINES) $^ -c -o $@

tmp/bc/dist/libvfs.bc: src/libvfs.c
	mkdir -p tmp/bc/dist
	$(EMCC) $(CFLAGS_DIST) $(WASQLITE_DEFINES) $^ -c -o $@

## debug
.PHONY: clean-debug
clean-debug:
	rm -rf debug

.PHONY: debug
debug: debug/wa-sqlite.mjs debug/wa-sqlite-async.mjs

debug/wa-sqlite.mjs: $(BITCODE_FILES_DEBUG) $(LIBRARY_FILES) $(EXPORTED_FUNCTIONS) $(EXPORTED_RUNTIME_METHODS)
	mkdir -p debug
	$(EMCC) $(EMFLAGS_DEBUG) \
	  $(EMFLAGS_INTERFACES) \
	  $(EMFLAGS_LIBRARIES) \
	  $(BITCODE_FILES_DEBUG) -o $@

debug/wa-sqlite-async.mjs: $(BITCODE_FILES_DEBUG) $(LIBRARY_FILES) $(EXPORTED_FUNCTIONS) $(EXPORTED_RUNTIME_METHODS) $(ASYNCIFY_IMPORTS)
	mkdir -p debug
	$(EMCC) $(EMFLAGS_DEBUG) \
	  $(EMFLAGS_INTERFACES) \
	  $(EMFLAGS_LIBRARIES) \
	  $(EMFLAGS_ASYNCIFY_DEBUG) \
	  $(BITCODE_FILES_DEBUG) -o $@

## dist
.PHONY: clean-dist
clean-dist:
	rm -rf dist

.PHONY: dist
dist: dist/wa-sqlite.mjs dist/wa-sqlite-async.mjs

dist/wa-sqlite.mjs: $(BITCODE_FILES_DIST) $(LIBRARY_FILES) $(EXPORTED_FUNCTIONS) $(EXPORTED_RUNTIME_METHODS)
	mkdir -p dist
	$(EMCC) $(EMFLAGS_DIST) \
	  $(EMFLAGS_INTERFACES) \
	  $(EMFLAGS_LIBRARIES) \
	  $(BITCODE_FILES_DIST) -o $@

dist/wa-sqlite-async.mjs: $(BITCODE_FILES_DIST) $(LIBRARY_FILES) $(EXPORTED_FUNCTIONS) $(EXPORTED_RUNTIME_METHODS) $(ASYNCIFY_IMPORTS)
	mkdir -p dist
	$(EMCC) $(EMFLAGS_DIST) \
	  $(EMFLAGS_INTERFACES) \
	  $(EMFLAGS_LIBRARIES) \
	  $(EMFLAGS_ASYNCIFY_DIST) \
	  $(BITCODE_FILES_DIST) -o $@
