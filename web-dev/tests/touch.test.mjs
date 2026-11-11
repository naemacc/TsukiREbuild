// Playing by touch (web/app/js/touch.js, touch.css and the screens' hooks behind ui.touch): which devices get it, the stage in
// the safe area, the story's gestures, the frame gate and the game held in portrait, the Back button, the control panel, the
// press and two-tap rules, and that a device with a mouse is left exactly as it was.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { TOUCH, TOUCH_HINTS, TOUCH_CONTROLS, FrameGate, StoryTouch, backX, barPlace, installTouch, pinch, stageFit, touchFirst } = await import("../../web/app/js/touch.js");
const { UI, HINTS, QUICK_BAR } = await import("../../web/app/js/ui.js");
const { KeyMap } = await import("../../web/app/js/keys.js");
const source = (name) => readFileSync(new URL(`../../web/app/${name}`, import.meta.url), "utf8");
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const store = () => ({ data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = String(v); } });

// ---- which devices ---------------------------------------------------------------------------------------------------
const media = (matches, search = "") => ({ location: { search }, matchMedia: (q) => ({ matches: matches(q) }) });

test("touch-first is a coarse first pointer that cannot hover; the address can force it either way", () => {
  assert.equal(TOUCH.query, "(hover: none) and (pointer: coarse)");
  assert.equal(touchFirst(media((q) => q === TOUCH.query)), true, "a phone or a tablet");
  assert.equal(touchFirst(media(() => false)), false, "a mouse: a desktop, however narrow its window; a laptop with a touch screen");
  assert.equal(touchFirst(media(() => false, "?touch=1")), true);
  assert.equal(touchFirst(media(() => true, "?touch=0&mute")), false);
  assert.equal(touchFirst(media(() => true, "?touch")), true);
  assert.equal(touchFirst({ location: { search: "" } }), false, "no media queries: not touch");
  assert.equal(touchFirst({ location: { search: "" }, matchMedia() { throw Error("no"); } }), false);
});

