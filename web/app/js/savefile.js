// savefile.js - the browser's saves to and from the original game's save file, savedata000 (gamesave.js has the file's layout): the opening page's
// Export and Import (home.js). The port's own; the game keeps its saves in that one file already.
//
// What goes across, and where the port keeps it (KEYS):
//   the config          tsuki.settings, tsuki.volumes (the fields the port has; gamesave.js CONFIG)
//   the globals         tsuki.globals; the flowchart's bits among them are tsuki.flow.v2
//   pictures and music  tsuki.unlocks.v1 (seen bits, music numbers, the two opening movies)
//   the read marks      tsuki.readBlocks
// Not in the file and left alone by both: the key bindings, the voice samples, which pages were shown (LOCAL).
//
// Import takes the file in place of what the browser has. The file itself is kept too (in the browser's database, `base`), and an Export starts
// from it, so that what the port keeps no copy of (the choices taken, config fields with no setting, the save records) comes out as it went in.
import { GAME, FILE_NAME, isGameSave, readSystem, usedRecords, writeSystem } from "./gamesave.js";
import { cgLists, musicUnlocked } from "./unlocks.js";

export { FILE_NAME };
// The names the game's state is kept under here, with what each holds (for the test that every stored name is accounted for).
export const KEYS = {
  "tsuki.saves": "saves", "tsuki.autosaves": "saves", "tsuki.quicksave": "saves",
  "tsuki.globals": "progress", "tsuki.flow.v2": "progress", "tsuki.unlocks.v1": "progress", "tsuki.readBlocks": "progress", "tsuki.read": "progress",
  "tsuki.settings": "config", "tsuki.volumes": "config",
};
// Kept by this browser and never part of a save file: the key bindings, the config's voice samples, the first visit made, the touch hint learnt; and
// the note the opening page leaves itself across the reload after an import (session storage).
export const LOCAL = ["tsuki.keys", "tsuki.voiceSamples", "tsuki.welcomed", "tsuki.touch.hint"];
export const NOTE = "tsuki.home.loaded";

let replaced = false;
// True once an import has been written: the page is about to load again, and nothing it still holds in memory may be saved over the file (main.js's
// pagehide).
export const savesReplaced = () => replaced;

const json = (storage, k, or) => { try { return JSON.parse(storage.getItem(k) ?? "null") ?? or; } catch { return or; } };
const fromBase64 = (s) => { try { return Uint8Array.from(atob(s || ""), (c) => c.charCodeAt(0)); } catch { return new Uint8Array(0); } };
const toBase64 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

// Has the game been played here? A save of any kind, or a scene started. (The settings and the empty progress lists are written by the first visit
// itself, so their names being there says nothing.) Import asks before it replaces such a browser's progress, and Export has nothing to give another.
export function hasProgress(storage = globalThis.localStorage) {
  try {
    return Object.keys(json(storage, "tsuki.saves", {})).length > 0 || json(storage, "tsuki.autosaves", []).length > 0 || !!storage.getItem("tsuki.quicksave")
      || (json(storage, "tsuki.flow.v2", {}).started || []).length > 0;
  } catch { return false; }
}

// The port's state as gamesave.js writes it. seenOf: gallery.json's "seen" (picture name -> bit), for pictures an older version recorded by name.
export function portState(storage = globalThis.localStorage, seenOf = null) {
  const unlocks = json(storage, "tsuki.unlocks.v1", {}), flow = json(storage, "tsuki.flow.v2", {});
  const seen = new Set(unlocks.seen || []);
  if (seenOf) for (const name of unlocks.images || []) if (seenOf[name] !== undefined) seen.add(seenOf[name]);
  return {
    settings: json(storage, "tsuki.settings", {}), volumes: json(storage, "tsuki.volumes", {}), globals: json(storage, "tsuki.globals", {}),
    flow: { started: flow.started || [], completed: flow.completed || [], secondary: flow.secondary || [] },
    seen: [...seen], music: unlocks.music || [], movies: unlocks.movies || [], readBlocks: fromBase64(storage.getItem("tsuki.readBlocks")),
  };
}

