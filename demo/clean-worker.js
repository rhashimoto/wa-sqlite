const INDEXEDDB_DATABASES = [
  'demo-IDBMinimalVFS',
  'demo-IDBBatchAtomicVFS',
  'demo-IDBMinimalVFS-relaxed',
  'demo-IDBBatchAtomicVFS-relaxed',
  'benchmark-IDBMinimalVFS',
  'benchmark-IDBBatchAtomicVFS',
];

(async function() {
  // Remove IndexedDB databases.
  if (indexedDB.databases) {
    await indexedDB.databases().then(async databases => {
      for (const database of databases) {
        await deleteDatabase(database.name);
      }
    });
  } else {
    for (const database of INDEXEDDB_DATABASES) {
      await deleteDatabase(database);
    }
  }

  // Remove all OPFS files and directories.
  const root = await navigator.storage.getDirectory();
  // @ts-ignore
  for await (const handle of root.values()) {
    await root.removeEntry(handle.name, { recursive: true });
  }
  
  postMessage(null);
})();

function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.addEventListener('success', resolve);
    request.addEventListener('error', () => {
      reject(new Error(`error deleting ${name}`));
    });
    request.addEventListener('blocked', () => {
      reject(new Error(`blocked deleting ${name}`));
    });
  });
}