test("a device with a mouse gets nothing of it: no class, no listeners, no gate, and the screens are not asked", () => {
  const added = [];
  const win = { ...media(() => false), addEventListener: (t) => added.push(t), requestAnimationFrame() {}, cancelAnimationFrame() {} };
  const raf = win.requestAnimationFrame;
  const doc = { documentElement: { classList: { add: (c) => added.push(`class ${c}`) } }, createElement() { throw Error("nothing is built"); } };
  const t = installTouch({ win, doc });
  assert.deepEqual([t.on, t.held], [false, false]);
  assert.deepEqual(added, []);
  assert.equal(win.requestAnimationFrame, raf);
  assert.equal(t.storyClick({}), false);
  t.bind({}); t.place({});
  const main = source("js/main.js");
  assert.match(main, /const touch = installTouch\(\);\n/);
  assert.match(main, /ui\.touch = touch\.on \? touch : null;/);
  assert.match(main, /function fitStage\(\) \{\n  if \(touch\.on\) \{ touch\.place\(stage\); return; \}\n  const k = Math\.min\(innerWidth \/ 1920, innerHeight \/ 1080\);/);
  // its listeners are added before any of the page's own: the touch ring's is the first of those
  assert.ok(main.indexOf("const touch = installTouch();") < main.indexOf("const touchFx = new TouchFx("));
});

test("every rule of touch.css hangs on html.touch or on a class only a touch device's screens are given", () => {
  const css = source("touch.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const own = /^(#touch-safe|#rotate|#touch-back|#touch-hint|\.rt-|\.th-|\.tp-|\.qname|\.qbtn\.r0 \.qname|\.modepanel\.(tp|wl) |\.touchnote)/;
  let rules = 0;
  for (const m of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    for (const sel of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
      rules++;
      assert.ok(sel.startsWith("html.touch") || own.test(sel), `"${sel}" would reach a desktop page`);
    }
  }
  assert.ok(rules > 60);
  // the classes those rules name are given only with ui.touch
  const ui = source("js/ui.js");
  assert.match(ui, /el\.className = TB \? "modepanel tp" : "modepanel";/);
  assert.match(ui, /const TB = this\.touch \? TOUCH\.bar : null;/);
  assert.match(source("js/welcome.js"), /bar\.className = T \? "modepanel wl" : "modepanel";/);
  const html = source("index.html");
  assert.match(html, /<link rel="stylesheet" href="style\.css">\n<link rel="stylesheet" href="touch\.css">/);
  assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">/);
});

// ---- the stage in the window -----------------------------------------------------------------------------------------
test("the stage is fitted inside the safe area and centred in the window where that keeps it clear", () => {
  let f = stageFit(844, 390);
  near(f.k, 390 / 1080);
  near(f.x, (844 - 1920 * f.k) / 2);
  assert.equal(f.y, 0);
  // a notch at each end and a home bar: smaller, still centred, standing on the bar's edge
  f = stageFit(844, 390, { left: 47, right: 47, bottom: 21 });
  near(f.k, 369 / 1080);
  near(f.x, (844 - 1920 * f.k) / 2);
  assert.equal(f.y, 0);
  near(f.y + 1080 * f.k, 369);
  // a notch at one end only: the picture stays in the middle while it clears the notch
  f = stageFit(844, 390, { left: 44 });
  near(f.k, 390 / 1080);
  near(f.x, (844 - 1920 * f.k) / 2);
  assert.ok(f.x >= 44);
  // ... and moves over when it would not
  f = stageFit(700, 390, { left: 44 });
  near(f.k, 656 / 1920);
  assert.equal(f.x, 44);
  near(f.y, (390 - 1080 * f.k) / 2);
  // a tablet: bars above and below
  f = stageFit(1024, 768);
  near(f.k, 1024 / 1920);
  assert.equal(f.x, 0);
  near(f.y, (768 - 576) / 2);
  // never nothing
  assert.ok(stageFit(0, 0).k > 0);
});

// ---- the story's gestures --------------------------------------------------------------------------------------------
test("a touch on the story is read as a tap, a swipe, a hold or two fingers", () => {
  const T = TOUCH, g = new StoryTouch();
  // a tap, wandering less than the slop
  g.down(1, 100, 100, 0);
  assert.equal(g.move(1, 100 + T.slop - 1, 100), null);
  assert.equal(g.up(1, 80), "tap");
  assert.equal(g.busy, false);
  // wandering further without swiping is nothing
  g.down(1, 100, 100, 0);
  assert.equal(g.move(1, 100, 100 + T.slop + 2), null);
  assert.equal(g.up(1, 80), null);
  // the four swipes, once each, by the larger of the two distances; the lift after one is nothing
  for (const [dx, dy, dir] of [[0, T.swipe, "down"], [0, -T.swipe, "up"], [T.swipe, 10, "right"], [-T.swipe, -10, "left"], [30, 40, "down"]]) {
    g.down(1, 200, 200, 0);
    assert.equal(g.move(1, 200 + dx / 2, 200 + dy / 2), null, "not yet");
    assert.equal(g.move(1, 200 + dx, 200 + dy), dir);
    assert.equal(g.move(1, 200 + 2 * dx, 200 + 2 * dy), null, "said once");
    assert.equal(g.held(5000), false, "a swipe is not a hold");
    assert.equal(g.up(1, 300), null);
  }
  // held still: fast forward from T.hold on, until the finger goes
  g.down(1, 300, 300, 1000);
  assert.equal(g.held(1000 + T.hold - 1), false);
  assert.equal(g.held(1000 + T.hold), true);
  assert.equal(g.held(1000 + T.hold + 50), false, "said once");
  assert.equal(g.move(1, 300, 300 + 3 * T.swipe), null, "moving while it runs is no swipe");
  g.down(2, 500, 300, 1600);
  assert.equal(g.up(2, 1700), null, "a second finger changes nothing");
  assert.equal(g.up(1, 2000), "hold-end");
  assert.equal(g.busy, false);
  // a press that has moved does not become a hold
  g.down(1, 300, 300, 0);
  g.move(1, 300 + T.slop + 1, 300);
  assert.equal(g.held(T.hold + 100), false);
  assert.equal(g.up(1, 900), null);
  // two fingers down together and up again: hide the text
  g.down(1, 300, 300, 0);
  g.down(2, 500, 300, 40);
  assert.equal(g.held(T.hold), false, "two fingers are not a hold");
  assert.equal(g.up(1, 120), null, "until both are up");
  assert.equal(g.up(2, 130), "two");
  // the second too late, a third, or one of them sliding: nothing
  g.down(1, 300, 300, 0); g.down(2, 500, 300, T.two + 1);
  assert.equal(g.up(1, 500), null); assert.equal(g.up(2, 500), null);
  g.down(1, 300, 300, 0); g.down(2, 500, 300, 10); g.down(3, 700, 300, 20);
  assert.deepEqual([g.up(1, 90), g.up(2, 90), g.up(3, 90)], [null, null, null]);
  g.down(1, 300, 300, 0); g.down(2, 500, 300, 10); g.move(2, 500, 300 + T.slop + 1);
  assert.deepEqual([g.up(1, 90), g.up(2, 90)], [null, null]);
  // the browser taking the touch away ends a hold
  g.down(1, 300, 300, 0);
  g.held(T.hold);
  assert.equal(g.cancel(), "hold-end");
  assert.equal(g.cancel(), null);
  // a finger the reader does not know is nothing
  assert.equal(g.up(9, 0), null);
  assert.equal(g.move(9, 0, 0), null);
});

test("two fingers on a picture: how much larger, about the point between them", () => {
  const z = pinch([100, 100], [200, 100], [50, 100], [250, 100]);
  assert.equal(z.ratio, 2);
  assert.deepEqual(z.at, [150, 100]);
  assert.equal(pinch([0, 0], [0, 0], [10, 0], [20, 0]).ratio, 1, "two fingers on one point: no change");
  near(pinch([0, 0], [30, 40], [0, 0], [15, 20]).ratio, 0.5);
});

// ---- the frame gate --------------------------------------------------------------------------------------------------
test("the frame gate keeps frames asked for while held and asks for them again after; cancelling works on both sides", () => {
  const asked = [], cancelled = [];
  const win = { requestAnimationFrame(fn) { asked.push(fn); return asked.length; }, cancelAnimationFrame(id) { cancelled.push(id); } };
  const gate = new FrameGate(win);
  const a = () => {}, b = () => {}, c = () => {};
  assert.equal(win.requestAnimationFrame(a), 1);
  assert.deepEqual(asked, [a]);
  gate.hold(true);
  const idB = win.requestAnimationFrame(b), idC = win.requestAnimationFrame(c);
  assert.ok(idB < 0 && idC < 0 && idB !== idC);
  assert.deepEqual(asked, [a], "nothing reaches the browser while held");
  win.cancelAnimationFrame(idC);
  win.cancelAnimationFrame(1);
  assert.deepEqual(cancelled, [1]);
  gate.hold(true);
  gate.hold(false);
  assert.deepEqual(asked, [a, b], "what was kept is asked for, what was cancelled is not");
  gate.hold(false);
  assert.deepEqual(asked, [a, b]);
  win.requestAnimationFrame(c);
  assert.deepEqual(asked, [a, b, c]);
});

// ---- a touch device, end to end with a small window -------------------------------------------------------------------
// A window and a document with what installTouch touches: listeners by type, timers and frames stepped by hand.
function rig({ w = 844, h = 390, search = "", learnt = false } = {}) {
  class El {
    constructor(tag = "div") { this.tagName = tag.toUpperCase(); this.children = []; this.parent = null; this.style = {}; this.listeners = {}; this.cls = new Set(); this.attrs = {}; this.id = ""; }
    get classList() { const s = this.cls; return { add: (c) => s.add(c), remove: (c) => s.delete(c), toggle: (c, on = !s.has(c)) => { if (on) s.add(c); else s.delete(c); return on; }, contains: (c) => s.has(c) }; }
    append(...cs) { for (const c of cs) { c.parent = this; this.children.push(c); } }
    set innerHTML(t) { this.html = t; this.children = [new El()]; }
    get firstChild() { return this.children[0]; }
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
    setAttribute(k, v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k] ?? null; }
    get isConnected() { return true; }
    closest(sel) { for (let e = this; e; e = e.parent) if (sel.split(",").some((s) => { s = s.trim(); return s.startsWith("#") ? e.id === s.slice(1) : e.cls.has(s.slice(1)); })) return e; return null; }
    getBoundingClientRect() { return { left: 75, top: 0, width: 694, height: 390 }; }
    fire(t, e = {}) { for (const f of this.listeners[t] || []) f({ stopPropagation() {}, preventDefault() {}, target: this, ...e }); }
  }
  const stage = new El(), html = new El("html"), body = new El("body"), listeners = {}, docListeners = {};
  stage.id = "stage";
  let clock = 0, timers = [], frames = [], dialogStory = false, systemDialog = false, viewer = false;
  const video = Object.assign(new El("video"), { paused: false, pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); } });
  video.setAttribute("src", "/assets/movie/x.mp4");
  const win = {
    location: { search }, innerWidth: w, innerHeight: h, localStorage: store(), performance: { now: () => clock }, screen: {},
    matchMedia: (q) => ({ matches: q === TOUCH.query }),
    addEventListener(t, f, o) { (listeners[t] ||= []).push(f); },
    getComputedStyle: () => ({ paddingTop: "0px", paddingRight: "0px", paddingBottom: "0px", paddingLeft: "0px" }),
    setTimeout(f, ms) { timers.push({ f, at: clock + ms }); return timers.length; },
    clearTimeout(id) { if (timers[id - 1]) timers[id - 1].f = null; },
    requestAnimationFrame(f) { frames.push(f); return frames.length; },
    cancelAnimationFrame() {},
  };
  if (learnt) win.localStorage.setItem(TOUCH.hint.key, "1");
  const doc = {
    documentElement: html, body, hidden: false, fullscreenElement: null,
    createElement: (t) => new El(t), getElementById: (id) => (id === "stage" ? stage : null),
    querySelector: (sel) => (sel === ".gl-viewer" ? (viewer ? {} : null) : sel.includes(".dialog.story") ? (dialogStory ? {} : null) : sel.includes(".dialog:not(.notice)") ? (systemDialog ? {} : null) : null),
    querySelectorAll: (sel) => (sel === "video" ? [video] : []),
    addEventListener(t, f) { (docListeners[t] ||= []).push(f); },
  };
  const calls = [];
  const ui = {
    screen: null, backFn: null, panelOpen: false, get open() { return this.screen !== null; },
    env: { canPanel: () => true }, sound: (n) => calls.push(`sound ${n}`),
    openPanel(k) { this.panelOpen = true; calls.push(`panel ${k}`); }, closePanel() { this.panelOpen = false; calls.push("close"); }, back() { calls.push("back"); },
  };
  const vm = { running: true, autoUntil: 0, autoTimer: 7, holdClocks: (why, on) => calls.push(`clocks ${why} ${on}`), armAuto: (left) => calls.push(`auto ${left}`) };
  const audio = { ctx: { state: "running", suspend() { this.state = "suspended"; calls.push("suspend"); }, resume() { this.state = "running"; calls.push("resume"); } }, start: () => calls.push("start") };
  let choosing = false, movie = false;
  const act = { fast: (on) => calls.push(`fast ${on}`), log: () => calls.push("log"), hide: () => calls.push("hide"), choosing: () => choosing, movie: () => movie, refit: () => calls.push("refit") };
  const fire = (t, e = {}) => {
    const ev = { type: t, pointerType: "touch", isPrimary: true, target: stage, timeStamp: clock, cancelable: true, stopped: false, prevented: false,
      stopImmediatePropagation() { this.stopped = true; }, stopPropagation() {}, preventDefault() { this.prevented = true; }, ...e };
    for (const f of listeners[t] || []) { f(ev); if (ev.stopped) break; }
    return ev;
  };
  return {
    win, doc, stage, html, body, ui, vm, audio, act, calls, video, fire, El,
    set choosing(v) { choosing = v; }, set movie(v) { movie = v; }, set dialogStory(v) { dialogStory = v; }, set systemDialog(v) { systemDialog = v; }, set viewer(v) { viewer = v; },
    advance(ms) { clock += ms; for (const t of timers) if (t.f && t.at <= clock) { const f = t.f; t.f = null; f(); } },
    frame(n = 1) { for (let k = 0; k < n; k++) { clock += 1000 / 60; const fs = frames; frames = []; for (const f of fs) f(clock); } },
    resize(nw, nh) { win.innerWidth = nw; win.innerHeight = nh; fire("resize"); },
    fireDoc(t, e) { for (const f of docListeners[t] || []) f(e); },
    byId: (id) => stage.children.find((c) => c.id === id),
  };
}
const tapAt = (r, target = r.stage, x = 400, y = 200) => {
  r.fire("pointerdown", { pointerId: 1, clientX: x, clientY: y, target });
  r.advance(60);
  r.fire("pointerup", { pointerId: 1, clientX: x, clientY: y, target });
  return r.fire("click", { clientX: x, clientY: y, target });
};
const swipeBy = (r, dx, dy, target = r.stage) => {
  r.fire("pointerdown", { pointerId: 1, clientX: 400, clientY: 200, target });
  r.advance(30);
  r.fire("pointermove", { pointerId: 1, clientX: 400 + dx, clientY: 200 + dy, target });
  r.advance(30);
  r.fire("pointerup", { pointerId: 1, clientX: 400 + dx, clientY: 200 + dy, target });
};