// A savedata000 of the browser's state, or null when the game has not been played here. base: the file last imported (a Uint8Array), if any.
export function exportSaves(storage = globalThis.localStorage, base = null, seenOf = null) {
  if (!hasProgress(storage)) return null;
  const from = base && isGameSave(base) ? base : null, file = new Uint8Array(GAME.size);
  if (from) file.set(from);
  file.set(writeSystem(portState(storage, seenOf), from));
  return file;
}

// A file's bytes, checked: the parts as gamesave.js reads them. Throws an Error whose message is for the player.
export function readSaves(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== GAME.size) throw Error("That is not the game's save file (savedata000).");
  if (!isGameSave(bytes)) throw Error("That save file is empty or damaged; nothing was changed.");
  return { ...readSystem(bytes), records: usedRecords(bytes) };   // (records: only counted so far, see recordsLine)
}

// The file's save records are not read into the port's saves yet (TODO item 161): they stay in the kept file and go out again with an Export. The
// line that says so after an import, or nothing for a file with none.
export function recordsLine(sys) {
  const n = sys.records?.length || 0;
  return n ? ` Its ${n} save${n === 1 ? "" : "s"} cannot be loaded here yet; ${n === 1 ? "it stays" : "they stay"} in the file for the next Export.` : "";
}

// The file's parts in place of the browser's. If the browser will not take them (no room, storage refused) what was there is put back and the
// error thrown.
export function importSaves(sys, storage = globalThis.localStorage) {
  const names = ["tsuki.settings", "tsuki.volumes", "tsuki.globals", "tsuki.flow.v2", "tsuki.unlocks.v1", "tsuki.readBlocks", "tsuki.read"];
  const before = Object.fromEntries(names.map((k) => [k, storage.getItem(k)]));
  const put = (k, v) => { if (v === null || v === undefined) storage.removeItem(k); else storage.setItem(k, v); };
  try {
    put("tsuki.settings", JSON.stringify({ ...json(storage, "tsuki.settings", {}), ...sys.settings }));
    put("tsuki.volumes", JSON.stringify({ ...json(storage, "tsuki.volumes", {}), ...sys.volumes }));
    put("tsuki.globals", JSON.stringify(sys.globals));
    // (migrated, endingsInferred: the file's bits are the game's own, so nothing is to be worked out from older read history)
    put("tsuki.flow.v2", JSON.stringify({ ...sys.flow, migrated: true, endingsInferred: true }));
    put("tsuki.unlocks.v1", JSON.stringify({ images: [], seen: sys.seen, music: sys.music, movies: sys.movies }));
    put("tsuki.readBlocks", toBase64(sys.readBlocks));
    put("tsuki.read", null);   // (the port's own older list of lines shown: the game's marks above stand for it)
  } catch (e) {
    try { for (const k of names) put(k, before[k]); } catch { /* as much of it as the browser takes */ }
    throw Error("This browser would not store the file; nothing was changed.", { cause: e });
  }
  replaced = true;
}

