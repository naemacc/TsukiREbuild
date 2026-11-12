// Export and Import on the opening page (web/app/js/home.js): the browser's state to and from the original game's save file, savedata000
// (web/app/js/gamesave.js reads and writes the file, savefile.js is the browser's side).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const { GAME, FLOW_BITS, DEFAULT_CONFIG, configToPort, portToConfig, globalName, isGameSave, readSystem, writeSystem } = await import("../../web/app/js/gamesave.js");
const { FILE_NAME, KEYS, LOCAL, NOTE, describe, recordsLine, exportSaves, hasProgress, importSaves, portState, readSaves, savesReplaced } = await import("../../web/app/js/savefile.js");
const { TABS, PLAY, SAVE_PLATES, SAVE_TEXT } = await import("../../web/app/js/home.js");
const source = (name) => readFileSync(new URL(`../../web/app/${name}`, import.meta.url), "utf8");

function memory(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, map: m };
}
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const read = new Uint8Array(GAME.readBlocks); read[0] = 3; read[7] = 200; read[GAME.readBlocks - 1] = 9;
const STATE = {
  settings: { textSpeed: 20, readSpeed: 5, autoPage: 4000, autoClick: 1500, skipRead: true, voiceOn: false, voiceStop: false, wholeUnread: true, wholeRead: false, skipConfirm: true,
    fastForward: "full", fadeUnread: false, fadeRead: true },
  volumes: { bgm: 0.55, se: 0.2, sys: 0, bgmMute: true, seMute: false, sysMute: true, chars: Array.from({ length: 19 }, (_, i) => 30 + i), charOn: Array.from({ length: 19 }, (_, i) => i !== 5) },
  globals: { G002: 5, G005: 3, G008: 389, G069: 1, G499: 65535 },
  flow: { started: [1, 2, 485, 575], completed: [1, 557], secondary: [564, 565, 1267] },
  seen: [0, 9, 2834, 0xc7f], music: [1, 2, 95, 0x417], movies: ["op1_arc", "op2_ciel"], readBlocks: read,
};
const stored = (s = STATE) => ({
  "tsuki.settings": JSON.stringify(s.settings), "tsuki.volumes": JSON.stringify(s.volumes), "tsuki.globals": JSON.stringify(s.globals),
  "tsuki.flow.v2": JSON.stringify({ ...s.flow, migrated: true }), "tsuki.unlocks.v1": JSON.stringify({ images: [], seen: s.seen, music: s.music, movies: s.movies }),
  "tsuki.readBlocks": b64(s.readBlocks),
});

test("every name the game keeps in the browser is one that goes across or one of the few that stay with the browser", () => {
  const dir = new URL("../../web/app/js/", import.meta.url);
  const used = new Set();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".js"))) {
    for (const line of readFileSync(new URL(f, dir), "utf8").split("\n")) {
      if (/^\s*\/\//.test(line)) continue;
      for (const m of line.matchAll(/"(tsuki\.[A-Za-z0-9.]+)"/g)) used.add(m[1]);
    }
  }
  const known = new Set([...Object.keys(KEYS), ...LOCAL, NOTE, "tsuki.files"]);
  assert.deepEqual([...used].filter((k) => !known.has(k)), [], "a new name: list it in savefile.js KEYS (and carry it) or LOCAL");
});

test("the file's layout: the system data's parts end to end, 140 records after it", () => {
  assert.equal(GAME.size, 4091904);
  assert.equal(GAME.config + GAME.configSize, GAME.globals);
  assert.equal(GAME.globals + 2 * GAME.globalCount, GAME.seen);
  assert.equal(GAME.seen + GAME.seenBytes, GAME.read);
  assert.equal(GAME.musicBit + GAME.musicCount, GAME.seenBytes * 8, "pictures' bits, then a bit a music number, fill the 0x213 bytes");
  assert.ok(GAME.read + GAME.readBlocks <= GAME.newest && GAME.choices + GAME.choiceBytes <= GAME.system);
  assert.equal(GAME.records + GAME.slots * GAME.stride, GAME.size);
  assert.deepEqual(FLOW_BITS, { started: [110, 0, 576], completed: [300, 0, 576], secondary: [400, 564, 704] }, "the bits decode_save.py reads (0x926b0 / 0x922c0 / 0x92300)");
  assert.equal(DEFAULT_CONFIG.length, GAME.configSize);
  assert.equal(FILE_NAME, "savedata000");
  assert.equal(globalName(5), "G005");
});

