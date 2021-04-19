import Module from '../dist/wa-sqlite.mjs';

Module().then(Module => {
  console.log(Module);
  const sqlite3_malloc = Module.cwrap('sqlite3_malloc', 'number', ['number']);
  const sqlite3_free = Module.cwrap('sqlite3_free', 'void', ['number']);
  const sqlite3_open_v2 = Module.cwrap('sqlite3_open_v2', 'number', ['string', 'number', 'number', 'string']);

  const tmpPtr = sqlite3_malloc(4);
  const result = sqlite3_open_v2("foo", tmpPtr, 0x6, "unix");
  console.log('result', result);
  const db = Module.getValue(tmpPtr, 'i32');
  sqlite3_free(tmpPtr);
  console.log('opened db', db);
});
