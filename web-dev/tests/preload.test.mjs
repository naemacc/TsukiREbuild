// What is read before it is asked for (web/app/js/preload.js): the queue's order, the start-up list, the look-ahead and the movies made ready.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const { ART, GL_ART, Preloader, RANK } = await import("../../web/app/js/preload.js");
const { VM } = await import("../../web/app/js/vm.js");
const asset = (path) => new URL(`../../web/assets/${path}`, import.meta.url);
const json = (path) => JSON.parse(readFileSync(asset(path), "utf8"));
const source = (name) => readFileSync(new URL(`../../web/app/${name}`, import.meta.url), "utf8");
const index = json("scripts/index.json"), tables = json("audio_tables.json"), images = json("images.json"), system = json("system.json");

// A page with one movie element on it, and movie elements that record what was done to them.
function fakePage() {
  const video = () => ({ attrs: {}, style: {}, loads: 0, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] ?? null; },
    removeAttribute(k) { delete this.attrs[k]; }, load() { this.loads++; }, set src(v) { this.attrs.src = v; }, get src() { return this.attrs.src; } });
  const page = { made: [], shown: video(), createElement() { const v = video(); page.made.push(v); return v; }, getElementById: (id) => (id === "movie" ? page.shown : null),
    fonts: { asked: [], load(spec) { this.asked.push(spec); return Promise.resolve(); } } };
  return page;
}
// The game's own scripts and tables, with stand-ins for the renderer and the sound that record what they were asked for, in order.
function world({ lanes = 4, vm: extra = {} } = {}) {
  const asked = [];
  const scripts = new Map();
  const vm = { index, movies: tables.movies, system, scripts, skip: false, skipUntil: 0, instant: false, voiceOn: true, soundsSkipped: false, script: { name: "" },
    getScript(i) { if (!scripts.has(i)) scripts.set(i, Promise.resolve(json(`scripts/${i}.json`))); return scripts.get(i); },
    movieFor: VM.prototype.movieFor, ...extra };
  const gfx = { images, tex: new Map(), ui: new Map(),
    load(key) { asked.push(`img ${key}`); gfx.tex.set(key, {}); return Promise.resolve(); },
    uiTexture(path) { asked.push(`gl ${path}`); gfx.ui.set(path, { loaded: Promise.resolve() }); return null; } };
  const audio = { table: tables, buffers: new Map(), muted: false, buffer(url) { asked.push(`snd ${url}`); audio.buffers.set(url, true); return Promise.resolve(); } };
  class Picture { set src(v) { asked.push(`art ${v}`); } decode() { return Promise.resolve(); } }
  const page = fakePage();
  return { asked, vm, gfx, audio, page, pre: new Preloader({ vm, gfx, audio, page, Picture, lanes }) };
}
const settle = async (pre) => { for (let k = 0; k < 5; k++) { await new Promise((r) => setTimeout(r, 5)); await pre.idle(); } };

test("every interface picture on the start-up list is in web/assets/ui, none twice in a group", () => {
  const windows = system.windows.styles.map((s) => `DISP_PARTS_JA/${s[0]}`);
  for (const [group, list] of [...Object.entries(ART), ...Object.entries(GL_ART), ["windows", windows]]) {
    assert.equal(new Set(list).size, list.length, group);
    for (const p of list) assert.ok(existsSync(asset(`ui/${p}.webp`)), `${group}: ${p}`);
  }
  // the screens named in the request: the title, the text window and its marks, the choices and questions, the menus
  for (const p of ["TITLE_PARTS_JA/titlemenu", "PARTS/caution2_1920x1080"]) assert.ok(ART.title.includes(p), p);
  for (const p of ["DISP_PARTS_JA/txtwindow01-1920", "DISP_PARTS_JA/lineBreak_a", "SELECT_PARTS_JA/altermenu___", "DIALOG_PARTS_JA/dialog_win"]) assert.ok(ART.story.includes(p), p);
  for (const p of ["MENU_PARTS_JA/menu_window", "SAVE_PARTS_JA/save_win", "CONF_PARTS_JA/system_bg", "DISP_PARTS_JA/bg_backlog"]) assert.ok(ART.menus.includes(p), p);
});