test("the game's first config is the port's own defaults", () => {
  const { settings, volumes } = configToPort(DEFAULT_CONFIG);
  assert.deepEqual(settings, { textSpeed: 35, readSpeed: 15, autoPage: 3000, autoClick: 2200, skipRead: false, voiceOn: true, voiceStop: true, wholeUnread: false, wholeRead: false,
    skipConfirm: false, fastForward: "read", fadeUnread: true, fadeRead: true }, "main.js DEFAULTS");
  assert.deepEqual(volumes, { bgm: 0.4, se: 0.4, sys: 0.1, bgmMute: false, seMute: false, sysMute: false, chars: Array(19).fill(50), charOn: Array(19).fill(true) }, "audio.js VOLUME_DEFAULTS");
  const main = source("js/main.js");
  assert.match(main, /const DEFAULTS = \{ textSpeed: 35, readSpeed: 15, autoPage: 3000, autoClick: 2200, skipRead: false, voiceOn: true, voiceStop: true,\n  wholeUnread: false, wholeRead: false, skipConfirm: false, fastForward: "read", fadeUnread: true, fadeRead: true \};/);
});

test("a config written from the port's settings reads back the same; fields with no setting stay as the base has them", () => {
  const c = portToConfig(STATE.settings, STATE.volumes);
  assert.deepEqual(configToPort(c), { settings: STATE.settings, volumes: STATE.volumes });
  const known = new Set([4, 5, 6, 7, 8, 9, 0xa, 0xb, 0xe, 0xf, 0x10, 0x11, 0x1c, 0x1d, 0x1e, 0x24, 0x25, 0x26, 0x27, 0x2e, 0x5a, 0x5b, 0x5c, 0x5d, 0x5e, 0x60, 0x61, 0x62, 0x64, 0x65, 0x66,
    ...Array.from({ length: 38 }, (_, i) => 0x34 + i)]);
  for (let i = 0; i < c.length; i++) if (!known.has(i)) assert.equal(c[i], DEFAULT_CONFIG[i], `+0x${i.toString(16)}`);
  const base = Uint8Array.from(DEFAULT_CONFIG); base[0x12] = 0; base[0x13] = 0; base[0x28] = 7;
  const over = portToConfig({ textSpeed: 12 }, {}, base);
  assert.equal(over[0xe], 12);
  assert.equal(over[0x28], 7);
  assert.equal(over[0x12], 0);
  assert.deepEqual(configToPort(over).settings.readSpeed, 15, "a setting the port does not have keeps the base's");
});

test("system data written from the port's state reads back the same", () => {
  const sys = writeSystem(STATE);
  const file = new Uint8Array(GAME.size); file.set(sys);
  assert.equal(isGameSave(file), true);
  const got = readSystem(file);
  for (const k of ["settings", "volumes", "globals", "flow", "seen", "music", "movies"]) assert.deepEqual(got[k], STATE[k], k);
  assert.deepEqual([...got.readBlocks], [...STATE.readBlocks]);
  // where the bits are
  const g = (n) => sys[GAME.globals + 2 * n] | (sys[GAME.globals + 2 * n + 1] << 8);
  assert.equal(g(110), (1 << 1) | (1 << 2), "scenes 1 and 2 started");
  assert.equal(g(110 + 30), 1 << 5, "485");
  assert.equal(g(300 + 34), 1 << 13, "557 completed");
  assert.equal(g(400), 3, "lines 564 and 565");
  assert.equal(g(5), 3, "both opening movies");
  assert.equal(sys[GAME.seen] & 1, 1);
  assert.equal(sys[GAME.seen + (0xc80 >> 3)] & 0b110, 0b110, "music 1 and 2 at bits 0xc81, 0xc82");
  assert.equal(sys[GAME.read + 7], 200);
});

test("over a base: what the port has no copy of stays, and progress is never taken away", () => {
  const base = new Uint8Array(GAME.size);
  base.set(writeSystem({ ...STATE, globals: { G002: 1, G031: 77 }, flow: { started: [3], completed: [3], secondary: [600] }, seen: [44], music: [7], movies: [], readBlocks: Uint8Array.of(9, 0, 0, 0, 0, 0, 0, 1) }));
  base[GAME.choices + 5] = 0x81; base[GAME.newest] = 85; base[GAME.config + 0x28] = 9;
  const sys = writeSystem(STATE, base);
  const file = new Uint8Array(GAME.size); file.set(sys);
  const got = readSystem(file);
  assert.equal(sys[GAME.choices + 5], 0x81, "the choices taken");
  assert.equal(got.newest, 85);
  assert.equal(sys[GAME.config + 0x28], 9);
  assert.equal(got.globals.G031, 77, "a global the port never touched");
  assert.equal(got.globals.G002, 5, "one it has is the port's");
  assert.deepEqual(got.flow.started, [1, 2, 3, 485, 575]);
  assert.deepEqual(got.seen, [0, 9, 44, 2834, 0xc7f]);
  assert.deepEqual(got.music, [1, 2, 7, 95, 0x417]);
  assert.equal(got.readBlocks[0], 9, "the higher read mark");
  assert.equal(got.readBlocks[7], 200);
});

