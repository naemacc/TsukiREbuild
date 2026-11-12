// gamesave.js - the original game's own save file, savedata000, read and written: what the opening page's Import and Export use (home.js), so a save
// goes between the game and this port both ways.
//
// The file (native 0xa8e30: one buffer of 0x3e7000 bytes, read and written whole) is the system data, 0x1740 bytes at 0, and 140 records of 0x7140
// bytes at 0x1800 + 0x7200 n (0xb6710 / 0xb67a0): 0-99 the save list's slots, 100-138 the automatic saves, newest first, 139 the quick save.
//
// The system data, as 0x4ec60 writes it and 0x4ea30 reads it back:
//   +0       0x3ed, then 1 (+2): there is system data
//   +4       the config, 0x68 bytes (0x2dd20 takes it; CONFIG below)
//   +0x6c    the global variables G0-G499, 16 bits each. The flowchart is in them, a bit a scene (0x926b0 / 0x922c0 / 0x92300): started from G110,
//            completed from G300, a chart line (564-1267) revealed from G400. G005's bits 0 and 1 are the two opening movies (0x92400).
//   +0x454   0x213 bytes of bits: a picture seen (0x774f0, bits 0-0xc7f) and, from bit 0xc80, a piece of music heard by its number (0x64f60 / 0x77740)
//   +0x667   0xfb4 bytes: for each message block, the highest index read (0x53a60)
//   +0x161e  the newest record's number, the one Continue loads (0x8d2f0)
//   +0x1622  the save list's last slot (0xf1f43c)
//   +0x1624  0x118 bytes of bits: the rows of each choice that have been taken (0x83e50). The port draws a taken row like any other and keeps no such
//            bits, so they are only carried.
// Everything is little-endian.
export const GAME = {
  size: 0x3e7000, system: 0x1740, config: 4, configSize: 0x68, globals: 0x6c, globalCount: 500, seen: 0x454, seenBytes: 0x213, read: 0x667, readBlocks: 0xfb4,
  newest: 0x161e, lastSlot: 0x1622, choices: 0x1624, choiceBytes: 0x118, records: 0x1800, stride: 0x7200, recordSize: 0x7140, slots: 140,
  hasSystem: 0x3ed, used: 0x3f2, musicBit: 0xc80, musicCount: 0x418,
};
export const FILE_NAME = "savedata000";
// The flowchart's bits among the globals: [first variable, first item, items].
export const FLOW_BITS = { started: [110, 0, 576], completed: [300, 0, 576], secondary: [400, 564, 0x2c0] };
const flowWords = ([first, , count]) => [first, first + Math.ceil(count / 16)];
// The opening movies whose showing G005 records (0x40a00 -> 0x923c0), by its bit: the gallery's movie list (gallery.json movieList).
export const MOVIE_BITS = { 0: "op1_arc", 1: "op2_ciel" };

// The config (0x68 bytes; the game's first one is at 0x46b080, also what its reset writes, 0x2c810). The fields the port has a setting for, by the
// offsets its own code cites (main.js DEFAULTS, vm.js, audio.js VOLUME_DEFAULTS); the others are carried as they are.
//   +4 BGM, +8 SE, +0xa menu volume (0-100), +0x64 / +0x65 / +0x66 their mutes; +6 voices on (100) or off (0); +0x24 a bit a character, voice on;
//   +0x34 + 2i a character's volume; +0xe / +0x10 the text speed, unread and read (ms a letter); +0x5c / +0x1c auto mode's wait on a page and on a
//   line (ms); +0x1e fast forward stops at unread text (1) or not; +0x2e a press stops the voice; +0x5a / +0x5b whole text at once, unread / read;
//   +0x5e skip read scenes, +0x60 ask first; +0x61 / +0x62 no fade of letters, unread / read.
export const DEFAULT_CONFIG = Uint8Array.from("ff 00 00 00 28 00 64 00 28 00 0a 00 00 00 23 00 0f 00 ff ff 01 00 00 00 00 00 00 00 98 08 01 00 01 00 00 00 ff ff ff 3f 03 00 00 00 00 00 01 00 28 00 00 00 32 00 32 00 32 00 32 00 32 00 32 00 32 00 32 00 32 00 32 00 32 00 32 00 32 00 32 00 32 00 32 00 32 00 32 00 32 00 00 00 b8 0b 00 00 00 00 00 01 00 00 00 00"
  .split(" ").map((h) => parseInt(h, 16)));
export const CHARACTERS = 19;
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const put16 = (b, o, v) => { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; };
const clamp = (v, lo, hi, or) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : or);

