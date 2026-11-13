// updater.js - the desktop app's side of an update (web/app/js/update.js decides what is wanted; apphost.js lists the commands).
//
// Updates are kept under the app's own data folder, one folder a version:
//   update/state.json            which one is in use, which was before it, whether it has come up, which were given up
//   update/<id>/files/...        the files of update <id>, under the paths the page asks for them by
//   update/<id>/meta.json        what <id> is: written when it is switched to, with every file's size and hash
// A request is answered from the update in use where it has the file (fileFor), from the app's own files otherwise. An update's folder is filled
// file by file, each downloaded beside its place, checked against its size and hash and only then given its name; nothing looks into that
// folder until state.json names it, and state.json is replaced in one step. So the app is always wholly on one version: an update cut off
// halfway has changed nothing, and its finished files are found again, checked, the next time. Downloads come from one address, `origin`, which
// the caller fixes (https://arcueid.date); the page chooses only paths under it.
//
// A version that does not come up (the page never confirms it) twice running is taken out again, the one before it is back, and its name is
// kept in `rejected`. Everything is dropped when the app itself is another one than the updates were made for (`bundle`).
// Only Node's own modules, so that the tests can run it (web-dev/tests/app-update.test.mjs).
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SAFE_PATH = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;   // (update.js has the same)
const QUERY = /^h=[0-9a-f]{1,64}$/;
const ID = /^[0-9a-f]{12}-[0-9a-f]{8}$/;
const HASH = /^([0-9a-f]{32}|[0-9a-f]{64})$/;   // MD5 for the game's files, SHA-256 for the page's
const TEXT_MOST = 4 << 20, FILE_MOST = 2 ** 31, TRIES = 2, STALL = 30000;

const algorithm = (hash) => (hash.length === 32 ? "md5" : "sha256");
function hashFile(file, hash) {
  const h = crypto.createHash(algorithm(hash)), fd = fs.openSync(file, "r"), buf = Buffer.allocUnsafe(1 << 20);
  try { for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n)); } finally { fs.closeSync(fd); }
  return h.digest("hex");
}
// A file written whole or not at all: beside its place first, flushed, then renamed over it (retried where a scanner holds it, as on Windows).
function writeWhole(file, data) {
  const tmp = `${file}.tmp`, fd = fs.openSync(tmp, "w");
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  rename(tmp, file);
}
function rename(from, to) {
  for (let i = 0; ; i++) {
    try { fs.renameSync(from, to); return; } catch (e) {
      if (i >= 5 || !["EPERM", "EBUSY", "EACCES"].includes(e.code)) throw e;
      const until = Date.now() + 100 * (i + 1); while (Date.now() < until) { /* a moment */ }
    }
  }
}
const sizeOf = (file) => { try { const st = fs.statSync(file); return st.isFile() ? st.size : -1; } catch { return -1; } };

class Updater {
  // dir: where the updates are kept. origin: the one address downloads come from. bundle: a name for the files the app was built with.
  // fetch(url, { signal }): the web's fetch.
  constructor({ dir, origin, bundle, fetch }) {
    Object.assign(this, { dir, origin: origin.replace(/\/$/, ""), bundle, fetch });
    this.state = this.fresh();
    this.meta = null;
    this.busy = null;   // the download under way: { stop() }
  }
  fresh() { return { bundle: this.bundle, current: null, previous: null, confirmed: true, tries: 0, rejected: [] }; }
  folder(id) { return path.join(this.dir, id); }
  place(id, rel) { return path.join(this.dir, id, "files", ...rel.split("/")); }
  save() { fs.mkdirSync(this.dir, { recursive: true }); writeWhole(path.join(this.dir, "state.json"), JSON.stringify(this.state)); }
  // An update as it was recorded, if every file of it is there at its size; else null.
  read(id) {
    try {
      if (!ID.test(id || "")) return null;
      const meta = JSON.parse(fs.readFileSync(path.join(this.folder(id), "meta.json"), "utf8"));
      if (meta.id !== id || !meta.files || typeof meta.files !== "object") return null;
      for (const [rel, [size]] of Object.entries(meta.files)) if (!SAFE_PATH.test(rel) || sizeOf(this.place(id, rel)) !== size) return null;
      return meta;
    } catch { return null; }
  }
  drop(id) { if (ID.test(id || "")) fs.rmSync(this.folder(id), { recursive: true, force: true }); }
  // The version tried twice without coming up, or broken on disk: out, the one before it back, and not offered again by itself.
  giveUp() {
    const s = this.state;
    if (s.current) { s.rejected = [...s.rejected.filter((r) => r !== s.current), s.current].slice(-8); this.drop(s.current); }
    s.current = this.read(s.previous) ? s.previous : null;
    s.previous = null; s.confirmed = true; s.tries = 0;
  }

