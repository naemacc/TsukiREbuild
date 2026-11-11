// Sounds in packs (web-dev/tools/build_packs.py, audio.js) and the loading screen after START (preload.js, main.js).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";

const { Audio } = await import("../../web/app/js/audio.js");
const { Preloader, RANK } = await import("../../web/app/js/preload.js");
const source = (name) => readFileSync(new URL(`../../web/app/${name}`, import.meta.url), "utf8");
const bytes = (...v) => new Uint8Array(v).buffer;
const list = (b) => [...new Uint8Array(b)];

// An Audio whose fetch is a table of addresses; what was asked for is kept.
function rig(files) {
  const asked = [];
  const had = globalThis.fetch;
  globalThis.fetch = async (url) => {
    asked.push(url);
    const hit = files[url];
    if (hit === undefined) return { ok: false, json: async () => { throw Error("none"); }, arrayBuffer: async () => { throw Error("none"); } };
    return { ok: true, json: async () => hit, arrayBuffer: async () => hit };
  };
  const audio = Object.create(Audio.prototype);
  return { audio, asked, done() { globalThis.fetch = had; } };
}
const INDEX = { "/assets/pack/index.json": { index: "index-aaaa.json" },
  "/assets/pack/index-aaaa.json": { version: 1, packs: [["voice-1.pack", ["voice/A", 2, "voice/B C", 3]], ["se-1.pack", ["se/X", 1]]] } };

test("a sound the index names is cut from its pack: one request for the pack, however many of its sounds are read", async () => {
  const r = rig({ ...INDEX, "/assets/pack/voice-1.pack": bytes(1, 2, 3, 4, 5), "/assets/pack/se-1.pack": bytes(9) });
  try {
    assert.deepEqual(list(await r.audio.soundData("/assets/voice/A.ogg")), [1, 2]);
    assert.deepEqual(list(await r.audio.soundData(`/assets/voice/${encodeURIComponent("B C")}.ogg`)), [3, 4, 5], "by the file's own name, at the sum of the sizes before it");
    assert.deepEqual(list(await r.audio.soundData("/assets/se/X.ogg")), [9]);
    assert.deepEqual(r.asked, ["/assets/pack/index.json", "/assets/pack/index-aaaa.json", "/assets/pack/voice-1.pack", "/assets/pack/se-1.pack"]);
    // each read is a copy: decoding one does not take the pack's bytes away from the next
    const a = await r.audio.soundData("/assets/voice/A.ogg");
    new Uint8Array(a)[0] = 77;
    assert.deepEqual(list(await r.audio.soundData("/assets/voice/A.ogg")), [1, 2]);
  } finally { r.done(); }
});

test("a sound no pack has, a pack that cannot be read, and a copy without packs all fall back to the sound's own file", async () => {
  let r = rig({ ...INDEX, "/assets/bgm/7.ogg": bytes(5, 5), "/assets/voice/A.ogg": bytes(8) });
  try {
    assert.deepEqual(list(await r.audio.soundData("/assets/bgm/7.ogg")), [5, 5], "music is not packed");
    assert.deepEqual(list(await r.audio.soundData("/assets/voice/A.ogg")), [8], "its pack is missing: the file itself");
    await assert.rejects(r.audio.soundData("/assets/voice/NONE.ogg"), /no audio/);
  } finally { r.done(); }
  r = rig({ "/assets/voice/A.ogg": bytes(4) });
  try {
    assert.deepEqual(list(await r.audio.soundData("/assets/voice/A.ogg")), [4]);
    assert.deepEqual(list(await r.audio.soundData("/assets/voice/A.ogg")), [4]);
    assert.equal(r.asked.filter((u) => u.includes("/pack/")).length, 1, "the index is asked for once, not at every sound");
  } finally { r.done(); }
  const audio = source("js/audio.js");
  assert.match(audio, /const data = await this\.soundData\(url\);\n\s+return this\.decoder\(\)\.decodeAudioData\(data\);/, "every sound the game plays goes through it");
  assert.match(audio, /const PACKS_KEPT = 8;/);
});

