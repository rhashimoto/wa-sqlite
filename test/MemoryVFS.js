// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
import * as VFS from './VFS.js';

export class MemoryVFS extends VFS.Base {
  name = 'memory';
  
  // Map of existing files, keyed by filename.
  mapNameToFile = new Map();

  // Map of open files, keyed by id (sqlite3_file pointer).
  mapIdToFile = new Map();

  constructor() {
    super();
  }

  /**
   * @param {string?} name 
   * @param {number} fileId 
   * @param {number} flags 
   * @param {{ set: function(number): void }} pOutFlags 
   * @returns 
   */
  xOpen(name, fileId, flags, pOutFlags) {
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
    pOutFlags.set(flags);
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} fileId 
   */
  xClose(fileId) {
    const file = this.mapIdToFile.get(fileId);
    this.mapIdToFile.delete(fileId);

    if (file.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
      this.mapNameToFile.delete(file.name);
    }
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} fileId 
   * @param {{ size: number, value: Int8Array }} pData 
   * @param {number} iOffset
   */
  xRead(fileId, pData, iOffset) {
    const file = this.mapIdToFile.get(fileId);

    // Clip the requested read to the file boundary.
    const bgn = Math.min(iOffset, file.size);
    const end = Math.min(iOffset + pData.size, file.size);
    const nBytes = end - bgn;

    if (nBytes) {
      pData.value.set(new Int8Array(file.data, bgn, nBytes));
    }
    return nBytes === pData.size ? VFS.SQLITE_OK : VFS.SQLITE_IOERR_SHORT_READ;
  }

  /**
   * @param {number} fileId 
   * @param {{ size: number, value: Int8Array }} pData 
   * @param {number} iOffset
   */
  xWrite(fileId, pData, iOffset) {
    const file = this.mapIdToFile.get(fileId);
    if (iOffset + pData.size > file.data.byteLength) {
      // Resize the ArrayBuffer to hold more data.
      const newSize = Math.max(iOffset + pData.size, 2 * file.data.byteLength);
      const data = new ArrayBuffer(newSize);
      new Int8Array(data).set(new Int8Array(file.data, 0, file.size));
      file.data = data;
    }

    // Copy data.
    new Int8Array(file.data, iOffset, pData.size).set(pData.value);
    file.size = Math.max(file.size, iOffset + pData.size);
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} fileId 
   * @param {number} iSize 
   * @returns 
   */
  xTruncate(fileId, iSize) {
    const file = this.mapIdToFile.get(fileId);

    // For simplicity we don't make the ArrayBuffer smaller.
    file.size = Math.min(file.size, iSize);
    return VFS.SQLITE_OK;
  }

  /**
   * @param {number} fileId 
   * @param {{ set: function(number): void }} pSize64 
   * @returns 
   */
  xFileSize(fileId, pSize64) {
    const file = this.mapIdToFile.get(fileId);

    pSize64.set(file.size);
    return VFS.SQLITE_OK;
  }

  /**
   * 
   * @param {string} name 
   * @param {number} syncDir 
   * @returns 
   */
  xDelete(name, syncDir) {
    this.mapNameToFile.delete(name);
    return VFS.SQLITE_OK;
  }

  /**
   * @param {string} name 
   * @param {number} flags 
   * @param {{ set: function(number): void }} pResOut 
   * @returns 
   */
  xAccess(name, flags, pResOut) {
    const file = this.mapNameToFile.get(name);
    pResOut.set(file ? 1 : 0);
    return VFS.SQLITE_OK;
  }
}
