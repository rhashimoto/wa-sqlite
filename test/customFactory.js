// VFS options for the tests that keep IndexedDB databases in a Storage
// Bucket instead of the default one. A VFS given these options must behave
// as it does with the global indexedDB, and must not share locks or messages
// with a VFS using it. Storage Buckets exist only in Chromium; elsewhere the
// tests that need one are skipped.

// The bucket the "-customFactory" configurations of test-worker.js use.
export const TEST_BUCKET = 'wa-sqlite-test-bucket';

/**
 * @param {string} bucketName
 * @returns {{ getIDBFactory: () => Promise<IDBFactory>, prefix: string }}
 */
export function customFactoryOptions(bucketName) {
  return {
    // @ts-ignore
    getIDBFactory: () => navigator.storageBuckets.open(bucketName)
      .then(bucket => bucket.indexedDB),
    prefix: `${bucketName}:`,
  };
}

/**
 * @returns {boolean} whether this context has Storage Buckets
 */
export function supportsStorageBuckets() {
  return 'storageBuckets' in navigator;
}