test("the packs on disk are whole: every pack the index names is there at the size of its files, and every voice and sound effect is in one", { skip: !existsSync(new URL("../../web/assets/pack/index.json", import.meta.url)) }, () => {
  const at = (name) => new URL(`../../web/assets/pack/${name}`, import.meta.url);
  const index = JSON.parse(readFileSync(at(JSON.parse(readFileSync(at("index.json"), "utf8")).index), "utf8"));
  assert.equal(index.version, 1);
  const kinds = { voice: 0, se: 0, sys: 0 }, seen = new Set();
  for (const [pack, items] of index.packs) {
    let size = 0;
    for (let i = 0; i < items.length; i += 2) { size += items[i + 1]; kinds[items[i].split("/")[0]]++; assert.equal(seen.has(items[i]), false, items[i]); seen.add(items[i]); }
    assert.equal(statSync(at(pack)).size, size, pack);
    assert.match(pack, /^(voice|se|sys)-[0-9a-f]{10}\.pack$/, "named by its content, so it can be kept for good");
    assert.ok(size <= 1_500_000 || items.length === 2, `${pack} is ${size}`);
  }
  assert.deepEqual(kinds, { voice: 16460, se: 1284, sys: 9 });
  assert.ok(index.packs.length < 17753 / 20, `${index.packs.length} packs: a player asks for at least twenty times fewer files`);
});

test("the preloader says when the first screens' files are in, and how far along they are", async () => {
  const waits = [];
  const audio = { buffers: new Map(), muted: false, buffer: () => new Promise((r) => waits.push(r)) };
  const vm = { getScript: () => new Promise(() => {}) };
  const p = new Preloader({ vm, gfx: {}, audio, page: null, Picture: null, lanes: 2 });
  assert.equal(p.settled(RANK.story), true, "nothing asked for yet");
  assert.equal(p.progress(RANK.story), 1);
  p.sound(RANK.next, "/a"); p.sound(RANK.story, "/b"); p.sound(RANK.menus, "/c"); p.sound(RANK.story, "/d");
  assert.equal(p.settled(RANK.story), false);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(p.progress(RANK.story), 0);
  waits.shift()();                                             // /a
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(Math.round(p.progress(RANK.story) * 100), 33);
  assert.equal(p.settled(RANK.next), true, "the next screen's are in");
  assert.equal(p.settled(RANK.story), false);
  while (waits.length) { waits.shift()(); await new Promise((r) => setTimeout(r, 0)); }
  await p.idle();
  assert.equal(p.settled(RANK.story), true);
  assert.equal(p.progress(RANK.story), 1);
  assert.equal(p.progress(RANK.menus), 1);
  // a script still being fetched to be read ahead has its files to come
  p.from(3, RANK.story);
  assert.equal(p.settled(RANK.story), false);
  // movies made ready
  assert.equal(p.moviesReady(), true);
  p.movies.set("x", { readyState: 1 });
  assert.equal(p.moviesReady(), false);
  p.movies.set("x", { readyState: 4 });
  assert.equal(p.moviesReady(), true);
});

test("after START the game's Loading window holds until the first screens' files are in, and not at all when they already are", () => {
  const main = source("js/main.js"), ui = source("js/ui.js");
  assert.match(main, /const LOADING = \{ least: 700, movie: 6000, most: 20000, out: 300 \};/);
  assert.match(main, /const ready = \(t\) => preload\.settled\(RANK\.story\) && \(preload\.moviesReady\(\) \|\| t > LOADING\.movie\);\n  if \(ready\(0\)\) return;/);
  assert.match(main, /ui\.notify\(word, \{ held: true, live: \(\) => `\$\{word\}  \$\{Math\.floor\(preload\.progress\(RANK\.story\) \* 100\)\}%` \}\);/, "the game's own notice, with the count");
  assert.match(main, /if \(\(t >= LOADING\.least && ready\(t\)\) \|\| t >= LOADING\.most\) done\(\); else setTimeout\(look, 100\);/, "never longer than 20 s");
  assert.match(main, /if \(welcomeDue\(q\)\) await openWelcome\(ui\);[^\n]*\n  if \(firstVisit\) await loadingScreen\(\);/);
  assert.match(ui, /if \(live\) \{ const now = live\(\); if \(now !== q\.textContent\) q\.textContent = now; \}/);
});
