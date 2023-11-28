// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
// @ts-ignore
const fn_methods = {
  $fn_method_support__postset: 'fn_method_support();',
  $fn_method_support: function() {
    function pullCstr(heap, index) {
      const chars = [];
      for (let i = 0; heap[index + i] != 0; ++i) {
        if (i > 1000) {
          throw new Error('C-string never terminated after 1k characters');
        }

        chars.push(heap[index + i]);
      }

      return String.fromCharCode(...chars);
    }
    
    const mapIdToFunction = new Map();
    const mapContextToAppData = new Map();

    Module['createFunction'] =
      function(db, zFunctionName, nArg, eTextRep, pAppData, f) {
        const key = mapIdToFunction.size;
        mapIdToFunction.set(key, {
          f: f,
          appData: pAppData
        });
        return ccall(
          'create_function',
          'number',
          ['number', 'string', 'number', 'number', 'number', 'number'],
          [db, zFunctionName, nArg, eTextRep, key, 0]);
      }

    Module['createAggregate'] =
      function(db, zFunctionName, nArg, eTextRep, pAppData, fStep, fFinal) {
        const key = mapIdToFunction.size;
        mapIdToFunction.set(key, {
          step: fStep,
          final: fFinal,
          appData: pAppData
        });
        return ccall(
          'create_function',
          'number',
          ['number', 'string', 'number', 'number', 'number', 'number'],
          [db, zFunctionName, nArg, eTextRep, key, 1]);
      }

    Module['getFunctionUserData'] = function(pContext) {
      return mapContextToAppData.get(pContext);
    }

    Module['updateHook'] = function(db, f) {
      const key = mapIdToFunction.size;
      mapIdToFunction.set(key, f);
      return ccall(
        'update_hook',
        'void',
        ['number', 'number'],
        [db, key]
      );
    }

    _jsFunc = function(pApp, pContext, iCount, ppValues) {
      const f = mapIdToFunction.get(pApp);
      mapContextToAppData.set(pContext, f.appData);
      f.f(pContext, new Uint32Array(HEAPU8.buffer, ppValues, iCount));
      mapContextToAppData.delete(pContext);
    }

    _jsStep = function(pApp, pContext, iCount, ppValues) {
      const f = mapIdToFunction.get(pApp);
      mapContextToAppData.set(pContext, f.appData);
      f.step(pContext, new Uint32Array(HEAPU8.buffer, ppValues, iCount));
      mapContextToAppData.delete(pContext);
    }

    _jsFinal = function(pApp, pContext) {
      const f = mapIdToFunction.get(pApp);
      mapContextToAppData.set(pContext, f.appData);
      f.final(pContext);
      mapContextToAppData.delete(pContext);
    }

    _jsUpdateHook = function(pApp, updateType, dbName, tblName, lo32, hi32) {
      const f = mapIdToFunction.get(pApp);
      const heap = HEAPU8;
      const rowid = (BigInt(hi32) << 32n) | (BigInt(lo32) & 0xffffffffn);
      f(updateType, pullCstr(heap, dbName), pullCstr(heap, tblName), rowid);
    }
  }
};

const FN_METHOD_NAMES = [
  "jsFunc",
  "jsStep",
  "jsFinal",
  "jsUpdateHook"
];
for (const method of FN_METHOD_NAMES) {
  fn_methods[method] = function() {};
  fn_methods[`${method}__deps`] = ['$fn_method_support'];
}
mergeInto(LibraryManager.library, fn_methods);