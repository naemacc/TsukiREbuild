// Checks for TODO item 123 (2026-11-10): story timing away from 60 Hz. main.js now moves the story's clocks a whole game frame at a time
// (vm.useFrameTime, vm.frameStep), lets the script take its step between two game frames carried by one display frame (vm.settleScript),
// and steps what moves once a frame on the story's screen from the same loop (vm.endFrame, vm.everyFrame). Measured in a browser on a
// virtual clock at 30, 60, 120 and 144 Hz (web-dev/audit/FIXES.md, "TODO item 123"); these hold the pieces the measurements rest on.
import test from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = String(v); }, removeItem(k) { delete this.store[k]; } };

const { VM } = await import("../../web/app/js/vm.js");
const { Value } = await import("../../web/app/js/animation.js");

const FRAME = 1000 / 60;

// A machine on frame time, its frames stepped by hand as main.js steps them.
function machine() {
  const node = { innerHTML: "", style: { top: "" } };
  globalThis.document = { getElementById: () => node };
  const played = [];
  const text = { pageParts: [], typing: false, intro: false, rate: 0, clear() { this.pageParts = []; }, setIntro() {}, setOpen() {},
    fadeOut() {}, fadeIn() {}, closeNow() {}, closeQuick() {}, add: () => Promise.resolve(), log() {}, beginMessage() {} };
  const audio = { snapshot: () => ({}), restore() {}, stopVoice() {}, speed: 1, setSpeed(k) { this.speed = k; }, voiceDone: () => Promise.resolve(),
    playSE: (k, name) => played.push(name), fadeSE() {}, setSEVolume() {}, stopSE() {} };
  const gfx = { load: async () => ({ tex: null, w: 100, h: 100 }), tex: new Map() };
  const vm = new VM({ gfx, text, audio });
  vm.externalTicks = true;
  vm.useFrameTime();
  vm.script = { name: "synthetic", ops: [] };
  vm.running = true;
  // one game frame as main.js runs it: the clocks a frame on, the script's step, the tick, the end of the frame
  const frame = async () => { vm.frameStep(); await vm.settleScript(); vm.tick(); vm.endFrame(); };
  return { vm, frame, played };
}
async function framesOf(m, promise, limit = 400) {
  let done = false;
  promise.then(() => { done = true; });
  await m.vm.settleScript();
  for (let n = 0; n <= limit; n++) {
    if (done) return n;
    await m.frame();
  }
  return -1;
}

test("frame time: the story's clocks stand still between frame steps and move a whole frame at each", async () => {
  const { vm } = machine();
  const t0 = vm.now(), s0 = vm.soundClock.now(), f0 = vm.frameNow();
  await new Promise((r) => setTimeout(r, 30));   // real time passes: the clocks do not
  assert.equal(vm.now(), t0);
  vm.frameStep();
  vm.frameStep();
  assert.ok(Math.abs(vm.now() - t0 - 2 * FRAME) < 1e-9);
  assert.ok(Math.abs(vm.soundClock.now() - s0 - 2 * FRAME) < 1e-9);
  assert.ok(Math.abs(vm.frameNow() - f0 - 2 * FRAME) < 1e-9);
  vm.paused = true;                               // a menu holds the story's clock, not the sound clock
  vm.frameStep();
  assert.ok(Math.abs(vm.now() - t0 - 2 * FRAME) < 1e-9);
  assert.ok(Math.abs(vm.soundClock.now() - s0 - 3 * FRAME) < 1e-9);
});

test("frame time: a timed wait ends at the frame step it is due by, with no timer (WTTM 1000 is 60 frames, 17 one, 1084 65)", async () => {
  for (const [ms, frames] of [[1000, 60], [17, 1], [1084, 65], [100, 6]]) {
    const m = machine();
    assert.equal(await framesOf(m, m.vm.op_WTTM(String(ms), "1")), frames, `WTTM ${ms}`);
  }
});

test("frame time: a tween drawn between frames shows the last frame's level (whole frames, item 146)", async () => {
  const { vm } = machine();
  const v = new Value(0);
  v.to(0, 1000, 1000, 0, vm.now(), 0);   // 60 frames, the step 4096 / 60 = 68
  for (let k = 0; k < 7; k++) vm.frameStep();
  const at7 = v.at(vm.now());
  assert.ok(Math.abs(at7 - 1000 * (7 * 68) / 4096) < 1e-9, `level ${at7} at the 7th frame`);
  await new Promise((r) => setTimeout(r, 10));   // a display frame later, no game frame: the same level
  assert.equal(v.at(vm.now()), at7);
});