// What the browser holds now, for SAVE DATA's page: rows of [name, what], or none when the game has not been played here and no file is kept.
//   tables: { chart, gallery } (flowchart.json, gallery.json), so that a row can say "of how many", as the game's own screens count them: the
//           flowchart's scenes, the pictures the CG gallery lists, the Music Player's rows. Without them the rows give the bare counts.
//   base:   the file last imported, if one is kept
export function loadedData(storage = globalThis.localStorage, { chart = null, gallery = null } = {}, base = null) {
  const kept = base && isGameSave(base) ? usedRecords(base).length : -1;
  if (!hasProgress(storage) && kept < 0) return [];
  const s = portState(storage, gallery?.seen || null), plural = (k, word) => `${k} ${word}${k === 1 ? "" : "s"}`;
  const flow = { started: new Set(s.flow.started), completed: new Set(s.flow.completed) };
  const unlocks = { seen: new Set(s.seen), images: new Set(json(storage, "tsuki.unlocks.v1", {}).images || []), music: new Set(s.music), movies: new Set(s.movies) };
  const rows = [];
  const scenes = chart ? [...new Set(chart.groups.flatMap((g) => g.parts).filter((p) => p.flag > 0).map((p) => p.flag))] : null;
  rows.push(["Scenes", scenes ? `${scenes.filter((n) => flow.completed.has(n)).length} of ${scenes.length} completed` : `${flow.completed.size} completed`]);
  if (gallery) {
    const all = gallery.cg.reduce((n, e) => n + e.variants.length, 0);
    rows.push(["Pictures", `${cgLists(gallery.cg, { unlocks, flow }).flat.length} of ${all}`]);
    rows.push(["Music", `${gallery.music.filter((t) => musicUnlocked(t, { unlocks, flow })).length} of ${gallery.music.length}`]);
  } else {
    rows.push(["Pictures", String(unlocks.seen.size)], ["Music", String(unlocks.music.size)]);
  }
  const saves = Object.keys(json(storage, "tsuki.saves", {})).length, autos = json(storage, "tsuki.autosaves", []).length, quick = !!storage.getItem("tsuki.quicksave");
  const parts = [saves ? plural(saves, "save") : "", autos ? plural(autos, "automatic save") : "", quick ? "a quick save" : ""].filter(Boolean);
  rows.push(["Saves made here", parts.length ? parts.join(", ") : "None"]);
  if (kept >= 0) rows.push(["Imported file", `${FILE_NAME}, kept for Export${kept ? `, with its ${plural(kept, "save slot")}` : ""}`]);
  return rows;
}

// Remove: the saves and the progress out of the browser, as if the game had never been played here. The settings, volumes and key bindings stay
// (they are how the player likes the game, not where they are in it); the kept file goes too (dropBase).
export const REMOVED = ["tsuki.saves", "tsuki.autosaves", "tsuki.quicksave", "tsuki.globals", "tsuki.flow.v2", "tsuki.unlocks.v1", "tsuki.readBlocks", "tsuki.read"];
export function removeSaves(storage = globalThis.localStorage) {
  for (const k of REMOVED) storage.removeItem(k);
  replaced = true;   // (the page loads again, and what it holds in memory must not be written back: main.js pagehide)
}

// ---- the file last imported, kept whole (4 MB: more than local storage has room for) ---------------------------------------------------------
const DB = "tsuki.files", STORE = "files";
function database(idb) {
  return new Promise((done, fail) => {
    const open = idb.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onsuccess = () => done(open.result);
    open.onerror = () => fail(open.error);
  });
}
// (both resolve even where the browser has no database or refuses it: there is then no base, and an Export is made from the port's state alone)
export async function keepBase(bytes, idb = globalThis.indexedDB) {
  try {
    const db = await database(idb);
    await new Promise((done, fail) => { const t = db.transaction(STORE, "readwrite"); t.objectStore(STORE).put(bytes, FILE_NAME); t.oncomplete = done; t.onerror = () => fail(t.error); });
    db.close();
    return true;
  } catch { return false; }
}
export async function dropBase(idb = globalThis.indexedDB) {
  try {
    const db = await database(idb);
    await new Promise((done, fail) => { const t = db.transaction(STORE, "readwrite"); t.objectStore(STORE).delete(FILE_NAME); t.oncomplete = done; t.onerror = () => fail(t.error); });
    db.close();
    return true;
  } catch { return false; }
}
export async function loadBase(idb = globalThis.indexedDB) {
  try {
    const db = await database(idb);
    const got = await new Promise((done, fail) => { const r = db.transaction(STORE).objectStore(STORE).get(FILE_NAME); r.onsuccess = () => done(r.result); r.onerror = () => fail(r.error); });
    db.close();
    return got instanceof Uint8Array ? got : got ? new Uint8Array(got) : null;
  } catch { return null; }
}