test("on the story a swipe down brings the control panel, a swipe up the log (or sends the panel up), and the click after either is passed over", () => {
  const r = rig();
  const touch = installTouch({ win: r.win, doc: r.doc });
  assert.equal(touch.on, true);
  assert.ok(r.html.cls.has("touch"));
  touch.bind({ ui: r.ui, vm: r.vm, audio: r.audio, act: r.act });
  assert.equal(r.ui.touch, touch);
  r.calls.length = 0;
  swipeBy(r, 0, TOUCH.swipe + 5);
  assert.deepEqual(r.calls.filter((c) => c !== "start"), ["panel true"]);
  let click = r.fire("click", { clientX: 400, clientY: 250 });
  assert.equal(click.stopped, true, "the click a browser may still make after the swipe does nothing");
  click = r.fire("click", { clientX: 400, clientY: 250 });
  assert.equal(click.stopped, false, "the next one is a click again");
  // the tap that sends the panel up does not also advance the story
  assert.equal(touch.storyClick({ clientY: 300 }), true);
  r.ui.panelOpen = false;
  r.fire("click", { clientX: 400, clientY: 300 });
  assert.equal(touch.storyClick({ clientY: 300 }), false, "with the panel up already, a tap is the story's");
  // up: the panel goes, with the cancel sound; without the panel, the log
  r.advance(1000);
  r.ui.panelOpen = true; r.calls.length = 0;
  swipeBy(r, 0, -TOUCH.swipe - 5);
  assert.deepEqual(r.calls.filter((c) => c !== "start"), ["sound 2", "close"]);
  r.advance(1000); r.calls.length = 0;
  swipeBy(r, 0, -TOUCH.swipe - 5);
  assert.deepEqual(r.calls.filter((c) => c !== "start"), ["log"]);
  // at a choice there is no log, but the panel still comes
  r.advance(1000); r.calls.length = 0; r.choosing = true;
  swipeBy(r, 0, -TOUCH.swipe - 5);
  r.advance(1000);
  swipeBy(r, 0, TOUCH.swipe + 5);
  assert.deepEqual(r.calls.filter((c) => c !== "start"), ["panel true"]);
  // sideways is nothing; neither is a swipe over a screen, or during a movie
  r.advance(1000); r.calls.length = 0; r.choosing = false; r.ui.panelOpen = false;
  swipeBy(r, TOUCH.swipe + 5, 0);
  r.ui.screen = "system"; swipeBy(r, 0, TOUCH.swipe + 5); r.ui.screen = null;
  r.movie = true; swipeBy(r, 0, TOUCH.swipe + 5); r.movie = false;
  assert.deepEqual(r.calls.filter((c) => c !== "start"), []);
});