// The port's settings (main.js "tsuki.settings") and volumes (audio.js "tsuki.volumes") from a config.
export function configToPort(c) {
  const on = c[0x24] | (c[0x25] << 8) | (c[0x26] << 16) | (c[0x27] << 24);
  return {
    settings: { textSpeed: u16(c, 0xe), readSpeed: u16(c, 0x10), autoPage: u16(c, 0x5c), autoClick: u16(c, 0x1c), skipRead: !!c[0x5e], voiceOn: u16(c, 6) !== 0,
      voiceStop: !!c[0x2e], wholeUnread: !!c[0x5a], wholeRead: !!c[0x5b], skipConfirm: !!c[0x60], fastForward: c[0x1e] ? "read" : "full", fadeUnread: !c[0x61], fadeRead: !c[0x62] },
    volumes: { bgm: u16(c, 4) / 100, se: u16(c, 8) / 100, sys: u16(c, 0xa) / 100, bgmMute: !!c[0x64], seMute: !!c[0x65], sysMute: !!c[0x66],
      chars: Array.from({ length: CHARACTERS }, (_, i) => u16(c, 0x34 + 2 * i)), charOn: Array.from({ length: CHARACTERS }, (_, i) => !!((on >>> i) & 1)) },
  };
}
// A config from the port's settings and volumes, over `base` (the config last imported, or the game's first one): a field the port has no
// setting for stays as the base has it, and so does one whose setting is missing.
export function portToConfig(settings = {}, volumes = {}, base = DEFAULT_CONFIG) {
  const c = Uint8Array.from(base.length === GAME.configSize ? base : DEFAULT_CONFIG);
  const s = settings || {}, v = volumes || {};
  const word = (o, x, lo, hi) => { if (x !== undefined && x !== null) put16(c, o, clamp(Number(x), lo, hi, u16(c, o))); };
  const flag = (o, x, one = 1) => { if (typeof x === "boolean") c[o] = x ? one : 0; };
  word(0xe, s.textSpeed, 0, 0x7fff); word(0x10, s.readSpeed, 0, 0x7fff); word(0x5c, s.autoPage, 0, 0x7fff); word(0x1c, s.autoClick, 0, 0x7fff);
  flag(0x5e, s.skipRead); flag(0x2e, s.voiceStop); flag(0x5a, s.wholeUnread); flag(0x5b, s.wholeRead); flag(0x60, s.skipConfirm);
  if (typeof s.voiceOn === "boolean") put16(c, 6, s.voiceOn ? 100 : 0);
  if (s.fastForward === "read" || s.fastForward === "full") c[0x1e] = s.fastForward === "read" ? 1 : 0;
  if (typeof s.fadeUnread === "boolean") c[0x61] = s.fadeUnread ? 0 : 1;
  if (typeof s.fadeRead === "boolean") c[0x62] = s.fadeRead ? 0 : 1;
  const level = (o, x) => { if (typeof x === "number") put16(c, o, clamp(x * 100, 0, 100, u16(c, o))); };
  level(4, v.bgm); level(8, v.se); level(0xa, v.sys);
  flag(0x64, v.bgmMute); flag(0x65, v.seMute); flag(0x66, v.sysMute);
  if (Array.isArray(v.chars)) v.chars.slice(0, CHARACTERS).forEach((x, i) => word(0x34 + 2 * i, x, 0, 100));
  if (Array.isArray(v.charOn)) {
    let on = (c[0x24] | (c[0x25] << 8) | (c[0x26] << 16) | (c[0x27] << 24)) >>> 0;
    v.charOn.slice(0, CHARACTERS).forEach((x, i) => { if (typeof x === "boolean") on = x ? (on | (1 << i)) >>> 0 : (on & ~(1 << i)) >>> 0; });
    c[0x24] = on & 255; c[0x25] = (on >>> 8) & 255; c[0x26] = (on >>> 16) & 255; c[0x27] = (on >>> 24) & 255;
  }
  return c;
}

// A global variable's name as the port keeps it ("G005": vm.js globals).
export const globalName = (n) => `G${String(n).padStart(3, "0")}`;
const isFlowWord = (n) => Object.values(FLOW_BITS).some((f) => { const [a, b] = flowWords(f); return n >= a && n < b; });
const bitsOf = (words, [first, base, count]) => {
  const out = [];
  for (let i = 0; i < count; i++) if (words[first + (i >> 4)] & (1 << (i & 15))) out.push(base + i);
  return out;
};

