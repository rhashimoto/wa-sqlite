// VFS options for the tests that keep files in a directory of the origin
// private file system instead of its root. A VFS given these options must
// behave as it does with the default root, and must not share locks with a
// VFS using the default root. AccessHandlePoolVFS has no lockPrefix option,
// as it uses no locks, and ignores it.

// The directory the "-customRoot" configurations of test-worker.js use.
export const TEST_ROOT_DIRECTORY = 'wa-sqlite-test-root';

/**
 * @param {string} directoryName directory below the default root
 * @returns {{ getRoot: () => Promise<FileSystemDirectoryHandle>, lockPrefix: string }}
 */
export function customRootOptions(directoryName) {
  return {
    getRoot: () => navigator.storage.getDirectory()
      .then(root => root.getDirectoryHandle(directoryName, { create: true })),
    lockPrefix: `${directoryName}:`,
  };
}
