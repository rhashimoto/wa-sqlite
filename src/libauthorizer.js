const authorizer_methods = {
  $authorizer_method_support__postset: 'authorizer_method_support();',
  $authorizer_method_support: function() {
    const mapDbToAuthorizer = new Map();

    Module['setAuthorizer'] =
      function(db, f, userData) {
        if (f) {
          mapDbToAuthorizer.set(db, { f, userData });
        } else {
          mapDbToAuthorizer.delete(db);
        }
        return ccall('set_authorizer', 'number', ['number'], [db])
      };

    _jsAuth = function(db, iActionCode, pParam3, pParam4, pParam5, pParam6) {
      if (mapDbToAuthorizer.has(db)) {
        const { f, userData } = mapDbToAuthorizer.get(db);
        return f(
          userData,
          iActionCode,
          pParam3 ? UTF8ToString(pParam3) : null,
          pParam4 ? UTF8ToString(pParam4) : null,
          pParam5 ? UTF8ToString(pParam5) : null,
          pParam6 ? UTF8ToString(pParam6) : null);
      }
      return 0;
    }
  }
};

const AUTHORIZER_METHOD_NAMES = ["jsAuth"];
for (const method of AUTHORIZER_METHOD_NAMES) {
  authorizer_methods[method] = function() {};
  authorizer_methods[`${method}__deps`] = ['$authorizer_method_support'];
}
mergeInto(LibraryManager.library, authorizer_methods);