export function isGameSave(bytes) {
  return bytes instanceof Uint8Array && bytes.length === GAME.size && u16(bytes, 0) === GAME.hasSystem;
}

// The records in use, by number (0-99 the list's slots, 100-138 automatic, 139 the quick save).
export function usedRecords(bytes) {
  const out = [];
  for (let n = 0; n < GAME.slots; n++) if (u16(bytes, GAME.records + n * GAME.stride) === GAME.used) out.push(n);
  return out;
}

// The system data of a save, as the port keeps each part.
//   globals    { G005: 63, ... }: every global that is not zero, but for the flowchart's words
//   flow       { started, completed, secondary }: scene and line numbers (flowchart-model.js "tsuki.flow.v2")
//   seen       the pictures' seen bits; music: the music numbers heard; movies: the opening movies seen, by name (unlocks.js "tsuki.unlocks.v1")
//   readBlocks the read marks (vm.js "tsuki.readBlocks")
export function readSystem(bytes) {
  if (!isGameSave(bytes)) throw Error("not a savedata000");
  const G = GAME, sys = bytes.subarray(0, G.system);
  const words = Array.from({ length: G.globalCount }, (_, n) => u16(sys, G.globals + 2 * n));
  const globals = {};
  words.forEach((v, n) => { if (v && !isFlowWord(n)) globals[globalName(n)] = v; });
  const flow = Object.fromEntries(Object.entries(FLOW_BITS).map(([k, f]) => [k, bitsOf(words, f)]));
  const seen = [], music = [];
  for (let i = 0; i < G.seenBytes * 8; i++) {
    if (!(sys[G.seen + (i >> 3)] & (1 << (i & 7)))) continue;
    if (i < G.musicBit) seen.push(i); else music.push(i - G.musicBit);
  }
  const movies = Object.entries(MOVIE_BITS).filter(([bit]) => words[5] & (1 << Number(bit))).map(([, name]) => name);
  return { ...configToPort(sys.subarray(G.config, G.config + G.configSize)), globals, flow, seen, music, movies,
    readBlocks: sys.slice(G.read, G.read + G.readBlocks), newest: u16(sys, G.newest), lastSlot: u16(sys, G.lastSlot) };
}

// System data from the port's state, over `base` (the system data last imported, or none). What the port keeps is written; the rest (the choices
// taken, config fields with no setting, globals the port never touched) stays as the base has it. Progress is never taken away: a bit the base
// has set and a read mark it has higher stay, as in the game's own merge (0x4ea30).
//   state: { settings, volumes, globals, flow, seen, music, movies, readBlocks }, each as readSystem gives it
export function writeSystem(state, base = null) {
  const G = GAME, sys = new Uint8Array(G.system);
  if (base && base.length >= G.system && u16(base, 0) === G.hasSystem) sys.set(base.subarray(0, G.system));
  else sys.set(DEFAULT_CONFIG, G.config);
  put16(sys, 0, G.hasSystem); put16(sys, 2, 1);
  sys.set(portToConfig(state.settings, state.volumes, sys.slice(G.config, G.config + G.configSize)), G.config);
  const word = (n) => u16(sys, G.globals + 2 * n), setWord = (n, v) => put16(sys, G.globals + 2 * n, v & 0xffff);
  for (const [name, v] of Object.entries(state.globals || {})) {
    const m = /^G(\d+)$/.exec(name), n = m ? Number(m[1]) : -1;
    if (n >= 0 && n < G.globalCount && !isFlowWord(n) && Number.isFinite(v)) setWord(n, v);
  }
  for (const [k, [first, from, count]] of Object.entries(FLOW_BITS)) {
    for (const item of state.flow?.[k] || []) { const i = item - from; if (i >= 0 && i < count) setWord(first + (i >> 4), word(first + (i >> 4)) | (1 << (i & 15))); }
  }
  for (const [bit, name] of Object.entries(MOVIE_BITS)) if ((state.movies || []).includes(name)) setWord(5, word(5) | (1 << Number(bit)));
  const setBit = (i) => { if (i >= 0 && i < G.seenBytes * 8) sys[G.seen + (i >> 3)] |= 1 << (i & 7); };
  for (const b of state.seen || []) if (b < G.musicBit) setBit(b);
  for (const n of state.music || []) if (n >= 0 && n < G.musicCount) setBit(G.musicBit + n);
  const read = state.readBlocks;
  if (read) for (let i = 0; i < G.readBlocks && i < read.length; i++) if (read[i] > sys[G.read + i]) sys[G.read + i] = read[i];
  return sys;
}
