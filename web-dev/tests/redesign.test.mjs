// The mouse and keyboard interface (TODO items 126-133): the key map, the log's pages, the quick bar and the hint bars.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { ACTIONS, KeyMap, MENU_KEYS, MOUSE, SLOTS, canBind, keyLabel, keyName } = await import("../../web/app/js/keys.js");
const { logPages } = await import("../../web/app/js/uifx.js");
const source = (name) => readFileSync(new URL(`../../web/app/${name}`, import.meta.url), "utf8");
const store = () => ({ data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = String(v); } });
const ev = (key, mods = {}) => ({ key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...mods });

test("127: one key map: every story action has its keys, no key twice, and the menus' keys and the mouse are listed beside them", () => {
  const seen = new Map();
  for (const a of ACTIONS) {
    assert.ok(a.keys.length <= SLOTS, a.id);
    for (const k of a.keys) { assert.equal(seen.has(k), false, `${k} for ${a.id} and ${seen.get(k)}`); seen.set(k, a.id); }
  }
  const ids = ACTIONS.map((a) => a.id);
  for (const id of ["advance", "fast", "skip", "auto", "log", "rewind", "hide", "voice", "quickSave", "quickLoad", "prevScene", "nextScene", "bar", "save", "load", "config", "menu", "fullscreen"]) assert.ok(ids.includes(id), id);
  assert.deepEqual(MENU_KEYS.map(([label]) => label), ["Move", "Choose", "Back", "Change page", "Scroll", "First / last"]);
  assert.equal(MOUSE.length, 6);
  // the letters that changed meaning from screen to screen are one thing each now
  const m = new KeyMap(store());
  assert.deepEqual(["A", "S", "L", "R", "F", "Escape", "Control"].map((k) => m.action(ev(k))), ["auto", "skip", "log", "rewind", "fullscreen", "menu", "fast"]);
  assert.equal(m.action(ev("C")), null, "C opens nothing");
});

test("127: keys are named as they are shown, letters whatever the case; a key with Ctrl, Alt or the command key held is the browser's", () => {
  assert.deepEqual([keyName(ev("a")), keyName(ev("A")), keyName(ev(" ")), keyName(ev("ArrowUp")), keyName(ev("F2"))], ["A", "A", "Space", "ArrowUp", "F2"]);
  assert.deepEqual([keyLabel("Escape"), keyLabel("Control"), keyLabel("ArrowUp"), keyLabel("PageUp"), keyLabel("Q")], ["Esc", "Ctrl", "↑", "Page Up", "Q"]);
  assert.deepEqual([canBind("F5"), canBind("F11"), canBind("F12"), canBind("Meta"), canBind(""), canBind("G"), canBind("Shift")], [false, false, false, false, false, true, true]);
  const m = new KeyMap(store());
  assert.equal(m.action(ev("s")), "skip");
  assert.equal(m.action(ev("s", { ctrlKey: true })), null, "Ctrl + S is the browser's, also while Ctrl fast forwards");
  assert.equal(m.action(ev("s", { metaKey: true })), null);
  assert.equal(m.action(ev("Control", { ctrlKey: true })), "fast", "the modifier itself can be an action's key");
  assert.equal(m.action(ev("Tab", { shiftKey: true })), null);
  assert.equal(m.label("auto"), "A");
  assert.equal(m.label("save"), "", "Save has no key until one is given");
});

