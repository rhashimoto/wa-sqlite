import * as VFS from '../VFS.js';
// import { WebTorrent } from "webtorrent"; // the demo page uses a script tag with cdnjs

export class WebTorrentVFS extends VFS.Base {
  name = 'webtorrent';

  defaultOpts = {
    preloading: false,
    timeout: 5000
  }

  /**
   * @param {string} torrent Everything that WebTorrent.add accepts or an existing WebTorrent.Torrent
   * @param {Object} opts
   * @param {boolean} opts.preloading Start auto downloading the complete database file when it is opened
   * @param {number} opts.timeout How long to wait for the torrent to become ready (load meta & pieces information)
   */
  constructor(torrent, opts) {
    super();
    opts = opts || this.defaultOpts;

    this.preloading = opts.preloading || this.defaultOpts.preloading;
    this.mapIdToFile = new Map();

    this.ready = new DeferredPromise();
    this.ready.finally(() => {
      if (this.torrent && this.torrent.ready) {
        console.log("torrent is ready");
        if (this.timeout) {
          clearTimeout(this.timeout);
        }
      }
    });

    if (torrent && torrent.__proto__.constructor.name === "Torrent") { // very bad check if torrent is a WebTorrent.Torrent instance
      this.torrent = torrent;
      if (this.torrent.ready) {
        this.ready.resolve();
      } else {
        this.torrent.on("ready", () => {
          this.ready.resolve();
        });
      }
    } else {
      this.client = new WebTorrent();
      this.torrent = this.client.add(torrent, {
        // store: could use indexeddb-chunk-store for persistence
      }, (torrent) => {
        this.ready.resolve();

        // always stop auto downloading when we control the torrent
        torrent.deselect(0, torrent.pieces.length - 1, false);
      });
    }

    // start timeout last so we can be sure torrent was added/created
    const waitFor = opts.timeout || this.defaultOpts.timeout;
    this.timeout = setTimeout(() => {this.ready.reject(`Torrent was not ready after ${waitFor} ms`)}, waitFor);
  }

  close() {
    if (this.client) {
      this.client.destroy();
    }
  }

  xOpen(name, fileId, flags, pOutFlags) {
    return this.handleAsync(async () => {
      console.debug(`xOpen name:${name} fileId:${fileId} flags:${flags}`);

      const file = await this.findFile(name);
      if (!file) {
        return VFS.SQLITE_CANTOPEN;
      }

      // Put the file in the opened files map.
      this.mapIdToFile.set(fileId, file);

      if (this.preloading) {
        file.select(); // start auto downloading
      }

      pOutFlags.set(flags);
      return VFS.SQLITE_OK;
    });
  }

  xClose(fileId) {
    console.debug(`xClose fileId:${fileId}`);
    const file = this.mapIdToFile.get(fileId);
    if (file && this.client) {
      // stop auto downloading, only if we also control the torrent
      file.deselect(); // does not work according to docs (https://github.com/webtorrent/webtorrent/issues/164) ?
    }
    this.mapIdToFile.delete(fileId);
    return VFS.SQLITE_OK;
  }

  xRead(fileId, pData, iOffset) {
    return this.handleAsync(async () => {
      console.debug(`xRead fileId:${fileId} offset:${iOffset} size:${pData.size}`);
      const file = this.mapIdToFile.get(fileId);

      const stream = file.createReadStream({
        start: iOffset,
        end: iOffset + pData.size - 1 // -1 because end is inclusive
      });

      let arrayOffset = 0;

      return new Promise(((resolve, reject) => {
        stream.on("error", (err) => {
          console.error("read stream error");
          console.error(err);
          resolve(VFS.SQLITE_IOERR);
        });
        stream.on("end", () => {
          if (arrayOffset !== pData.size) {
            // Zero unused area of read buffer.
            pData.value.fill(0, arrayOffset);
            resolve(VFS.SQLITE_IOERR_SHORT_READ);
          } else {
            resolve(VFS.SQLITE_OK);
          }
        });
        stream.on("data", (chunk) => {
          pData.value.subarray(arrayOffset).set(new Int8Array(chunk));
          arrayOffset += chunk.length;
        });
      }));
    });
  }

  xFileSize(fileId, pSize64) {
    const file = this.mapIdToFile.get(fileId);
    console.debug(`xFileSize fileId:${fileId} -> ${file.length}`);
    pSize64.set(file.length);
    return VFS.SQLITE_OK;
  }

  xDeviceCharacteristics(fileId) {
    return VFS.SQLITE_IOCAP_IMMUTABLE;
  }

  xAccess(name, flags, pResOut) {
    return this.handleAsync(async () => {
      console.debug(`xAccess name:${name} flags:${flags}`);
      const file = await this.findFile(name);
      if (file && (flags === VFS.SQLITE_ACCESS_EXISTS || flags === VFS.SQLITE_ACCESS_READ)) {
        pResOut.set(1);
      } else {
        pResOut.set(0);
      }
      return VFS.SQLITE_OK;
    });
  }

  async waitUntilTorrentIsReady() {
    if (!this.torrent.ready) {
      console.debug("waiting for torrent to be ready...");
      await this.ready;
    }
  }

  /**
   * Search file in torrent
   * @param {string} name
   * @return WebTorrent.TorrentFile
   */
  async findFile(name) {
    try {
      await this.waitUntilTorrentIsReady();
    } catch (err) {
      console.error(err);
      return null;
    }

    for (let file of this.torrent.files) {
      if (file.path === name) {
        return file;
      }
    }
    console.error(`\"${name}\" does not exist in ${this.torrent.files}`)
    return null;
  }
}

// copied from https://stackoverflow.com/a/47112177
class DeferredPromise {
  constructor() {
    this._promise = new Promise((resolve, reject) => {
      // assign the resolve and reject functions to `this`
      // making them usable on the class instance
      this.resolve = resolve;
      this.reject = reject;
    });
    // bind `then` and `catch` to implement the same interface as Promise
    this.then = this._promise.then.bind(this._promise);
    this.catch = this._promise.catch.bind(this._promise);
    this.finally = this._promise.finally.bind(this._promise);
    this[Symbol.toStringTag] = 'Promise';
  }
}