test("frame time: a delayed sound counts down in frame steps (068:1000 waits 60 frames)", async () => {
  const m = machine();
  m.vm.soundLater(18, 1, { "068": 1000, "017": 40 }, "SE_A", false);
  assert.equal(m.vm.delayed.size, 1);
  let n = 0;
  while (m.vm.delayed.size && n < 200) { await m.frame(); n++; }
  assert.equal(n, 60);
  assert.equal(m.vm.framePolls.size, 0, "the slot's countdown is no longer looked at");
});

test("frame time: auto mode's wait ends at a frame step (2200 ms a click: 132 frames), and a menu cancels it", async () => {
  const m = machine();
  m.vm.auto = true;
  m.vm.autoClick = 2200;
  m.vm.pageEnd = false;
  let resolved = false;
  m.vm.waitResolve = () => { resolved = true; };
  m.vm.autoSince = m.vm.autoNow();
  m.vm.armAuto();
  let n = 0;
  while (!resolved && n < 400) { await m.frame(); n++; }
  assert.equal(n, 132);
  m.vm.waitResolve = () => {};
  m.vm.autoSince = m.vm.autoNow();
  m.vm.armAuto();
  assert.equal(m.vm.framePolls.size, 1);
  m.vm.paused = true;
  assert.equal(m.vm.framePolls.size, 0);
  assert.equal(m.vm.autoUntil, 0);
});

test("frame time: the script's step runs before the frame goes on, so two game frames in one display frame are two (30 Hz)", async () => {
  const { vm } = machine();
  const seen = [];
  // a script that waits a frame, then sets something, then waits again: two waits in two frames, not one
  (async () => {
    await vm.sleep(FRAME);
    seen.push(vm.ticks);
    await vm.sleep(FRAME);
    seen.push(vm.ticks);
  })();
  await vm.settleScript();
  vm.opCount++;   // the loop counts commands; here the steps stand in for them
  // one display frame carrying two game frames, as main.js runs it
  for (let i = 0; i < 2; i++) {
    if (i) await vm.settleScript();
    vm.frameStep();
    await vm.settleScript();
    vm.tick();
    vm.endFrame();
  }
  await vm.settleScript();
  assert.deepEqual(seen, [0, 1], "each wait ended at its own frame's start");
});

test("frame time: what waits for a frame (the scene skip's countdown, the notices, a choice) moves once a game frame", async () => {
  const m = machine();
  const steps = [];
  let left = 3;
  m.vm.everyFrame(() => { steps.push(m.vm.ticks); return --left > 0; });
  const ends = [];
  (async () => { for (let i = 0; i < 3; i++) { await m.vm.nextFrame(); ends.push(m.vm.ticks); } })();
  for (let i = 0; i < 5; i++) await m.frame();
  assert.deepEqual(steps, [1, 2, 3], "a step at the end of each frame until it says stop");
  assert.equal(m.vm.frameHooks.size, 0);
  assert.deepEqual(ends, [1, 2, 3]);
});

test("without main.js (the tests, the smoke test) the clocks read the real time and waits run on timers, as before", async () => {
  const node = { innerHTML: "", style: { top: "" } };
  globalThis.document = { getElementById: () => node };
  const vm = new VM({ gfx: { load: async () => ({}), tex: new Map() }, text: { add: () => Promise.resolve() }, audio: {} });
  assert.equal(vm.frameTimed, false);
  const t0 = vm.now();
  await new Promise((r) => setTimeout(r, 25));
  assert.ok(vm.now() - t0 >= 20);
  const started = performance.now();
  await vm.sleep(40);
  assert.ok(performance.now() - started >= 35);
});

test("item 146: an MSAD's typing front goes on from the line's letter count + 1 in single precision, as the game's one front does", async () => {
  const { advanceFront } = await import("../../web/app/js/textbox.js");
  const f32 = Math.fround, step = f32(f32(16.666668) / 50);
  // the game's front after four letters and the click: 5, then a step a frame, rounded at that size
  let game = 5, port = 1, gameAt = 0, portAt = 0;
  for (let k = 1; k <= 6; k++) {
    game = f32(game + step);
    port = advanceFront(port, 1, 50, 4);
    if (!gameAt && game > 6) gameAt = k;
    if (!portAt && port > 2) portAt = k;
    assert.equal(port + 4, game, `frame ${k}`);
  }
  assert.equal(portAt, 3);
  assert.equal(gameAt, 3);
  // counted from 1 (the port before): the fourth frame
  let rel = 1, relAt = 0;
  for (let k = 1; k <= 6 && !relAt; k++) { rel = advanceFront(rel, 1, 50); if (rel > 2) relAt = k; }
  assert.equal(relAt, 4);
});
