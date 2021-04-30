declare namespace Asyncify {
  function handleAsync(f: () => Promise<any>);
}

declare function UTF8ToString(ptr: number): string;
declare function ccall(name: string, returns: string, args: Array<any>, options?: object): any;
declare function getValue(ptr: number, type: string): number;
declare function setValue(ptr: number, value: number, type: string): number;
declare function mergeInto(library: object, methods: object): void;

declare var HEAP8: Int8Array;
declare var LibraryManager;
declare var Module;
declare var _vfsAccess;
declare var _vfsCheckReservedLock;
declare var _vfsClose;
declare var _vfsDelete;
declare var _vfsDeviceCharacteristics;
declare var _vfsFileControl;
declare var _vfsFileSize;
declare var _vfsLock;
declare var _vfsOpen;
declare var _vfsRead;
declare var _vfsSectorSize;
declare var _vfsSync;
declare var _vfsTruncate;
declare var _vfsUnlock;
declare var _vfsWrite;

declare var _jsFunc;
declare var _jsStep;
declare var _jsFinal;