  // Once, as the app starts.
  load() {
    let s = null;
    try { s = JSON.parse(fs.readFileSync(path.join(this.dir, "state.json"), "utf8")); } catch { /* none yet, or unreadable: as built */ }
    if (!s || typeof s !== "object" || s.bundle !== this.bundle) {
      // No update has been switched to yet (what a download left is kept: it is checked file by file when it goes on). Or the app itself
      // is another one than the updates were made for: it is the newer, and they go.
      if (s) fs.rmSync(this.dir, { recursive: true, force: true });
      this.state = this.fresh();
      this.meta = null;
      return this;
    }
    this.state = { ...this.fresh(), ...s, rejected: Array.isArray(s.rejected) ? s.rejected.filter((r) => ID.test(r)) : [] };
    const st = this.state;
    if (st.current && !st.confirmed) { if (st.tries >= TRIES) this.giveUp(); else st.tries++; }
    if (st.current && !this.read(st.current)) this.giveUp();
    this.meta = st.current ? this.read(st.current) : null;
    this.save();
    return this;
  }

  // The file to answer a request for `rel` ("js/main.js", "assets/img/X.avif") with, when the update in use has one.
  fileFor(rel) { return this.meta && Object.hasOwn(this.meta.files, rel) ? this.place(this.meta.id, rel) : null; }
  info() {
    const m = this.meta;
    return { current: m ? { id: m.id, time: m.time, version: m.version, assets: m.assets, files: m.files } : null, rejected: this.state.rejected };
  }
  // The page has come up in the version in use: it stays, and the one before it is not needed any more.
  confirm() {
    const s = this.state;
    if (s.confirmed) return;
    s.confirmed = true; s.tries = 0;
    const old = s.previous;
    s.previous = null;
    this.save();
    if (old && old !== s.current) this.drop(old);
  }

  address(from) {
    const [rel, query, more] = String(from).split("?");
    if (more !== undefined || !SAFE_PATH.test(rel) || (query !== undefined && !QUERY.test(query))) throw Error(`not a path of the site's: ${from}`);
    return `${this.origin}/${rel}${query ? `?${query}` : ""}`;
  }
  // One download: its bytes to `each`, in pieces. Stops when nothing has come for STALL ms, or when `stop` is called.
  async get(url, each, most) {
    const cut = new AbortController();
    let timer = null;
    const wait = () => { clearTimeout(timer); timer = setTimeout(() => cut.abort(), STALL); };
    const stop = () => cut.abort();
    this.stops?.add(stop);
    try {
      wait();
      const r = await this.fetch(url, { signal: cut.signal, redirect: "error", cache: "no-store" });
      if (r.status !== 200 || !r.body) throw Error(`${url}: HTTP ${r.status}`);
      let size = 0;
      for await (const piece of r.body) {
        wait();
        size += piece.length;
        if (size > most) throw Error(`${url}: larger than expected`);
        each(piece);
      }
    } finally { clearTimeout(timer); this.stops?.delete(stop); }
  }
  async fetchText({ path: from, hash = null }) {
    if (hash !== null && !HASH.test(hash)) throw Error("not a hash");
    const parts = [];
    await this.get(this.address(from), (p) => parts.push(Buffer.from(p)), TEXT_MOST);
    const all = Buffer.concat(parts);
    if (hash && crypto.createHash(algorithm(hash)).update(all).digest("hex") !== hash) throw Error(`${from}: not the file the site lists`);
    return all.toString("utf8");
  }

