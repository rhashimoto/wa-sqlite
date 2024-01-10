// @ts-ignore
addToLibrary({
  $adapters_support__deps: ['$stringToUTF8'],
  $adapters_support__postset: 'adapters_support();',
  $adapters_support: function() {
    const hasAsyncify = typeof Asyncify === 'object';

    async function relay(...args) {
      console.log('relay', args);
      return args[0] + 1;
    }

    // @ts-ignore
    _ii = (...args) => relay(...args);
    // @ts-ignore
    _ii.sig = 'ii';
  },

  ii: function() {},
  ii__deps: ['$adapters_support']
});
