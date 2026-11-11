// touch.js - playing by touch alone, on a phone or a tablet held in landscape. Everything here is for a device whose
// first pointer is a finger (touchFirst); on any other the page is as it was: nothing below is installed, and the rules
// of touch.css all hang on html.touch. What a mouse or a key did, a finger does this way:
//   the story     a tap advances; a swipe down brings the control panel (the quick bar, at a finger's size), a swipe up the
//                 log; a finger held still fast forwards while it stays; a tap with two fingers hides the text
//   Back          the game's own touch Back button (native 0x4a410: back_btn at the bottom right, sliding in from the edge)
//   the menus     an item lights as it is pressed and is chosen by the tap; lists move under the finger
//   portrait      a screen asks for the device to be turned, and the game is held under it as under a hidden tab
// The screens' own parts (larger plates, wider rows, the two-tap rule of choices and the flowchart) are in ui.js,
// gallery.js, flowchart.js and home.js, each behind ui.touch, with their measures here (TOUCH).

export const TOUCH = {
  // touch-first: the first pointer is coarse and cannot hover. A laptop with a touch screen has a fine first pointer, a
  // narrow desktop window has a mouse, a tablet with a mouse attached reports that mouse: none of them match.
  query: "(hover: none) and (pointer: coarse)",
  // The story's gestures, in CSS pixels (what a finger travels, whatever the stage's scale) and milliseconds: a tap may
  // wander `slop`; past `swipe` the press is a swipe; held still for `hold` it fast forwards; a second finger within
  // `two` of the first makes a two-finger tap. `after`: how long a click that follows a gesture is passed over.
  slop: 14, swipe: 44, hold: 420, two: 350, after: 400,
  // A tap in the top strip of the story's picture brings the panel down, as the mouse at the top does (stage pixels).
  topZone: 86,
  // The control panel (ui.js buildPanel): the game's panel plates, uncut (220 x 62), drawn at `scale` in `cols` columns
  // `pitch` apart from x, rows `rowPitch` apart from y, a name under each; the panel is `height` high, the strip's own
  // lower `edge` rows kept as they are under the rest stretched.
  bar: { w: 220, h: 62, scale: 1.5, cols: 5, x: 51, pitch: 372, y: 30, rowPitch: 150, height: 486, edge: 8, cut: 88 },
  // The Back button (native 0x4a410 / 0x4a7a0): back_btn's cells (8, 16) and (8, 168), 280 x 128, at (1640, 952),
  // sliding in from the right edge as t rises 0.04 a frame, eased cubic in-out.
  back: { x: 1640, y: 952, w: 280, h: 128, cells: [[8, 16], [8, 168]], rate: 0.04 },
  // The title: the logo at `logo` of its size, `logoUp` higher; the rows at `rows` times theirs from `rowsUp` higher,
  // about (960, 720), so five stand 112 px apart where they stood 56.
  title: { logo: 0.7, logoUp: 48, rows: 2, rowsUp: 222, copy: [-790, 10] },
  // The system menu's column: the same buttons, this far apart (75 for a mouse).
  columnStep: 112,
  // The gallery's column (80 for a mouse) and the Music Player's list (59.1 and 15 rows).
  galleryStep: 110,
  music: { pitch: 90.5, rows: 10, font: 40, least: 28 },
  // The CG viewer: a picture may be made this many times its fitted size (with a mouse: up to its own size, as the game).
  viewerZoom: 4,
  // ... and its Back button goes this long after the last touch (ms), and comes back at the next.
  viewerBack: 2000,
  // ... and its buttons, drawn at 1.25 (110 x 100) in the same two rows.
  musicControls: { play: [1372, 558], pause: [1482, 558], stop: [1592, 558], repeat: [1702, 558], prev: [1482, 664], next: [1592, 664] },
  // The config: drawn at `scale` about `origin`, its column left out, so it takes the screen's width; the page's window
  // is `height` high (858 at 1x) and reaches the bottom of the screen, there being no hint bar on a touch device; what
  // that hides is added to the page's scroll range.
  config: { scale: 1.27, origin: [1763, 96], height: 706, clip: 858 },
  // Yes / No and notices: the window at this size about the stage's centre.
  dialog: 1.5,
  // The names under the control panel's plates, by the quick bar's ids.
  names: { prevScene: "Previous scene", rewind: "Previous message", auto: "Auto mode", skip: "Skip read text", nextScene: "Next scene", quickSave: "Quick save",
    quickLoad: "Quick load", voice: "Replay voice", log: "Log", hide: "Hide text", save: "Save", load: "Load", config: "Config", fullscreen: "Full screen", menu: "System menu" },
  // The opening page's four plates (home.js): the panel's, at its size, in one row `pitch` apart, centred; the reading
  // column starts under the strip, `height` high.
  home: { pitch: 465, y: 28, height: 150 },
  // The hint over a story's first screen: stays this many frames; kept in the browser once the panel has been pulled down.
  hint: { frames: 420, rate: 0.05, key: "tsuki.touch.hint" },
};