test("a tap at the top of the story's picture brings the panel; anywhere else it is the story's", () => {
  const r = rig();
  const touch = installTouch({ win: r.win, doc: r.doc });
  touch.bind({ ui: r.ui, vm: r.vm, audio: r.audio, act: r.act });
  r.calls.length = 0;
  const yOf = (stageY) => (stageY * 390) / 1080;   // the rig's stage is 390 px high from the window's top
  r.fire("click", { clientY: yOf(40) });
  assert.equal(touch.storyClick({ clientY: yOf(40) }), true);
  assert.deepEqual(r.calls, ["panel true"]);
  r.ui.panelOpen = false; r.calls.length = 0;
  r.fire("click", { clientY: yOf(TOUCH.topZone + 5) });
  assert.equal(touch.storyClick({ clientY: yOf(TOUCH.topZone + 5) }), false);
  r.choosing = true;
  assert.equal(touch.storyClick({ clientY: yOf(40) }), false, "a choice's rows have the screen");
  r.choosing = false; r.movie = true;
  assert.equal(touch.storyClick({ clientY: yOf(40) }), false, "a movie has the tap");
  r.movie = false; r.ui.env.canPanel = () => false;
  assert.equal(touch.storyClick({ clientY: yOf(40) }), false, "locked (XSTP)");
  assert.deepEqual(r.calls, []);
  const main = source("js/main.js");
  assert.match(main, /stage\.addEventListener\("click", \(e\) => \{\n  audio\.start\(\);\n  if \(touch\.storyClick\(e\)\) return;/);
  assert.match(main, /addEventListener\("mousemove", \(e\) => \{\n  if \(touch\.on\) return;/, "a tap's own mouse events are not a mouse at the top");
});

test("a finger held on the picture fast forwards while it stays; two fingers hide the text; neither leaves a click behind", () => {
  const r = rig();
  const touch = installTouch({ win: r.win, doc: r.doc });
  touch.bind({ ui: r.ui, vm: r.vm, audio: r.audio, act: r.act });
  r.calls.length = 0;
  r.fire("pointerdown", { pointerId: 1, clientX: 400, clientY: 200 });
  r.advance(TOUCH.hold - 40);
  assert.deepEqual(r.calls, []);
  r.advance(60);
  assert.deepEqual(r.calls, ["fast true"]);
  r.advance(2000);
  r.fire("pointerup", { pointerId: 1, clientX: 400, clientY: 200 });
  assert.deepEqual(r.calls.filter((c) => c !== "start"), ["fast true", "fast false"]);
  assert.equal(r.fire("click", { clientX: 400, clientY: 200 }).stopped, true, "letting go does not advance the text");
  // a short tap never starts it
  r.advance(1000); r.calls.length = 0;
  assert.equal(tapAt(r).stopped, false);
  r.advance(1000);
  assert.deepEqual(r.calls.filter((c) => c !== "start"), []);
  // not over a choice, nor on the panel
  r.choosing = true;
  r.fire("pointerdown", { pointerId: 1, clientX: 400, clientY: 200 }); r.advance(TOUCH.hold + 50); r.fire("pointerup", { pointerId: 1, clientX: 400, clientY: 200 });
  r.choosing = false; r.ui.panelOpen = true;
  r.fire("pointerdown", { pointerId: 1, clientX: 400, clientY: 200 }); r.advance(TOUCH.hold + 50); r.fire("pointerup", { pointerId: 1, clientX: 400, clientY: 200 });
  r.ui.panelOpen = false;
  assert.deepEqual(r.calls.filter((c) => c !== "start"), []);
  // two fingers
  r.advance(1000);
  r.fire("pointerdown", { pointerId: 1, clientX: 300, clientY: 200 });
  r.fire("pointerdown", { pointerId: 2, clientX: 500, clientY: 200, isPrimary: false });
  r.advance(80);
  r.fire("pointerup", { pointerId: 1, clientX: 300, clientY: 200 });
  r.fire("pointerup", { pointerId: 2, clientX: 500, clientY: 200, isPrimary: false });
  assert.deepEqual(r.calls.filter((c) => c !== "start"), ["hide"]);
  r.advance(TOUCH.hold + 100);
  assert.deepEqual(r.calls.filter((c) => c !== "start"), ["hide"], "and no fast forward from the first of them");
  // the browser taking the touch away ends fast forward too
  r.advance(1000); r.calls.length = 0;
  r.fire("pointerdown", { pointerId: 1, clientX: 400, clientY: 200 }); r.advance(TOUCH.hold + 50);
  r.fire("pointercancel", { pointerId: 1 });
  assert.deepEqual(r.calls.filter((c) => c !== "start"), ["fast true", "fast false"]);
});

test("a long press's menu event never reaches the game from a finger (a mouse's right click still does); sound starts as a touch ends", () => {
  const r = rig();
  const touch = installTouch({ win: r.win, doc: r.doc });
  touch.bind({ ui: r.ui, vm: r.vm, audio: r.audio, act: r.act });
  r.fire("pointerdown", { pointerId: 1, clientX: 400, clientY: 200 });
  let menu = r.fire("contextmenu");
  assert.deepEqual([menu.stopped, menu.prevented], [true, true]);
  r.fire("pointerup", { pointerId: 1 });
  r.fire("pointerdown", { pointerId: 5, pointerType: "mouse" });
  menu = r.fire("contextmenu");
  assert.deepEqual([menu.stopped, menu.prevented], [false, false]);
  r.calls.length = 0;
  r.fire("touchend");
  assert.deepEqual(r.calls, ["start"], "a touch gives the page its activation as it ends");
});

test("in portrait the rotate screen is up and the game is held: clocks, sound, movies, the auto wait and every frame; it all goes on when the device is turned", () => {
  const r = rig();
  const touch = installTouch({ win: r.win, doc: r.doc });
  touch.bind({ ui: r.ui, vm: r.vm, audio: r.audio, act: r.act });
  const rotate = r.body.children.find((c) => c.id === "rotate");
  assert.ok(rotate && /rotate your device/.test(rotate.html));
  assert.equal(touch.held, false);
  let frames = 0;
  const loop = () => { frames++; r.win.requestAnimationFrame(loop); };
  r.win.requestAnimationFrame(loop);
  r.frame(3);
  assert.equal(frames, 3);
  r.vm.autoUntil = r.win.performance.now() + 1500;
  r.calls.length = 0;
  r.resize(390, 844);
  assert.equal(touch.held, true);
  assert.ok(r.html.cls.has("turn"));
  assert.deepEqual(r.calls.filter((c) => c !== "refit"), ["fast false", "suspend", "clocks rotate true"]);
  assert.equal(r.video.paused, true);
  assert.equal(r.vm.autoUntil, 0);
  r.frame(10);
  assert.equal(frames, 4, "the frame already asked for runs; no other does");
  // nothing reaches the game while it is up
  for (const t of ["pointerdown", "pointerup", "click", "keydown", "touchend", "wheel"]) assert.equal(r.fire(t, { pointerId: 1 }).stopped, true, t);
  assert.equal(r.audio.ctx.state, "suspended", "a tap under it does not start the sound again");
  // a movie started under it waits
  const other = Object.assign(new r.El("video"), { paused: false, pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); } });
  other.setAttribute("src", "/assets/movie/TM_CI.mp4");
  r.fireDoc("play", { target: other });
  assert.equal(other.paused, true);
  // turned back
  r.calls.length = 0;
  r.advance(3000);
  r.resize(844, 390);
  assert.equal(touch.held, false);
  assert.equal(r.html.cls.has("turn"), false);
  assert.deepEqual(r.calls.filter((c) => c !== "refit"), ["clocks rotate false", "auto 1500", "resume"]);
  assert.deepEqual([r.video.paused, other.paused], [false, false]);
  r.frame(2);
  assert.equal(frames, 6);
  assert.equal(r.fire("click").stopped, false);
  // a page opened in portrait is held from the start, and the game's parts as soon as they exist
  const p = rig({ w: 390, h: 844 });
  const t2 = installTouch({ win: p.win, doc: p.doc });
  assert.equal(t2.held, true);
  t2.bind({ ui: p.ui, vm: p.vm, audio: p.audio, act: p.act });
  assert.ok(p.calls.includes("clocks rotate true") && p.calls.includes("suspend"));
  const main = source("js/main.js");
  assert.match(main, /else if \(!touch\.held\) audio\.ctx\.resume\(\);/, "coming back to the tab in portrait does not start the sound");
});

test("the Back button is the game's own, in touch.js only: it slides in while a screen has a Back, is its Back, and stays away from the story's questions and movies", () => {
  const B = TOUCH.back;
  assert.deepEqual([B.x, B.y, B.w, B.h, B.cells, B.rate], [1640, 952, 280, 128, [[8, 16], [8, 168]], 0.04]);
  assert.equal(backX(0), B.x + B.w);
  assert.equal(backX(1), B.x);
  near(backX(0.5), B.x + B.w / 2);
  let last = Infinity;
  for (let t = 0; t <= 1.0001; t += 0.04) { const x = backX(t); assert.ok(x <= last); last = x; }
  const r = rig({ learnt: true });
  const touch = installTouch({ win: r.win, doc: r.doc });
  touch.bind({ ui: r.ui, vm: r.vm, audio: r.audio, act: r.act });
  const back = r.byId("touch-back");
  assert.match(back.style.cssText, /left:1640px;top:952px;width:280px;height:128px;background-image:url\("\/assets\/ui\/DISP_PARTS_JA\/back_btn\.webp"\);/);
  assert.equal(back.style.backgroundPosition, "-8px -16px");
  r.frame(5);
  assert.equal(back.style.pointerEvents, "none", "the story has no Back");
  r.ui.screen = "system"; r.ui.backFn = () => {};
  r.frame(1);
  assert.equal(back.style.pointerEvents, "");
  r.frame(12);
  assert.match(back.style.transform, /^translateX\((\d+(\.\d+)?)px\)$/);
  assert.ok(parseFloat(back.style.transform.slice(11)) > 0, "on its way in after half its 25 frames");
  r.frame(15);
  assert.equal(back.style.transform, "translateX(0px)");
  assert.equal(back.style.visibility, "visible");
  r.calls.length = 0;
  back.fire("pointerdown");
  assert.equal(back.style.backgroundPosition, "-8px -168px", "lit while pressed");
  back.fire("pointerup");
  back.fire("click");
  assert.deepEqual(r.calls, ["back"]);
  // the story's own questions have no Back; a movie hides it, unless the system is asking about it (Back is then No)
  r.dialogStory = true; r.frame(1);
  assert.equal(back.style.pointerEvents, "none");
  r.dialogStory = false; r.movie = true; r.frame(1);
  assert.equal(back.style.pointerEvents, "none");
  r.systemDialog = true; r.frame(1);
  assert.equal(back.style.pointerEvents, "");
  r.systemDialog = false; r.movie = false; r.ui.backFn = null; r.frame(30);
  assert.equal(back.style.visibility, "hidden");
  // the desktop screens still have none (reverify.test.mjs, Redesign 126): the art is named here and in touch.css only
  for (const file of ["js/ui.js", "js/gallery.js", "js/flowchart.js", "js/welcome.js", "js/main.js", "style.css"]) assert.doesNotMatch(source(file), /back_btn/, file);
  assert.match(source("touch.css"), /html\.touch #touch-back \{ display: block; position: absolute; z-index: 40;/);
});

test("over a picture in the CG viewer the Back button leaves two seconds after the last touch and any touch brings it back", () => {
  assert.equal(TOUCH.viewerBack, 2000);
  const r = rig({ learnt: true });
  const touch = installTouch({ win: r.win, doc: r.doc });
  touch.bind({ ui: r.ui, vm: r.vm, audio: r.audio, act: r.act });
  const back = r.byId("touch-back");
  r.ui.screen = "gallery"; r.ui.backFn = () => {};
  r.frame(240);
  assert.equal(back.style.pointerEvents, "", "in the gallery's lists it stays, however long");
  r.viewer = true;
  r.frame(110);
  assert.equal(back.style.pointerEvents, "", "the picture has been up under two seconds");
  r.frame(20);
  assert.equal(back.style.pointerEvents, "none");
  r.frame(30);
  assert.equal(back.style.visibility, "hidden");
  r.fire("pointerdown", { pointerId: 1, clientX: 300, clientY: 200 });
  r.frame(1);
  assert.equal(back.style.pointerEvents, "", "a touch brings it back");
  r.frame(60); r.fire("pointermove", { pointerId: 1, clientX: 320, clientY: 200 }); r.frame(100);
  assert.equal(back.style.pointerEvents, "", "and it stays while the finger moves");
  r.frame(40);
  assert.equal(back.style.pointerEvents, "none");
  r.viewer = false; r.frame(1);
  assert.equal(back.style.pointerEvents, "", "back in the grid it is there again");
});

test("on a touch device: no hint bar along the bottom, larger song names, and a picture can be made four times its fitted size", () => {
  const css = source("touch.css"), g = source("js/gallery.js");
  assert.match(css, /html\.touch \.helpbar, html\.touch \.fc-help \{ display: none; \}/);
  assert.match(css, /html\.touch \.logscroll \{ height: 1080px; \}/, "the log runs to the bottom, where the bar was");
  assert.match(css, /html\.touch \.gl-track \{ font-size: 40px; letter-spacing: 2px; overflow: hidden; \}/);
  assert.deepEqual([TOUCH.music.font, TOUCH.music.least], [40, 28]);
  assert.match(g, /for \(let size = TOUCH\.music\.font; size > TOUCH\.music\.least && r\.scrollWidth > r\.clientWidth; \) r\.style\.fontSize = `\$\{--size\}px`;/, "a title too long for its row is set smaller until it fits");
  assert.equal(TOUCH.viewerZoom, 4);
  assert.match(g, /if \(ui\.touch\) max = Math\.max\(max, min \* TOUCH\.viewerZoom\);/);
  assert.doesNotMatch(source("style.css"), /\.helpbar \{[^}]*display: none/, "a mouse's screens keep theirs");
});

test("the config's System page has its words at one size on every device: the rows' names, the choices, the toggles and the samples", async () => {
  const { CONF_TEXT, SYSTEM_LABELS, SYSTEM_AREA, OPTION_SHEETS, OPTION_LOOKS, labelBase, relettered } = await import("../../web/app/js/confart.js");
  assert.equal(CONF_TEXT.size, 28);
  assert.match(source("style.css"), /\.confsample \{ position: absolute; left: 756px; font: 28px var\(--story-font\);/);
  // the eight rows, in the picture's order, none over the next, each clear of the lines between the rows
  assert.deepEqual(SYSTEM_LABELS.map((l) => l.lines.join(" ")), ["Unread text speed", "Read text speed", "Auto mode page switching", "Auto mode click wait time", "Read scenes auto skip", "Fast forward", "Text display", "Read text display"]);
  const rules = [228, 407, 547, 688, 839, 993, 1152];   // the picture's thin lines between rows
  SYSTEM_LABELS.forEach(({ y: [y0, y1], lines }, i) => {
    const top = y0 - SYSTEM_AREA.clean, bottom = y1 + SYSTEM_AREA.clean;
    assert.ok(top > (i ? SYSTEM_LABELS[i - 1].y[1] + SYSTEM_AREA.clean : 60), `row ${i} starts under the one before (and under the heading)`);
    for (const r of rules) assert.ok(r < top || r > bottom, `row ${i} leaves the line at ${r}`);
    const last = labelBase(y0) + (lines.length - 1) * CONF_TEXT.line;
    assert.ok(labelBase(y0) - CONF_TEXT.size > top && last + 8 < (rules[i] ?? 1336), `row ${i}'s new words stand in its own band`);
  });
  // every choice of the two sheets, three looks each; the words fit their cells or are drawn narrower
  assert.deepEqual(OPTION_SHEETS.btn_base1.words, ["ON", "OFF", "Full", "Read", "Fade in", "Insta display", "Fade out", "Insta erasure"]);
  assert.deepEqual(OPTION_SHEETS.btn_base2.words, ["Display whole text", "Display confirmation"]);
  assert.equal(OPTION_LOOKS.length, 3);
  for (const S of Object.values(OPTION_SHEETS)) assert.ok(S.x + S.room <= S.col && S.base < S.row);
  // ... in the last column too, which ends where the sheet does (the "on" look of Display confirmation lost its last letter there)
  for (const S of Object.values(OPTION_SHEETS)) assert.ok(2 * S.col + S.x + S.room + 10 <= S.width, `${2 * S.col + S.x + S.room} of ${S.width}`);
  assert.deepEqual(await relettered(), {}, "where there is no canvas the art as it is stands in");
  const ui = source("js/ui.js"), main = source("js/main.js");
  assert.match(ui, /confTex\(name\) \{ return this\.confArt\?\.\[name\] \|\| url\("CONF_PARTS_JA", name\); \}/);
  assert.match(ui, /background-image:url\("\$\{this\.confTex\(c\.tex\)\}"\)/);
  assert.match(main, /relettered\(\)\.then\(\(art\) => \{ ui\.confArt = art; \}\);/);
});

test("the hint names the gestures over a story's first screen until the panel has been pulled down once on this device", () => {
  const r = rig();
  const touch = installTouch({ win: r.win, doc: r.doc });
  touch.bind({ ui: r.ui, vm: r.vm, audio: r.audio, act: r.act });
  const hint = r.byId("touch-hint");
  assert.match(hint.html, /Swipe down: controls .* Swipe up: log .* Hold: fast forward .* Two fingers: hide text/);
  r.frame(30);
  assert.equal(hint.style.opacity, "1");
  swipeBy(r, 0, TOUCH.swipe + 5);
  assert.equal(r.win.localStorage.getItem(TOUCH.hint.key), "1");
  r.frame(30);
  assert.equal(hint.style.display, "none");
  // next time it is not shown at all
  const again = rig({ learnt: true });
  const t2 = installTouch({ win: again.win, doc: again.doc });
  t2.bind({ ui: again.ui, vm: again.vm, audio: again.audio, act: again.act });
  again.frame(30);
  assert.notEqual(again.byId("touch-hint").style.opacity, "1");
  // left alone it goes by itself
  const idle = rig();
  const t3 = installTouch({ win: idle.win, doc: idle.doc });
  t3.bind({ ui: idle.ui, vm: idle.vm, audio: idle.audio, act: idle.act });
  idle.frame(TOUCH.hint.frames + 60);
  assert.equal(idle.byId("touch-hint").style.display, "none");
});

// ---- the screens' touch layouts ---------------------------------------------------------------------------------------
test("the control panel is the quick bar's fifteen buttons at a finger's size: the game's plates uncut at 1.5, three rows of five, a name under each", async () => {
  const B = TOUCH.bar;
  assert.deepEqual([B.w, B.h, B.scale, B.cols], [220, 62, 1.5, 5], "the game's own plate, larger");
  // on the smallest phone (375 px high) a press area is a finger wide and high
  const k = 375 / 1080;
  assert.ok(B.pitch * k >= 44 && B.rowPitch * k >= 44, `${B.pitch * k} x ${B.rowPitch * k}`);
  const places = Array.from({ length: 15 }, (_, i) => barPlace(i));
  assert.deepEqual(places[0], [B.x, B.y]);
  assert.deepEqual(places[5], [B.x, B.y + B.rowPitch]);
  assert.deepEqual(places[14], [B.x + 4 * B.pitch, B.y + 2 * B.rowPitch]);
  for (const [x, y] of places) assert.ok(x >= 0 && x + B.w * B.scale <= 1920 && y + B.h * B.scale + 40 <= B.height, `${x}, ${y}`);
  assert.ok(B.pitch >= B.w * B.scale + 20 && B.rowPitch >= B.h * B.scale + 40, "no plate over the next, and room for the name");
  const had = globalThis.document;
  const made = [];
  const fake = (tag) => { const e = { tag, style: {}, className: "", classList: { add() {}, remove() {}, toggle() {} }, children: [], append(...c) { this.children.push(...c); }, listeners: {},
    addEventListener(t, f) { this.listeners[t] = f; }, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [] }; made.push(e); return e; };
  globalThis.document = { createElement: fake, getElementById: fake, fullscreenElement: null };
  try {
    const vm = { choosing: null, instant: false, replay: false, replaySource: null, running: true, auto: false, skipToggle: false, previousScene: () => null, canRewind: () => true };
    const calls = [];
    const env = new Proxy({ hasQuickSave: () => false, canPanel: () => true }, { get: (t, key) => t[key] ?? ((...a) => calls.push([key, ...a])) });
    const sounds = [];
    const ui = Object.assign(Object.create(UI.prototype), { vm, env, audio: { start() {} }, sound: (n) => sounds.push(n), keys: new KeyMap(store()), pointerMoved: true, touch: { on: true } });
    ui.buildPanel();
    const p = ui.panel;
    assert.equal(p.el.className, "modepanel tp");
    assert.equal(p.bar, B);
    assert.deepEqual(p.defs.map((d) => d.id), ["prevScene", "rewind", "auto", "skip", "nextScene", "quickSave", "quickLoad", "voice", "log", "hide", "save", "load", "config", "fullscreen", "menu"], "the same fifteen");
    for (const d of p.defs) assert.ok(TOUCH.names[d.id], `${d.id} has a name`);
    p.btns.forEach((b, i) => {
      const [x, y] = barPlace(i);
      assert.equal(b.style.cssText, `left:${x}px;top:${y}px;width:220px;height:62px;`);
      assert.equal(b.children.find((c) => c.className === "qname").textContent, TOUCH.names[p.defs[i].id]);
    });
    // the strip made as high: its own lower edge under the rest stretched
    const [a, b] = p.el.children;
    assert.deepEqual([a.className, b.className], ["tp-a", "tp-b"]);
    assert.equal(a.style.cssText, `top:0;height:${B.height - B.edge}px;background-size:1920px ${((B.height - B.edge) * 96) / B.cut}px;`);
    assert.equal(b.style.cssText, `top:${B.height - B.edge}px;height:${B.edge}px;background-position:0 ${-B.cut}px;`);
    // opened by a swipe: the panel's sound, and no cursor waiting on a button
    ui.openPanel(true);
    assert.deepEqual([ui.panelOpen, p.sel, sounds.at(-1)], [true, -1, 3]);
    // a finger lights the plate it presses; its tap acts and sends the panel up
    const auto = p.defs.findIndex((d) => d.id === "auto");
    p.btns[auto].listeners.pointerdown({ pointerType: "touch" });
    assert.equal(p.sel, auto);
    p.btns[auto].listeners.click({ stopPropagation() {} });
    assert.deepEqual(calls, [["toggleAuto"]]);
    assert.equal(ui.panelOpen, false);
  } finally { globalThis.document = had; }
  const css = source("touch.css");
  assert.match(css, /html\.touch \.modepanel\.tp \{ height: 486px; transform: translateY\(-494px\); \}/);
  assert.match(css, /\.modepanel\.tp \.qbtn, \.modepanel\.wl \.qbtn \{ transform: scale\(1\.5\); transform-origin: 0 0; overflow: visible; \}/);
  assert.equal(B.height, 486);
  // with a mouse the bar is as it was
  assert.deepEqual([QUICK_BAR.w, QUICK_BAR.h, QUICK_BAR.pitch], [117, 62, 118]);
});

// An element for ui.add: listeners by type, classes.
function item() {
  const e = { listeners: {}, cls: new Set(), addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }, fire(t, ev = {}) { for (const f of this.listeners[t] || []) f({ stopPropagation() {}, ...ev }); } };
  e.classList = { toggle: (c, on) => { if (on) e.cls.add(c); else e.cls.delete(c); }, contains: (c) => e.cls.has(c), remove: (c) => e.cls.delete(c), add: (c) => e.cls.add(c) };
  return e;
}
function addRig(touch) {
  const sounds = [], chosen = [];
  const ui = Object.assign(Object.create(UI.prototype), { items: [], sel: 0, pointerMoved: true, touch, sound: (n) => sounds.push(n), showCaption() {}, captionBox: null });
  return { ui, sounds, chosen };
}

test("under a finger an item lights as it is pressed and its tap chooses it; with a mouse a press lights nothing", () => {
  const t = addRig({ on: true });
  const a = item(), b = item();
  t.ui.add(a, () => t.chosen.push("a"));
  t.ui.add(b, () => t.chosen.push("b"));
  t.ui.select(0);
  b.fire("pointerdown", { pointerType: "touch" });
  assert.equal(t.ui.sel, 1);
  assert.ok(b.cls.has("sel") && !a.cls.has("sel"));
  assert.deepEqual(t.sounds, [], "lit without the cursor's sound");
  b.fire("click");
  assert.deepEqual([t.chosen, t.sounds], [["b"], [1]]);
  // a pen or a mouse on a touch device moves as a mouse does
  a.fire("pointerdown", { pointerType: "mouse" });
  assert.equal(t.ui.sel, 1);
  // no touch layer: a press is nothing, a click chooses
  const d = addRig(null);
  const c = item(), e = item();
  d.ui.add(c, () => d.chosen.push("c"));
  d.ui.add(e, () => d.chosen.push("e"), { twoTap: true });
  d.ui.select(0);
  e.fire("pointerdown", { pointerType: "touch" });
  assert.equal(d.ui.sel, 0);
  e.fire("click");
  assert.deepEqual(d.chosen, ["e"], "and the two-tap rule is a touch device's alone");
});

test("the two-tap rule (flowchart scenes): a first tap lights the item, a tap on the lit item chooses it", () => {
  const t = addRig({ on: true });
  const a = item(), b = item();
  t.ui.add(a, () => t.chosen.push("a"), { twoTap: true });
  t.ui.add(b, () => t.chosen.push("b"), { twoTap: true });
  t.ui.deselect();
  const tap = (el) => { el.fire("pointerdown", { pointerType: "touch" }); el.fire("click"); };
  tap(a);
  assert.deepEqual([t.chosen, t.ui.sel, t.sounds], [[], 0, [0]], "lit, with the cursor's sound, not chosen");
  tap(b);
  assert.deepEqual([t.chosen, t.ui.sel], [[], 1], "another: lit instead");
  tap(b);
  assert.deepEqual(t.chosen, ["b"]);
  tap(b);
  assert.deepEqual(t.chosen, ["b", "b"], "and again while it stays lit");
  assert.match(source("js/flowchart.js"), /onSelect: \(\) => select\(p, how\), twoTap: true \}\)\);/);
});

