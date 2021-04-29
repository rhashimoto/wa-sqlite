// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
import { MemoryVFS } from './MemoryVFS.js';

// Asynchronous memory filesystem. This filesystem requires an Asyncify
// build. It is mainly useful for testing that the Asyncify build is
// working.
export class MemoryAsyncVFS extends MemoryVFS {
  name = 'memory-async';
  
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
  // @ts-ignore
  xOpen(name, fileId, flags, pOutFlags) {
    return this.handleAsync(async () => super.xOpen(name, fileId, flags, pOutFlags));
  }

  /**
   * @param {number} fileId 
   */
  // @ts-ignore
  xClose(fileId) {
    return this.handleAsync(async () => super.xClose(fileId));
  }

  /**
   * @param {number} fileId 
   * @param {{ size: number, value: Int8Array }} pData 
   * @param {number} iOffset
   */
  // @ts-ignore
  xRead(fileId, pData, iOffset) {
    return this.handleAsync(async () => super.xRead(fileId, pData, iOffset));
  }

  /**
   * @param {number} fileId 
   * @param {{ size: number, value: Int8Array }} pData 
   * @param {number} iOffset
   */
  // @ts-ignore
  xWrite(fileId, pData, iOffset) {
    return this.handleAsync(async () => super.xWrite(fileId, pData, iOffset));
  }

  /**
   * @param {number} fileId 
   * @param {number} iSize 
   * @returns 
   */
  // @ts-ignore
  xTruncate(fileId, iSize) {
    return this.handleAsync(async () => super.xTruncate(fileId, iSize));
  }

  /**
   * @param {number} fileId 
   * @param {{ set: function(number): void }} pSize64 
   * @returns 
   */
  // @ts-ignore
  xFileSize(fileId, pSize64) {
    return this.handleAsync(async () => super.xFileSize(fileId, pSize64));
  }

  /**
   * 
   * @param {string} name 
   * @param {number} syncDir 
   * @returns 
   */
  // @ts-ignore
  xDelete(name, syncDir) {
    return this.handleAsync(async () => super.xDelete(name, syncDir));
  }

  /**
   * @param {string} name 
   * @param {number} flags 
   * @param {{ set: function(number): void }} pResOut 
   * @returns 
   */
  // @ts-ignore
  xAccess(name, flags, pResOut) {
    return this.handleAsync(async () => super.xAccess(name, flags, pResOut));
  }
}
