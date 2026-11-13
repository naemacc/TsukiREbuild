// What is read before it is asked for (web/app/js/preload.js): the queue's order, the start-up list, the look-ahead and the movies made ready.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const { ART, GL_ART, Preloader, RANK, fontsFor } = await import("../../web/app/js/preload.js");
const { VM } = await import("../../web/app/js/vm.js");
const asset = (path) => new URL(`../../web/assets/${path}`, import.meta.url);
// The media are not in the repository: whether the site has a picture is asked of the list of its files (web-dev/assets-manifest.txt), which also
// holds where only the scripts and tables were fetched (fetch_assets.py --tables).
const listed = new Set(readFileSync(new URL("../../web-dev/assets-manifest.txt", import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => l.split(" ").slice(2).join(" ")));
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
function world({ lanes = 4, vm: extra = {}, fonts } = {}) {
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
  return { asked, vm, gfx, audio, page, pre: new Preloader({ vm, gfx, audio, page, Picture, lanes, ...(fonts ? { fonts } : {}) }) };
}
const settle = async (pre) => { for (let k = 0; k < 5; k++) { await new Promise((r) => setTimeout(r, 5)); await pre.idle(); } };

test("every interface picture on the start-up list is one of the site's files (assets/ui), none twice in a group", () => {
  const windows = system.windows.styles.map((s) => `DISP_PARTS_JA/${s[0]}`);
  for (const [group, list] of [...Object.entries(ART), ...Object.entries(GL_ART), ["windows", windows]]) {
    assert.equal(new Set(list).size, list.length, group);
    for (const p of list) assert.ok(listed.has(`ui/${p}.webp`), `${group}: ${p}`);
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
  for (const p of ART.firstTitle) assert.ok(!asked.includes(`art /assets/ui/${p}.webp`), `not the first launch's ${p}`);
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
  assert.ok(listed.has("ui/NOISE_PARTS/noisehd1.webp"));
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
  assert.match(main, /preload\.startup\(\{ firstLaunch, stage: firstLaunch \? 0 : titleNext\(\), scene: q\.has\("script"\) \}\);\n  window\.preload = preload;\n(  \/\/[^\n]*\n)*  if \(homeDue\(q\)\) await openHome\(ui, \{ started: gameStarted \}\);/,
    "begun before the first page, so it reads while the page is up");
  assert.equal(main.match(/= movieElement\(name\);/g).length, 2, "story movies and the title's");
  assert.match(main, /old\.replaceWith\(made\);/);
  assert.doesNotMatch(main, /v\.src = /, "no movie set on the element behind the loader's back");
  assert.match(vm, /if \(this\.ahead\) \{ this\.ahead\(this\.script, pc\); return; \}/);
  assert.match(audio, /return this\.decoder\(\)\.decodeAudioData\(data\);/);
  assert.equal(VM.prototype.movieFor.call({ movies: tables.movies, script: { name: "04_00_ARC04_4_1" } }, "5"), "op1_arc");
  assert.equal(VM.prototype.movieFor.call({ movies: tables.movies, script: { name: "04_00_ARC04_4_1" } }, "5", "04_01_CIEL04_4_2"), "op1_arc");
  // the tables are asked for together, each still read where it was
  assert.match(vm, /\.map\(\(n\) => \[n, fetch\(shared\.has\(n\) \? `\/assets\/\$\{n\}\.json` : asset\(`\/assets\/\$\{n\}\.json`\)\)\]\)\);/);   // (each in the language in use: lang.js)
  for (const n of ["scripts/index", "text", "audio_tables", "images", "effects", "system", "animations", "gallery", "flowchart"]) assert.ok(existsSync(asset(`${n}.json`)), n);
});

test("the faces are the language's own: in Japanese the original's text face with the story's screen, its balloon and sans faces with the menus", async () => {
  assert.deepEqual(fontsFor(false), { story: ['40px "SeuratPro"', "16px Inter"], menus: [] });
  const ja = fontsFor(true);
  assert.deepEqual(ja.story, ['45.6px "TsukuMin"', "16px Inter"]);
  assert.deepEqual(ja.menus, ['45.6px "SeuratProJa"', '24px "TsukuGo"']);
  assert.ok(![...ja.story, ...ja.menus].some((f) => f.includes('"SeuratPro"')), "not the translation's balloon face");
  // each is a face style.css declares, and the Japanese ones are read from ja/fonts
  const css = source("style.css");
  for (const f of [...ja.story, ...ja.menus, ...fontsFor(false).story]) {
    const family = f.match(/"([^"]+)"/)?.[1];
    if (family) assert.match(css, new RegExp(`@font-face \\{ font-family: "${family}"; src: url\\("/assets/${family === "SeuratPro" ? "fonts" : "ja/fonts"}/`), family);
  }
  const { pre, page } = world({ lanes: 1, fonts: ja });
  pre.startup({ firstLaunch: false, stage: 0, scene: true });
  await settle(pre);
  assert.deepEqual(page.fonts.asked, [...ja.story, ...ja.menus], "the story's faces first, then the menus'");
  const order = [...pre.read];
  assert.ok(order[RANK.story] >= 2 && order[RANK.menus] >= 2);
});