test("a choice under a finger is the game's own touch rule: a tap lights a row, a tap on the lit row takes it", () => {
  const ui = source("js/ui.js");
  const choices = ui.slice(ui.indexOf("  choices(list) {"), ui.indexOf("  // ---- the quick bar"));
  assert.match(choices, /row\.addEventListener\("pointerdown", \(e\) => \{\n\s+if \(!this\.touch \|\| e\.pointerType !== "touch" \|\| fx\.state === 2\) return;\n\s+lit = fx\.cur === i;\n\s+if \(!lit && fx\.move\(i\)\) this\.sound\(0\);\n\s+\}\);/);
  assert.match(choices, /row\.addEventListener\("click", \(e\) => \{ e\.stopPropagation\(\); if \(this\.touch && !lit && fx\.state !== 2\) \{ lit = true; return; \} press\(i\); \}\);/);
  assert.match(choices, /let lit = true;/, "with a mouse every click takes the row, as before");
});

test("the hint bars say what a finger does; Back and the cursor's entries are left out", () => {
  for (const label of Object.keys(HINTS)) assert.ok(label in TOUCH_HINTS, `${label} has a touch entry (or null)`);
  assert.equal(TOUCH_HINTS.Back, null);
  assert.equal(TOUCH_HINTS.Move, null);
  for (const keys of Object.values(TOUCH_HINTS)) for (const k of keys || []) assert.doesNotMatch(k, /click|wheel|Esc|Enter|key/i, k);
  const had = globalThis.document;
  const mk = (tag) => ({ tag, children: [], className: "", textContent: "", append(...c) { this.children.push(...c); }, appendChild(c) { this.children.push(c); }, setAttribute() {} });
  globalThis.document = { createElement: mk };
  try {
    const words = (bar) => bar.children.map((h) => h.children.map((c) => c.textContent).join(" "));
    const page = mk("div");
    const t = Object.assign(Object.create(UI.prototype), { touch: { on: true }, keys: new KeyMap(store()) });
    assert.deepEqual(words(t.helpBar(page, ["Back", "Choose", "Move", "Scroll"])), ["Tap Choose", "Drag Scroll"]);
    assert.deepEqual(words(t.helpBar(page, ["Back", "Picture", "Zoom", "Fill", "Reset"])), ["Tap Swipe Picture", "Pinch Zoom"]);
    const d = Object.assign(Object.create(UI.prototype), { touch: null, keys: new KeyMap(store()) });
    assert.deepEqual(words(d.helpBar(page, ["Back", "Choose"])), ["Esc Right click Back", "Enter Click Choose"], "a mouse's bar is as it was");
  } finally { globalThis.document = had; }
});

