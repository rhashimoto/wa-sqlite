// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
import * as VFS from './VFS.js';

export class MemoryVFS extends VFS.Base {
  // Map of existing files, keyed by filename.
  mapNameToFile = new Map();

  // Map of open files, keyed by id (sqlite3_file pointer).
  mapIdToFile = new Map();

  constructor(Module) {
    super(Module);
  }

  /**
   * @param {string?} name 
   * @param {number} fileId 
   * @param {number} flags 
   * @param {number} pOutFlags 
   * @returns 
   */
  open(name, fileId, flags, pOutFlags) {
    // Generate a random name if requested.
    name = name || Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);

    let file = this.mapNameToFile.get(name);
    if (!file) {
      if (flags & VFS.SQLITE_OPEN_CREATE) {
        // Create a new file object.
        file = {
          name,
          flags,
          size: 0,
          data: new ArrayBuffer(0)
        }
        this.mapNameToFile.set(name, file);
      } else {
        return VFS.SQLITE_CANTOPEN;
      }
    }

    // Put the file in the opened files map.
    this.mapIdToFile.set(fileId, file);
    this.setValue(pOutFlags, flags, 'i32');
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} fileId 
   */
  close(fileId) {
    const file = this.mapIdToFile.get(fileId);
    this.mapIdToFile.delete(fileId);

    if (file.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
      this.mapNameToFile.delete(file.name);
    }
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} fileId 
   * @param {number} pData 
   * @param {number} iSize
   * @param {number} iOffset
   */
  read(fileId, pData, iSize, iOffset) {
    const file = this.mapIdToFile.get(fileId);

    // Clip the requested read to the file boundary.
    const bgn = Math.min(iOffset, file.size);
    const end = Math.min(iOffset + iSize, file.size);
    const nBytes = end - bgn;

    if (nBytes) {
      this.getArray(pData, nBytes).set(new Int8Array(file.data, bgn, nBytes));
    }
    return nBytes === iSize ? VFS.SQLITE_OK : VFS.SQLITE_IOERR_SHORT_READ;
  }

  /**
   * @param {number} fileId 
   * @param {number} pData Wasm memory offset
   * @param {number} iSize
   * @param {number} iOffset
   */
  write(fileId, pData, iSize, iOffset) {
    const file = this.mapIdToFile.get(fileId);
    if (iOffset + iSize > file.data.byteLength) {
      // Resize the ArrayBuffer to hold more data.
      const newSize = Math.max(iOffset + iSize, 2 * file.data.byteLength);
      const data = new ArrayBuffer(newSize);
      new Int8Array(data).set(new Int8Array(file.data, 0, file.size));
      file.data = data;
    }

    // Copy data.
    new Int8Array(file.data, iOffset, iSize).set(this.getArray(pData, iSize));
    file.size = Math.max(file.size, iOffset + iSize);
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} fileId 
   * @param {number} iSize 
   * @returns 
   */
  truncate(fileId, iSize) {
    const file = this.mapIdToFile.get(fileId);

    // For simplicity we don't make the ArrayBuffer smaller.
    file.size = Math.min(file.size, iSize);
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} fileId 
   * @param {number} pSize64 pointer to 64-bit integer output
   * @returns 
   */
  fileSize(fileId, pSize64) {
    const file = this.mapIdToFile.get(fileId);

    // Note that this is a 64-bit value, so type is 'i64'.
    this.setValue(pSize64, file.size, 'i64');
    return VFS.SQLITE_OK;
  }

  /**
   * 
   * @param {string} name 
   * @param {number} syncDir 
   * @returns 
   */
  delete(name, syncDir) {
    this.mapNameToFile.delete(name);
    return VFS.SQLITE_OK;
  }

  /**
   * @param {string} name 
   * @param {number} flags 
   * @param {number} pResOut pointer to 32-bit integer output
   * @returns 
   */
  access(name, flags, pResOut) {
    const file = this.mapNameToFile.get(name);
    this.setValue(pResOut, file ? 1 : 0, 'i32');
    return VFS.SQLITE_OK;
  }
}