test("the queue reads by rank, then in the order asked, a few at a time; a waiting job asked for again at a lower rank moves up", async () => {
  const { pre } = world({ lanes: 2 });
  const order = [], open = [];
  let most = 0, now = 0;
  const job = (name) => () => { order.push(name); most = Math.max(most, ++now); return new Promise((res) => open.push(() => { now--; res(); })); };
  assert.equal(pre.add(RANK.extras, "d", job("d")), true);
  pre.add(RANK.menus, "c", job("c"));
  pre.add(RANK.next, "a", job("a"));
  pre.add(RANK.story, "b", job("b"));
  pre.add(RANK.extras, "e", job("e"));
  assert.equal(pre.add(RANK.extras, "e", job("e again")), false, "one job a key");
  assert.deepEqual(order, [], "nothing starts until the caller has listed all it wants");
  await Promise.resolve();
  assert.deepEqual(order, ["a", "b"], "the two most pressing, not the two asked for first");
  pre.add(RANK.next, "e", job("e again"));   // e is wanted sooner now
  while (open.length) { open.shift()(); await new Promise((r) => setTimeout(r, 0)); }
  assert.deepEqual(order, ["a", "b", "e", "c", "d"]);
  assert.equal(most, 2, "never more than its lanes at once");
  // a job that fails, or throws as it starts, frees its lane like any other
  pre.add(0, "x", () => Promise.reject(new Error("gone")));
  pre.add(0, "y", () => { throw new Error("gone"); });
  pre.add(0, "z", job("z"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(order.at(-1), "z");
  open.shift()();
  await pre.idle();
  assert.equal(pre.active, 0);
});

test("a first visit reads the opening first: its script, its picture and its movie, then the story's screen, the menus, the gallery", async () => {
  const { pre, asked, page, vm } = world({ lanes: 1 });   // one lane: the order read is the order of need
  pre.startup({ firstLaunch: true, stage: 0 });
  await settle(pre);
  assert.deepEqual([...pre.movies.keys()], ["prologue"], "the intro video, and no logo or title movie: the first launch's title has none");
  assert.equal(page.made[0].getAttribute("src"), "/assets/movie/prologue.mp4");
  assert.equal(page.made[0].preload, "auto");
  assert.ok(vm.scripts.has(index.names.indexOf("00_01")) && vm.scripts.has(index.start), "the opening's script and the story's");
  const at = (s) => { const k = asked.indexOf(s); assert.notEqual(k, -1, s); return k; };
  const sys = at("snd /assets/sys/0.ogg"), opening = at("img IMG0597"), music = at("snd /assets/bgm/MOON01_BGM02.ogg");
  const window = at("art /assets/ui/DISP_PARTS_JA/txtwindow01-1920.webp"), choice = at("art /assets/ui/SELECT_PARTS_JA/altermenu___.webp");
  const title = at("art /assets/ui/TITLE_PARTS_JA/titlemenu.webp"), menu = at("art /assets/ui/MENU_PARTS_JA/menu_window.webp");
  const balloon = at("gl DISP_PARTS_JA/tw_t_L___V13_E__-39"), gallery = at("art /assets/ui/GALLERY_PARTS_JA/gallerymenu_window.webp");
  assert.ok(Math.max(sys, opening, music) < Math.min(window, choice, title), "what the next screen needs, before the story's screen");
  assert.ok(Math.max(window, choice, title) < Math.min(menu, balloon), "the story's screen before the menus");
  assert.ok(Math.max(menu, balloon) < gallery, "the gallery last");
  for (let n = 0; n < 9; n++) at(`snd /assets/sys/${n}.ogg`);
  assert.equal(new Set(asked).size, asked.length, "nothing read twice");
  assert.deepEqual(page.fonts.asked, ['40px "SeuratPro"', "16px Inter"]);
});

test("a later visit makes the logo and the title's movie ready, and reads the title before the story's screen", async () => {
  const { pre, asked } = world({ lanes: 1 });
  pre.startup({ firstLaunch: false, stage: 3 });
  await settle(pre);
  assert.deepEqual([...pre.movies.keys()], ["TM_CI", "titlebg3"]);
  const at = (s) => { const k = asked.indexOf(s); assert.notEqual(k, -1, s); return k; };
  assert.ok(at("art /assets/ui/PARTS/caution2_1920x1080.webp") < at("art /assets/ui/DISP_PARTS_JA/txtwindow01-1920.webp"), "the notice");
  assert.ok(at("art /assets/ui/TITLE_PARTS_JA/title_bg3.webp") < at("art /assets/ui/DISP_PARTS_JA/txtwindow01-1920.webp"), "the stage's own still");
  assert.ok(!asked.includes("img IMG0597"), "not the opening's picture");
  // a page opened on a scene has no logo, title or opening to read
  const scene = world();
  scene.pre.startup({ scene: true });
  await settle(scene.pre);
  assert.equal(scene.pre.movies.size, 0);
  assert.ok(!scene.asked.some((s) => s.includes("TITLE_PARTS_JA")) && scene.asked.includes("art /assets/ui/DISP_PARTS_JA/txtwindow01-1920.webp"));
});

test("the look-ahead reads what the script is coming to: pictures, sounds and voices near, movies and the next scripts from further off", async () => {
  const { pre, asked, vm } = world();
  const i = index.names.indexOf("04_00_ARC04_4_1"), script = json(`scripts/${i}.json`);
  const movieAt = script.ops.findIndex((o) => o[0] === "TOMP");
  assert.deepEqual(script.ops[movieAt], ["TOMP", "5"]);
  pre.ahead(script, movieAt - 320);
  await settle(pre);
  assert.deepEqual([...pre.movies.keys()], ["op1_arc"], "the opening song, 320 commands before it plays");
  const next = script.ops.slice(movieAt).filter((o) => o[0] === "JUMP").map((o) => index.jump[o[1]]);
  assert.ok(next.length > 0 && next.every((t) => vm.scripts.has(t)), "the scripts it jumps to");
  // the pictures, sounds and voices of the next 300 commands, a few new ones a pass
  const near = script.ops.slice(movieAt - 320, movieAt - 20);
  const pictures = asked.filter((s) => s.startsWith("img ")), names = near.filter((o) => ["STCH", "SCH2", "SPFC", "SPRD"].includes(o[0]) && o[2]).map((o) => o[2].toUpperCase());
  assert.ok(pictures.length > 0 && pictures.length <= 8 + 2);
  for (const p of pictures.filter((s) => !s.startsWith("img RULE_"))) assert.ok(names.includes(p.slice(4)), p);
  const voices = asked.filter((s) => s.startsWith("snd /assets/voice/"));
  assert.ok(voices.length > 0 && voices.length <= 6);
  assert.equal(voices[0], `snd /assets/voice/${near.find((o) => o[0] === "VPLY")[1]}.ogg`, "nearest first");
  // the same place again reads nothing; further on it reads what is new
  const n = asked.length;
  pre.ahead(script, movieAt - 310);
  await settle(pre);
  assert.equal(asked.length, n);
  pre.ahead(script, movieAt - 250);
  await settle(pre);
  assert.equal(new Set(asked).size, asked.length, "nothing read twice");
});

test("the look-ahead follows the game's switches: no voices while skipping or switched off, nothing during a test jump or an instant run", async () => {
  const i = index.names.indexOf("04_00_ARC04_4_1"), script = json(`scripts/${i}.json`);
  const voiced = (extra, audioExtra = {}) => {
    const w = world({ vm: extra });
    Object.assign(w.audio, audioExtra);
    w.pre.ahead(script, 400);
    return settle(w.pre).then(() => w);
  };
  assert.ok((await voiced({})).asked.some((s) => s.includes("/voice/")));
  for (const off of [{ skip: true }, { voiceOn: false }]) {
    const w = await voiced(off);
    assert.ok(!w.asked.some((s) => s.includes("/voice/")), JSON.stringify(off));
    assert.ok(w.asked.some((s) => s.startsWith("img ")), "pictures all the same");
  }
  assert.ok(!(await voiced({}, { voiceOff: () => true })).asked.some((s) => s.includes("/voice/")), "a speaker switched off");
  assert.ok(!(await voiced({}, { muted: true })).asked.some((s) => s.startsWith("snd ")), "no sound at all with ?mute");
  assert.ok(!(await voiced({ skip: true, soundsSkipped: true })).asked.some((s) => s.startsWith("snd ")));
  for (const off of [{ skipUntil: 900 }, { instant: true }]) assert.deepEqual((await voiced(off)).asked, [], JSON.stringify(off));
});

test("a movie on a route's script is that route's; the chapter titles and the film grain are found too", async () => {
  const { pre, asked } = world();
  const ciel = index.names.indexOf("05_01_CIEL05_2_2_2"), script = json(`scripts/${ciel}.json`);
  pre.ahead(script, script.ops.findIndex((o) => o[0] === "TOMP") - 100);
  await settle(pre);
  assert.ok(pre.movies.has("op2_ciel"));
  // a script that ends in a jump to a chapter's first script, whose title movie is at its 56th command
  const day = index.names.indexOf("01_00_ARC01_1");
  const before = index.names.findIndex((_, k) => json(`scripts/${k}.json`).ops.some((o) => o[0] === "JUMP" && index.jump[o[1]] === day));
  const prev = json(`scripts/${before}.json`), jumpAt = prev.ops.findIndex((o) => o[0] === "JUMP" && index.jump[o[1]] === day);
  const far = world();
  far.pre.ahead(prev, Math.max(0, jumpAt - 50));
  await settle(far.pre);
  assert.ok(far.pre.movies.has("phasetitle_01_00"), "across the jump");
  // film grain: its texture is read as the renderer's
  const grain = world();
  grain.pre.near(["STNS", "3", "2"], { rank: RANK.story });
  grain.pre.near(["STNS", "3", "0"], { rank: RANK.story });
  await settle(grain.pre);
  assert.deepEqual(grain.asked, ["gl NOISE_PARTS/noisehd1"]);
  assert.ok(existsSync(asset("ui/NOISE_PARTS/noisehd1.webp")));
  assert.equal(asked.filter((s) => s.startsWith("gl ")).length, 0);
});

test("two movies are kept ready at most, the oldest let go; one taken is the caller's; the one on screen is not read again", () => {
  const { pre, page } = world();
  assert.equal(pre.readyMovie("prologue"), true);
  assert.equal(pre.readyMovie("prologue"), false);
  pre.readyMovie("titlebg1");
  pre.readyMovie("op1_arc");
  assert.deepEqual([...pre.movies.keys()], ["titlebg1", "op1_arc"]);
  assert.equal(page.made[0].getAttribute("src"), null, "the oldest stops reading its file");
  assert.equal(page.made[0].loads, 1);
  const v = pre.takeMovie("op1_arc");
  assert.equal(v, page.made[2]);
  assert.equal(pre.takeMovie("op1_arc"), null, "taken once");
  assert.equal(pre.takeMovie("ed01_arc"), null);
  page.shown.setAttribute("src", "/assets/movie/titlebg2.mp4");
  assert.equal(pre.readyMovie("titlebg2"), false, "on screen now");
  // one whose file could not be read is not handed over: the page's own element reports it, as before
  pre.readyMovie("ed01_arc");
  pre.movies.get("ed01_arc").error = { code: 4 };
  assert.equal(pre.takeMovie("ed01_arc"), null);
  // outside a browser there is nothing to make
  const none = new Preloader({ vm: {}, gfx: {}, audio: {}, page: undefined, Picture: undefined });
  assert.equal(none.readyMovie("prologue"), false);
  assert.equal(none.art(0, "PARTS/caution2_1920x1080"), false);
});

test("the game uses it: movies play in the element made ready, the script runner calls the look-ahead, sounds decode before the first click", async () => {
  const main = source("js/main.js"), vm = source("js/vm.js"), audio = source("js/audio.js");
  assert.match(main, /const preload = new Preloader\(\{ vm, gfx, audio \}\);\nvm\.ahead = \(script, pc\) => preload\.ahead\(script, pc\);/);
  assert.match(main, /preload\.startup\(\{ firstLaunch, stage: firstLaunch \? 0 : titleNext\(\), scene: q\.has\("script"\) \}\);\n  window\.preload = preload;\n(  \/\/[^\n]*\n)*  if \(homeDue\(q\)\) await openHome\(ui, \{ about: firstVisit \}\);/,
    "begun before the first page, so it reads while the page is up");
  assert.equal(main.match(/= movieElement\(name\);/g).length, 2, "story movies and the title's");
  assert.match(main, /old\.replaceWith\(made\);/);
  assert.doesNotMatch(main, /v\.src = /, "no movie set on the element behind the loader's back");
  assert.match(vm, /if \(this\.ahead\) \{ this\.ahead\(this\.script, pc\); return; \}/);
  assert.match(audio, /return this\.decoder\(\)\.decodeAudioData\(data\);/);
  assert.equal(VM.prototype.movieFor.call({ movies: tables.movies, script: { name: "04_00_ARC04_4_1" } }, "5"), "op1_arc");
  assert.equal(VM.prototype.movieFor.call({ movies: tables.movies, script: { name: "04_00_ARC04_4_1" } }, "5", "04_01_CIEL04_4_2"), "op1_arc");
  // the tables are asked for together, each still read where it was
  assert.match(vm, /\.map\(\(n\) => \[n, fetch\(`\/assets\/\$\{n\}\.json`\)\]\)\);/);
  for (const n of ["scripts/index", "text", "audio_tables", "images", "effects", "system", "animations", "gallery", "flowchart"]) assert.ok(existsSync(asset(`${n}.json`)), n);
});