test("the title, the column, the config and the lists are laid out for a finger from the same art", () => {
  const ui = source("js/ui.js"), css = source("touch.css"), T = TOUCH;
  // the title: the logo smaller, the rows twice their size and so 112 px apart, all inside the stage
  assert.match(ui, /const boxed = \(cls\) => \(this\.touch \? page\.appendChild\(Object\.assign\(document\.createElement\("div"\), \{ className: `tbox \$\{cls\}` \}\)\) : page\);/);
  assert.match(css, /html\.touch \.t-logo \{ transform-origin: 960px 72px; transform: translateY\(-48px\) scale\(\.7\); \}/);
  assert.match(css, /html\.touch \.t-rows \{ transform-origin: 960px 720px; transform: translateY\(-222px\) scale\(2\); \}/);
  assert.deepEqual([T.title.logo, T.title.logoUp, T.title.rows, T.title.rowsUp], [0.7, 48, 2, 222]);
  const rowTop = (y) => 720 + (y - 720) * T.title.rows - T.title.rowsUp;   // a row's top after the change
  const five = [0, 1, 2, 3, 4].map((k) => rowTop(720 + 56 * k));
  assert.ok(five[1] - five[0] >= 110 && five[4] + 72 * T.title.rows / 2 + 50 <= 1080 && five[0] > 72 - T.title.logoUp + 648 * T.title.logo, `${five}`);
  // (the light is added over the page itself, not inside the logo's box, where it would add to nothing)
  assert.match(ui, /this\.titleLogoLayer\(boxed\("t-logo"\), \{ lumi: true, over: page \}\)/);
  assert.match(css, /html\.touch \.t-lumi \{ transform-origin: 240px -480px; transform: translateY\(-48px\) scale\(\.7\); \}/);
  // the column: the same buttons, 112 px apart
  assert.equal(T.columnStep, 112);
  assert.match(ui, /const gap = this\.touch \? TOUCH\.columnStep - M\.step : 0;/);
  assert.match(ui, /top:\$\{M\.y \+ \(M\.step \+ gap\) \* r\}px;/);
  assert.ok(105 + T.columnStep * 4 + 70 < 1080);
  // the config: its column left out, the screen at 1.27 about (1763, 96), the page's window shorter by what the scale adds
  const C = T.config;
  assert.match(css, /html\.touch \.conffg \{ transform-origin: 1763px 96px; transform: scale\(1\.27\); \}/);
  assert.match(css, /html\.touch \.colbox\.conf \{ display: none; \}/);
  assert.match(css, /html\.touch \.confscroll \{ height: 706px; \}/);
  const at = (x) => C.origin[0] + (x - C.origin[0]) * C.scale;
  assert.ok(at(400) >= 0 && at(1863) <= 1920, `${at(400)} - ${at(1863)}: the tabs' band to the scroll bar, inside the stage`);
  assert.ok(Math.abs(96 + (165 + C.height - 96) * C.scale - 1080) < 3, "the page's window runs to the bottom of the screen (no hint bar on touch)");
  assert.match(ui, /\+ \(this\.touch \? TOUCH\.config\.clip - TOUCH\.config\.height : 0\);/, "what the shorter window hides is added to the scroll");
  assert.match(ui, /if \(n === 2\) \{ if \(this\.touch\) this\.buildTouchPage\(pageBox\); else this\.buildControlsPage\(pageBox\); return; \}/);
  assert.ok(TOUCH_CONTROLS.length >= 8 && TOUCH_CONTROLS.every(([what, how]) => what && how));
  // a slider under a finger: along it the knob follows, across it the page scrolls; minus and plus step on the tap
  assert.match(ui, /if \(Math\.abs\(dx\) <= Math\.abs\(dy\)\) \{ finger = null; return; \}/);
  assert.match(ui, /if \(press\.slider && Math\.abs\(e\.clientX - press\.x\) > Math\.abs\(e\.clientY - press\.y\)\) \{ press = null; return; \}/);
  assert.match(ui, /if \(this\.touch && e\.pointerType === "touch"\) \{ b\.finger = \{ repeated: false \}; C\.hold = \{ button: b, n: CONFIG\.hold, pointer: true, finger: b\.finger \}; return; \}/);
  // lists: the browser's own scrolling for a finger, and nothing else of the page moves
  assert.match(css, /html\.touch \.slotlist, html\.touch \.logscroll \{ touch-action: pan-y; \}/);
  assert.match(css, /html\.touch, html\.touch body \{ position: fixed; inset: 0; width: 100%; height: 100%; overflow: hidden; overscroll-behavior: none; touch-action: none;/);
  assert.match(ui, /if \(from === null \|\| state !== "open" \|\| \(from - e\.touches\[0\]\.clientY\) \/ scale\(\) < LOG\.close\) return;/, "pulled on past the newest line, the log closes");
  // the gallery: rows further apart, ten tracks to the screen, the CG viewer's fingers
  const g = source("js/gallery.js");
  assert.match(g, /const ROW = ui\.touch \? TOUCH\.galleryStep : 80;/);
  assert.ok(160 + T.galleryStep * 5 + 96 <= 1023);
  assert.match(g, /const ML = ui\.touch \? \{ \.\.\.MUSIC, \.\.\.TOUCH\.music \} : MUSIC;/);
  near(T.music.pitch * T.music.rows, 905, 0.01);
  assert.match(g, /zoomTo\(pinched\.scale \* z\.ratio, \[\(z\.at\[0\] - r\.left\) \* k2, \(z\.at\[1\] - r\.top\) \* k2\]\);/);
  assert.match(g, /if \(drag\.swipe && Math\.abs\(dx\) > SWIPE && change\(dx < 0 \? 1 : -1\)\) ui\.sound\(0\);/);
});

test("the game goes full screen at any click or tap, on every device, until the Full screen key or button takes it out", () => {
  const main = source("js/main.js");
  assert.match(main, /let wantFull = true;\nfunction toggleFullscreen\(\) \{\n  if \(document\.fullscreenElement\) \{ wantFull = false; document\.exitFullscreen\?\.\(\)\.catch\(\(\) => \{\}\); return; \}\n  wantFull = true;/);
  assert.match(main, /addEventListener\("click", \(\) => \{\n  if \(!wantFull \|\| document\.fullscreenElement\) return;\n  try \{ document\.documentElement\.requestFullscreen\?\.\(\)/);
  assert.doesNotMatch(source("js/touch.js"), /panelWas = !!touch\.ui\?\.panelOpen;\n\s+fullscreen\(\);/, "one place asks: main.js");
});

test("Firefox on Android draws a movie's own element: painted to a canvas its frames were black", () => {
  const main = source("js/main.js");
  assert.match(main, /const paintsNothing = \/Android\/i\.test\(navigator\.userAgent \|\| ""\);\nfunction paintMovie\(v\) \{\n  stopPaintingMovie\(v\);   \/\/ nothing of the last movie\n  if \(paintsNothing\) return;/);
});

test("the first-visit page on a touch device: the eight plates in two full rows of four with START last, and how to play by touch", async () => {
  const { SECTIONS, TOUCH_INTRO } = await import("../../web/app/js/welcome.js");
  const w = source("js/welcome.js"), B = TOUCH.bar, W = TOUCH.welcome;
  assert.equal(SECTIONS.length + 1, 8, "eight plates");
  assert.match(w, /\(T && k === 0 \? \[\.\.\.s\.blocks, \.\.\.TOUCH_INTRO\] : s\.blocks\)\.map\(blockEl\)/);
  assert.equal(TOUCH_INTRO[0][0], "h");
  assert.match(TOUCH_INTRO[1], /Swipe down .* up for the log.* fast forward.* two fingers.* Back button/);
  // two rows of five inside the strip, START in the last place of the second
  assert.match(w, /\[T\.welcome\.x \+ \(i % T\.welcome\.cols\) \* T\.welcome\.pitch, T\.welcome\.y \+ Math\.floor\(i \/ T\.welcome\.cols\) \* T\.welcome\.rowPitch\]/);
  assert.equal(W.cols * 2, SECTIONS.length + 1, "no place left empty");
  const right = W.x + (W.cols - 1) * W.pitch + B.w * B.scale;
  assert.ok(Math.abs(W.x - (1920 - right)) <= 1 && W.pitch > B.w * B.scale, "the rows stand in the middle, no plate over the next");
  assert.ok(W.y + W.rowPitch + B.h * B.scale <= W.height);
  assert.match(source("touch.css"), /html\.touch \.wl-scroll \{ top: 262px; height: 818px; \}/);
});