// The hint bars' entries for a finger (ui.helpBar): what to do in place of the keys and the mouse. null: not shown (Back
// has its button; nothing moves a cursor). Since 2026-11-10 the bars themselves are not drawn on a touch device, at the
// user's request (touch.css), so these only name the bars for a screen reader.
export const TOUCH_HINTS = {
  Start: ["Tap START"], Back: null, Choose: ["Tap"], Move: null, "Cursor movement": null, "Change page": null, Scroll: ["Drag"],
  "Quick jump": ["Tap a line"], "Replay voice": ["Tap its mark"], Picture: ["Tap", "Swipe"], Zoom: ["Pinch"], Fill: null, Reset: null, "Change key": null,
};
// The config's Controls page on a touch device (ui.buildTouchPage): what each thing is done with.
export const TOUCH_CONTROLS = [
  ["Advance text, choose", "Tap"],
  ["Control panel", "Swipe down, or tap the top edge"],
  ["Log", "Swipe up"],
  ["Fast forward", "Touch and hold"],
  ["Hide text", "Tap with two fingers"],
  ["Back", "The Back button"],
  ["Scroll a list", "Drag"],
  ["A choice", "Tap it to light it, tap again to take it"],
  ["CG viewer", "Tap or swipe: picture, pinch: zoom, drag: move"],
  ["Flowchart", "Tap a scene to see it, tap again to open it"],
];

// Whether this device is played by touch: /?touch=1 or /?touch=0 decides it outright (for testing, and for a device the
// query gets wrong), else the media query. Decided once, as the page loads.
export function touchFirst(win = globalThis) {
  let forced = null;
  try { const q = new URLSearchParams(win.location?.search || ""); if (q.has("touch")) forced = q.get("touch") !== "0"; } catch { /* no address */ }
  if (forced !== null) return forced;
  try { return !!win.matchMedia?.(TOUCH.query)?.matches; } catch { return false; }
}

// The 1920 x 1080 stage in a w x h window with the safe area's insets: as large as fits inside the insets, and centred in
// the window itself where that keeps it inside them (a notch at one end of a wide phone does not push the picture aside).
export function stageFit(w, h, inset = {}) {
  const { top = 0, right = 0, bottom = 0, left = 0 } = inset;
  const aw = Math.max(1, w - left - right), ah = Math.max(1, h - top - bottom);
  const k = Math.min(aw / 1920, ah / 1080), sw = 1920 * k, sh = 1080 * k;
  const centre = (size, used, lo, hi) => Math.max(lo, Math.min((size - used) / 2, size - hi - used));
  return { k, x: centre(w, sw, left, right), y: centre(h, sh, top, bottom) };
}

// A place of the control panel's button i on the stage: [x, y] of its plate.
export function barPlace(i, B = TOUCH.bar) { return [B.x + (i % B.cols) * B.pitch, B.y + Math.floor(i / B.cols) * B.rowPitch]; }

