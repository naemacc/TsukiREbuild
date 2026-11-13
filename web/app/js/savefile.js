// savefile.js - the browser's saves to and from the original game's save file, savedata000 (gamesave.js has the file's layout): the opening page's
// Export and Import (home.js). The port's own; the game keeps its saves in that one file already.
//
// What goes across, and where the port keeps it (KEYS):
//   the config          tsuki.settings, tsuki.volumes (the fields the port has; gamesave.js CONFIG)
//   the globals         tsuki.globals; the flowchart's bits among them are tsuki.flow.v2
//   pictures and music  tsuki.unlocks.v1 (seen bits, music numbers, the two opening movies)
//   the read marks      tsuki.readBlocks
// Not in the file and left alone by both: the key bindings, the voice samples, the language, which pages were shown (LOCAL).
//
// Import loads the file's settings and progress over the browser's own, which are put aside first (OWN), not lost: Remove takes the file out again
// and puts them back as they were. The saves made here (the save list, the automatic saves, the quick save) are the browser's own throughout; neither
// touches them. The file itself is kept too (in the browser's database, `base`), and an Export starts from it, so that what the port keeps no copy of
// (the choices taken, config fields with no setting, the file's records) comes out as it went in.
import { GAME, FILE_NAME, isGameSave, readSystem, writeSystem } from "./gamesave.js";
import { cgLists, musicUnlocked } from "./unlocks.js";

export { FILE_NAME };
// The names the game's state is kept under here, with what each holds (for the test that every stored name is accounted for).
export const KEYS = {
  "tsuki.saves": "saves", "tsuki.autosaves": "saves", "tsuki.quicksave": "saves",
  "tsuki.globals": "progress", "tsuki.flow.v2": "progress", "tsuki.unlocks.v1": "progress", "tsuki.readBlocks": "progress", "tsuki.read": "progress",
  "tsuki.settings": "config", "tsuki.volumes": "config",
};
// Kept by this browser and never part of a save file: the key bindings, the config's voice samples, the first visit made, the touch hint learnt, the
// language (lang.js); and the notes the opening page leaves itself across a reload, after an import or a change of language (session storage).
// (and, in the Android and desktop apps, the update's notes: update.js)
export const LOCAL = ["tsuki.keys", "tsuki.voiceSamples", "tsuki.welcomed", "tsuki.touch.hint", "tsuki.lang", "tsuki.home.tab", "tsuki.update.seen", "tsuki.update.done"];
export const NOTE = "tsuki.home.loaded";
// The browser's own settings and progress while an imported file (or the 100% save) is loaded: { name: the stored value, or null where there was
// none }, and under "label" what is loaded, for the page to say.
export const OWN = "tsuki.own";
// What an import writes, and so what is put aside and put back.
export const IMPORTED = ["tsuki.settings", "tsuki.volumes", "tsuki.globals", "tsuki.flow.v2", "tsuki.unlocks.v1", "tsuki.readBlocks", "tsuki.read"];
// Is an imported file loaded?
export function hasImported(storage = globalThis.localStorage) { try { return !!storage.getItem(OWN); } catch { return false; } }
// What is loaded, as the import named it ("savedata000", "The 100% save"), or null with nothing loaded.
export function importedLabel(storage = globalThis.localStorage) {
  try { const own = JSON.parse(storage.getItem(OWN) ?? "null"); return own ? own.label || FILE_NAME : null; } catch { return null; }
}

let replaced = false;
// True once an import has been written: the page is about to load again, and nothing it still holds in memory may be saved over the file (main.js's
// pagehide).
export const savesReplaced = () => replaced;

const json = (storage, k, or) => { try { return JSON.parse(storage.getItem(k) ?? "null") ?? or; } catch { return or; } };
const fromBase64 = (s) => { try { return Uint8Array.from(atob(s || ""), (c) => c.charCodeAt(0)); } catch { return new Uint8Array(0); } };
const toBase64 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

// Has the game been played here? A save of any kind, or a scene started. (The settings and the empty progress lists are written by the first visit
// itself, so their names being there says nothing.) Export has nothing to give where it has not.
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
  return readSystem(bytes);
}