test("Export: a savedata000 of the browser's state; nothing when the game has not been played here", () => {
  assert.equal(exportSaves(memory()), null);
  const fresh = { "tsuki.flow.v2": JSON.stringify({ started: [], completed: [], secondary: [], migrated: true }), "tsuki.settings": "{}", "tsuki.readBlocks": "AAAA", "tsuki.saves": "{}", "tsuki.autosaves": "[]" };
  assert.equal(hasProgress(memory(fresh)), false, "what a first visit writes by itself is not the game having been played");
  assert.equal(exportSaves(memory(fresh)), null);
  for (const [k, v] of [["tsuki.saves", JSON.stringify({ 4: {} })], ["tsuki.autosaves", "[{}]"], ["tsuki.quicksave", "{}"], ["tsuki.flow.v2", JSON.stringify({ started: [485] })]]) {
    assert.equal(hasProgress(memory({ ...fresh, [k]: v })), true, k);
  }
  const file = exportSaves(memory(stored()));
  assert.equal(file.length, GAME.size);
  const got = readSaves(file);
  for (const k of ["settings", "volumes", "globals", "flow", "seen", "music", "movies"]) assert.deepEqual(got[k], STATE[k], k);
  // pictures an older version recorded by name go out as their bits
  const old = stored(); old["tsuki.unlocks.v1"] = JSON.stringify({ images: ["IMG0007"], seen: [1], music: [], movies: [] });
  assert.deepEqual(readSaves(exportSaves(memory(old), null, { IMG0007: 321 })).seen, [1, 321]);
});