// The Back button's x at t (0 out of sight, 1 in place).
export function backX(t, B = TOUCH.back) {
  const u = Math.max(0, Math.min(1, t)), e = u < 0.5 ? 4 * u * u * u : 1 - ((-2 * u + 2) ** 3) / 2;
  return B.x + (1 - e) * B.w;
}

// One touch sequence on the story's screen, read as a gesture. Fed the fingers as they come, move and go (ids, CSS
// pixels, milliseconds), it answers: move() "up" / "down" / "left" / "right" once as a press becomes a swipe; held(t)
// true once a press has stayed still long enough (fast forward starts); up() "tap", "two" (a two-finger tap), "hold-end"
// or null. A press that wandered without swiping, or more fingers than two, is nothing.
export class StoryTouch {
  constructor(T = TOUCH) { this.T = T; this.reset(); }
  reset() { this.pts = new Map(); this.state = "idle"; this.t0 = 0; this.first = null; this.moved = false; }
  get busy() { return this.state !== "idle"; }
  down(id, x, y, t) {
    const p = { x0: x, y0: y };
    if (this.state === "idle") { this.reset(); this.pts.set(id, p); this.state = "press"; this.t0 = t; this.first = id; return; }
    this.pts.set(id, p);
    if (this.state === "hold") return;   // fast forward goes on under the first finger
    this.state = this.state === "press" && !this.moved && this.pts.size === 2 && t - this.t0 <= this.T.two ? "two" : "void";
  }
  move(id, x, y) {
    const p = this.pts.get(id);
    if (!p) return null;
    const dx = x - p.x0, dy = y - p.y0, d = Math.hypot(dx, dy);
    if (this.state === "press") {
      if (d >= this.T.swipe) { this.state = "void"; return Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? "down" : "up") : dx > 0 ? "right" : "left"; }
      if (d > this.T.slop) this.moved = true;
    } else if (this.state === "two" && d > this.T.slop) this.state = "void";
    return null;
  }
  held(t) {
    if (this.state !== "press" || this.moved || t - this.t0 < this.T.hold) return false;
    this.state = "hold";
    return true;
  }
  up(id, t) {
    if (!this.pts.delete(id)) return null;
    const was = this.state;
    if (was === "hold") {
      if (id !== this.first && this.pts.size) return null;
      this.state = this.pts.size ? "void" : "idle";
      return "hold-end";
    }
    if (this.pts.size) return null;
    this.state = "idle";
    if (was === "press") return this.moved ? null : "tap";
    if (was === "two") return t - this.t0 <= this.T.two + this.T.hold ? "two" : null;
    return null;
  }
  cancel() { const was = this.state; this.reset(); return was === "hold" ? "hold-end" : null; }
}