test("the first launch reads its own title and cautions; a later boot, or one with the 100% save, reads the title of its stage and no more", async () => {
  // the pictures each title draws (ui.js): the first launch's title_bg0, prompt and cautions only there
  const ui = source("js/ui.js");
  for (const p of ART.firstTitle) assert.ok(ui.includes(`"${p.split("/")[1]}"`), p);
  assert.match(ui, /sprite\("TITLE_PARTS_JA", "title_bg0"/);
  assert.match(ui, /sprite\("PARTS", "caution2_1920x1080"/);
  for (const p of [...ART.title, ...ART.firstTitle]) {
    const [pack, name] = p.split("/");
    assert.ok(ui.includes(`"${name}"`) || source("js/home.js").includes(p), `${p} is drawn somewhere`);
  }
  const first = world({ lanes: 1 });
  first.pre.startup({ firstLaunch: true, stage: 0 });
  await settle(first.pre);
  for (const p of ART.firstTitle) assert.ok(first.asked.includes(`art /assets/ui/${p}.webp`), p);
  // the 100% save: the last stage, its movie, still and music
  const full = world({ lanes: 1 });
  full.pre.startup({ firstLaunch: false, stage: 5 });
  await settle(full.pre);
  assert.deepEqual([...full.pre.movies.keys()], ["TM_CI", "titlebg4"]);
  assert.ok(full.asked.includes("art /assets/ui/TITLE_PARTS_JA/title_bg4.webp"));
  assert.ok(full.asked.includes(`snd /assets/bgm/${tables.bgm[71]}.ogg`), "music 72, the last stage's");
  assert.ok(!full.asked.includes(`snd /assets/bgm/${tables.bgm[1]}.ogg`), "not the earlier stages' music 2");
  for (const p of ART.firstTitle) assert.ok(!full.asked.includes(`art /assets/ui/${p}.webp`), p);
});

// ---- a scene's pictures, read before it starts (preload.js scene, vm.js sceneReady) and the textures they become (renderer.js upload) ----
// A renderer's picture files as preload.js uses them: `fail` says how a name's reads go (a list, one entry a read: "drop" for a connection that fails,
// "gone" for a file that is not there, anything else comes), `open` holds the reads still under way when `slow` is set.
function fileWorld({ fail = {}, slow = false } = {}) {
  const asked = [], open = [], files = new Map();
  const gfx = { images, tex: new Map(), files,
    file(key, keep) {
      const hit = files.get(key);
      if (hit) return hit.read;
      asked.push(key);
      const how = (fail[key] || []).shift(), entry = { done: false };
      entry.read = new Promise((res, rej) => {
        const end = () => { if (how === "drop") rej(new TypeError("failed to fetch")); else if (how === "gone") rej(Object.assign(new Error("no image"), { missing: true })); else { entry.done = true; res({}); } };
        if (slow) open.push(end); else end();
      });
      if (keep) { files.set(key, entry); entry.read.catch(() => { if (files.get(key) === entry) files.delete(key); }); }
      return entry.read;
    },
    hasFile: (key) => !!files.get(key)?.done,
    keepFiles(keys) { for (const k of [...files.keys()]) if (!keys.has(k)) files.delete(k); } };
  const scripts = new Map();
  const vm = { index, movies: tables.movies, system, getScript(i) { if (!scripts.has(i)) scripts.set(i, Promise.resolve(json(`scripts/${i}.json`))); return scripts.get(i); } };
  const pre = new Preloader({ vm, gfx, audio: { table: tables, buffers: new Map(), muted: true }, page: null, Picture: null });
  pre.wait = () => Promise.resolve();   // (no real seconds between two tries)
  return { asked, open, files, gfx, vm, pre };
}
const turn = () => new Promise((r) => setTimeout(r, 0));

test("a scene's pictures: every picture and rule the script names from a command on, branches and all, and only those the game has", () => {
  const { pre } = fileWorld();
  const s = json("scripts/6.json");   // 01_00_ARC01_1_2: the train, Ciel's standing sprite at command 71
  const all = pre.scenePictures(s, 0);
  assert.ok(all.has("SIE_A_00_00_N00") && all.has("IMG0773"));
  for (const k of all) assert.ok(images[k], k);
  const named = new Set(s.ops.filter((o) => (o[0] === "STCH" || o[0] === "SCH2") && o[2] && images[o[2].toUpperCase()]).map((o) => o[2].toUpperCase()));
  for (const k of named) assert.ok(all.has(k), k);
  // from a later command: only what is still to come
  const last = s.ops.findLastIndex((o) => o[0] === "STCH" && o[2]), tail = pre.scenePictures(s, last);
  assert.ok(tail.size >= 1 && tail.size < all.size);
  assert.equal(pre.scenePictures(s, s.ops.length).size, 0);
  // a transition through a rule picture and a wipe; a name with no picture is none
  const made = pre.scenePictures({ ops: [["FADS", "2", "500", "7"], ["FADS", "0", "500", "9"], ["STTR", "3", "12"], ["STCH", "1", "no_such_picture"], ["SPFC", "0", "img0773"]] });
  assert.deepEqual([...made].sort(), ["IMG0773", "RULE_07", "RULE_12"]);
});

test("a scene does not start until its pictures are in: scene() gives a wait while any is missing, and nothing to wait for once they are kept", async () => {
  const { pre, open, asked, gfx } = fileWorld({ slow: true });
  const s = json("scripts/6.json"), names = pre.scenePictures(s, 0);
  let done = false;
  const wait = pre.scene(s, 0);
  assert.ok(wait && typeof wait.then === "function");
  wait.then(() => { done = true; });
  await turn();
  assert.equal(asked.length, 8, "eight files at a time");
  assert.equal(pre.sceneProgress(), 0);
  for (let k = 0; k < 4; k++) open.shift()();
  await turn();
  assert.equal(pre.sceneProgress(), 4 / names.size);
  assert.equal(done, false);
  while (!done) { while (open.length) open.shift()(); await turn(); }
  assert.equal(pre.sceneProgress(), null, "no scene is being waited for");
  for (const k of names) assert.ok(gfx.hasFile(k), k);
  // the scripts it jumps to are read next, without anyone waiting, so that the scene after it has nothing to wait for
  for (let k = 0; k < 60; k++) { while (open.length) open.shift()(); await turn(); }
  const next = json(`scripts/${index.jump[s.ops.find((o) => o[0] === "JUMP")[1]]}.json`), after = pre.scenePictures(next, 0);
  assert.ok(after.size > 0);
  for (const k of after) assert.ok(gfx.hasFile(k), `next scene: ${k}`);
  assert.equal(pre.scene(next, 0), null, "everything is in: the next scene starts at once");
  // ... and what only the scene before used is let go
  for (const k of names) if (!after.has(k)) assert.ok(!gfx.hasFile(k), `kept from the last scene: ${k}`);
  // the same scene again (a load back into it) waits for nothing
  assert.equal(pre.scene(next, 0), null);
});

test("a picture that does not come is asked for again; one that is not there is not, and neither keeps the scene from starting", async () => {
  const script = { ops: [["STCH", "1", "img0773"], ["STCH", "2", "img2228"], ["STCH", "3", "img0009"], ["STCH", "4", "img2345"]], labels: {} };
  const { pre, asked, gfx } = fileWorld({ fail: { IMG0773: ["drop", "drop"], IMG2228: ["gone"], IMG0009: ["drop", "drop", "drop", "drop", "drop"] } });
  await pre.scene(script, 0);
  const times = (k) => asked.filter((a) => a === k).length;
  assert.equal(times("IMG0773"), 3, "dropped twice, then it came");
  assert.ok(gfx.hasFile("IMG0773"));
  assert.equal(times("IMG2228"), 1, "not there: asked for once");
  assert.equal(times("IMG0009"), 4, "given up after three more tries: the story reads it again when it comes to it");
  assert.ok(!gfx.hasFile("IMG0009") && gfx.hasFile("IMG2345"));
});

test("the story stands still for a scene's pictures: before a script's first command, after a load, and where a run that draws nothing ends", async () => {
  const calls = [], holds = [];
  let release = null;
  const vm = Object.assign(Object.create(VM.prototype), { loadHold: 0, sceneOf: null, sceneFrom: 0, script: { name: "a" }, pc: 0, _skip: false,
    holdClocks() {}, onHold: (on) => holds.push(on), scene: (script, pc) => { calls.push([script.name, pc]); return new Promise((res) => { release = res; }); } });
  assert.equal(vm.sceneDue(), true);
  let through = false;
  const ready = vm.sceneReady().then(() => { through = true; });
  await turn();
  assert.deepEqual([calls, holds, vm.loadHold, through], [[["a", 0]], [true], 1, false], "held, and main.js told so for its Loading window");
  release();
  await ready;
  assert.deepEqual([holds, vm.loadHold, vm.sceneDue()], [[true, false], 0, false]);
  // further on in the same script: nothing; back before where it was read from, or in another script: again
  vm.pc = 40;
  assert.equal(vm.sceneDue(), false);
  Object.assign(vm, { sceneFrom: 40, pc: 10 });
  assert.equal(vm.sceneDue(), true);
  Object.assign(vm, { pc: 50, script: { name: "b" } });
  assert.equal(vm.sceneDue(), true);
  // a run that draws nothing (a read scene passed at once, a test jump) waits for no pictures; where it ends, the scene's are read
  Object.assign(vm, { _skip: true, instant: true });
  assert.equal(vm.sceneDue(), false);
  Object.assign(vm, { _skip: false, instant: false });
  assert.equal(vm.sceneDue(), true);
  // nothing to wait for: no hold at all
  vm.scene = () => null;
  holds.length = 0;
  await vm.sceneReady();
  assert.deepEqual(holds, []);
  // the loop asks before each command, and a load asks with its own pictures
  const src = source("js/vm.js");
  assert.match(src, /if \(this\.sceneDue\(\)\) \{ await this\.sceneReady\(\); if \(gen !== this\.generation\) return; \}/);
  assert.match(src.slice(src.indexOf("  async restore(s,")), /const read = this\.scene\(script, s\.pc\);\s+if \(read\) waits\.push\(read\);\s+\}\s+await this\.waitImages\(waits\);/);
  // main.js: the game's own Loading window, which takes no keys, over a hold that lasts
  const main = source("js/main.js");
  assert.match(main, /vm\.scene = \(script, pc\) => preload\.scene\(script, pc\);/);
  assert.match(main, /holdNote = ui\.notify\(text\(\), \{ held: true, passive: true, live: text \}\);/);
});

// A GPU as renderer.js upload sees it: `most` on a side, and `refuse(w, h, n)` saying whether the n-th upload is turned down (the texture left empty,
// an error to be read). createImageBitmap is the page's, which makes the picture any size asked.
const { Renderer } = await import("../../web/app/js/renderer.js");
function gpu({ most = 16384, refuse = () => false, lost = false } = {}) {
  const made = [], deleted = [], uploads = [];
  let error = 0;
  const gl = { NO_ERROR: 0, TEXTURE_2D: 1, RGBA8: 2, RGBA: 3, UNSIGNED_BYTE: 4, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 5, TEXTURE_MIN_FILTER: 6, TEXTURE_MAG_FILTER: 7, TEXTURE_WRAP_S: 8,
    TEXTURE_WRAP_T: 9, LINEAR: 10, CLAMP_TO_EDGE: 11, isContextLost: () => lost, getError() { const e = error; error = 0; return e; }, createTexture() { const t = { id: made.length }; made.push(t); return t; },
    bindTexture() {}, pixelStorei() {}, texParameteri() {}, deleteTexture(t) { deleted.push(t); },
    texImage2D(_t, _l, _f, _a, _b, bmp) { uploads.push([bmp.width, bmp.height]); if (bmp.width > most || bmp.height > most || refuse(bmp.width, bmp.height, uploads.length)) error = 0x505; } };
  const evicted = [];
  const r = Object.assign(Object.create(Renderer.prototype), { gl, maxSide: most, limit: 1400 * 1048576, bytes: 900 * 1048576, tex: new Map(), files: new Map(), evict(all) { evicted.push(all); } });
  return { r, gl, made, deleted, uploads, evicted };
}
const bitmaps = (w, h) => { globalThis.createImageBitmap = async (_blob, o = {}) => ({ width: o.resizeWidth || w, height: o.resizeHeight || h, close() {} }); };

test("a picture larger than the GPU takes on a side is made to fit, so it is a picture and not a black box (Ciel's standing sprite, 841 x 4128, on a 4096 GPU)", async (t) => {
  t.after(() => { delete globalThis.createImageBitmap; });
  bitmaps(841, 4128);
  const big = gpu({ most: 16384 }), e1 = {};
  await big.r.upload(e1, {}, "SIE_A_00_00_N00");
  assert.deepEqual([e1.w, e1.h, big.uploads], [841, 4128, [[841, 4128]]], "as stored where the GPU takes it");
  const small = gpu({ most: 4096 }), e2 = {};
  await small.r.upload(e2, {}, "SIE_A_00_00_N00");
  assert.deepEqual(small.uploads, [[834, 4096]], "never offered at a size the GPU refuses");
  assert.deepEqual([e2.w, e2.h, !!e2.tex], [834, 4096, true]);
  // the widest picture of all on the same GPU
  bitmaps(7467, 5000);
  const wide = gpu({ most: 4096 }), e3 = {};
  await wide.r.upload(e3, {}, "IMG1481");
  assert.deepEqual([e3.w, e3.h], [4096, 2742]);
});

test("an upload the GPU turns down is made again with the other pictures let go, then at half the size; one that never goes in is no picture, and its empty texture is deleted", async (t) => {
  t.after(() => { delete globalThis.createImageBitmap; });
  bitmaps(3060, 3053);
  // no room the first time: the pictures not on screen go, the same size is tried again
  const once = gpu({ refuse: (w, h, n) => n === 1 }), e1 = {};
  await once.r.upload(e1, {}, "IMG2228");
  assert.deepEqual([once.uploads, once.evicted, e1.w, once.deleted.length], [[[3060, 3053], [3060, 3053]], [true], 3060, 1]);
  assert.ok(once.r.limit < 900 * 1048576, "and fewer pictures are kept from now on");
  // still none: half the size
  const twice = gpu({ refuse: (w) => w > 2000 }), e2 = {};
  await twice.r.upload(e2, {}, "IMG2228");
  assert.deepEqual([twice.uploads.at(-1), e2.w, e2.h, !!e2.tex], [[1530, 1526], 1530, 1526, true]);
  // never: the picture fails to load, so the layer is not drawn at all (renderer.js drawn: no texture, no quad)
  const never = gpu({ refuse: () => true }), e3 = {};
  await assert.rejects(never.r.upload(e3, {}, "IMG2228"), /no room for image IMG2228/);
  assert.equal(e3.tex, undefined);
  assert.equal(never.deleted.length, never.made.length, "no empty texture is left behind");
  const { drawn } = await import("../../web/app/js/renderer.js");
  assert.equal(drawn({ z: 5, ready: null }, { alpha: 1 }), false);
  assert.equal(drawn({ z: 5, ready: { tex: null } }, { alpha: 1 }), false, "nor one whose texture was let go");
  // a lost context takes no upload
  const lost = gpu({ lost: true });
  await assert.rejects(lost.r.upload({}, {}, "IMG2228"), /no room/);
  assert.equal(lost.uploads.length, 0);
});

test("the textures let go are never ones a layer holds: on screen, staged for the next commit, or the rule a transition goes through", () => {
  const deleted = [];
  const mb = 1048576, entry = (used) => ({ tex: { used }, w: 1024, h: 1024, used });   // 4 MB each
  const r = Object.assign(Object.create(Renderer.prototype), { gl: { deleteTexture: (t) => deleted.push(t) }, limit: 16 * mb, bytes: 24 * mb, ruleSlot: "RULE_07",
    tex: new Map([["SHOWN", entry(1)], ["STAGED", entry(2)], ["RULE_07", entry(3)], ["WIPE", entry(4)], ["OLD", entry(5)], ["OLDER", entry(0)]]),
    liveLayers: [{ image: "shown" }], inUse: () => [{ image: "shown" }, { image: "staged" }, { image: null, rule: { name: "WIPE" } }] });
  const held = { shown: r.tex.get("SHOWN"), old: r.tex.get("OLD") };
  r.evict(true);
  assert.deepEqual([...r.tex.keys()], ["SHOWN", "STAGED", "RULE_07", "WIPE"]);
  assert.equal(deleted.length, 2);
  assert.equal(held.old.tex, null, "what still points at a texture let go draws nothing");
  assert.ok(held.shown.tex);
  assert.equal(r.bytes, 16 * mb);
  // the VM names its layers: on screen, staged and left behind
  assert.match(source("js/vm.js"), /gfx\.inUse = \(\) => \[\.\.\.this\.layers\.values\(\), \.\.\.this\.pending\.values\(\), \.\.\.this\.ghosts\.values\(\)\];/);
});