test("Import: the file's parts take the place of the browser's; the keys and the pages shown stay", () => {
  const sys = readSaves(exportSaves(memory(stored())));
  const there = memory({ "tsuki.globals": JSON.stringify({ G002: 9, G050: 1 }), "tsuki.flow.v2": JSON.stringify({ started: [7], completed: [7] }), "tsuki.read": "AQID",
    "tsuki.settings": JSON.stringify({ textSpeed: 1 }), "tsuki.volumes": JSON.stringify({ voice: 1, bgm: 1 }), "tsuki.keys": "{\"skip\":\"KeyS\"}", "tsuki.welcomed": "1" });
  assert.equal(savesReplaced(), false);
  importSaves(sys, there);
  assert.equal(savesReplaced(), true, "from here the page's own state is not saved over it (main.js pagehide)");
  const now = portState(there);
  for (const k of ["settings", "globals", "flow", "seen", "music", "movies"]) assert.deepEqual(now[k], STATE[k], k);
  assert.deepEqual(JSON.parse(there.getItem("tsuki.volumes")), { voice: 1, ...STATE.volumes });
  assert.deepEqual([...now.readBlocks], [...STATE.readBlocks]);
  const flow = JSON.parse(there.getItem("tsuki.flow.v2"));
  assert.equal(flow.migrated && flow.endingsInferred, true, "the game's own bits: nothing is worked out from read history");
  assert.equal(there.getItem("tsuki.read"), null);
  assert.equal(there.getItem("tsuki.keys"), "{\"skip\":\"KeyS\"}");
  assert.equal(there.getItem("tsuki.welcomed"), "1");
  assert.match(source("js/main.js"), /addEventListener\("pagehide", \(\) => \{ if \(!savesReplaced\(\)\) \{ autosave\(\); vm\.saveRead\(\); vm\.unlocks\.save\(\); \}/);
});

test("anything that is not the game's save file is refused, with a line for the player", () => {
  for (const bad of [null, new Uint8Array(0), new Uint8Array(100), new Uint8Array(GAME.size + 1), "text"]) assert.throws(() => readSaves(bad), /not the game's save file/);
  assert.throws(() => readSaves(new Uint8Array(GAME.size)), /empty or damaged; nothing was changed/);
});

test("a browser that will not store the file keeps what it had", () => {
  const sys = readSaves(exportSaves(memory(stored())));
  const store = memory({ "tsuki.globals": JSON.stringify({ G002: 9 }), "tsuki.settings": "{}", "tsuki.flow.v2": JSON.stringify({ started: [7] }) });
  const before = Object.fromEntries(store.map);
  let full = true;
  const set = store.setItem;
  store.setItem = (k, v) => { if (full && k === "tsuki.unlocks.v1") { full = false; throw Error("QuotaExceededError"); } set(k, v); };
  assert.throws(() => importSaves(sys, store), /would not store the file; nothing was changed/);
  assert.deepEqual(Object.fromEntries(store.map), before);
});

test("what a file holds, in a few words", () => {
  assert.equal(describe({ flow: { completed: [1, 2] }, seen: [1], music: [1, 2, 3] }), "2 scenes completed, 1 picture, 3 songs");
  // the file's save records are counted, and the player told they are not loaded yet (TODO item 161)
  assert.equal(recordsLine({ records: [] }), "");
  assert.match(recordsLine({ records: [3] }), /^ Its 1 save cannot be loaded here yet; it stays in the file/);
  assert.match(recordsLine({ records: [73, 74, 139] }), /^ Its 3 saves cannot be loaded here yet; they stay in the file/);
  const file = new Uint8Array(GAME.size); file.set(writeSystem(STATE));
  for (const n of [0, 99, 139]) { file[GAME.records + n * GAME.stride] = 0xf2; file[GAME.records + n * GAME.stride + 1] = 3; }
  assert.deepEqual(readSaves(file).records, [0, 99, 139]);
});

test("the opening page: two of the panel's plates on PLAY ONLINE, above the prompt; Import asks before it replaces progress, keeps the file, and loads the page again", () => {
  const blocks = TABS[PLAY].sections[0].blocks.map((b) => (Array.isArray(b) ? b[0] : "text"));
  assert.deepEqual(blocks.slice(-2), ["saves", "press"]);
  assert.deepEqual(SAVE_PLATES.map((p) => p.plate), ["EXPORT SAVES", "IMPORT SAVES"]);
  assert.ok(SAVE_TEXT.ask.split("\n").every((line) => line.length <= 36), "the question fits the game's window, two lines");
  assert.match(SAVE_TEXT.note, /savedata000/);
  const home = source("js/home.js"), css = source("style.css");
  assert.match(home, /quickBarArt\(SAVE_PLATES\.map/, "the game's own plates, relettered as the tabs are");
  assert.match(home, /if \(!hasProgress\(\)\) \{ load\(sys, bytes\); return; \}\n\s*ui\.dialog\(SAVE_TEXT\.ask, [^\n]*\{ startNo: true \}\);/, "asked in the game's Yes / No window, starting on No");
  assert.match(home, /await keepBase\(bytes\);\n\s*ui\.fadeBlack\(black, 1, FADE\.out \* 2, \(\) => location\.reload\(\)\);/);
  assert.match(home, /exportSaves\(localStorage, await loadBase\(\), /, "an Export starts from the file last imported");
  assert.match(home, /a\.download = FILE_NAME;/);
  assert.match(home, /bytes = f\.size === GAME\.size \? new Uint8Array\(await f\.arrayBuffer\(\)\) : null;/, "a file of another size is not read");
  assert.match(home, /box\.addEventListener\("click", \(e\) => e\.stopPropagation\(\)\);/, "a click here does not start the game");
  assert.match(css, /\.hm-save-row \{ display: flex; justify-content: center;/);
});

// The 100% save shared on the project's server (data/tsuki/reference-saves; with the game's dump, so not in the repository): read, and written back.
const REAL = new URL("../../data/tsuki/reference-saves/discord-2026-11-07/savedata000", import.meta.url);
test("a real save of the original game: its progress as decode_save.py reads it, and written over itself it is the same file", { skip: !existsSync(REAL) }, () => {
  const file = new Uint8Array(readFileSync(REAL));
  const sys = readSaves(file);
  assert.deepEqual([sys.flow.started.length, sys.flow.completed.length, sys.flow.secondary.length], [556, 553, 630]);
  assert.deepEqual([sys.seen.length, sys.music.length, sys.movies.length, sys.newest], [2716, 116, 2, 85]);
  assert.deepEqual(sys.records, [73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85]);
  assert.equal(sys.settings.textSpeed, 33);
  assert.equal(sys.volumes.charOn[5], false);
  const store = memory();
  importSaves(sys, store);
  const out = exportSaves(store, file);
  assert.equal(Buffer.compare(Buffer.from(out), Buffer.from(file)), 0, "imported and exported again, byte for byte");
  // with no base only what the port keeps no copy of differs: the config's +0x12, the newest record, the choices taken
  const bare = exportSaves(store, null), differ = [];
  for (let i = 0; i < GAME.system; i++) if (bare[i] !== file[i]) differ.push(i);
  assert.ok(differ.every((o) => o === 0x16 || o === 0x17 || o === GAME.newest || (o >= GAME.choices && o < GAME.choices + GAME.choiceBytes)), differ.map((o) => o.toString(16)).join(" "));
});