test("127: changing a key: it leaves the action that had it, a slot can be emptied, the map is kept and can be put back", () => {
  const s = store();
  const m = new KeyMap(s);
  assert.equal(m.set("save", 0, "G"), true);
  assert.deepEqual(m.keys("save"), ["G"]);
  assert.equal(m.action(ev("g")), "save");
  m.set("save", 1, "A");                                       // Auto's key
  assert.deepEqual([m.keys("save"), m.keys("auto")], [["G", "A"], []]);
  assert.equal(m.action(ev("a")), "save");
  m.set("save", 0, "A");                                       // the same key into the other slot: once only
  assert.deepEqual(m.keys("save"), ["A"]);
  m.set("advance", 0, null);                                   // Backspace on a slot
  assert.deepEqual(m.keys("advance"), ["Space"]);
  assert.equal(m.set("log", 0, "F5"), false, "the browser's keys cannot be taken");
  assert.deepEqual(m.keys("log"), ["L", "PageUp"]);
  // kept in the browser, read back, and bad entries dropped
  const again = new KeyMap(s);
  assert.deepEqual([again.keys("save"), again.keys("auto"), again.keys("advance")], [["A"], [], ["Space"]]);
  s.data["tsuki.keys"] = JSON.stringify({ skip: ["K", "F5", 7, "J", "M"], nothing: ["Z"] });
  const odd = new KeyMap(s);
  assert.deepEqual(odd.keys("skip"), ["K", "J"]);
  assert.equal(odd.action(ev("s")), null);
  assert.equal(odd.action(ev("a")), "auto", "an action the stored map does not name keeps its own");
  s.data["tsuki.keys"] = "{broken";
  assert.equal(new KeyMap(s).action(ev("s")), "skip");
  again.reset();
  assert.deepEqual(again.keys("auto"), ["A"]);
  assert.deepEqual(JSON.parse(s.data["tsuki.keys"]).save, []);
});

test("127: the story screen and the pad run actions, not letters; the config's pages turn with Tab", () => {
  const main = source("js/main.js");
  assert.match(main, /const act = keys\.action\(e\);/);
  assert.match(main, /if \(act && runAction\(act, e\)\) e\.preventDefault\(\);/);
  assert.doesNotMatch(main, /k === "s" \|\| k === "S"/);
  assert.match(main, /const PAD_STORY = \{ A: "advance", Down: "advance", Y: "menu", X: "log", Up: "bar", R: "skip", L: "auto", ZL: "rewind" \};/);
  assert.match(main, /const PAD_MENU = \{ A: "Enter", B: "Escape", Up: "ArrowUp", Down: "ArrowDown", Left: "ArrowLeft", Right: "ArrowRight", L: "Tab", R: "Tab" \};/);
  const ui = source("js/ui.js");
  assert.match(ui, /if \(k === "Tab"\) \{ if \(!e\.repeat\) changePage\(e\.shiftKey \? -1 : 1\); return true; \}/);
  assert.doesNotMatch(ui, /k === "a" \|\| k === "A" \|\| k === "f"/);
  assert.match(ui, /resetSettings|buildControlsPage/);
  assert.match(main, /audio\.resetVolumes\(\); keys\.reset\(\);/, "Reset to defaults puts the keys back too");
  // the gallery's viewer no longer takes R
  assert.doesNotMatch(source("js/gallery.js"), /key === "r" \|\| key === "R"/);
});

test("131: the log's pages: every record, oldest first, cut at the text window's page ends, the page on screen last", () => {
  const rec = (seq, pageEnd = false, kind = "msg") => ({ seq, pageEnd, kind });
  const records = [rec(1), rec(2, true), rec(3), rec(4), rec(5, true), rec(6, false, "choice"), rec(6, true, "choice"), rec(7), rec(8)];
  const pages = logPages(records);
  assert.deepEqual(pages.map((p) => p.map((r) => r.seq)), [[1, 2], [3, 4, 5], [6, 6], [7, 8]]);
  assert.deepEqual(logPages([]), []);
  assert.deepEqual(logPages([rec(1)]).map((p) => p.length), [1], "a single line is shown too");
  // once the 800-record log has let records go, the oldest page may be cut short and is left out
  assert.deepEqual(logPages(records, true).map((p) => p.map((r) => r.seq)), [[3, 4, 5], [6, 6], [7, 8]]);
  assert.deepEqual(logPages([rec(1), rec(2)], true).length, 1, "but never the only page");
});

