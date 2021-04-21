# dependencies

SQLITE_AMALGAMATION = sqlite-amalgamation-3330000
SQLITE_AMALGAMATION_ZIP_URL = https://www.sqlite.org/2020/sqlite-amalgamation-3330000.zip
SQLITE_AMALGAMATION_ZIP_SHA1 = 5b0a95fc6090499c0cdf7f15fcec9c132f8e021e

EXTENSION_FUNCTIONS = extension-functions.c
EXTENSION_FUNCTIONS_URL = https://www.sqlite.org/contrib/download/extension-functions.c?get=25
EXTENSION_FUNCTIONS_SHA1 = c68fa706d6d9ff98608044c00212473f9c14892f

# source files

LIBRARY_FILES = src/vfs.js
EXPORTED_FUNCTIONS = src/exported_functions.json
EXTRA_EXPORTED_RUNTIME_METHODS = src/extra_exported_runtime_methods.json
ASYNCIFY_IMPORTS = src/asyncify_imports.json

# intermediate files

BITCODE_FILES = tmp/bc/sqlite3.bc tmp/bc/extension-functions.bc tmp/bc/vfs.bc

# build options

EMCC ?= emcc

CFLAGS = \
	-O3 \
	-flto \
	-I'deps/$(SQLITE_AMALGAMATION)'

EMFLAGS = \
	-s ALLOW_MEMORY_GROWTH=1 \
	-s RESERVED_FUNCTION_POINTERS=64 \
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
	--js-library src/vfs.js

EMFLAGS_ASYNCIFY = \
	-s ASYNCIFY \
	-s ASYNCIFY_STACK_SIZE=12288 \
	-s ASYNCIFY_IMPORTS=@src/asyncify_imports.json

# https://www.sqlite.org/compile.html
SQLITE_DEFINES = \
	-DSQLITE_OMIT_AUTOINIT \
	-DSQLITE_OMIT_DEPRECATED \
	-DSQLITE_OMIT_LOAD_EXTENSION \
	-DSQLITE_OMIT_SHARED_CACHE \
	-DSQLITE_DISABLE_LFS \
	-DSQLITE_THREADSAFE=0 \
	-DSQLITE_ENABLE_NORMALIZE

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
	echo '$(SQLITE_AMALGAMATION_ZIP_SHA1)' 'cache/$(SQLITE_AMALGAMATION).zip' | sha1sum -c
	rm -rf $@
	unzip 'cache/$(SQLITE_AMALGAMATION).zip' -d deps/
	touch $@

deps/$(EXTENSION_FUNCTIONS): cache/$(EXTENSION_FUNCTIONS)
	mkdir -p deps
	echo '$(EXTENSION_FUNCTIONS_SHA1)' 'cache/$(EXTENSION_FUNCTIONS)' | sha1sum -c
	cp 'cache/$(EXTENSION_FUNCTIONS)' $@

## tmp
.PHONY: clean-tmp
clean-tmp:
	rm -rf tmp

tmp/bc/sqlite3.bc: deps/$(SQLITE_AMALGAMATION)/sqlite3.c
	mkdir -p tmp/bc
	$(EMCC) $(CFLAGS) $(SQLITE_DEFINES) $^ -c -o $@

tmp/bc/extension-functions.bc: deps/$(EXTENSION_FUNCTIONS)
	mkdir -p tmp/bc
	$(EMCC) $(CFLAGS) $(SQLITE_DEFINES) $^ -c -o $@

tmp/bc/vfs.bc: src/vfs.c
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
	  $(EMFLAGS_ASYNCIFY) \
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
	  $(EMFLAGS_ASYNCIFY) \
	  $(BITCODE_FILES) -o $@