  // Fills update `id`'s folder with `files` ([{ path, from, size, hash }]): a file already there, or held by the update in use, is checked
  // and kept; the others are downloaded. onProgress({ done, total }): the bytes downloaded, of those to download.
  async stage({ id, files }, onProgress = null) {
    if (this.busy) throw Error("an update is being downloaded already");
    if (!ID.test(id || "") || !Array.isArray(files)) throw Error("not an update");
    for (const f of files) {
      if (!f || !SAFE_PATH.test(f.path) || !HASH.test(f.hash || "") || !Number.isInteger(f.size) || f.size < 0 || f.size > FILE_MOST) throw Error(`not an update's file: ${f?.path}`);
      this.address(f.from);
    }
    const s = this.state;
    if (id === s.current) throw Error("that update is in use");
    this.stops = new Set();
    let stopped = false;
    this.busy = { stop: () => { stopped = true; for (const stop of this.stops) stop(); } };
    try {
      // room is kept for the version in use, the one before it while that may still be gone back to, and this one
      fs.mkdirSync(this.dir, { recursive: true });
      for (const name of fs.readdirSync(this.dir)) if (ID.test(name) && ![id, s.current, s.previous].includes(name)) this.drop(name);
      const wanted = [];
      for (const f of files) {
        const dest = this.place(id, f.path);
        if (sizeOf(dest) === f.size && hashFile(dest, f.hash) === f.hash) continue;   // (from a download that was cut off)
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const held = this.meta?.files[f.path];
        if (held && held[1] === f.hash) {
          fs.copyFileSync(this.place(this.meta.id, f.path), `${dest}.part`);
          if (hashFile(`${dest}.part`, f.hash) === f.hash) { rename(`${dest}.part`, dest); continue; }
        }
        wanted.push(f);
      }
      const total = wanted.reduce((n, f) => n + f.size, 0);
      let done = 0, told = 0;
      const tell = (force) => { const now = Date.now(); if (onProgress && (force || now - told > 100)) { told = now; onProgress({ done, total }); } };
      tell(true);
      for (const f of wanted) {
        if (stopped) throw Error("stopped");
        const dest = this.place(id, f.path), part = `${dest}.part`, h = crypto.createHash(algorithm(f.hash)), fd = fs.openSync(part, "w");
        let size = 0;
        try {
          await this.get(this.address(f.from), (p) => { fs.writeSync(fd, p); h.update(p); size += p.length; done += p.length; tell(false); }, f.size);
          fs.fsyncSync(fd);
        } catch (e) { done -= size; fs.closeSync(fd); fs.rmSync(part, { force: true }); throw stopped ? Error("stopped") : e; }
        fs.closeSync(fd);
        if (size !== f.size || h.digest("hex") !== f.hash) { fs.rmSync(part, { force: true }); throw Error(`${f.path}: not the file the site lists`); }
        rename(part, dest);
      }
      tell(true);
      return { ok: true };
    } finally { this.busy = null; this.stops = null; }
  }
  cancel() { this.busy?.stop(); }

  // Switches to update `id`, whose files `stage` has brought: meta = { id, time, version, assets, files: { path: [size, hash] } }.
  apply({ id, meta }) {
    if (this.busy) throw Error("an update is being downloaded");
    if (!ID.test(id || "") || !meta || meta.id !== id || !meta.files || typeof meta.files !== "object") throw Error("not an update");
    if (!Number.isFinite(meta.time) || !/^[0-9a-f]{12}$/.test(meta.version || "") || !/^[0-9a-f]{32}$/.test(meta.assets || "")) throw Error("not an update");
    const files = {};
    for (const [rel, entry] of Object.entries(meta.files)) {
      if (!SAFE_PATH.test(rel) || !Array.isArray(entry) || !Number.isInteger(entry[0]) || !HASH.test(entry[1] || "")) throw Error(`not an update's file: ${rel}`);
      if (sizeOf(this.place(id, rel)) !== entry[0]) throw Error(`${rel} has not been downloaded`);
      files[rel] = [entry[0], entry[1]];
    }
    const kept = { id, time: meta.time, version: meta.version, assets: meta.assets, files };
    writeWhole(path.join(this.folder(id), "meta.json"), JSON.stringify(kept));
    const s = this.state;
    // (the one before stays until this one has come up; an unconfirmed one in between is not gone back to)
    if (s.current !== id) { if (s.confirmed) { if (s.previous && s.previous !== id) this.drop(s.previous); s.previous = s.current; } else this.drop(s.current); }
    s.current = id; s.confirmed = false; s.tries = 1;
    this.save();   // the switch
    this.meta = kept;
    return { ok: true };
  }
}

module.exports = { Updater, SAFE_PATH, ID };