// Two fingers on a picture (the CG viewer): from the pair as it was and as it is, how much larger, and about which
// point (their midpoint now).
export function pinch(a0, b0, a1, b1) {
  const d0 = Math.hypot(a0[0] - b0[0], a0[1] - b0[1]), d1 = Math.hypot(a1[0] - b1[0], a1[1] - b1[1]);
  return { ratio: d0 > 0 ? d1 / d0 : 1, at: [(a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2] };
}

// requestAnimationFrame behind a gate: while held, a frame asked for is kept, and asked for again when the hold ends, so
// every loop of the page stands still under the rotate screen as it does in a hidden tab.
export class FrameGate {
  constructor(win) {
    this.raf = win.requestAnimationFrame.bind(win);
    this.caf = win.cancelAnimationFrame.bind(win);
    this.held = false;
    this.kept = new Map();
    this.n = 0;
    win.requestAnimationFrame = (fn) => this.request(fn);
    win.cancelAnimationFrame = (id) => this.cancel(id);
  }
  request(fn) {
    if (!this.held) return this.raf(fn);
    const id = -(++this.n);
    this.kept.set(id, fn);
    return id;
  }
  cancel(id) { if (id < 0) this.kept.delete(id); else this.caf(id); }
  hold(on) {
    if (on === this.held) return;
    this.held = on;
    if (on) return;
    const fns = [...this.kept.values()];
    this.kept.clear();
    for (const fn of fns) this.raf(fn);
  }
}

const ART = "/assets/ui";
const NONE = { on: false, held: false, bind() {}, place() {}, storyClick: () => false, learned() {} };

// Everything a touch device needs outside the screens themselves. Called first thing by main.js, before any other
// listener is added, so that this one's come first: the rotate screen can keep every event from the game, and a click
// that belongs to a gesture can be taken before anything acts on it. Returns the object main.js and ui.js ask:
//   on           touch-first
//   held         the rotate screen is up
//   place(stage) fits the stage (main.js fitStage)
//   bind(o)      the game's parts, once they exist: { ui, vm, audio, act: { fast(down), log(), hide(), choosing(), movie(), refit() } }
//   storyClick(e) a click that reached the story's screen: true if it was the panel's (it closed it, or it was at the top strip)
export function installTouch({ win = window, doc = document } = {}) {
  if (!touchFirst(win)) return NONE;
  const root = doc.documentElement, T = TOUCH;
  root.classList.add("touch");
  const touch = { on: true, held: false, ui: null, vm: null, audio: null, act: null };
  // the art only a touch device draws, read now: the rotate screen has it the moment the device is turned
  for (const a of ["DISP_PARTS_JA/back_btn", "DISP_PARTS_JA/voice_icon", "DISP_PARTS_JA/menuBG01_upscale", "DISP_PARTS_JA/mode_ring_1", "DIALOG_PARTS_JA/dialog_win", "TITLE_PARTS_JA/title_titlelog"]) {
    if (win.Image) new win.Image().src = `${ART}/${a}.webp`;
  }
  const gate = new FrameGate(win);
  const now = () => win.performance.now();

  // ---- the stage in the window ------------------------------------------------------------------------------------
  const probe = doc.createElement("div");
  probe.id = "touch-safe";   // touch.css: its paddings are the safe area's insets
  (doc.body || root).append(probe);
  const insets = () => {
    const s = win.getComputedStyle(probe), n = (v) => parseFloat(v) || 0;
    return { top: n(s.paddingTop), right: n(s.paddingRight), bottom: n(s.paddingBottom), left: n(s.paddingLeft) };
  };
  touch.fit = () => stageFit(win.innerWidth, win.innerHeight, insets());
  touch.place = (stage) => {
    const f = touch.fit();
    stage.style.transform = `translate(${f.x}px, ${f.y}px) scale(${f.k})`;
  };

  // ---- portrait: the rotate screen, and the game held under it -------------------------------------------------------
  // Outside the stage (which would be a strip across a portrait window): the menu's sky, the logo, the game's notice
  // window with the words, and the auto mode's ring turning. All of it the game's art, laid out 900 wide and scaled to
  // the window.
  const rotate = doc.createElement("div");
  rotate.id = "rotate";
  rotate.setAttribute("role", "alert");
  rotate.innerHTML = '<div class="rt-box"><div class="rt-logo"></div><div class="rt-win"><div class="rt-q">Please rotate your device</div>'
    + '<div class="rt-sub">This game is played in landscape.</div><div class="rt-ring"></div></div></div>';
  (doc.body || root).append(rotate);
  const box = rotate.firstChild;
  const movies = new Set();
  let autoLeft = null;
  const hold = (on) => {
    if (on === touch.held) return;
    touch.held = on;
    gate.hold(on);
    root.classList.toggle("turn", on);
    const { vm, audio, act } = touch;
    if (on) {
      endGesture();
      act?.fast(false);
      for (const v of doc.querySelectorAll("video")) if (!v.paused) { v.pause(); movies.add(v); }
      if (audio?.ctx?.state === "running") audio.ctx.suspend();
      if (vm) {
        vm.holdClocks("rotate", true);
        // the auto mode's wait is a timer of its own: it stops here and goes on with what was left
        if (vm.autoUntil) { autoLeft = Math.max(0, vm.autoUntil - (vm.autoNow ? vm.autoNow() : now())); if (vm.cancelAuto) vm.cancelAuto(); else { win.clearTimeout(vm.autoTimer); vm.autoUntil = 0; } }
      }
    } else {
      if (vm) { vm.holdClocks("rotate", false); if (autoLeft !== null) vm.armAuto(autoLeft); }
      autoLeft = null;
      if (audio?.ctx && !doc.hidden) audio.ctx.resume();
      for (const v of movies) if (v.isConnected && v.getAttribute("src")) v.play().catch(() => {});
      movies.clear();
      act?.refit();
    }
  };
  const turned = () => {
    const w = win.innerWidth, h = win.innerHeight, k = Math.min(w / 900, h / 1300);
    box.style.transform = `translate(-50%, -50%) scale(${k})`;
    hold(h > w);
    touch.act?.refit();
  };
  win.addEventListener("resize", turned);
  win.addEventListener("orientationchange", turned);
  win.visualViewport?.addEventListener?.("resize", turned);
  // a movie started under the rotate screen (the logo, as the page loads in portrait) waits for the turn
  doc.addEventListener("play", (e) => { if (touch.held && e.target?.tagName === "VIDEO") { e.target.pause(); movies.add(e.target); } }, true);

  // ---- full screen: main.js asks for it at every click; here landscape is kept where the browser lets a page lock it, and a tap on
  // the rotate screen, which no click of the game's sees, asks too -------------------------------------------------
  let asked = false;
  const fullscreen = () => {
    if (asked) return;
    asked = true;
    if (doc.fullscreenElement || !root.requestFullscreen) return;
    try { root.requestFullscreen({ navigationUI: "hide" })?.catch?.(() => {}); } catch { /* not here */ }
  };
  doc.addEventListener("fullscreenchange", () => {
    if (doc.fullscreenElement) { try { win.screen?.orientation?.lock?.("landscape")?.catch?.(() => {}); } catch { /* not here */ } }
    turned();
  });

  // ---- events: before every other listener of the page --------------------------------------------------------------
  // Under the rotate screen nothing reaches the game. A tap there still asks for the full screen, which on a phone that
  // lets a page lock its orientation turns the picture by itself.
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "mousedown", "mouseup", "mousemove", "click", "auxclick", "dblclick", "wheel", "keydown", "keyup", "touchstart", "touchmove", "touchend"]) {
    win.addEventListener(type, (e) => {
      if (!touch.held) return;
      e.stopImmediatePropagation();
      if (type === "click" && !touch.fullHeld?.()) { asked = false; fullscreen(); }   // (not while the opening page holds it back, main.js)
      if (e.cancelable && type !== "touchstart" && type !== "touchmove" && type !== "wheel") e.preventDefault();
    }, { capture: true, passive: false });
  }
  // A long press brings the browser's menu for a mouse's right click: on a touch device it is never Back (main.js).
  let lastPointer = "touch", touchedAt = 0;
  win.addEventListener("pointerdown", (e) => { lastPointer = e.pointerType || "touch"; touchedAt = now(); }, true);
  win.addEventListener("pointermove", () => { touchedAt = now(); }, true);
  win.addEventListener("contextmenu", (e) => { if (lastPointer === "mouse") return; e.preventDefault(); e.stopImmediatePropagation(); }, true);
  // (iOS: two fingers would zoom the page whatever the viewport says)
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) win.addEventListener(type, (e) => e.preventDefault(), { capture: true, passive: false });

  // ---- the story's gestures ----------------------------------------------------------------------------------------
  const gesture = new StoryTouch();
  let holdTimer = null, fastOn = false, skipClick = 0, panelWas = false, plain = true;
  const story = () => !!touch.vm?.running && !touch.ui.open && !touch.act.movie();
  const passClick = () => { skipClick = Infinity; };
  function endGesture() {
    win.clearTimeout(holdTimer);
    if (gesture.cancel() === "hold-end" || fastOn) { fastOn = false; touch.act?.fast(false); }
    if (skipClick === Infinity) skipClick = now() + T.after;
  }
  const swipe = (dir) => {
    const { ui, act } = touch;
    if (dir === "down") { if (!ui.panelOpen && ui.env.canPanel()) { ui.openPanel(true); touch.learned(); } }
    else if (dir === "up") {
      if (ui.panelOpen) { ui.sound(2); ui.closePanel(); } else if (story() && !act.choosing()) act.log();
    }
  };
  win.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch" || !touch.ui) return;
    const t = e.target, free = !t.closest?.("#ui, #sysui, #touch-back");
    if (!free || !touch.vm.running || touch.ui.open || touch.act.movie()) { if (gesture.busy) endGesture(); return; }
    if (e.isPrimary && gesture.busy) endGesture();   // (a finger whose lift never arrived does not hold the next press up)
    const fresh = !gesture.busy;
    gesture.down(e.pointerId, e.clientX, e.clientY, e.timeStamp);
    if (!fresh) { win.clearTimeout(holdTimer); if (gesture.state !== "hold") passClick(); return; }
    // a finger held on the picture itself fast forwards: not on the panel, nor over a choice
    plain = !t.closest?.(".modepanel") && !touch.ui.panelOpen && !touch.act.choosing();
    win.clearTimeout(holdTimer);
    if (plain) holdTimer = win.setTimeout(() => {
      if (!gesture.held(now() + 30) || !story() || touch.ui.panelOpen) return;
      fastOn = true;
      passClick();
      touch.act.fast(true);
    }, T.hold);
  }, true);
  win.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "touch" || !gesture.busy) return;
    const dir = gesture.move(e.pointerId, e.clientX, e.clientY);
    if (gesture.moved || dir) win.clearTimeout(holdTimer);
    if (dir) { passClick(); swipe(dir); }
  }, true);
  const lift = (e) => {
    if (e.pointerType !== "touch" || !gesture.busy) return;
    const res = e.type === "pointercancel" ? gesture.cancel() : gesture.up(e.pointerId, e.timeStamp);
    if (!gesture.busy) win.clearTimeout(holdTimer);
    if (res === "hold-end") { fastOn = false; touch.act.fast(false); }
    else if (res === "two" && plain && story()) { passClick(); touch.act.hide(); }
    if (!gesture.busy && skipClick === Infinity) skipClick = now() + T.after;
  };
  win.addEventListener("pointerup", lift, true);
  win.addEventListener("pointercancel", lift, true);
  // The click a tap makes. One that follows a swipe, a hold or two fingers is passed over; the panel's state as the
  // click began is kept for storyClick, since every click sends the panel up before the story sees it (main.js).
  win.addEventListener("click", (e) => {
    if (now() < skipClick) { skipClick = 0; e.stopImmediatePropagation(); e.preventDefault(); return; }
    panelWas = !!touch.ui?.panelOpen;   // (the full screen is asked for by main.js, at every click, as on a desktop)
  }, true);
  // A touch gives the page its activation as it ends, not as it starts: sound is started there too.
  for (const type of ["touchend", "pointerup"]) win.addEventListener(type, () => { touch.audio?.start(); }, true);
  touch.storyClick = (e) => {
    if (panelWas) { panelWas = false; return true; }   // the tap that sent the panel up does nothing else
    const { ui, vm } = touch;
    if (!ui || !vm.running || ui.open || touch.act.movie() || touch.act.choosing()) return false;
    const stage = doc.getElementById("stage"), r = stage.getBoundingClientRect();
    const y = ((e.clientY - r.top) * 1080) / (r.height || 1080);
    if (!(y >= 0 && y < T.topZone) || !ui.env.canPanel()) return false;
    ui.openPanel(true);
    touch.learned();
    return true;
  };

  // ---- the hint over a story's first screen --------------------------------------------------------------------------
  let learnt = false;
  try { learnt = !!win.localStorage.getItem(T.hint.key); } catch { /* shown each time */ }
  touch.learned = () => {
    if (learnt) return;
    learnt = true;
    try { win.localStorage.setItem(T.hint.key, "1"); } catch { /* not kept */ }
  };

  // ---- once the game's parts exist ---------------------------------------------------------------------------------
  touch.bind = (o) => {
    Object.assign(touch, o);
    const stage = doc.getElementById("stage"), { ui } = touch;
    ui.touch = touch;
    // The Back button: up while the screen on show has a Back (not the story's own questions, which have none, nor a
    // movie), over everything but the touch ring, as the game draws it.
    const B = T.back, back = doc.createElement("button");
    back.id = "touch-back";
    back.setAttribute("aria-label", "Back");
    back.style.cssText = `left:${B.x}px;top:${B.y}px;width:${B.w}px;height:${B.h}px;background-image:url("${ART}/DISP_PARTS_JA/back_btn.webp");`;
    const cell = (i) => { back.style.backgroundPosition = `${-B.cells[i][0]}px ${-B.cells[i][1]}px`; };
    cell(0);
    back.addEventListener("pointerdown", () => cell(1));
    for (const type of ["pointerup", "pointercancel", "pointerleave"]) back.addEventListener(type, () => cell(0));
    back.addEventListener("click", (e) => { e.stopPropagation(); ui.back(); });
    stage.append(back);
    const asking = () => !!doc.querySelector("#sysui .dialog:not(.notice):not(.story)");   // a system question is up: Back is its No, over a movie too
    // Over a picture in the CG viewer it leaves two seconds after the last touch, so nothing lies over the picture, and any touch brings it back.
    let viewing = false, viewedAt = 0;
    const idleViewer = () => {
      const on = !!doc.querySelector(".gl-viewer");
      if (on && !viewing) viewedAt = now();
      viewing = on;
      return on && now() - Math.max(viewedAt, touchedAt) > T.viewerBack;
    };
    const wanted = () => ui.open && !!ui.backFn && (!touch.act.movie() || asking()) && !doc.querySelector("#sysui .dialog.story") && !idleViewer();
    // The hint: the caption's band with the gestures on it, over the first story screen of a visit, until the panel has
    // been pulled down once on this device.
    const hint = doc.createElement("div");
    hint.id = "touch-hint";
    hint.innerHTML = '<div class="th-band"></div><div class="th-text">Swipe down: controls  ·  Swipe up: log  ·  Hold: fast forward  ·  Two fingers: hide text</div>';
    stage.append(hint);
    let t = 0, last = null, hintAt = learnt ? Infinity : 0, hintLevel = 0;
    const step = (real) => {
      const dt = last === null ? 0 : Math.min(30, ((real - last) * 60) / 1000);
      last = real;
      const want = wanted();
      if (want ? t < 1 : t > 0) {
        t = Math.max(0, Math.min(1, t + (want ? B.rate : -B.rate) * dt));
        back.style.transform = `translateX(${backX(t) - B.x}px)`;
        back.style.visibility = t > 0 ? "visible" : "hidden";
      }
      back.style.pointerEvents = want ? "" : "none";
      if (hintAt !== Infinity) {
        const up = !learnt && story() && !ui.panelOpen && hintAt < T.hint.frames;
        if (story() && !learnt) hintAt += dt;
        hintLevel = Math.max(0, Math.min(1, hintLevel + (up ? T.hint.rate : -T.hint.rate) * dt));
        hint.style.opacity = String(hintLevel);
        hint.style.display = hintLevel > 0 ? "block" : "none";
        if (hintLevel === 0 && (learnt || hintAt >= T.hint.frames)) hintAt = Infinity;
      }
      win.requestAnimationFrame(step);
    };
    win.requestAnimationFrame(step);
    if (touch.held) { touch.held = false; hold(true); }   // the page loaded in portrait: the game's parts are held now that they exist
  };

  turned();
  return touch;
}
