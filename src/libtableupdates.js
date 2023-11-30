mergeInto(LibraryManager.library, {
    onTableChangeCallback: function(db, optType, tableName, rowId) {
        // This is exposed globally since exporting from this module caused WASM compilation errors
        const fn = globalThis['__onTablesChanged'];
        fn?.(db, optType, tableName, rowId);
    }
});