test("131: the log page renderer wraps each record for the caller, and leaves the page as it was without one", async () => {
  const text = source("js/textbox.js");
  assert.match(text, /export function renderLogPage\(box, records, wrap = null\) \{/);
  assert.match(text, /const into = wrap \? box\.appendChild\(wrap\(r, row\)\) : box;/);
  const ui = source("js/ui.js");
  const log = ui.slice(ui.indexOf("  backlog() {"), ui.indexOf("  // ---- sounds"));
  assert.match(log, /logPages\(T\.history, T\.dropped\)/);
  assert.match(log, /this\.vm\.canJump\(rec\.r\.seq, choice\)/, "a line is offered Quick Jump only where the story still keeps that point");
  assert.match(log, /this\.dialog\(this\.message\(23, "Quick Jump\?"\)/);
  assert.match(log, /this\.audio\.playVoice\(rec\.r\.voice\)/);
  assert.match(log, /if \(past >= LOG\.close\) leave\(\);/, "the wheel turned on past the newest line closes it");
  // a page is in the document before it is laid out, so a run of dashes is joined by the distance measured for its face (setDashJoin)
  assert.match(log, /const box = div\("logpage"\), made = \[\];\n\s+inner\.prepend\(box\);\n\s+renderLogPage\(box, records,/);
  // older pages arrive above the view for a moment after opening: the list is moved by hand only where the browser's scroll anchoring does not do it
  assert.match(log, /if \(!anchors \|\| top <= 0\) list\.scrollTop \+= list\.scrollHeight - before;/, "moved twice, the wheel's turn was undone");
});

test("Firefox paints every movie on a canvas of its own (white flashes in its own video drawing, 2026-11-10); other browsers do not", () => {
  const main = source("js/main.js");
  assert.match(main, /const paintsMovies = CSS\.supports\("-moz-appearance", "none"\) && "requestVideoFrameCallback" in HTMLVideoElement\.prototype;/);
  assert.equal(main.match(/if \(paintsMovies\) paintMovie\(v\);/g).length, 2, "the title's movie and playMovie's");
  assert.equal(main.match(/^\s+stopPaintingMovie\(v\);/gm).length, 3, "at the end of each, and before a new one");
  assert.match(main, /\(moviePic \|\| \$\("movie"\)\)\.after\(c\)/, "a story movie's cover stays over the picture");
  assert.doesNotMatch(main, /flashtest/, "the test page is gone");
});

test("First visit: the page that takes the click the browser wants before sound, built on the game's panel, once only", async () => {
  const store = {};
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const { SECTIONS, welcomeDue } = await import("../../web/app/js/welcome.js");
  const query = (s) => new URLSearchParams(s);
  assert.equal(welcomeDue(query("")), true, "a first visit");
  assert.equal(welcomeDue(query("?script=00_02")), false, "not for a test going straight to a scene");
  store["tsuki.welcomed"] = "1";
  assert.equal(welcomeDue(query("")), false, "once only");
  assert.equal(welcomeDue(query("?welcome")), true, "unless asked for");
  assert.equal(SECTIONS.length + 1, 8, "seven sections and START, on the panel's own eight plates (Extras is part of Testing since 2026-11-10)");
  assert.ok(SECTIONS.find((s) => s.tab === "TESTING").blocks.some((b) => b[0] === "h" && b[1] === "Extras"));
  assert.match(source("js/welcome.js"), /const PLATE = \{ w: 220, h: 62, x: 82, pitch: 221, y: 29 \};/);
  for (const s of SECTIONS) { assert.ok(s.tab.length <= 9, s.tab); assert.ok(s.blocks.length > 0, s.tab); }
  const text = source("js/welcome.js"), main = source("js/main.js");
  assert.match(text, /ui\.audio\.start\(\);    \/\/ the click or key the browser wanted/);
  assert.match(text, /sprite\("MODEPNL_PARTS_JA", "modepanel_window", 0, 0, 1920, 96\)/, "the game's own strip");
  assert.match(text, /quickBarArt\(LABELS\.map/, "and its plates");
  assert.match(main, /if \(welcomeDue\(q\)\) await openWelcome\(ui\);/);
  assert.ok(main.indexOf("await openWelcome(ui)") < main.indexOf("await boot()"), "before the first movie");
  assert.ok(text.indexOf("localStorage.setItem(KEY") > text.indexOf("const begin ="), "marked only once START is pressed");
});

test("Self-contained: the app asks only for /assets/..., and the server needs nothing outside web/", () => {
  for (const f of ["js/main.js", "style.css", "index.html"]) assert.doesNotMatch(source(f), /\/rom\//, f);
  const server = source("../server.py");
  assert.doesNotMatch(server, /import convert|web-research|base_game|numpy|PIL/);
});

test("131: the save list has all 100 slots for saving, and for loading every record with the quick and automatic saves, newest first", () => {
  const ui = source("js/ui.js");
  const save = ui.slice(ui.indexOf("  savesScreen(mode"), ui.indexOf("  // SELA's save screen has closed"));
  assert.match(save, /if \(mode === "save"\) for \(let i = 0; i < 100; i\+\+\) entries\.push\(\{ rec: saves\[i\] \|\| null, kind: "slot", slot: i \}\);/);
  assert.match(save, /const quick = this\.env\.quickRecord\?\.\(\);/);
  assert.match(save, /for \(const rec of this\.autosaves\(\)\) if \(rec\) entries\.push\(\{ rec, kind: "auto" \}\);/);
  assert.match(save, /entries\.sort\(\(a, b\) => \(b\.rec\.when \|\| 0\) - \(a\.rec\.when \|\| 0\)\);/);
  assert.doesNotMatch(save, /pressChoose/);
});

test("129, 133: the quick bar is the game's panel with seven more buttons, each with what it can do now; any click sends it up; full screen is an action", async () => {
  const { UI, QUICK_BAR } = await import("../../web/app/js/ui.js");
  const had = globalThis.document;
  const fake = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, children: [], append(...c) { this.children.push(...c); }, listeners: {},
    addEventListener(t, f) { this.listeners[t] = f; }, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [] });
  globalThis.document = { createElement: fake, getElementById: fake, fullscreenElement: null };
  try {
    const vm = { choosing: null, instant: false, replay: false, replaySource: null, running: true, auto: false, skipToggle: false, previousScene: () => null, canRewind: () => true };
    const calls = [];
    const env = new Proxy({ hasQuickSave: () => false, canPanel: () => true }, { get: (t, k) => t[k] ?? ((...a) => calls.push([k, ...a])) });
    const ui = Object.assign(Object.create(UI.prototype), { vm, env, audio: { start() {} }, sound() {}, keys: new KeyMap(store()), pointerMoved: true });
    ui.buildPanel();
    const defs = ui.panel.defs;
    // the game's eight in the game's order (their plates 0-7 of mode_panel_btn_ja), then the new ones
    assert.deepEqual(defs.map((d) => d.id), ["prevScene", "rewind", "auto", "skip", "nextScene", "quickSave", "quickLoad", "voice", "log", "hide", "save", "load", "config", "fullscreen", "menu"]);
    assert.deepEqual(defs.map((d) => d.art), [0, 1, 2, 3, 4, 5, 6, 7, ...Array(7).fill(undefined)]);
    assert.deepEqual([QUICK_BAR.h, QUICK_BAR.y], [62, 29], "the panel's own height and row");
    assert.ok(defs.length * QUICK_BAR.pitch <= 1850 - 82 + 2, "fifteen stand where the game's eight did (x 82 - 1850)");
    assert.equal(ui.panel.art, false, "no canvas here: the plain plates stand in");
    const press = (id) => ui.pressPanel(defs.findIndex((d) => d.id === id));
    press("save"); press("load"); press("config"); press("menu"); press("log"); press("fullscreen"); press("auto");
    assert.deepEqual(calls, [["menu", 0], ["menu", 1], ["menu", 2], ["menu"], ["log"], ["fullscreen"], ["toggleAuto"]]);
    calls.length = 0;
    press("prevScene");                                          // nothing to go back to
    press("quickLoad");                                          // no quick save yet
    assert.deepEqual(calls, []);
    vm.choosing = {};
    press("log"); press("skip");
    assert.deepEqual(calls, [], "not at a choice");
    // a button's caption names its key
    assert.equal(ui.panelTip(defs.find((d) => d.id === "auto")), "Auto Mode: ON / OFF  [A]");
    assert.equal(ui.panelTip(defs.find((d) => d.id === "save")), "Save");
    // opened by its key it is driven by Left / Right and Enter, and Esc closes it
    vm.choosing = null;
    ui.openPanel(true);
    assert.equal(defs[ui.panel.sel].id, "auto");
    assert.equal(ui.panel.hover, -1, "the keys' cursor shows no caption");
    ui.panelKey({ key: "ArrowLeft" });
    assert.equal(defs[ui.panel.sel].id, "rewind");
    ui.panelKey({ key: "ArrowLeft" });
    assert.equal(defs[ui.panel.sel].id, "menu", "past Prev Scene, which can do nothing now, and round");
    assert.equal(ui.panelKey({ key: "Escape" }), true);
    assert.equal(ui.panelOpen, false);
    assert.equal(ui.panelKey({ key: "Enter" }), false, "closed: the key is the story's");
    // any click sends it up, and the pointer still at the top does not bring it straight back
    ui.openPanel();
    assert.equal(ui.panelOpen, true);
    const auto = defs.findIndex((d) => d.id === "auto");
    ui.panel.btns[auto].listeners.pointermove({ pointerType: "mouse" });
    assert.deepEqual([ui.panel.sel, ui.panel.hover], [auto, auto], "the button under the pointer is lit and captioned");
    calls.length = 0;
    ui.panel.btns[auto].listeners.click({ stopPropagation() {} });
    assert.deepEqual(calls, [["toggleAuto"]]);
    assert.equal(ui.panelOpen, false);
    ui.openPanel();
    assert.equal(ui.panelOpen, false, "held until the pointer has left the top");
    ui.panelHold = false;
    ui.openPanel();
    assert.equal(ui.panelOpen, true);
    assert.equal(ui.dismissPanel(), true);
    assert.equal(ui.dismissPanel(), false);
  } finally { globalThis.document = had; }
  const main = source("js/main.js");
  assert.match(main, /addEventListener\("click", \(\) => \{ ui\.dismissPanel\(\); \}, true\);/, "any click, wherever it lands");
  assert.match(main, /else ui\.panelHold = false;/);
  assert.match(main, /document\.documentElement\.requestFullscreen\?\.\(\)/);
  assert.match(main, /if \(act === "fullscreen"\) \{ if \(!e\.repeat\) toggleFullscreen\(\); e\.preventDefault\(\); return; \}/);
  const uiSrc = source("js/ui.js");
  assert.match(uiSrc, /if \(!this\.binding && this\.keys\?\.action\(e\) === "fullscreen"\)/, "on every screen, except while a key is being chosen");
  // the sheet is cut from the game's plates: the bare plate from Auto's, each mark laid back over it
  assert.match(uiSrc, /img\.src = url\("MODEPNL_PARTS_JA", "mode_panel_btn_ja"\);/);
  assert.match(uiSrc, /const PANEL_ART = \{ w: 220, h: 62, x: 10, dx: 232, y: 9, dy: 72, clean: 2, hole: \[84, 136\], edge: 12,/);
});

test("Captions show only under the pointer, and the gallery's column takes the cursor back from its section the same way", () => {
  const ui = source("js/ui.js");
  assert.match(ui, /this\.showCaption\(items\[i\]\);   \/\/ a caption shows only while the pointer is on its button/);
  assert.match(ui, /el\.addEventListener\("pointerleave", \(\) => \{ if \(this\.captionBox\?\.key === el\) this\.captionBox\.hide\(\); \}\);/);
  assert.match(ui, /if \(!this\.pointing\) this\.captionBox\?\.hide\(\);/);
  const gallery = source("js/gallery.js");
  assert.match(gallery, /if \(focus !== "menu"\) \{ focus = "menu"; view\?\.focus\(false\); \}/);
  assert.doesNotMatch(gallery, /addEventListener\("mouseenter", \(\) => \{ if \(/, "the lists follow a moving pointer, not an element sliding under one at rest");
  // the movie frames' lit and pressed cells line up with the normal one (they are cut 3 px further left than 259 apart)
  assert.match(gallery, /const COLS = \[0, 256, 512\], ROWS = \[0, 155, 307\];/);
  // the lists scroll by the wheel's own distance, a little under one for one, and the pointer does not scroll them to the row it lights
  assert.match(gallery, /export const WHEEL_GAIN = 0\.8;/);
  assert.match(gallery, /scrollBy\(wheelPixels\(e, stageScale\(\)\) \* WHEEL_GAIN\)/);
  assert.match(gallery, /scrollRows\(\(wheelPixels\(e, stageScale\(\)\) \* WHEEL_GAIN\) \/ MUSIC\.pitch\)/);
  assert.match(gallery, /focusContent\(\); select\(k, grid\.sel, false\);/);
  // the viewer's hints stand still through a change: over the wipe, and not in its capture
  assert.doesNotMatch(gallery, /bandInto/);
  const css = source("style.css");
  assert.match(css, /\.gl-viewer-band \{ position: absolute; inset: 0; pointer-events: none; z-index: 2; \}/);
  assert.match(css, /\.logrec\.sel \{ text-shadow: 0 0 5px rgba\(112, 255, 255, \.95\)/, "the log's line glows as a choice's row does");
  assert.doesNotMatch(css, /\.logrec\.sel \{ background/);
});

test("The title's rows take the pointer only once they have fully come up; the keys act from the end of the black as before", () => {
  const ui = source("js/ui.js");
  const title = ui.slice(ui.indexOf("  titleMenu({ fromGallery = false } = {}) {"), ui.indexOf("  // Config or Load is opening over the title"));
  assert.match(title, /ready: \(\) => ready\(\) && shown\[k\] >= 1,/);
  assert.match(title, /shown\[i\] = titleRowAlpha\(third, menu, i, mainBtns\.length\);/);
  assert.match(title, /b\.el\.style\.pointerEvents = shown\[i\] >= 1 \? "" : "none";/);
  assert.match(title, /if \(!ready\(\)\) return true;\n\s+if \(e\.key\.startsWith\("Arrow"\)\) logo\.snap\(\);/, "the keys are not held back by it");
});

test("The gallery opens from the title on the game's own fade, without the stop the game makes after it, its thumbnail sheet read ahead", async () => {
  const { GALLERY_OPEN, TITLE_MENU } = await import("../../web/app/js/uifx.js");
  assert.equal(Math.round(TITLE_MENU.to / TITLE_MENU.rate), 60, "the fade's frames, as the game's");
  assert.equal(GALLERY_OPEN.hold, 0.35, "the game's loading stop, kept as a number only");
  const ui = source("js/ui.js");
  assert.match(ui, /this\.fadeBlack\(black2, TITLE_MENU\.to, TITLE_MENU\.rate, start\(\(\) => this\.env\.gallery\(undefined, \{ fromTitle: true \}\)\)\);/);
  assert.doesNotMatch(ui, /GALLERY_OPEN\.hold \* 60|GALLERY_QUICK/, "neither the stop nor a quicker fade");
  assert.match(ui, /this\.env\.preloadGallery\?\.\(\);/);
  assert.match(source("js/gallery.js"), /export function preloadGallery\(\) \{\n  if \(openGallery\.atlas \|\| typeof Image === "undefined"\) return;/);
});

test("The menu's header names the music playing, left of the scene name and never over it", async () => {
  const { UI, NOW_PLAYING: N } = await import("../../web/app/js/ui.js");
  const had = globalThis.document;
  const el = (tag) => ({ tag, style: {}, children: [], className: "", textContent: "", offsetWidth: 0, append(...c) { this.children.push(...c); }, setAttribute(k, v) { this[k] = v; } });
  globalThis.document = { createElement: el };
  try {
    const tracks = [{ title: "Moon Princess: re", music: 1, also: [2] }, { title: "Moonlight: re", music: 2, also: [] }, { title: "", music: 9 }];
    const run = ({ n = 1, playing = true, scene = "1st day", sceneWidth = 227 } = {}) => {
      const ui = Object.assign(Object.create(UI.prototype), { audio: { bgmState: n === null ? null : { n }, bgm: playing ? {} : null }, vm: { gallery: { music: tracks } } });
      const page = el("div"), s = el("div");
      s.textContent = scene;
      // the probe the scene name is wrapped in reports the text's width
      const create = globalThis.document.createElement;
      globalThis.document.createElement = (t) => Object.assign(create(t), t === "span" ? { offsetWidth: sceneWidth } : {});
      ui.nowPlaying(page, s);
      globalThis.document.createElement = create;
      const box = page.children[0];
      if (!box) return null;
      const [left, width] = /left:(\d+)px;width:(\d+)px;/.exec(box.style.cssText).slice(1).map(Number);
      return { left, right: left + width, title: box.children[1].textContent, cls: [box.className, box.children[0].className, box.children[1].className] };
    };
    const a = run();
    assert.deepEqual(a.cls, ["nowplaying", "np-disc", "np-title"]);
    assert.equal(a.title, "Moon Princess: re");
    assert.equal(a.left, N.left);
    assert.equal(a.right, N.sceneRight - 227 - N.gap, "48 px short of the scene name");
    assert.equal(run({ n: 2 }).title, "Moonlight: re", "a track's own number before another's second one");
    assert.equal(run({ scene: "", sceneWidth: 0 }).right, N.note - N.gap, "no scene name: short of the band's Note.");
    assert.equal(run({ sceneWidth: 900 }).right, N.sceneRight - N.sceneWidth - N.gap, "the scene name's box is 420 wide at most");
    assert.ok(run({ sceneWidth: 900 }).right - N.left >= N.least, "room even beside the widest scene name");
    assert.equal(run({ playing: false }), null, "the music has ended: nothing");
    assert.equal(run({ n: null }), null);
    assert.equal(run({ n: 77 }), null, "a number the Music Player does not list");
    assert.equal(run({ n: 9 }), null, "no title");
  } finally { globalThis.document = had; }
  // "Audio Track" stands over the title as "Note." over the scene name, drawn to that label's measures
  const { NOTE_LABEL } = await import("../../web/app/js/ui.js");
  assert.deepEqual([N.label, N.inset], ["Audio Track", 19]);
  assert.deepEqual([NOTE_LABEL.cap, NOTE_LABEL.width, NOTE_LABEL.base, NOTE_LABEL.stem, NOTE_LABEL.word], [13, 43, 26, 2, "Note."]);
  const src = source("js/ui.js");
  assert.match(src, /label\.el\.style\.left = `\$\{right - N\.inset - label\.width \+ label\.pad\}px`;/);
  assert.match(src, /const size = \(T\.cap \/ \(probe\.measureText\("N"\)\.actualBoundingBoxAscent \|\| 72\)\) \* 100;/);
  const css = source("style.css");
  assert.match(css, /\.np-title \{ flex: 0 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;/, "a long title is cut, not run on");
  assert.match(css, /\.np-turn \{ transform: scale\(1\.3\); animation: npturn 2s linear infinite; \}/);
  assert.match(css, /\.np-turn, \.np-hole \{ transform-origin: 43px 43\.5px; \}/, "turning about the knob's own centre");
});

test("Chapter titles are written out, one line each, from what the two picture sheets say (the menu's header and the flowchart)", async () => {
  const { menuChapter, flowChapter, chapterLine, chapterNamed } = await import("../../web/app/js/chapters.js");
  const system = JSON.parse(readFileSync(new URL("../../web/assets/system.json", import.meta.url), "utf8"));
  const chart = JSON.parse(readFileSync(new URL("../../web/assets/flowchart.json", import.meta.url), "utf8"));
  // the header: F023 picks a cell of system_phasetitle_ja
  const cells = system.saves.phaseCells;
  assert.equal(menuChapter(cells[0]), null, "no chapter yet");
  assert.deepEqual(menuChapter(cells[1]), { day: null, name: "Prologue", struck: false });
  assert.deepEqual(menuChapter(cells[3]), { day: 1, name: "Morning of Homecoming I", struck: false });
  assert.deepEqual(menuChapter(cells[18]), { day: 8, name: "Eyes of Death Perception II", struck: false });
  assert.deepEqual(menuChapter(cells[26]), { day: 11, name: "Epilogue.", struck: true });
  assert.deepEqual(menuChapter(cells[36]), { day: 15, name: "Daylight Blue", struck: false });
  for (const c of cells) if (c[2] - c[0] > 1) assert.ok(menuChapter(c), `a name for the cell at ${c[0]}, ${c[1]}`);
  // the flowchart: a part's phase picks a cell of flow_phasetitle
  const lines = chart.phaseRects.map((r) => chapterLine(flowChapter(r)));
  assert.equal(lines.length, 29);
  assert.deepEqual([lines[0], lines[2], lines[20], lines[21], lines[28]], ["0 / Glass Moon", "2 / Day that Wasn't", "12 / Night of Ill-Omen", "12 / Vermillion Vestiges II", "Prologue"]);
  assert.equal(new Set(lines).size, 29, "each cell its own chapter");
  // the two sheets name the same chapters
  const menuNames = new Set(cells.map(menuChapter).filter(Boolean).map((c) => c.name));
  for (const r of chart.phaseRects) { const c = flowChapter(r); assert.ok(menuNames.has(c.name), c.name); assert.deepEqual(chapterNamed(c.name), c); }
  // the save rows' chapters too, by the same number (savetitle's table runs as the header's does)
  for (let i = 0; i < 38; i++) assert.equal(system.saves.saveTitleCells[i][2] - system.saves.saveTitleCells[i][0] > 1, !!menuChapter(cells[i]), `entry ${i}`);
  const ui = source("js/ui.js");
  assert.match(ui, /chapter = menuChapter\(T\.phaseCells\[Math\.max\(0, Math\.min\(37, f23\(rec\)\)\)\]\);/);
  assert.doesNotMatch(ui, /SAVE_TITLES|saveTitleCells/);
  assert.doesNotMatch(source("style.css"), /savetitle\.webp/);
  // drawn as text: no cell of either picture any more
  assert.doesNotMatch(source("js/ui.js"), /"system_phasetitle_ja"/);
  assert.doesNotMatch(source("js/flowchart.js"), /"flow_phasetitle"/);
  const css = source("style.css");
  assert.match(css, /\.chapter \{ position: absolute; left: 20px; top: 0; height: 84px; display: flex; align-items: center; white-space: nowrap;/);
  assert.match(css, /\.fc-chapter \{[^}]*text-align: right; white-space: nowrap;[^}]*\n\s+font: 400 25px\/32px/, "the flowchart's, larger than the picture's 17 px");
});

test("128: the hint bars name keys and the mouse, and every screen's entries have them", async () => {
  const { HINTS } = await import("../../web/app/js/ui.js");
  const used = new Set();
  for (const file of ["js/ui.js", "js/gallery.js", "js/flowchart.js"]) {
    const src = source(file);
    for (const m of src.matchAll(/helpBar\([^,]+, (?:C\.page === 2 \? )?(\[[^\]]+\])(?: : (\[[^\]]+\]))?/g)) for (const list of [m[1], m[2]]) if (list) for (const l of JSON.parse(list)) used.add(l);
    for (const m of src.matchAll(/HELP = \{ 0: (\[[^\]]+\]), 10: (\[[^\]]+\]) \}/g)) for (const list of [m[1], m[2]]) for (const l of JSON.parse(list)) used.add(l);
  }
  assert.ok(used.size >= 8, [...used].join(", "));
  for (const label of used) assert.ok(HINTS[label]?.length, `no keys for "${label}"`);
  assert.deepEqual(HINTS.Back, ["Esc", "Right click"]);
  assert.deepEqual(HINTS.Choose, ["Enter", "Click"]);
  const ui = source("js/ui.js");
  assert.doesNotMatch(ui, /help_key|help_txt_ja|conf_manual0_ja", CONFIG/, "the controller's glyphs and its Controls picture are not drawn");
});

test("130: the story screen under a mouse: the wheel is one step a turn, the middle button hides the text, any click shows it again, the pointer rests out of sight", () => {
  const main = source("js/main.js");
  assert.match(main, /const WHEEL = \{ notch: 50, pause: 200, gap: 150, after: 400 \};/);
  assert.match(main, /if \(ui\.open \|\| !vm\.running \|\| vm\.locked\) \{ wheelAt = e\.timeStamp; wheelUsed = true; wheelHold = e\.timeStamp \+ WHEEL\.after; return; \}/);
  assert.match(main, /stage\.addEventListener\("auxclick", \(e\) => \{ if \(e\.button === 1\) \{ e\.preventDefault\(\); hideText\(\); \} \}\);/);
  assert.match(main, /if \(showText\(\)\) return;\n  vm\.press\(\);/);
  assert.match(main, /if \(showText\(\)\) return;\n  if \(vm\.running && !vm\.locked && !moviesDone\) systemMenu\(\);/, "a right click with the text hidden shows it first");
  assert.match(main, /stage\.classList\.add\("idle"\)/);
  assert.match(source("style.css"), /#stage\.idle, #stage\.idle \* \{ cursor: none !important; \}/);
});
