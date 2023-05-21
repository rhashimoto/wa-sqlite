const progress_methods = {
  $progress_method_support__postset: 'progress_method_support();',
  $progress_method_support: function() {
    const mapDbToProgress = new Map();

    Module['progressHandler'] =
      function(db, nProgressOps, f, userData) {
        if (f) {
          mapDbToProgress.set(db, { f, userData });
        } else {
          mapDbToProgress.delete(db);
        }
        return ccall('progress_handler', null, ['number', 'number'], [db, nProgressOps])
      };

    _jsProgress = function(db) {
      if (mapDbToProgress.has(db)) {
        const { f, userData } = mapDbToProgress.get(db);
        return f(userData);
      }
      return 0;
    }
  }
};

const PROGRESS_METHOD_NAMES = ["jsProgress"];
for (const method of PROGRESS_METHOD_NAMES) {
  progress_methods[method] = function() {};
  progress_methods[`${method}__deps`] = ['$progress_method_support'];
}
mergeInto(LibraryManager.library, progress_methods);