// The file's parts over the browser's own, which are put aside first unless a file is loaded already (then they are aside, and the earlier file's
// parts are what is replaced). If the browser will not take them (no room, storage refused) everything is put back as it was and the error thrown.
//   label:        what is being loaded, kept for the page to say
//   keepSettings: the progress alone; the settings and volumes stay the browser's (the 100% save: it is somebody else's game, not their config)
export function importSaves(sys, storage = globalThis.localStorage, { label = FILE_NAME, keepSettings = false } = {}) {
  const before = Object.fromEntries(IMPORTED.map((k) => [k, storage.getItem(k)])), aside = storage.getItem(OWN);
  const put = (k, v) => { if (v === null || v === undefined) storage.removeItem(k); else storage.setItem(k, v); };
  try {
    put(OWN, JSON.stringify({ ...(aside ? JSON.parse(aside) : before), label }));
    if (!keepSettings) {
      put("tsuki.settings", JSON.stringify({ ...json(storage, "tsuki.settings", {}), ...sys.settings }));
      put("tsuki.volumes", JSON.stringify({ ...json(storage, "tsuki.volumes", {}), ...sys.volumes }));
    }
    put("tsuki.globals", JSON.stringify(sys.globals));
    // (migrated, endingsInferred: the file's bits are the game's own, so nothing is to be worked out from older read history)
    put("tsuki.flow.v2", JSON.stringify({ ...sys.flow, migrated: true, endingsInferred: true }));
    put("tsuki.unlocks.v1", JSON.stringify({ images: [], seen: sys.seen, music: sys.music, movies: sys.movies }));
    put("tsuki.readBlocks", toBase64(sys.readBlocks));
    put("tsuki.read", null);   // (the port's own older list of lines shown: the game's marks above stand for it)
  } catch (e) {
    try { for (const k of IMPORTED) put(k, before[k]); put(OWN, aside); } catch { /* as much of it as the browser takes */ }
    throw Error("This browser would not store the file; nothing was changed.", { cause: e });
  }
  replaced = true;
}

// Remove: the imported file's settings and progress out, and the browser's own back as they were before it was loaded. False when no file is
// loaded (nothing is touched). The kept file goes too (dropBase).
export function removeImported(storage = globalThis.localStorage) {
  let own = null;
  try { own = JSON.parse(storage.getItem(OWN) ?? "null"); } catch { /* not readable: nothing to put back */ }
  if (!own || typeof own !== "object") return false;
  for (const k of IMPORTED) { if (typeof own[k] === "string") storage.setItem(k, own[k]); else storage.removeItem(k); }
  storage.removeItem(OWN);
  replaced = true;   // (the page loads again, and what it holds in memory must not be written back: main.js pagehide)
  return true;
}

// What the browser holds now, for SAVE DATA's page: { facts, file }, or null when the game has not been played here and no file is loaded.
//   facts:  four figures with what each counts, [figure, what], set side by side across the page: scenes completed, pictures, songs, saves made here
//   file:   with an imported file loaded, the line that says the figures are its own
//   tables: { chart, gallery } (flowchart.json, gallery.json), so that a figure can be "of how many", as the game's own screens count them: the
//           flowchart's scenes, the pictures the CG gallery lists, the Music Player's rows. Without them the figures are the bare counts.
export function loadedData(storage = globalThis.localStorage, { chart = null, gallery = null } = {}) {
  const loaded = hasImported(storage);
  if (!hasProgress(storage) && !loaded) return null;
  const s = portState(storage, gallery?.seen || null);
  const flow = { started: new Set(s.flow.started), completed: new Set(s.flow.completed) };
  const unlocks = { seen: new Set(s.seen), images: new Set(json(storage, "tsuki.unlocks.v1", {}).images || []), music: new Set(s.music), movies: new Set(s.movies) };
  const facts = [];
  const scenes = chart ? [...new Set(chart.groups.flatMap((g) => g.parts).filter((p) => p.flag > 0).map((p) => p.flag))] : null;
  facts.push([scenes ? `${scenes.filter((n) => flow.completed.has(n)).length} / ${scenes.length}` : String(flow.completed.size), "scenes completed"]);
  if (gallery) {
    const all = gallery.cg.reduce((n, e) => n + e.variants.length, 0);
    facts.push([`${cgLists(gallery.cg, { unlocks, flow }).flat.length} / ${all}`, "pictures"]);
    facts.push([`${gallery.music.filter((t) => musicUnlocked(t, { unlocks, flow })).length} / ${gallery.music.length}`, "songs"]);
  } else {
    facts.push([String(unlocks.seen.size), "pictures"], [String(unlocks.music.size), "songs"]);
  }
  // the saves made here: one kind alone is named with its count; several are added up, and the line under the figure says which
  const kinds = [[Object.keys(json(storage, "tsuki.saves", {})).length, "in the list", "save"], [json(storage, "tsuki.autosaves", []).length, "automatic", "automatic save"],
    [storage.getItem("tsuki.quicksave") ? 1 : 0, "quick", "quick save"]].filter(([n]) => n > 0);
  const total = kinds.reduce((n, k) => n + k[0], 0);
  if (kinds.length === 1) facts.push([String(total), `${kinds[0][2]}${total === 1 ? "" : "s"} made here`]);
  else facts.push([String(total), kinds.length ? `saves made here: ${kinds.map(([n, how]) => `${n} ${how}`).join(", ")}` : "saves made here"]);
  return { facts, file: loaded ? `${importedLabel(storage)} is loaded: these are its own. Your own are put aside until it is removed.` : null };
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
