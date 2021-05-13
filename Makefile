# dependencies

SQLITE_AMALGAMATION = sqlite-amalgamation-3350500
SQLITE_AMALGAMATION_ZIP_URL = https://www.sqlite.org/2021/${SQLITE_AMALGAMATION}.zip
SQLITE_AMALGAMATION_ZIP_SHA = b49409ef123e193e719e2536f9b795482a69e61a9cc728933739b9024f035061

EXTENSION_FUNCTIONS = extension-functions.c
EXTENSION_FUNCTIONS_URL = https://www.sqlite.org/contrib/download/extension-functions.c?get=25
EXTENSION_FUNCTIONS_SHA = 991b40fe8b2799edc215f7260b890f14a833512c9d9896aa080891330ffe4052

# source files

LIBRARY_FILES = src/libfunction.js src/libmodule.js src/libvfs.js
EXPORTED_FUNCTIONS = src/exported_functions.json
EXTRA_EXPORTED_RUNTIME_METHODS = src/extra_exported_runtime_methods.json
ASYNCIFY_IMPORTS = src/asyncify_imports.json

# intermediate files

BITCODE_FILES = \
	tmp/bc/sqlite3.bc tmp/bc/extension-functions.bc \
	tmp/bc/libfunction.bc \
	tmp/bc/libmodule.bc \
	tmp/bc/libvfs.bc

# build options

EMCC ?= EMCC_CLOSURE_ARGS="--externs externs.js" emcc

CFLAGS = \
	-O3 \
	-flto \
	-I'deps/$(SQLITE_AMALGAMATION)' \
	-Wno-non-literal-null-conversion

EMFLAGS = \
	-s ALLOW_MEMORY_GROWTH=1 \
	-s WASM=1 \
	-s INVOKE_RUN

EMFLAGS_DEBUG = \
	-s INLINING_LIMIT=10 \
	-s ASSERTIONS=1 \
	-O1

EMFLAGS_DIST = \
	-s INLINING_LIMIT=50 \
	-O3 \
	-flto \
	--closure 1

EMFLAGS_INTERFACES = \
	-s EXPORTED_FUNCTIONS=@$(EXPORTED_FUNCTIONS) \
	-s EXTRA_EXPORTED_RUNTIME_METHODS=@$(EXTRA_EXPORTED_RUNTIME_METHODS)

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
SQLITE_DEFINES = \
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
	openssl dgst -sha256 -r cache/$(SQLITE_AMALGAMATION).zip | awk '{print $$1}' > deps/sha
	echo $(SQLITE_AMALGAMATION_ZIP_SHA) | cmp deps/sha
	rm -rf deps/sha $@
	unzip 'cache/$(SQLITE_AMALGAMATION).zip' -d deps/
	touch $@

deps/$(EXTENSION_FUNCTIONS): cache/$(EXTENSION_FUNCTIONS)
	mkdir -p deps
	openssl dgst -sha256 -r cache/$(EXTENSION_FUNCTIONS) | awk '{print $$1}' > deps/sha
	echo $(EXTENSION_FUNCTIONS_SHA) | cmp deps/sha
	rm -rf deps/sha $@
	cp 'cache/$(EXTENSION_FUNCTIONS)' $@

## tmp
.PHONY: clean-tmp
clean-tmp:
	rm -rf tmp

tmp/bc/sqlite3.bc: deps/$(SQLITE_AMALGAMATION)
	mkdir -p tmp/bc
	$(EMCC) $(CFLAGS) $(SQLITE_DEFINES) $^/sqlite3.c -c -o $@

tmp/bc/extension-functions.bc: deps/$(EXTENSION_FUNCTIONS)
	mkdir -p tmp/bc
	$(EMCC) $(CFLAGS) $(SQLITE_DEFINES) $^ -c -o $@

tmp/bc/libfunction.bc: src/libfunction.c
	mkdir -p tmp/bc
	$(EMCC) $(CFLAGS) $(SQLITE_DEFINES) $^ -c -o $@

tmp/bc/libmodule.bc: src/libmodule.c
	mkdir -p tmp/bc
	$(EMCC) $(CFLAGS) $(SQLITE_DEFINES) $^ -c -o $@

tmp/bc/libvfs.bc: src/libvfs.c
	mkdir -p tmp/bc
	$(EMCC) $(CFLAGS) $(SQLITE_DEFINES) $^ -c -o $@

## debug
.PHONY: clean-debug
clean-debug:
	rm -rf debug

.PHONY: debug
debug: debug/wa-sqlite.mjs debug/wa-sqlite-async.mjs

debug/wa-sqlite.mjs: $(BITCODE_FILES) $(LIBRARY_FILES) $(EXPORTED_FUNCTIONS) $(EXTRA_EXPORTED_RUNTIME_METHODS)
	mkdir -p debug
	$(EMCC) $(EMFLAGS) $(EMFLAGS_DEBUG) \
	  $(EMFLAGS_INTERFACES) \
	  $(EMFLAGS_LIBRARIES) \
	  $(BITCODE_FILES) -o $@

debug/wa-sqlite-async.mjs: $(BITCODE_FILES) $(LIBRARY_FILES) $(EXPORTED_FUNCTIONS) $(EXTRA_EXPORTED_RUNTIME_METHODS) $(ASYNCIFY_IMPORTS)
	mkdir -p debug
	$(EMCC) $(EMFLAGS) $(EMFLAGS_DEBUG) \
	  $(EMFLAGS_INTERFACES) \
	  $(EMFLAGS_LIBRARIES) \
	  $(EMFLAGS_ASYNCIFY_DEBUG) \
	  $(BITCODE_FILES) -o $@

## dist
.PHONY: clean-dist
clean-dist:
	rm -rf dist

.PHONY: dist
dist: dist/wa-sqlite.mjs dist/wa-sqlite-async.mjs

dist/wa-sqlite.mjs: $(BITCODE_FILES) $(LIBRARY_FILES) $(EXPORTED_FUNCTIONS) $(EXTRA_EXPORTED_RUNTIME_METHODS)
	mkdir -p dist
	$(EMCC) $(EMFLAGS) $(EMFLAGS_DIST) \
	  $(EMFLAGS_INTERFACES) \
	  $(EMFLAGS_LIBRARIES) \
	  $(BITCODE_FILES) -o $@

dist/wa-sqlite-async.mjs: $(BITCODE_FILES) $(LIBRARY_FILES) $(EXPORTED_FUNCTIONS) $(EXTRA_EXPORTED_RUNTIME_METHODS) $(ASYNCIFY_IMPORTS)
	mkdir -p dist
	$(EMCC) $(EMFLAGS) $(EMFLAGS_DIST) \
	  $(EMFLAGS_INTERFACES) \
	  $(EMFLAGS_LIBRARIES) \
	  $(EMFLAGS_ASYNCIFY_DIST) \
	  $(BITCODE_FILES) -o $@
