// Checks for the differences found by re-checking the functions the map had counted as handled (web-dev/audit/REVERIFY.md,
// FIX-CHECKLIST.md N2 and the items it added, S33-S36). Tests that read generated assets skip when those files are not
// there (they stay local).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

globalThis.localStorage = { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = String(v); }, removeItem(k) { delete this.store[k]; } };

const asset = (p) => new URL(`../../web/assets/${p}`, import.meta.url);
const readAsset = (p) => JSON.parse(readFileSync(asset(p), "utf8"));

const { VM } = await import("../../web/app/js/vm.js");
const { Audio } = await import("../../web/app/js/audio.js");
const { withContext } = await import("./fake-audio.mjs");
const { effectAlive } = await import("../../web/app/js/effects.js");

// A script machine with stand-ins for drawing, text and sound.
function machine(extra = {}) {
  const node = { innerHTML: "", style: { top: "" } };
  globalThis.document = { getElementById: () => node };
  const text = { pageParts: [], typing: false, intro: false, clear() { this.pageParts = []; }, setIntro() {}, setOpen() {},
    closeNow() {}, closeQuick() {}, fadeOut() {}, fadeIn() {}, addBreak() {}, beginMessage() {}, continueMessage() {},
    setWhole() {}, log() {}, unlog() {}, add: async () => {}, finish() {}, rows: () => ({}), ...extra.text };
  const audio = { snapshot: () => ({ bgm: null, se: [], last: Array(20).fill(-1), lastMusic: 0 }), restore() {}, stopVoice() {}, playVoice() {}, characterOf: () => -1,
    voiceDone: () => new Promise(() => {}), ...extra.audio };
  const gfx = { load: async () => ({ tex: null, w: 100, h: 100 }), tex: new Map(), ...extra.gfx };
  const vm = new VM({ gfx, text, audio, ...extra.hooks });
  vm.script = { name: "synthetic", ops: [], labels: {} };
  vm.lines = [];
  vm.read = new Uint8Array(16);
  vm.waitAdvance = async () => {};
  return vm;
}
const z = (block, index) => block * 256 + index;

// ---- S33: the game's read marks -----------------------------------------------------------------------------------
test("S33: the build keeps each message's block and index (ZMbbbii, hex) and the label Z commands before an op", () => {
  if (!existsSync(asset("scripts/index.json"))) return;
  const index = readAsset("scripts/index.json");
  const s = readAsset(`scripts/${index.names.indexOf("01_00_ARC01_3")}.json`);
  const at = s.ops.findIndex((o) => o[0] === "MSG" && o[1] === "$001655");   // _ZM04701($001655)
  assert.equal(s.zm[at], z(0x47, 1));
  assert.deepEqual(s.zl[0], [[z(0x43, 1), ""], [z(0x44, 1), "START"]]);     // _ZZ04301();_ZZ04401(START)
  for (const [k, code] of Object.entries(s.zm)) { assert.equal(s.ops[k][0], "MSG"); assert.equal(code & 255, code % 256); }
  if (!existsSync(asset("scripts/zlines.json"))) return;
  assert.deepEqual(readAsset("scripts/zlines.json")["1655"], [z(0x47, 1)]);
});

test("S33: a message is read when its block's byte reaches its index; the next Z command marks it, skipping too (0x53a60, 0x78070)", async () => {
  const vm = machine();
  vm.script = { name: "a", ops: [["MSG", "x"], ["MSG", "y"], ["MSG", "z"]], labels: {}, zm: { 0: z(5, 1), 1: z(5, 2), 2: z(5, 3) }, zl: {} };
  vm.pc = 1; await vm.message("x", false);
  assert.equal(vm.msgRead, false);
  assert.equal(vm.readBlocks[5], 0);              // not yet: the message on screen is marked when the next Z runs
  vm.skip = true;                                 // fast forward: the next message still marks the one before
  vm.pc = 2; await vm.message("y", false);
  assert.equal(vm.readBlocks[5], 1);
  vm.skip = false;
  vm.pc = 3; await vm.message("z", false);
  assert.equal(vm.readBlocks[5], 2);
  // a high-water mark: anything at or under the byte counts as read, shown or not
  vm.readBlocks[9] = 6;
  assert.equal(vm.zRead(z(9, 4)), true);
  assert.equal(vm.zRead(z(9, 6)), true);
  assert.equal(vm.zRead(z(9, 7)), false);
  assert.equal(vm.zRead(z(0xfb4, 1)), false);     // blocks past 0xfb3 are never read
  // a ZY label (index 0) never raises its block
  vm.zCurrent = z(12, 0); vm.zStep(z(13, 1));
  assert.equal(vm.readBlocks[12], 0);
});

test("S33: block numbers shared by two scripts share their read marks (06_01_CIEL06_2 / _4 block 1093)", async () => {
  if (!existsSync(asset("scripts/index.json"))) return;
  const index = readAsset("scripts/index.json");
  const a = readAsset(`scripts/${index.names.indexOf("06_01_CIEL06_2")}.json`);
  const b = readAsset(`scripts/${index.names.indexOf("06_01_CIEL06_4")}.json`);
  const inBlock = (s) => Object.entries(s.zm).filter(([, c]) => c >> 8 === 1093).map(([k, c]) => [Number(k), c]);
  const [ka, ca] = inBlock(a).find(([, c]) => (c & 255) === 6);
  const [kb, cb] = inBlock(b).find(([, c]) => (c & 255) === 6);
  assert.notEqual(a.ops[ka][1], b.ops[kb][1]);    // different lines under the same block and index
  const vm = machine();
  vm.zCurrent = ca; vm.zStep(z(1, 1));            // 06_01_CIEL06_2's message 6 of block 1093 read
  assert.equal(vm.zRead(cb), true);               // 06_01_CIEL06_4's is read too
});

test("S33: the instant run stops at any Z command not read yet on \"Read\" (labels too), at every one while F998 is set", async () => {
  const vm = machine();
  vm.running = true;
  const run = () => { vm.instant = false; vm.beginInstant(); vm.recorded = null; };
  vm.fastForwardRead = true;
  vm.readBlocks[0x46] = 0;                        // a ZY label's block (index 0): never marked
  run(); vm.zStep(z(0x46, 0));
  assert.equal(vm.instant, false);
  vm.readBlocks[0x47] = 3;
  run(); vm.zStep(z(0x47, 2));                    // a read message: the run goes on
  assert.equal(vm.instant, true);
  vm.fastForwardRead = false;                     // "Full": unread text does not stop it
  run(); vm.zStep(z(0x46, 0));
  assert.equal(vm.instant, true);
  vm.vars.F998 = 1;                               // F998: every Z command stops it
  run(); vm.zStep(z(0x47, 2));
  assert.equal(vm.instant, false);
});

test("S33: label Z commands run before their op, from the label a jump named; a restored choice does not run them again", async () => {
  const vm = machine();
  const seen = [];
  vm.zStep = (code) => seen.push(code);
  vm.script = { name: "a", ops: [["NOP_"], ["NOP_"]], labels: { L: 0, M: 0 }, zl: { 0: [[z(1, 1), "L"], [z(2, 1), "M"]], 1: [[z(3, 0), "N"]] }, zm: {} };
  vm.running = true;
  vm.pc = 0;
  await vm.loop(vm.generation);
  assert.deepEqual(seen, [z(1, 1), z(2, 1), z(3, 0)]);
  seen.length = 0;
  vm.running = true;
  vm.goto("M");                                    // a jump to the second label of the stack runs from it
  await vm.loop(vm.generation);
  assert.deepEqual(seen, [z(2, 1), z(3, 0)]);
  seen.length = 0;
  vm.running = true;
  vm.pc = 1; vm.zSkip = 1;                         // a restored choice at op 1
  await vm.loop(vm.generation);
  assert.deepEqual(seen, []);
});

test("S33: MSAD keeps the message's read flag (no Z command); old per-line bits carry over once", async () => {
  const vm = machine();
  vm.script = { name: "a", ops: [["MSG", "$0"], ["MSAD", "$1"]], labels: {}, zm: { 0: z(7, 1) }, zl: {} };
  vm.lines = ["a", "b"];
  vm.readBlocks[7] = 1;
  vm.pc = 1; await vm.message("$0", false);
  assert.equal(vm.msgRead, true);
  vm.pc = 2; await vm.message("$1", true);         // line 1's own bit is not set, but MSAD keeps the flag
  assert.equal(vm.msgRead, true);
  // migration: a profile with per-line bits and no marks yet
  localStorage.removeItem("tsuki.readBlocks");
  localStorage.setItem("tsuki.read", btoa(String.fromCharCode(0b101)));   // lines 0 and 2
  const m = machine();
  m.lines = ["a", "b", "c"];
  m.loadRead();
  globalThis.fetch = async () => ({ json: async () => ({ 0: [z(20, 3)], 1: [z(20, 5)], 2: [z(21, 2), z(22, 4)] }) });
  try { await m.loadReadBlocks(); } finally { delete globalThis.fetch; }
  assert.deepEqual([m.readBlocks[20], m.readBlocks[21], m.readBlocks[22]], [3, 2, 4]);
  assert.ok(localStorage.getItem("tsuki.readBlocks"));
  const again = machine();
  await again.loadReadBlocks();                    // kept from then on
  assert.equal(again.readBlocks[22], 4);
});

// ---- S35: numbers stop at "." ------------------------------------------------------------------------------------
test("S35: decimals keep their whole part and STCH / SCH2 alpha stays within 0-255 (0x2d3c -> 0x3160, 0x60840)", () => {
  const vm = machine();
  vm.op_STCH("13", "img2182", "240", "136", "1000", "173.4", "6214");
  assert.equal(vm.layerFor(13).alpha.b, 173);
  vm.op_STCH("3", "img0931", "118", "68", "1000", "0.01", "3726");
  assert.equal(vm.layerFor(3).alpha.b, 0);
  vm.op_STCH("5", "img2228", "76", "176", "1000", "256", "5886");
  assert.equal(vm.layerFor(5).alpha.b, 255);
  vm.op_SCH2("5", "", "", "", "", "-4");
  assert.equal(vm.layerFor(5).alpha.b, 0);
  // SSW2(33,1,6,500,600,0.5,-1,0): the factor reads 0, so the layer does not sway
  vm.op_STCH("33", "img0001");
  vm.op_SSW2("33", "1", "6", "500", "600", "0.5", "-1", "0");
  const e = vm.layerFor(33).effects.oscillation;
  assert.equal(e.factor, 0);
  assert.equal(effectAlive(e, vm.now() + 100), false);
});

// ---- S36: seen at the commit ----------------------------------------------------------------------------------------
test("S36: a picture counts as seen at the commit, every layer's, not when STCH stages it (0x5d3a0 -> 0x774f0)", async () => {
  const vm = machine();
  const seen = [];
  vm.unlocks = { image: (n) => seen.push(n) };
  vm.op_STCH("6", "img1644");
  vm.op_STCH("6", "img1643");                      // 11_00_ARC11_1 op 114: replaced before the screen changed
  assert.deepEqual(seen, []);
  await vm.commit();
  assert.deepEqual(seen, ["img1643"]);
  seen.length = 0;
  vm.op_STCH("7", "img0001");
  await vm.commit();
  assert.deepEqual(seen.sort(), ["img0001", "img1643"]);   // every layer on screen, at every commit
});

// ---- S34: restores and the instant run's end put the recorded sound back as 0x5d7e0 ---------------------------------
function sound() {
  localStorage.removeItem("tsuki.volumes");
  const audio = new Audio();
  const h = withContext(audio);
  audio.table = { bgm: ["M1", "M2", "M3"] };
  return { audio, started: h.ctx.sources, ...h };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

test("S34: a restore starts every recorded loop again, keeps the music playing unless a load restarts it (0x5d7e0, 0x5ef10)", async () => {
  const { audio, started } = sound();
  await audio.playBGM(2, { "017": 80 });
  await audio.playSE(3, true, "MOON_SE03023", { "017": 60 });
  const snap = audio.snapshot();
  const music = audio.bgm, loop = audio.se.get(3);
  audio.restore(snap);                             // a rewind
  await settle();
  assert.equal(audio.bgm, music);                  // the same number goes on
  assert.notEqual(audio.se.get(3), loop);          // the loop starts again on its channel (0x9caa0 -> 0xedd28)
  assert.equal(loop.state, 0);
  assert.equal(started.filter((s) => s.started).length, 3);
  audio.restore(snap, { restartMusic: true });     // a load: everything stopped first, the track from its top
  await settle();
  assert.notEqual(audio.bgm, music);
  assert.equal(audio.bgmState.n, 2);
  assert.equal(audio.bgm.loop, true);              // the loop flag is on (0x9c960(1))
});

test("S34: the instant run records its sound and puts it back where it stops, tweens at their ends (0x649e0, 0x328f0)", async () => {
  const { audio } = sound();
  const vm = machine({ audio });
  vm.audio = audio;
  vm.running = true;
  await audio.playBGM(1, {});
  vm.op_STCH("2", "img0001");
  await vm.commit();
  vm.op_STGS("2", "0", "255", "5000", "0");        // a fade under way when the run starts
  vm.beginInstant();
  const before = audio.bgm;
  vm.op_MPLY("3", "`017:70");                      // recorded, not played
  vm.op_SEPL("4", "1", "MOON_SE03023", "`017:50");
  vm.op_SEPL("5", "0", "MOON_SE02009");            // played once: nothing to put back
  assert.equal(audio.bgm, before);
  assert.equal(audio.se.size, 0);
  vm.op_ATSV("");                                  // the run stops here and the recording is played
  await settle();
  assert.equal(audio.bgmState.n, 3);
  assert.equal(Math.round(audio.bgmState.vol * 100), 70);
  assert.equal(audio.se.get(4)?.name, "MOON_SE03023");
  assert.equal(audio.se.has(5), false);
  assert.equal(vm.layerFor(2).alpha.at(vm.now()), 255);   // the fade is at its end
  // TOMP stops the run without putting the recording back (0x6ef30): the sound stopped as the run began stays stopped (N2-74)
  vm.beginInstant();
  vm.op_MPLY("1");
  vm.endInstant(false);
  assert.equal(audio.bgmState, null);
  assert.equal(audio.bgm, null);
  assert.equal(audio.se.size, 0);
});

test("S34: a restored point shows its layers' tweens at their targets", async () => {
  const vm = machine();
  vm.motions = {};
  vm.op_STCH("2", "img0001");
  await vm.commit();
  vm.op_STGS("2", "0", "255", "5000", "0");
  vm.op_STCL("0", "2", "0", "0", "300", "100", "4000", "0");
  const s = vm.snapshot();
  s.waiting = false;
  vm.getScript = async () => vm.script;
  vm.flow.restore = () => {};
  vm.loop = () => {};
  await vm.restore(s, { rewind: true });
  const l = vm.layerFor(2), now = vm.now();
  assert.equal(l.alpha.at(now), 255);
  assert.deepEqual([l.x.at(now), l.y.at(now)], [300, 100]);
});

// ---- N2-210: a panel's frame ----------------------------------------------------------------------------------------
test("N2-210: an unturned panel's frame has a solid outer half and the picture stops at its inner edge (0x34a70 with a target)", async () => {
  const { clipGeometry } = await import("../../web/app/js/transform.js");
  // 01_00_ARC01_2 op 287: a black frame 84 wide, the panel from x 784 to 1876 and past the screen up and down
  const g = clipGeometry({ rect: [784, -231, 1092, 1581], border: 84, rot: 0, frame: 1 });
  assert.equal(g.band.solid, true);
  assert.deepEqual(g.band.sides, [1, 0, 1, 0]);
  assert.deepEqual(g.band.inner, [868, -231, 924, 1581]);
  // a turned panel's band is the blob's pieces, placed as 0x34a70's turned branch has them (TODO item 111, priority1.test.mjs); style 7 draws no frame
  assert.equal(clipGeometry({ rect: [100, 100, 400, 300], border: 20, rot: 1500, frame: 2 }).band.solid, false);
  assert.equal(clipGeometry({ rect: [100, 100, 400, 300], border: 20, rot: 0, frame: 7 }).band, null);
  const src = readFileSync(new URL("../../web/app/js/renderer.js", import.meta.url), "utf8");
  assert.match(src, /bandOn == 1 && \(p\.x < bandInner\.x/);                         // FS_LAYER leaves the picture out under it
  assert.match(src, /if \(solid == 0\) a = turnedBand\(p - outer\.xy, outer\.zw, b\) \* maskFade\(p\);\n  else if \(dx < b \|\| dy < b\) a = maskFade\(p\)/);   // FS_FRAME: the frame's colour at the mask's level
});

// ---- N2-211: a panel group's edge -------------------------------------------------------------------------------------
test("N2-211: a panel group with an edge width fades once, as one picture, so an opaque picture leaves none of its owner in the fade", async () => {
  const { groupNeedsBuffer } = await import("../../web/app/js/transform.js");
  // 02_00_ARC02_1B op 1264: a green owner with a picture linked over it, edge width 15, at full alpha as well
  assert.equal(groupNeedsBuffer(1, 0, 15), true);
  assert.equal(groupNeedsBuffer(1, 0, 0), false);
  const src = readFileSync(new URL("../../web/app/js/renderer.js", import.meta.url), "utf8");
  // inside the buffer the layers keep the rectangle but not the fade, the band keeps its solid outer half, then the mask goes over all of it
  assert.match(src, /if \(edgeless && at\.clip\) at\.clip = \{ \.\.\.at\.clip, border: 0 \};/);
  assert.match(src, /this\.drawFrame\(clip, 1, true\);\s+this\.fadeGroupEdge\(clip\);/);
  assert.match(src, /uniform1f\(prog\.u\.maskEdge, masked \? 0 : g\.border\)/);
  assert.match(src, /blendFunc\(gl\.ZERO, gl\.SRC_ALPHA\)/);
});

// ---- N2-5, N2-6: panel clips and groups ------------------------------------------------------------------------------
test("N2-5: an offset 1920 x 1080 clip cuts the picture; the panel runs of the draw task (0x3bba0)", async () => {
  const { place, panelRuns, groupOpacity, groupRelative } = await import("../../web/app/js/transform.js");
  const a = { id: 1, image: "x", parent: -1, link: -1, clip: [300, 150, 1920, 1080], border: 0, scale: 1000 };
  const placed = place([a], new Map([[a, { x: 240, y: 136, zx: 1000, zy: 1000, rot: 0, alpha: 255 }]]), () => [1280, 720]);
  assert.deepEqual(placed.get(a).clip.rect, [300, 150, 1920, 1080]);   // the picture shows only inside it
  // groups: a linked layer and its owner when they are neighbours in depth, the owner's clip making it a panel
  const L = (id, z, link = -1, clip = null) => ({ id, z, link, ready: {}, clip });
  const owner = L(2, 20, -1, [200, 100, 1200, 800]), child = L(3, 30, 2), other = L(4, 25), bg = L(1, 10);
  const all = new Map([bg, owner, child, other].map((l) => [l.id, l]));
  const byDepth = (ls) => ls.slice().sort((p, q) => p.z - q.z);
  let runs = panelRuns(byDepth([bg, owner, child]), all);
  assert.equal(runs.get(owner), runs.get(child));
  assert.deepEqual(runs.get(owner).layers, [owner, child]);
  assert.equal(runs.get(bg), undefined);
  // an unlinked layer in between breaks the run, and a link to an owner without a clip is no panel group
  runs = panelRuns(byDepth([bg, owner, other, child]), all);
  assert.equal(runs.size, 0);
  const noClip = L(5, 20, -1, null), kid = L(6, 30, 5);
  assert.equal(panelRuns([noClip, kid], new Map([[5, noClip], [6, kid]])).size, 0);
  // opacity of a group whose first layer is translucent (native frames: A = .5 without an edge width gave bg .75)
  assert.equal(groupOpacity(0.5, 0), 0.25);
  assert.equal(groupOpacity(0.5, 30), 0.5);
  assert.equal(groupRelative(0.25, 0.5), 0.5);
  assert.equal(groupRelative(1, 0.5), 1);      // at most the group's own opacity
});

test("A blur number is a softness that follows the picture's size class, measured on the game's pre-blurred files", async () => {
  const { blurSigma } = await import("../../web/app/js/transform.js");
  assert.equal(blurSigma("VRV_S_28_05_A00", 0), 0);
  assert.equal(blurSigma("VRV_S_28_05_A00", -3), 0);
  const close = (a, b) => assert.ok(Math.abs(a - b) < 0.05, `${a} vs ${b}`);
  close(blurSigma("IMG0342", 15), Math.hypot(9.75, Math.sqrt(0.3)));              // backgrounds: 0.65 n
  close(blurSigma("ARU_L_03_01_N00", 30), Math.hypot(9.75, Math.sqrt(0.3)));      // L: half of it
  close(blurSigma("ARU_M_84_15_N00", 40), Math.hypot(6.5, Math.sqrt(0.3)));       // M: a quarter
  close(blurSigma("vrv_s_28_05_a00", 15), Math.hypot(1.21875, Math.sqrt(0.3)));   // S: an eighth (the name's case does not matter)
  close(blurSigma("IMG0342", 100), 0);                                            // only the two digits of the file name count
});

test("Item 10: which arrangements of linked layers go through the group machine (0x3bba0)", async () => {
  const { panelRuns, groupModes, plainGroups } = await import("../../web/app/js/transform.js");
  const L = (id, z, link = -1, clip = null) => ({ id, z, link, ready: {}, clip });
  const C = [200, 100, 1200, 800];
  const owner = L(2, 20, -1, C), child = L(3, 30, 2), below = L(5, 15, 2), other = L(4, 25), bg = L(1, 10);
  const all = new Map([bg, owner, child, below, other].map((l) => [l.id, l]));
  const by = (ls) => ls.slice().sort((p, q) => p.z - q.z);
  const check = (ls) => { const o = by(ls), m = groupModes(o, all); return [m, plainGroups(o, all, m, panelRuns(o, all))]; };
  // the plain arrangement: the owner first, its members next to it
  let [m, plain] = check([bg, owner, child]);
  assert.equal(plain, true);
  assert.deepEqual([m.get(bg).mode, m.get(owner).mode, m.get(child).mode], [0, 1, 2]);
  // the owner above its child, and a member cut off by an unlinked layer
  [m, plain] = check([bg, below, owner]);
  assert.equal(plain, false);
  assert.deepEqual([m.get(below).mode, m.get(owner).mode], [1, 2]);
  [m, plain] = check([bg, owner, other, child]);
  assert.equal(plain, false);
  assert.deepEqual([m.get(owner).mode, m.get(other).mode, m.get(child).mode], [2, 0, 2]);
  // a link to an owner with no clip stays a plain draw, as on native frames
  const bare = L(6, 40), kid = L(7, 50, 6), all2 = new Map([bare, kid].map((l) => [l.id, l]));
  const m2 = groupModes([bare, kid], all2);
  assert.equal(plainGroups([bare, kid], all2, m2, panelRuns([bare, kid], all2)), true);
  assert.deepEqual([m2.get(bare).mode, m2.get(kid).mode], [1, 2]);
});

test("A panel group whose first layer has a blend shader goes through a buffer at any alpha (0xa2c30 / 0x37ea0)", async () => {
  const { groupCoverage, groupNeedsBuffer } = await import("../../web/app/js/transform.js");
  // 02_00_ARC02_1: layer 23 pulses 255 -> 0 with ps_lighten: at full alpha too, the group reaches the scene only through
  // that blend (drawn directly, its opaque room and subtracted lines went black on the scene's own room)
  assert.equal(groupNeedsBuffer(1, 37), true);
  assert.equal(groupNeedsBuffer(0.5, 37), true);
  assert.equal(groupNeedsBuffer(0.5, 0), true);
  assert.equal(groupNeedsBuffer(1, 0), false);   // a plain group at full alpha draws directly
  // the buffer's alpha: the first alpha without an edge width, 1 with one; the last pass multiplies by the first alpha
  // again, so a shader using a x op gets A^2 / A, and dodge (op alone) gets A (native: 128/255 of the grey gave 177 of 128)
  assert.equal(groupCoverage(0.5, 0), 0.5);
  assert.equal(groupCoverage(0.5, 30), 1);
  assert.equal(groupCoverage(1, 0), 1);
});

test("The display curve and the working space: pictures round-trip, and a later blended layer of a group takes the first alpha", () => {
  const src = readFileSync(new URL("../../web/app/js/renderer.js", import.meta.url), "utf8");
  // the last pass (138dd8be4ccf62ce) and the bake it undoes
  assert.match(src, /srgb\(pow\(max\(c\.rgb, vec3\(0\.0\)\), vec3\(2\.2\)\)\)/);
  assert.match(src, /return pow\(max\(l, vec3\(0\.0\)\), vec3\(1\.0 \/ 2\.2\)\)/);
  assert.match(src, /if \(picture == 1\) c\.rgb = working\(unp\(c\)\) \* c\.a;/);
  assert.match(src, /gl\.uniform1i\(u\.picture, 0\);/);   // the group's buffer is already in the working space
  assert.match(src, /drawOne\(l, relative, first && !!run\.shader, blended \? run\.first : 1, run\.edge\)/);
  const srgb = (l) => (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);
  const decode = (s) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
  const display = (x) => srgb(x ** 2.2), working = (s) => decode(s) ** (1 / 2.2);
  // an untouched picture comes out as it was stored, at every value
  for (let b = 0; b < 256; b++) assert.ok(Math.abs(display(working(b / 255)) * 255 - b) < 1e-6, `byte ${b}`);
  // native frames: a white group at A^2 on black, the values dumped at the end of the frame
  const measured = { 224: 197, 200: 159, 176: 123, 160: 100, 144: 80, 128: 61, 112: 46, 96: 31, 80: 18, 72: 13, 64: 7, 56: 4, 48: 2, 40: 1, 32: 0 };
  for (const [a, v] of Object.entries(measured)) assert.ok(Math.abs(display((a / 255) ** 2) * 255 - v) <= 1.2, `alpha ${a}`);
});

// ---- N2-7, N2-11, N2-12, N2-95, N2-99 --------------------------------------------------------------------------------
test("N2-7: the size class comes with digits in the prefix (table +0x46), and the one record that does not say it in the name", async () => {
  const { sizeClass } = await import("../../web/app/js/transform.js");
  assert.equal(sizeClass("Z20_L_10_00_N00"), 0.5);
  assert.equal(sizeClass("Y00_M_00_00_N00"), 0.25);
  assert.equal(sizeClass("Z01_S_10_00_N00"), 0.125);
  assert.equal(sizeClass("ARU_L_00_00_N00"), 0.5);
  assert.equal(sizeClass("ARU_A_00_00_N00"), 1);
  assert.equal(sizeClass("IMG5028"), 0.25);
});

test("N2-12: STBR's third argument replaces the second when present and not negative (0x62490)", () => {
  const vm = machine();
  const blendOf = (args) => { vm.op_STCH("13", "img0001"); vm.op_STBR("13", ...args); return vm.layerFor(13).blend; };
  assert.equal(blendOf(["8", "0"]), 0);       // 13,8,0: normal
  assert.equal(blendOf(["19", "0"]), 0);      // 22,19,0: normal
  assert.equal(blendOf(["1", "28"]), 28);     // 18,1,28: add
  assert.equal(blendOf(["10", "29"]), 29);    // 26,10,29: sub_noalpha
  assert.equal(blendOf(["19", "26"]), 26);    // 22,19,26: hardlight_ex
  assert.equal(blendOf(["17", ""]), 17);      // the third blank: the second
  assert.equal(blendOf(["17", "-1"]), 17);    // negative: the second
  assert.equal(blendOf(["0"]), 0);            // 0 is the engine's 255: normal
});

test("N2-11: a blurred picture name missing from the table leaves the layer empty; N2-99: STCH keeps the source's blur when blank", async () => {
  const vm = machine();
  vm.gfx.images = { IMG0001: [100, 100, 1], IMG0001_04_04: [108, 108, 1], Z20_M_61_00_A00: [100, 100, 1], IMG2472: [100, 100, 1], IMG2472_04_04: [100, 100, 1] };
  vm.op_STCH("5", "img0001", "", "", "", "", "", "", "CC", "4", "4");
  assert.equal(vm.layerFor(5).image, "img0001");          // IMG0001_04_04 is in the table
  vm.op_STCH("6", "Z20_M_61_00_A00", "", "", "", "", "", "", "CC", "10", "0");
  assert.equal(vm.layerFor(6).image, null);               // Z20_M_61_00_A00_10_00 is not: nothing is drawn (0x61e08)
  await vm.commit();
  // QA_20: STCH(28, img2472, ..., source 22) with blank blur arguments takes the source's 4,4
  vm.op_STCH("22", "img2472", "352", "40", "1000", "255", "518", "", "CC", "4", "4");
  await vm.commit();
  vm.op_STCH("28", "img2472", "74", "76", "1000", "255", "518", "", "CC", "", "", "", "", "", "", "", "", "", "22");
  assert.equal(vm.layerFor(28).blurX, 4);
  assert.equal(vm.layerFor(28).blurY, 4);
});

// ---- N2-13: a blurred layer's STPV pivot --------------------------------------------------------------------------------
test("N2-13: STPV on a blurred picture adds the table pivot of the blurred entry less the base entry's (0x639a0)", async () => {
  const { pivotOf } = await import("../../web/app/js/transform.js");
  const base = [2560, 1440, 1], blurred = [2576, 1456, 1];   // IMG0342 and IMG0342_04_04: 8 stored pixels of margin each side
  const l = { image: "img0342", pivot: [191, 124] };
  const [px, py] = pivotOf(l, blurred, base);
  const [ox, oy] = pivotOf(l, blurred);
  assert.ok(Math.abs((px - ox) - 3) < 1e-6);                  // (2576 - 2560) x 1.5 / 4 / 2 = half the 16-pixel growth
  assert.ok(Math.abs((py - oy) - (1456 - 1440) * 1.5 / (1080 / 272) / 2) < 1e-6);
  assert.deepEqual(pivotOf({ image: "x", pivot: null }, blurred, base), pivotOf({ image: "x", pivot: null }, blurred));
});

// ---- N2-15: colour effects are baked with the picture ----------------------------------------------------------------
test("N2-15: the effect is baked at the commit that changes the picture; STEC's colour multiplies at once, the record's preset comes at the next commit", async () => {
  const vm = machine();
  vm.gfx.images = {};
  vm.op_STCH("2", "img2523");
  vm.op_SNX2("2", "100");
  await vm.commit();
  let l = vm.layerFor(2);
  assert.equal(l.baked.bright, 100 / 255 + 1);
  assert.equal(l.recordPreset, 0);
  // the same picture again with no SNX2: the bake stays (07_01_CIEL07_2_2)
  vm.op_STCH("2", "img2523");
  await vm.commit();
  l = vm.layerFor(2);
  assert.equal(l.bright, 1);
  assert.equal(l.baked.bright, 100 / 255 + 1);
  // STEC on the live picture: not baked; the colour is the record's at once (QA_01's black), the preset at the commit
  vm.op_STEC("2", "1", "0x000000");
  assert.equal(l.baked.effect, 0);
  assert.deepEqual(l.tint, [0, 0, 0]);
  await vm.commit();
  assert.equal(vm.layerFor(2).baked.effect, 0);     // still the old picture
  assert.equal(vm.layerFor(2).recordPreset, 1);
  // a new picture bakes what is set
  vm.op_STCH("2", "img0001");
  vm.op_STEC("2", "13", "");
  await vm.commit();
  assert.equal(vm.layerFor(2).baked.effect, 13);
});

// ---- N2-16, N2-17, N2-97: the wipe and the haze ------------------------------------------------------------------------
test("N2-16 / N2-97 / N2-17: STTR's rule slot is shared with FADS, a rule-0 FADS empties it, and the layer shader takes the no-panel paths", async () => {
  const vm = machine();
  const src = readFileSync(new URL("../../web/app/js/renderer.js", import.meta.url), "utf8");
  // the rule, in a panel or not, and the wipe's coverage: at no panel the rule alone, not multiplied by the alpha (0xa6e90)
  assert.match(src, /o = maskOn == 1 && ruleWhole == 1 \? c : c \* alpha/);
  assert.match(src, /ruleWhole, at\.clip \? 0 : 1/);
  // a blend-shader layer with no panel takes no rule (0x36520's blend path has no +0x10c test)
  assert.match(src, /\(at\.clip \|\| !blendLayer\)/);
  // a hazed layer outside a panel counts its alpha twice in the colour (0x36520's haze branch: SrcAlpha into target 2)
  assert.match(src, /hazeTwice == 1\) c\.rgb \*= c\.a/);
  // the slot: STTR loads rule n; a FADS with rule 0 empties it; a rule transition changes it
  vm.op_STCH("2", "img0001");
  vm.op_STTR("2", "26");
  assert.equal(vm.gfx.ruleSlot, "RULE_26");
  vm.text = { ...vm.text, closeForFade() {}, rate: 0 };
  await vm.fade(1, 0, 0);
  assert.equal(vm.gfx.ruleSlot, null);
  // a rule transition loads its rule for the transition, and the end of the transition frees it (0x60610, 0x48ac0)
  vm.gfx.load = async () => ({ tex: {} });
  const set = [];
  Object.defineProperty(vm.gfx, "ruleSlot", { configurable: true, get() { return this._r; }, set(v) { set.push(v); this._r = v; } });
  await vm.fade(2, 0, 13);
  assert.deepEqual(set, ["RULE_13", null]);
});

// ---- SHOK: N2-86, N2-87, N2-88, N2-89, N2-90, N2-109, N2-98 -----------------------------------------------------------------
test("N2-86 / N2-87 / N2-88 / N2-89: SHOK's period and frames as 0x2ee70 / 0x2ef30 have them", async () => {
  const { makeEffect, effectOffset, effectAlive, impactPixels } = await import("../../web/app/js/effects.js");
  const F = 1000 / 60;
  // 80 ms x 10: period 4.8 frames, 48 frames in all; the shape read from a native run (y 12: 38.6 px at full level)
  const e = makeEffect("impact", [0, 12, 80, 10], 0);
  assert.equal(e.periodFrames, 4.8);
  assert.ok(effectAlive(e, 47 * F));
  assert.ok(!effectAlive(e, 48 * F + 0.01));
  const near = (v, want) => assert.ok(Math.abs(v - want) < 0.75, `${v} vs ${want}`);
  for (const [n, want] of [[3, -26], [4, -31], [6, 34], [7, 9], [8, -28], [9, -22], [10, 15], [16, 22]]) {
    near(impactPixels(e, (n - 1) * F)[1], want);   // frame n (1-based) after the SHOK, as the native frames showed
  }
  // count 0: nothing, and a running shake stops
  assert.equal(effectAlive(makeEffect("impact", [0, 7, 80, 0], 0), 1), false);
  // a delay keeps the running shake going; the delay counts 16 ms a tick (500 ms: 32 ticks, 2 frames later than 30)
  const running = makeEffect("impact", [0, 12, 100, 20], 0);
  const delayed = makeEffect("impact", [0, 12, 100, 3, 500], 100, running);
  assert.equal(delayed.delay, Math.ceil(500 / 16) * F);
  assert.deepEqual(effectOffset(delayed, 100 + 5 * F), effectOffset(running, 100 + 5 * F));
  assert.notDeepEqual(effectOffset(delayed, delayed.start + delayed.delay + 3 * F), effectOffset(running, delayed.start + delayed.delay + 3 * F));
  // an immediate SHOK replaces a pending one
  assert.equal(makeEffect("impact", [0, 12, 100, 20], 200, delayed).prev, null);
});

test("N2-90 / N2-109: a restore ends a shake, and SHAF ends a running one but not a pending one (0x5baf0, 0x2e560)", async () => {
  const { makeEffect } = await import("../../web/app/js/effects.js");
  const vm = machine();
  vm.gfx.shake = makeEffect("impact", [0, 12, 80, 10], vm.now());
  vm.op_SHAF();
  assert.equal(vm.gfx.shake, null);
  const pending = makeEffect("impact", [0, 12, 80, 10, 500], vm.now(), makeEffect("impact", [0, 3, 80, 10], vm.now()));
  vm.gfx.shake = pending;
  vm.op_SHAF();
  assert.ok(vm.gfx.shake);                         // the pending one still starts
  assert.equal(vm.gfx.shake.prev, null);           // but the running one is gone
  const s = vm.snapshot();
  s.waiting = false;
  vm.getScript = async () => vm.script;
  vm.flow.restore = () => {};
  vm.loop = () => {};
  vm.gfx.shake = makeEffect("impact", [0, 12, 80, 10], vm.now());
  await vm.restore(s, { rewind: true });
  assert.equal(vm.gfx.shake, null);
});

// ---- N2-91: tweens ---------------------------------------------------------------------------------------------------
test("N2-91: a tween lasts ceil(4096 / step) frames (the integer step 4096 / (ms x 60 / 1000))", async () => {
  const { Value } = await import("../../web/app/js/animation.js");
  const v = new Value(0);
  const frames = (ms) => { v.to(0, 255, ms, 0, 0); return Math.round(v.ms / (1000 / 60)); };
  assert.equal(frames(3000), 187);
  assert.equal(frames(5000), 316);
  assert.equal(frames(10000), 683);
  assert.equal(frames(40000), 4096);
  assert.equal(frames(1000), 61);
  v.to(0, 255, 3000, 0, 0);
  assert.equal(v.done(180 * 1000 / 60), false);       // nominal end: still going
  assert.equal(v.done(187.01 * 1000 / 60), true);
  // under a frame's worth of milliseconds: no tween at all (frames 0)
  v.to(0, 255, 10, 0, 0);
  assert.equal(v.at(0), 255);
});

// ---- N2-92, N2-93 (see screenfx test), sway ----------------------------------------------------------------------------
test("N2-92: shake and sway use the layer's own offset; V10: sway has a new period and amplitude each cycle and one random sign", async () => {
  const { slotShift, effectOffset, makeEffect } = await import("../../web/app/js/effects.js");
  const shake = makeEffect("shake", [0, 15, 100, -1], 0);
  const parent = { id: 1, parent: -1, link: -1, effects: { oscillation: shake } };
  const child = { id: 2, parent: 1, link: -1, effects: { oscillation: makeEffect("shake", [5, 0, 100, -1], 0) } };
  const all = new Map([[1, parent], [2, child]]);
  const now = 100;
  assert.deepEqual(slotShift(child, all, now, "oscillation"), effectOffset(child.effects.oscillation, now));
  // a quake still follows the parent (0x34440 flag 1)
  const q = { ...parent, effects: { quake: makeEffect("quake", [10, 10, 2], 0) } };
  const c2 = { ...child, effects: { quake: makeEffect("quake", [3, 3, 2], 0) } };
  assert.deepEqual(slotShift(c2, new Map([[1, q], [2, c2]]), 50, "quake"), effectOffset(q.effects.quake, 50));
  // sway: amplitude within the range, not always the same period
  const e = makeEffect("sway", [5, 15, 300, 600, 1], 0);
  const samples = [];
  for (let f = 0; f < 200; f++) samples.push(effectOffset(e, f * 1000 / 60)[0]);
  assert.ok(Math.max(...samples.map(Math.abs)) <= 15);
  assert.ok(samples.some((v) => Math.abs(v) > 0));
});

// ---- N2-100, N2-101 (see screenfx test), N2-107, N2-14, N2-108: restores and new stories ----------------------------------
test("N2-14 / N2-108 / N2-100 / N2-107: a new story clears the speed lines and the split; a restore restarts them", async () => {
  const { startLines, startSplit, splitSample } = await import("../../web/app/js/screenfx.js");
  const vm = machine();
  vm.gfx.lines = startLines(20, 0);
  vm.gfx.split = startSplit(0, 3, 0);
  vm.clearAnimations();
  assert.equal(vm.gfx.lines, null);
  assert.equal(vm.gfx.split, null);
  // the save holds lines of type 20 and a split; a restore starts the lines' first phase and the split from its start
  vm.gfx.lines = startLines(20, 0);
  vm.gfx.split = startSplit(-40, 3, 0);
  const s = vm.snapshot();
  s.waiting = false;
  vm.getScript = async () => vm.script;
  vm.flow.restore = () => {};
  vm.loop = () => {};
  vm.clock.offset -= 5000;   // time has passed since the save point
  vm.frameClock.offset -= 5000;
  await vm.restore(s, { rewind: true });
  assert.equal(vm.gfx.lines.type, 20);
  assert.ok(Math.abs(vm.gfx.lines.start - vm.now()) < 500);          // its first phase again
  assert.ok(Math.abs(vm.gfx.split.start - vm.frameNow()) < 500);     // the split counts the display's frames (item 110)
  assert.equal(splitSample(vm.gfx.split, vm.frameNow()).alpha, 1);   // the level is not 0
  // a split fading out at the save point is off after the restore
  s.split = { ...s.split, end: 0, endAlpha: 0.5 };
  await vm.restore(s, { rewind: true });
  assert.equal(vm.gfx.split, null);
});

test("N2-106: a preset change while the split is on takes its strength at the next 6-frame step (0x2e280, 0x2f910)", async () => {
  const { startSplit, splitSample } = await import("../../web/app/js/screenfx.js");
  const F = 1000 / 60;
  const a = startSplit(0, 11, 0);                 // strength 3.1 (default)
  const b = startSplit(0, 12, 10 * F, a);         // 2.5: the change comes at frame 10
  const on = (x, f) => splitSample(x, f * F + 1);
  const old = startSplit(0, 11, 0), newOne = { ...startSplit(0, 12, 0), start: 0 };
  // frames 10-11 are in the step of the change (k = 1): the old strength; frame 12 starts step 2
  assert.equal(on(b, 11).dx, splitSample(old, 11 * F + 1).dx);
  assert.equal(on(b, 13).dx, splitSample({ ...newOne, alphaAt: 0 }, 13 * F + 1).dx);
});

// ---- N2-102: SQK2 -1 and staged layers --------------------------------------------------------------------------------
test("N2-102: SQK2 -1 skips layers 0 and 1 that are only staged, and gives the rest their effect when live or staged (0x91540)", async () => {
  const vm = machine();
  vm.op_STCH("1", "img0597");            // layer 1 staged only (the black card)
  vm.op_SQK2("-1", "1", "9", "0", "-1");
  assert.deepEqual(vm.layerFor(1).effects, {});
  await vm.commit();
  vm.op_SQK2("-1", "1", "9", "0", "-1");
  assert.ok(vm.layerFor(1).effects.quake);
  vm.op_STCH("5", "img0001");            // layer 5 staged: it takes it
  vm.op_STCP("5", "50");
  vm.op_SQK2("-1", "1", "9", "0", "-1");
  assert.ok(vm.layerFor(5).effects.quake);
});

// ---- N2-103 / N2-104: the spline ---------------------------------------------------------------------------------------
test("N2-104: a run of held keys joins one point in the raw values, and the last key adds a point unless equal to the one before or a hold", async () => {
  const { Motion } = await import("../../web/app/js/animation.js");
  const H = -32767, R = -100001;
  const frame = (t, x, mode) => [t, 0, mode, x, H, H, R, H, H, H, H];
  // y: 0, 100, then holds, 0: raw values 0, 100, H, H, 0 - the holds are one point (the middle one), so the points are 0, 100, 100?, 0:
  // the first hold (prev != cur) makes a point with the resolved value; the second is inside a run of holds and joins it
  const track = { duration: 4000, loop: 0, frames: [frame(0, 0, 1), frame(1000, 100, H), frame(2000, H, H), frame(3000, H, H), frame(4000, 0, H)] };
  const motion = new Motion(1, track, { x: 0, y: 0, alpha: 255, rot: 0, zx: 1000, zy: 1000, blurX: 0, blurY: 0 }, 0);
  const s = motion.sample(500);        // inside the first segment (0 to 100 through the moments)
  assert.ok(Number.isFinite(s.x) && s.x > 0 && s.x < 100);
  assert.ok(Math.abs(motion.sample(1000).x - 100) < 1e-9);   // the key's value
});

// ---- N2-8, N2-9, N2-96, N2-10, N2-113, N2-105: indicators and bars -----------------------------------------------------------
test("N2-8 / N2-9 / N2-96 / N2-10 / N2-113 / N2-105: the mode icons, the popup's speed and origin, and the mode panel's closing curve", () => {
  const css = readFileSync(new URL("../../web/app/style.css", import.meta.url), "utf8");
  const main = readFileSync(new URL("../../web/app/js/main.js", import.meta.url), "utf8");
  // >> solid while skipping, 0.6 only stopped at unread text; >>| only in a scene skip's countdown
  assert.match(css, /#mode-skip\.on \{ opacity: 1; \}/);
  assert.match(css, /#mode-skip\.on\.paused \{ opacity: 0; filter: opacity\(\.6\); \}/);   // 0.6 of a level that falls: it fades out there
  assert.match(css, /#mode-skip\.on\.countdown \{ opacity: 1; background-position: -352px 0; \}/);
  assert.doesNotMatch(main, /classList\.toggle\("force"/);
  // the rewind icon: state 2 at x 546.67 of 640 while rewinding; state 1 in the countdown
  assert.match(css, /#mode-back \{ position: absolute; left: 1596px;/);
  // lit for the frame of a rewind, its level moving 0.25 a frame (one frame at a quarter on a native capture of one tap)
  assert.match(main, /backIcon\(2, 1\)/);
  assert.match(main, /backLevel \+ \(lit \? 0\.25 : -0\.25\)/);
  assert.doesNotMatch(css, /#mode-back \{[^}]*transition/);
  assert.match(main, /await countdown\(20, true\)/);
  // the popup: 0.04 a frame, anchored at its top left
  assert.match(main, /t \+= \(closing \? -0\.04 : 0\.04\) \* dt/);
  assert.match(css, /#popup \{[^}]*transform-origin: 0 0/);
  // the panel: opens ease-out, closes on the same curve backwards (ease-in)
  assert.match(css, /\.modepanel \{[^}]*cubic-bezier\(\.333333, 0, \.666667, \.333333\)/);
  assert.match(css, /\.modepanel\.on \{[^}]*cubic-bezier\(\.333333, \.666667, \.666667, 1\)/);
});

// ---- V10 / V15: STCL stops the motion; the split over a transition -------------------------------------------------------
test("V10: STCL stops the layer's track first; what it last wrote stays (0x625c0)", async () => {
  const vm = machine();
  const { Motion } = await import("../../web/app/js/animation.js");
  vm.op_STCH("30", "img2473");
  const l = vm.layerFor(30);
  l.motion = new Motion(23707, { duration: 1000, loop: 1, frames: [[0, 0, 0, 100, 40, 255, 0, 1000, 1000, 0, 0]], flags: null }, {}, vm.now() - 100);
  vm.op_STCL("0", "30", "", "-60", "", "-60", "0", "0");
  assert.equal(l.motion, null);
  vm.op_STMA("30", "0");
  assert.equal(l.y.at(vm.now()), -60);
});

test("V15: during a transition the split goes over both pictures, in present() and not in the scene (0x2fc50, task order)", () => {
  const src = readFileSync(new URL("../../web/app/js/renderer.js", import.meta.url), "utf8");
  assert.match(src, /if \(!this\.fade && !this\.noSplit\) this\.drawSplit\(now\)/);
  assert.match(src, /this\.splitLastLevel/);
  assert.match(src, /last \+ k \* \(sp\.level - last\)/);
});

// ---- N2: the story text and the rewind ----------------------------------------------------------------------------------
// A small DOM for the text box: elements with classes, parents and the few selectors the code uses.
function textDom() {
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.parent = null; this.className = ""; this._text = ""; this.dataset = { dashFor: "" }; const me = this;
      this.style = { opacity: "", setProperty() {}, getPropertyValue: () => "set" };
      this.classList = { add(c) { const s = new Set(me.className.split(" ").filter(Boolean)); s.add(c); me.className = [...s].join(" "); },
        remove(c) { me.className = me.className.split(" ").filter((x) => x && x !== c).join(" "); },
        contains(c) { return me.className.split(" ").includes(c); }, toggle(c, on) { if (on ?? !this.contains(c)) this.add(c); else this.remove(c); } }; }
    appendChild(c) { c.parent = this; this.children.push(c); return c; }
    after() {}
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
    set textContent(t) { this._text = t; this.children = []; }
    closest(tag) { for (let n = this; n; n = n.parent) if (n.tag === tag) return n; return null; }
    all(test) { const out = [], walk = (n) => { for (const c of n.children) { if (test(c)) out.push(c); walk(c); } }; walk(this); return out; }
    querySelectorAll(sel) {
      if (sel === "rt .ch") return this.all((c) => c.tag !== "#text" && c.classList.contains("ch") && c.closest("rt"));
      if (sel[0] === ".") return this.all((c) => c.tag !== "#text" && c.classList.contains(sel.slice(1)));
      return this.all((c) => c.tag === sel);
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    getClientRects() { return []; }
  }
  const els = { text: new El("div"), panel: new El("div"), note: new El("div") };
  globalThis.document = { getElementById: (id) => els[id] || null, createElement: (t) => new El(t), createTextNode: (t) => { const n = new El("#text"); n.textContent = t; return n; } };
  return els;
}
const textbox = await import("../../web/app/js/textbox.js");
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test("N2-18: turning skip on shows no notice (0x3b430: no caller passes the Skip row, the toggles make no call)", () => {
  assert.doesNotMatch(readFileSync(new URL("../../web/app/js/main.js", import.meta.url), "utf8"), /popup\("skip"\)/);
});

test("N2-19: the copy stops at the first @e or @n, so @k@e@n waits for its voice and no click (0x6e1dc-0x6e294)", () => {
  const vm = machine();
  vm.lines = ["A line."];
  const a = vm.parseMessage("$000000@k@e@n");
  assert.equal(a.noWait, false);
  assert.equal(a.noClick, true);
  assert.equal(vm.parseMessage("$000000@n").noWait, true);
  assert.equal(vm.parseMessage("$000000@e").noClick, true);
});

test("N2-20: @g sets the rest of the text in the second face, the patch's italic (0xbdc2c case g, native frame)", () => {
  const parts = textbox.parseMarkup("@gThat is, until I cross <paths|p> with her.");
  assert.ok(parts.filter((p) => p.t !== undefined).every((p) => p.i));
  assert.equal(parts.find((p) => p.base).g, true);
  assert.ok(textbox.parseMarkup("Plain").every((p) => !p.i));
  assert.equal(textbox.plain("@gThat is"), "That is");
});

test("N2-21: balloon text is in the game's third face (0xbdc2c code 0x18), the story window's stays the story font", () => {
  const css = readFileSync(new URL("../../web/app/style.css", import.meta.url), "utf8");
  assert.match(css, /@font-face \{ font-family: "SeuratPro"; src: url\("\/assets\/fonts\/SeuratPro-M\.otf"\)/);
  assert.match(css, /#text\.balloon \{ font-family: "SeuratPro", var\(--story-font\); \}/);
});

test("N2-22, N2-118, N2-119: runs of dashes (any of U+2015, U+2014, U+2500) or blocks are one element and one letter (0xbdc2c, native frame)", () => {
  textDom();
  try {
    const seg = document.createElement("span");
    const { chars } = textbox.fillSegment(seg, "a■■■b――c——d■e");
    // a b c d e, the two dash runs, the block run and the lone ■
    assert.equal(chars.length, 9);
    const block = seg.querySelectorAll(".blockrun");
    assert.equal(block.length, 1);
    near(parseFloat(block[0].style.width), 3 * textbox.BLOCK_CELL);
    const dashes = seg.querySelectorAll(".dashrun");
    assert.equal(dashes.length, 2);
    assert.equal(dashes[1].textContent, "――");                // an em dash run is drawn as the same one line
    assert.deepEqual(textbox.dashRuns("her——someone"), ["her", "——", "someone"]);
    assert.equal(textbox.isRun("■■"), true);
    assert.equal(textbox.isRun("■"), false);
  } finally { delete globalThis.document; }
});

test("N2-115, corrected by TODO item 51: a new MSG text shows nothing on the frame it is set and starts on the next; MSAD has no such frame (0xc3834, 0xa8240, 0xc0684)", () => {
  const els = textDom();
  try {
    const box = new textbox.TextBox();
    box.setOpen(true, true); box.closed = false; box.speed = 16.666668;   // a letter a frame
    box.add("Abcd", {});
    box.tick(1); assert.equal(box.run.front, 0);             // the frame it is set: the hold hands the front back as 0, no letter
    assert.equal(box.run.chars[0].classList.contains("on"), false);
    box.tick(1); assert.equal(box.run.front, 1);             // native frames: the first letter one frame after the line before dims
    assert.equal(box.run.chars[0].classList.contains("on"), true);
    box.finish();
    box.add("Ef", { inline: true });
    assert.equal(box.run.front, 1);                          // MSAD: the front stood a letter past the old end, so both letters come at once
    box.tick(1); assert.equal(box.run.front, 2);
    assert.equal(box.run.chars[0].classList.contains("on"), true);
    assert.equal(box.run.chars[1].classList.contains("on"), true);
  } finally { delete globalThis.document; }
});

test("N2-117: a pair of spaces is one letter, a leftover space one more (0xab59c: pair -> U+3000)", () => {
  textDom();
  try {
    const seg = document.createElement("span");
    assert.equal(textbox.fillSegment(seg, "a  b   c").chars.length, 3 + 1 + 2);
    assert.equal(seg.textContent, "a  b   c");               // all of them still on screen
  } finally { delete globalThis.document; }
});

test("N2-120: a reading fills in across its base (0xc0684): letter k at min(s - k, 1), s = (front - from) / (to - from) x L", () => {
  near(textbox.rubyAlpha(0, 0, 4, 2, 0), 0);
  near(textbox.rubyAlpha(1, 0, 4, 2, 0), 0.5);
  near(textbox.rubyAlpha(2, 0, 4, 2, 0), 1);
  near(textbox.rubyAlpha(3, 0, 4, 2, 1), 0.5);
  near(textbox.rubyAlpha(4, 0, 4, 2, 1), 1);
  const els = textDom();
  try {
    const box = new textbox.TextBox();
    box.setOpen(true, true); box.closed = false; box.speed = 16.666668;
    box.add("<prey|ab>x", { inline: true });
    const rt = els.text.querySelectorAll("rt")[0];
    assert.deepEqual(rt.children.map((c) => c.textContent), ["a", "b"]);
    box.tick(1);                                              // front 1 of the base's 4 letters: s = 0.5
    assert.equal(rt.children[0].style.opacity, "0.5");
    assert.equal(rt.children[1].classList.contains("on"), false);
    box.finish();
    assert.ok(rt.children.every((c) => c.classList.contains("on")));
  } finally { delete globalThis.document; }
});

test("N2-122: a break the port takes out is a space on screen and no letter of the typing (0xbd990, reflow SOFT)", () => {
  const els = textDom();
  try {
    const seg = document.createElement("span");
    const { chars } = textbox.fillSegment(seg, `one${textbox.SOFT}two`);
    assert.equal(chars.length, 6);
    assert.equal(seg.textContent, "one two");
    assert.equal(textbox.plain(`one${textbox.SOFT}two`), "one two");
    assert.deepEqual(textbox.parseMarkup(`a${textbox.SOFT}@tb`).find((p) => p.split), { split: true, lf: 1 });   // the @t index counts it as a raw break
  } finally { delete globalThis.document; }
});

test("N2-111: the page mark's last cell repeats the one before it (table 0x5730a0 entry 104), the line mark's strip is plain", () => {
  const css = readFileSync(new URL("../../web/app/style.css", import.meta.url), "utf8");
  assert.match(css, /#click-mark\.page \{[^}]*animation-name: markpage, markin/);
  assert.match(css, /@keyframes markpage \{[^\n]*100% \{ background-position: -4338\.36px 0; \}/);
});

test("N2-110: F799 stays set past the page's click, so an MSAD that follows still counts as a page end (0x6e950 at 0x6e97c, 0x81ed0)", async () => {
  const vm = machine();
  vm.op_WNTY("1");
  await vm.afterWait();
  assert.equal(vm.pageEnd, true);
  vm.op_WNTY("0");
  assert.equal(vm.pageEnd, false);
});

test("N2-114: a blank MSG still takes its row and the MSAD after it goes on that row (0x6e0d0, native frame)", async () => {
  const added = [];
  const vm = machine({ text: { add: async (t, o) => { added.push([t, !!o.inline]); } } });
  vm.lines = ["", "Honestly"];
  vm.script = { name: "t", ops: [], labels: {} };
  await vm.message("$000000", false);
  await vm.message("$000001", true);
  assert.deepEqual(added, [["", false], ["Honestly", true]]);
});

test("N2-116: a voice with its row at volume 0 still runs, so its waits last; a row switched off plays nothing (0x6e6c8, 0xee6b4)", async () => {
  const audio = new Audio();
  const h = withContext(audio);
  audio.rowOf = () => 3;
  audio.buffer = async () => h.ctx.createBuffer ? h.ctx.createBuffer(1, 1, 8000) : { duration: 1, numberOfChannels: 1 };
  audio.vol.charOn[3] = true; audio.vol.chars[3] = 0;
  const started = h.ctx.sources.length;
  await audio.playVoice("X");
  assert.equal(h.ctx.sources.length, started + 1);
  audio.vol.charOn[3] = false;
  await audio.playVoice("Y");
  assert.equal(h.ctx.sources.length, started + 1);
});

test("N2-3, N2-4: a rewind lands only on a message that is a page's first line, never a choice (0x816e0-0x8173c, native frames)", () => {
  const vm = machine();
  const point = (F823, choice = false) => ({ vars: { F823 }, choice });
  vm.trail = [point(1), point(2), point(3), point(1), point(2), point(0, true), point(1)];
  vm.waitResolve = () => {};                                  // waiting at the last point
  assert.equal(vm.rewindTarget(false), 3);                    // the choice before it is passed over; the page's first line
  vm.trail.length = 4;
  assert.equal(vm.rewindTarget(false), 0);                    // from a page's first line, to the previous page's
  vm.trail = [point(2), point(3)];
  assert.equal(vm.rewindTarget(false), -1);
  vm.waitResolve = null;
});

test("N2-84, N2-77: a rewind or Quick Jump types the line again (0x5baf0): letters off, read speed, set as a new line is, ruby letters too", async () => {
  const els = textDom();
  try {
    const box = new textbox.TextBox();
    box.setOpen(true, true); box.closed = false; box.speed = 16.666668;
    box.add("Ab<c|d>", {});
    box.finish();
    assert.ok(els.text.querySelectorAll(".ch").every((c) => c.classList.contains("on")));
    let done = false;
    box.retype().then(() => { done = true; });
    assert.ok(els.text.querySelectorAll(".ch").every((c) => !c.classList.contains("on")));
    assert.equal(box.run.n, 3);
    assert.equal(box.run.fresh, true);
    assert.equal(box.run.ruby.length, 1);
    box.tick(1);                                               // the frame it is set: nothing yet
    assert.equal(box.run.chars[0].classList.contains("on"), false);
    box.tick(1);                                               // then a letter
    assert.equal(box.run.chars[0].classList.contains("on"), true);
    assert.equal(box.run.chars[1].classList.contains("on"), false);
    box.finish();
    await new Promise((r) => setTimeout(r));
    assert.equal(done, true);
    assert.equal(box.retype === undefined, false);
  } finally { delete globalThis.document; }
});

test("N2-80, corrected by TODO item 51: choice rows always type at the read text's speed (native runs: config +0x10 whatever the lines were)", () => {
  assert.match(readFileSync(new URL("../../web/app/js/ui.js", import.meta.url), "utf8"), /ChoiceFx\.perFrame\(this\.vm\.readSpeed\)/);
});

test("N2-82: a held advance key does nothing further (the press edge, input +0x10)", () => {
  assert.match(readFileSync(new URL("../../web/app/js/main.js", import.meta.url), "utf8"), /case "advance":\n\s*\/\/[^\n]*\n\s*if \(e\.repeat \|\| choosing\(\)\) return true;/);
});

test("N2-83: the end of an instant run takes the page's earlier lines to their dim level (0x802c0)", () => {
  const els = textDom();
  try {
    const box = new textbox.TextBox();
    box.lines = [{ segs: [], timer: 3, T: 0 }, { segs: [], timer: 0, T: 0 }, { segs: [], timer: 0, T: 0 }];
    box.settleEarlier();
    assert.deepEqual(box.lines.map((l) => l.timer), [-1, -1, 0]);
  } finally { delete globalThis.document; }
});

test("N2-75, N2-76: the rewind trail reaches as far as the ring of 800 records; a rewind over an ATSV drops its point (0x5a910, 0x5cdf0)", async () => {
  const vm = machine();
  vm.ring = 10;
  vm.remember();
  vm.ring = 809;
  vm.remember();
  assert.equal(vm.trail.length, 2);
  vm.ring = 810;
  vm.remember();
  assert.equal(vm.trail.length, 2);                          // the first point has left the ring
  // the point of an ATSV made after the point rewound to goes away
  const before = { ring: 5 }, after = { ring: 20 };
  vm.scenePoints = [before, after];
  vm.nearScene = 2;
  await vm.restore({ layers: [], script: 0, pc: 0, vars: {}, audio: {}, html: "", ring: 10, flow: {} }, { rewind: true, retype: false }).catch(() => {});
  assert.deepEqual(vm.scenePoints, [before]);
  assert.equal(vm.nearScene, 0);
  vm.stop();
});

test("N2-85, corrected by TODO item 51: the auto wait does not run under the menu and starts again in full when it closes; switching auto on leaves what is left of the wait", async () => {
  const vm = machine();
  delete vm.armAuto;                                          // the machine's stand-in off: the real timer
  vm.audio.voiceDone = async () => {};
  const t0 = performance.now();
  vm.waitResolve = () => {};
  vm.autoClick = 2000;
  vm.autoSince = t0 - 500;                                    // the line has waited half a second
  vm.auto = true;
  vm.armAuto();
  assert.ok(vm.autoUntil - performance.now() > 1400 && vm.autoUntil - performance.now() <= 1500, "what is left of the wait, not all of it");
  vm.paused = true;
  assert.equal(vm.autoUntil, 0);
  vm.paused = false;
  const left = vm.autoUntil - performance.now();
  assert.ok(left > 1990 && left <= 2000 + 2 * (1000 / 60) + 1, `the whole wait again (${left})`);
  // a line that has waited longer than the delay goes on at once when auto is switched on
  let went = false;
  vm.waitResolve = () => { went = true; };
  vm.autoSince = performance.now() - 5000;
  vm.armAuto();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(went, true);
  clearTimeout(vm.autoTimer);
  vm.waitResolve = null;
});

test("N2-78: a choice's first row on a page with text leaves one blank row before the next line (0x78a80-0x78a98)", () => {
  const breaks = [];
  const vm = machine({ text: { addBreak: (n) => breaks.push(n) } });
  vm.vars.F823 = 2;
  vm.op_SELR("0", "x");
  vm.op_SELR("1", "y");
  assert.deepEqual(breaks, [1]);                             // the first row only
  assert.equal(vm.vars.F849, 1);                             // F847 + F823
  const none = machine({ text: { addBreak: (n) => breaks.push(n) } });
  none.vars.F823 = 0;
  none.op_SELR("0", "x");
  assert.deepEqual(breaks, [1]);
});

// ---- the script machine's last items: where a save resumes, what a replay plays, the voice, the delay slots -------
const restoreBase = (extra = {}) => ({ layers: [], script: 0, pc: 0, html: "", audio: {}, flow: {}, vars: {}, ...extra });
const seOpts = (ms) => [`\`068:${ms}`];
const waitFor = (ms) => new Promise((r) => setTimeout(r, ms));

test("N2-1: ATSV moves the checkpoint only on a page's first line, its Return to Previous Scene point is made either way (0x79030-0x79044, 0x7c0dc)", () => {
  const vm = machine();
  vm.vars.F823 = 1;                                          // straight after a page's first line
  vm.pc = 5;
  vm.op_ATSV("1");
  const first = vm.savePoint;
  assert.equal(first.pc, 5);
  assert.equal(first.choice, false);
  assert.equal(vm.scenePoints.length, 1);
  vm.vars.F823 = 3;                                          // a later line, before a choice: the page's first line stays the checkpoint
  vm.pc = 9;
  vm.op_ATSV("1");
  assert.equal(vm.savePoint, first);
  assert.equal(vm.scenePoints.length, 2);
  assert.equal(vm.scenePoints[1].pc, 9);                     // the ring still takes the record
  assert.equal(vm.scenePoints[1].vars.F823, 3);
  vm.vars.F823 = 0;                                          // a new page with no text yet moves it again
  vm.pc = 11;
  vm.op_ATSV();
  assert.equal(vm.savePoint.pc, 11);
  vm.locked = true;                                          // XSTP .. XRSM: the task holds records back (+0x35c0)
  vm.pc = 13;
  vm.op_ATSV();
  assert.equal(vm.savePoint.pc, 11);
  assert.equal(vm.scenePoints.length, 3);                    // no ring point either (0x7c0cc)
});

test("N2-1: a message moves the checkpoint on a page's first line only, and not while the controls are locked (+0x35c0)", async () => {
  const vm = machine();
  vm.waitAdvance = VM.prototype.waitAdvance;
  vm.armAuto = () => {};
  vm.vars.F823 = 1;
  vm.pc = 3;
  let p = vm.message("one", false);
  await waitFor(1); vm.advance(); await p;
  assert.equal(vm.savePoint.pc, 3);
  vm.vars.F823 = 2;
  vm.pc = 4;
  p = vm.message("two", false);
  await waitFor(1); vm.advance(); await p;
  assert.equal(vm.savePoint.pc, 3);                          // the later line leaves it
  vm.vars.F823 = 1;
  vm.pc = 5;
  vm.locked = true;                                          // a click is ignored while locked: the wait is ended by hand
  p = vm.message("locked", false);
  await waitFor(1); vm.waitResolve(); await p;
  assert.equal(vm.savePoint.pc, 3);
});

test("N2-1: SELD leaves the checkpoint alone: a save at a choice resumes at the page's first line (0x7f850 is never reached)", async () => {
  const vm = machine({ hooks: { onChoice: async () => 0 } });
  vm.vars.F823 = 1;
  vm.pc = 2;
  vm.op_ATSV("1");
  const cp = vm.savePoint;
  vm.vars.F823 = 3;
  vm.choices = [{ value: 0, text: "x", locked: false }];
  vm.pc = 8;
  await vm.op_SELD("_D000", "1");
  assert.equal(vm.savePoint, cp);
  assert.ok(vm.trail.at(-1).choice);                         // the choice's own rewind point is still made
});

test("N2-1: a restore moves the checkpoint only for a record on a page's first line (0x5d300-0x5d32c); a load takes its record, however old the save", async () => {
  const vm = machine();
  vm.getScript = async () => vm.script;
  vm.savePoint = { marker: true };
  await vm.restore(restoreBase({ vars: { F823: 3 } }), { rewind: true, retype: false });   // a Quick Jump to a later line
  assert.equal(vm.savePoint.marker, true);
  await vm.restore(restoreBase({ vars: { F823: 1 } }), { rewind: true, retype: false });   // a rewind to a first line
  assert.equal(vm.savePoint.vars.F823, 1);
  vm.savePoint = { marker: true };
  await vm.restore(restoreBase({ vars: { F823: 5 }, choices: ["a"], pc: 7 }));             // a save from before the fix, taken at a choice: as today
  assert.equal(vm.savePoint.vars.F823, 5);
  assert.equal(vm.savePoint.pc, 7);
  vm.stop();
});

test("N2-2: RDAS is passed over in a replay from the gallery's flowchart (0x79b78 -> 0x50f0); the Ending List and normal play still ask", async () => {
  let asked = 0;
  const vm = machine({ hooks: { onSceneSkip: async () => { asked++; return false; } } });
  vm.skipRead = true;
  vm.skipConfirm = true;
  vm.flow.completed.add(5);
  vm.replay = true;
  vm.replaySource = "flowchart";
  await vm.op_RDAS("5");
  assert.equal(asked, 0);
  vm.replaySource = "ending";
  await vm.op_RDAS("5");
  await vm.sceneSkip;                                     // asked on the frame after RDAS (N2-130)
  assert.equal(asked, 1);
  vm.replay = false;
  vm.replaySource = null;
  await vm.op_RDAS("5");
  await vm.sceneSkip;
  assert.equal(asked, 2);
  const main = readFileSync(new URL("../../web/app/js/main.js", import.meta.url), "utf8");
  assert.match(main, /vm\.replaySource = replay \? replayFrom : null/);
});

test("N2-79: Replay Voice's target is the last VPLY or VPL2, whatever clicks and later lines do (0xae0790); a restore takes it from the record", async () => {
  const played = [];
  const vm = machine({ audio: { voicePlaying: false, playVoice: (n) => played.push(n) } });
  vm.getScript = async () => vm.script;
  vm.waitAdvance = VM.prototype.waitAdvance;
  vm.armAuto = () => {};
  vm.op_VPLY("A");
  let p = vm.message("one", false);
  await waitFor(1); vm.advance(); await p;
  assert.equal(vm.lastVoice, "A");                           // the click leaves it
  p = vm.message("two", false);
  await waitFor(1); vm.advance(); await p;
  assert.equal(vm.lastVoice, "A");                           // and the next line, with no voice of its own
  vm.replayVoice();
  assert.deepEqual(played.at(-1), "A");
  vm.op_VPL2("B");                                           // VPL2 too, and it leaves no voice pending (0x7a4fc)
  assert.equal(vm.lastVoice, "B");
  assert.equal(vm.pendingVoice, null);
  // the record: an earlier voice stays Replay Voice's target though the record's own voice is none
  await vm.restore(restoreBase({ vars: { F823: 2 }, voice: null }), { rewind: true, retype: false });
  assert.equal(vm.lastVoice, null);
  await vm.restore(restoreBase({ vars: { F823: 2 }, voice: "C" }), { rewind: true, retype: false });
  assert.equal(vm.lastVoice, "C");
  vm.stop();
  const ui = readFileSync(new URL("../../web/app/js/ui.js", import.meta.url), "utf8");
  assert.doesNotMatch(ui, /Replay voice", fn: \(\) => E\.replayVoice\(\), can/);   // the game never greys the button out
});

test("N2-79: the next MSG's record keeps the voice VPLY or VPL2 named; a FADS clears it, an MSAD keeps it (0xae08b0)", async () => {
  const vm = machine({ gfx: { hold() {} } });
  vm.script = { name: "synthetic", ops: [], labels: {}, zm: undefined };
  vm.op_VPLY("A");
  assert.equal(vm.recordVoice, "A");
  await vm.message("one", false);
  assert.equal(vm.msgVoice, "A");
  assert.equal(vm.recordVoice, null);                        // the MSG took it
  vm.op_VPLY("B");
  await vm.op_FADS("1", "0", "0");
  assert.equal(vm.recordVoice, null);
  assert.equal(vm.pendingVoice, "B");                        // the pending voice is not touched: it still starts with the MSG
  await vm.message("two", false);
  assert.equal(vm.msgVoice, null);
  vm.op_VPL2("C");
  await vm.message("three", true);                           // MSAD (14_01_CIEL14_1C $037544): no record of its own
  assert.equal(vm.recordVoice, "C");
  await vm.message("four", false);                           // $037545: the MSG's record has VPL2's voice
  assert.equal(vm.msgVoice, "C");
  assert.equal(vm.recordVoice, null);
});

test("N2-79: a record's voice is the message's own: a load plays it, an ATSV's or a choice's record has none (0x5a910 writes -1)", async () => {
  const vm = machine();
  vm.op_VPLY("V");
  await vm.message("line", false);
  vm.remember();
  assert.equal(vm.trail.at(-1).voice, "V");                  // the wait's record
  vm.vars.F823 = 1;
  vm.op_ATSV("1");
  assert.equal(vm.savePoint.voice, null);
  vm.remember(true);
  assert.equal(vm.trail.at(-1).voice, null);
});

test("N2-81: the fast-forward key held cuts the voice each frame under \"Voices stop on input\" and F1123 clear; not with a menu up (0x8081c-0x80848)", () => {
  let stopped = 0;
  const vm = machine({ audio: { voicePlaying: true, stopVoice: () => { stopped++; } } });
  vm.fastForwardHeld = true;
  vm.voiceHeldCut();
  assert.equal(stopped, 1);
  vm.vars.F1123 = 1;                                         // 09_01_CIEL09_1_1's line that goes on through the change of scene
  vm.voiceHeldCut();
  assert.equal(stopped, 1);
  vm.vars.F1123 = 0;
  vm.voiceStop = false;
  vm.voiceHeldCut();
  assert.equal(stopped, 1);
  vm.voiceStop = true;
  vm.paused = true;                                          // the system menu: 0x40ed0 returns before the frame step
  vm.voiceHeldCut();
  assert.equal(stopped, 1);
  vm.paused = false;
  vm.fastForwardHeld = false;
  vm.voiceHeldCut();
  assert.equal(stopped, 1);
  assert.match(readFileSync(new URL("../../web/app/js/main.js", import.meta.url), "utf8"), /vm\.voiceHeldCut\(\)/);
});

test("N2-81: a VCWT passed while skipping, the skip that ends a line's own voice wait, and a press while skipping stop the voice whatever the setting or F1123; skipping past another wait does not (0x804b8, 0x80670, 0x80734)", async () => {
  let stopped = 0;
  const vm = machine({ audio: { voicePlaying: true, stopVoice: () => { stopped++; }, voiceDone: () => new Promise(() => {}) } });
  vm.waitAdvance = VM.prototype.waitAdvance;
  vm.armAuto = () => {};
  vm.vars.F1123 = 1;
  vm.voiceStop = false;
  vm.skip = true;
  await vm.op_VCWT();
  assert.equal(stopped, 1);                                  // VCWT under skip
  await vm.waitAdvance();                                    // a click wait skipping passes by itself: nothing
  assert.equal(stopped, 1);
  const endBySkip = async () => {                            // a wait the skip ends, as setSkip(true) does
    vm.skip = false;
    const w = vm.waitAdvance();
    await waitFor(1);
    vm.skip = true;
    vm.advance();
    await w;
  };
  await endBySkip();
  assert.equal(stopped, 1);                                  // the voice is not this line's: skipping alone leaves it (0x80734)
  vm.ownVoice = true;
  await endBySkip();
  assert.equal(stopped, 2);                                  // the line's own voice stops, setting or no setting (flag 4, 0x804b8)
  vm.ownVoice = false;
  vm.press();                                                // a press while skipping stops any voice (0x80670)
  assert.equal(stopped, 3);
  vm.skip = false;
  vm.press();                                                // not skipping: the press only ends a wait (none here)
  assert.equal(stopped, 3);
  // a line with @e: the click that passes its voice wait stops it under the setting, as at any wait for the voice
  vm.vars.F1123 = 0;
  vm.voiceStop = true;
  vm.pendingVoice = "A";
  const m = vm.message("x@e", false);
  await waitFor(1);
  vm.advance();
  await m;
  assert.equal(stopped, 4);
  // an @e line with no voice of its own does not wait for an older one (flag 4 is clear)
  vm.pendingVoice = null;
  let done = false;
  const n = vm.message("y@e", false).then(() => { done = true; });
  await waitFor(5);
  assert.equal(done, true);
  await n;
});

test("S39: a record keeps the 068 delay slots and a restore goes on counting (0x5a910 +0x3914, 0x5baf0)", async () => {
  const played = [];
  const vm = machine({ audio: { playSE: (ch, loop, name, o, f) => played.push([ch, loop, name, f?.delayed]), volSE() {}, fadeSE() {} } });
  vm.getScript = async () => vm.script;
  vm.op_SEPL("3", "1", "SE_A", ...seOpts(100));
  const s = vm.snapshot();
  assert.equal(s.delayed.length, 1);
  assert.deepEqual([s.delayed[0].k, s.delayed[0].kind, s.delayed[0].name, s.delayed[0].loop], [3, 1, "SE_A", true]);
  assert.ok(s.delayed[0].left > 0 && s.delayed[0].left <= 117);
  assert.equal(played.length, 0);
  await vm.restore(restoreBase({ vars: {}, delayed: s.delayed }));
  assert.equal(vm.delayed.size, 1);
  assert.equal(played.length, 0);                            // stop() cancelled it, the restore put it back
  await waitFor(150);
  assert.deepEqual(played, [[3, true, "SE_A", true]]);       // it ran on from where it was
  assert.equal(vm.delayed.size, 0);
  vm.stop();
});

test("S39: a record without delay slots (an older save) restores as before: nothing queued, nothing played", async () => {
  const played = [];
  const vm = machine({ audio: { playSE: (...a) => played.push(a), volSE() {}, fadeSE() {} } });
  vm.getScript = async () => vm.script;
  vm.op_SEPL("3", "0", "SE_A", ...seOpts(20));
  const old = restoreBase({ vars: { F823: 1 }, voice: "A00_01_00_0001_0" });   // no `delayed` field
  assert.equal(old.delayed, undefined);
  await vm.restore(old);
  assert.equal(vm.delayed.size, 0);
  await waitFor(60);
  assert.equal(played.length, 0);
  assert.equal(vm.lastVoice, "A00_01_00_0001_0");
  assert.equal(JSON.parse(JSON.stringify(vm.snapshot())).delayed, undefined);   // and a record with no slot in use says nothing
  vm.stop();
});

test("S39: a message's record has the slots of its start, so a delay that fires during the typing is still ahead of that point (0x6e0d0 -> 0x5a910)", async () => {
  const played = [];
  const vm = machine({ text: { add: () => new Promise((r) => setTimeout(r, 80)) }, audio: { voicePlaying: false, playSE: (ch, loop, name, o, f) => played.push(name), volSE() {}, fadeSE() {} } });
  vm.waitAdvance = VM.prototype.waitAdvance;
  vm.armAuto = () => {};
  vm.op_SEPL("3", "0", "SE_B", ...seOpts(20));
  const m = vm.message("one", false);
  await waitFor(70);
  assert.deepEqual(played, ["SE_B"]);                        // it fired during the typing
  await waitFor(30);
  vm.advance();
  await m;
  const d = vm.trail.at(-1).delayed;
  assert.equal(d.length, 1);
  assert.equal(d[0].name, "SE_B");
  assert.ok(d[0].left <= 34);
  assert.equal(vm.delayed.size, 0);
  // a later message starts with no slot in use: nothing for its record
  vm.text.add = async () => {};
  const n = vm.message("two", false);
  await waitFor(1);
  vm.advance();
  await n;
  assert.equal(vm.trail.at(-1).delayed, undefined);
});

test("the Ciel-sensei corners keep every line break of their own: the game shows those rows as they are", () => {
  const vm = machine();
  vm.lines = ["You only need to pay attention to what I have to say for\nthese lessons."];
  vm.script = { name: "QA_01", ops: [["MSG", "$000000"]], labels: {} };
  assert.equal(vm.lineText(0), vm.lines[0]);
  assert.equal(vm.parseMessage("$000000").text, vm.lines[0]);
  // elsewhere the patch's injector wrap still goes
  vm.script = { name: "T", ops: [["MSG", "$000000"]], labels: {} };
  assert.notEqual(vm.lineText(0), vm.lines[0]);
});

// ---- the dialog boxes: the system's Yes / No window, SELS / SELA, notices, the press rules ---------------------------------
const uifx = await import("../../web/app/js/uifx.js");
const { UI } = await import("../../web/app/js/ui.js");
const { markSaved } = await import("../../web/app/js/vm.js");
const css = readFileSync(new URL("../../web/app/style.css", import.meta.url), "utf8");

// A small DOM with the system window layer and a UI whose windows step by hand.
function windowRig() {
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.parent = null; this.style = { setProperty(k, v) { this[k] = v; } }; this.listeners = {}; this.cls = new Set(); this.text = ""; }
    set className(c) { this.cls = new Set(String(c).split(/\s+/).filter(Boolean)); }
    get className() { return [...this.cls].join(" "); }
    get classList() { const s = this.cls; return { add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)), toggle: (c, on = !s.has(c)) => { if (on) s.add(c); else s.delete(c); return on; }, contains: (c) => s.has(c) }; }
    append(...cs) { for (const c of cs) { if (typeof c === "string") { this.text += c; continue; } c.remove(); c.parent = this; this.children.push(c); } }
    prepend(c) { c.remove(); c.parent = this; this.children.unshift(c); }
    appendChild(c) { this.append(c); return c; }
    remove() { if (this.parent) { const p = this.parent.children; p.splice(p.indexOf(this), 1); this.parent = null; } }
    set textContent(t) { for (const c of [...this.children]) c.remove(); this.text = String(t); }
    get textContent() { return this.text + this.children.map((c) => c.textContent).join(""); }
    get isConnected() { let e = this; while (e.parent) e = e.parent; return e === root || e === sysui; }
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
    removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((g) => g !== f); }
    fire(t, e = {}) { for (const f of this.listeners[t] || []) f({ button: 0, buttons: 0, stopPropagation() {}, preventDefault() {}, ...e }); }
    setAttribute() {}
    querySelector(sel) { return sel === ".page" ? {} : null; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 1920, height: 1080 }; }
    findAll(fn, out = []) { for (const c of this.children) { if (fn(c)) out.push(c); c.findAll(fn, out); } return out; }
  }
  const root = new El("div"), sysui = new El("div"), stage = new El("div");
  const had = { doc: globalThis.document, add: globalThis.addEventListener, rem: globalThis.removeEventListener };
  globalThis.document = { createElement: (t) => new El(t), getElementById: (id) => (id === "sysui" ? sysui : id === "stage" ? stage : new El("div")) };
  const loops = [], sounds = [];
  const ui = Object.assign(Object.create(UI.prototype), {
    root, items: [], fx: [], sel: 0, keyFn: null, backFn: null, backBtn: null, sounds, sysWindows: new Set(), screen: "x",
    sound(n) { sounds.push(n); }, setBack() {}, showCaption() {}, stopFx() {}, closePanel() {}, animate(f) { this.fx.push(f); },
    sysLoop(f) { loops.push(f); return () => { const i = loops.indexOf(f); if (i >= 0) loops.splice(i, 1); }; },
    pointerMoved: true,
  });
  const frames = (n) => { for (let k = 0; k < n; k++) for (const f of [...loops]) f(1); };
  const box = () => sysui.children.find((c) => c.cls.has("dialog") && !c.cls.has("notice"));
  return { ui, El, root, sysui, stage, frames, loops, box, sounds, done() { globalThis.document = had.doc; } };
}
const q = (box) => box.findAll((c) => c.cls.has("dialog-q"))[0];
const win = (box) => box.findAll((c) => c.cls.has("dialog-win"))[0];
const buttons = (box) => box.findAll((c) => c.cls.has("spbtn"));

test("N2-48: the answer acts on the frame after the hold while the window fades; the question and a notice cross-fade (0x49f00 state 3 -> 4, 0x4abe0)", () => {
  const r = windowRig();
  const log = [];
  r.ui.dialog("Overwrite?", () => log.push("yes"), () => log.push("no"), { startNo: false });
  r.frames(15);
  assert.ok(r.ui.keyFn, "the dialog has the keys while up");
  r.ui.choose(r.ui.sel);                                     // A on Yes: sound 1, the button pressed, a 15-frame hold
  r.frames(15);
  assert.deepEqual(log, [], "not during the hold");
  assert.ok(r.box(), "still up");
  r.frames(1);
  assert.deepEqual(log, ["yes"], "the caller acts on the first frame of the fade");
  assert.equal(r.ui.keyFn, null, "and the keys are back with it");
  assert.ok(r.box(), "the window goes on fading on its own layer");
  // Back: one frame, then the same
  r.frames(20);
  assert.equal(r.box(), undefined);
  // the system window's question opens and the answer starts a notice that fades in while it fades out
  const r2 = windowRig();
  r2.ui.dialog("Overwrite?", () => { r2.notice = r2.ui.notify("Saving", { held: true }); }, null);
  r2.frames(15);
  r2.ui.choose(r2.ui.sel);
  r2.frames(16);
  assert.equal(r2.sysui.children.length, 2, "the notice comes up under the old window");
  const n = r2.sysui.children.find((c) => c.cls.has("notice"));
  assert.ok(Number(win(n).style.opacity) < 1 && Number(win(r2.box()).style.opacity) < 1, "both fading together");
  r.done(); r2.done();
});

test("N2-48: a screen taken down takes a window still up with it, but not one that has answered and is fading (0x49f00 runs regardless)", () => {
  const r = windowRig();
  r.ui.dialog("Quick Load?", () => {}, null);
  r.frames(15);
  r.ui.cancelSystemWindows();
  assert.equal(r.box(), undefined);
  const r2 = windowRig();
  r2.ui.dialog("Quick Load?", () => {}, null);
  r2.frames(15);
  r2.ui.choose(r2.ui.sel);
  r2.frames(16);
  r2.ui.cancelSystemWindows();
  assert.ok(r2.box(), "answered and fading: it carries on");
  r.done(); r2.done();
});

test("Redesign 126 (in place of N2-51): the button under a moving pointer takes the cursor with sound 0; a pointer at rest or a touch lights nothing; one click chooses", () => {
  const r = windowRig();
  const out = [];
  const a = new r.El("button"), b = new r.El("button"), c = new r.El("button");
  r.ui.items = [];
  r.ui.add(a, () => out.push("a"), {});
  r.ui.add(b, () => out.push("b"), {});
  r.ui.add(c, () => out.push("c"), { keysOnly: true });
  r.ui.select(0);
  r.sounds.length = 0;
  r.ui.pointerMoved = false;
  b.fire("pointermove", { pointerType: "mouse" });
  assert.equal(r.ui.sel, 0, "the page moved under a pointer at rest: the keys' cursor stays");
  r.ui.pointerMoved = true;
  b.fire("pointermove", { pointerType: "touch" });
  assert.equal(r.ui.sel, 0, "a touch lights nothing");
  b.fire("pointermove", { pointerType: "mouse" });
  assert.equal(r.ui.sel, 1);
  b.fire("pointermove", { pointerType: "mouse" });
  assert.deepEqual(r.sounds, [0], "the cursor sound once, as it arrives");
  c.fire("pointermove", { pointerType: "mouse" });
  assert.equal(r.ui.sel, 1, "an item for the keys alone does not follow the pointer");
  a.fire("click");
  assert.deepEqual(out, ["a"], "one click chooses, wherever the cursor was");
  assert.equal(r.ui.sel, 0);
  c.fire("click");
  assert.deepEqual(out, ["a"]);
  // an item that is not ready takes neither
  const d = new r.El("button");
  let ready = false;
  r.ui.add(d, () => out.push("d"), { ready: () => ready });
  d.fire("pointermove", { pointerType: "mouse" });
  d.fire("click");
  assert.deepEqual([r.ui.sel, out.length], [0, 1]);
  ready = true;
  d.fire("click");
  assert.deepEqual(out, ["a", "d"]);
  // the pointer does not scroll a list to the row it lights; the keys do
  const row = new r.El("button");
  let scrolled = 0;
  row.scrollIntoView = () => { scrolled++; };
  r.ui.add(row, () => {}, { scroll: true });
  row.fire("pointermove", { pointerType: "mouse" });
  assert.equal(scrolled, 0);
  r.ui.select(0);
  r.ui.select(r.ui.items.length - 1);
  assert.equal(scrolled, 1);
  r.done();
});

test("Redesign 126 (in place of N2-159): the game's tap windows (0xad4e0) stay as a table only: a click of any length chooses; the touch screen's Back button is gone and the touch ring is back for every press", () => {
  const FRAME = 1000 / 60;
  const reader = new uifx.TouchPress();
  // the reader itself still counts as the game does
  reader.down(100, 100, 0);
  let f = reader.up(2 * FRAME);
  assert.equal(f.tap, false, "2 frames + the release sample: 3");
  reader.down(100, 100, 100000);
  f = reader.up(100000 + 3 * FRAME);
  assert.equal(f.tap, true, "3 frames + the release sample: 4");
  reader.down(100, 100, 2000000);
  f = reader.up(2000000 + 300 * FRAME);
  assert.deepEqual([f.tap, f.long], [false, false]);
  // the screens no longer ask it
  const ui = readFileSync(new URL("../../web/app/js/ui.js", import.meta.url), "utf8");
  assert.doesNotMatch(ui, /TouchPress|tapped\(|lastTouch/);
  assert.doesNotMatch(ui, /tap: "long"/);
  // the Back button (0x4a410) is not drawn any more: a right click or Esc goes back, as the hint bars say
  for (const file of ["js/ui.js", "js/gallery.js", "js/flowchart.js", "style.css"]) assert.doesNotMatch(readFileSync(new URL(`../../web/app/${file}`, import.meta.url), "utf8"), /setBack|backBtn|backbtn|back_btn/, file);
  // and a left press of the mouse draws the game's touch ring again, as a touch does
  const main = readFileSync(new URL("../../web/app/js/main.js", import.meta.url), "utf8");
  assert.match(main, /const touchFx = new TouchFx\(\$\("touchfx"\)\);\naddEventListener\("pointerdown", \(e\) => \{\n  if \(e\.button !== 0 \|\| document\.documentElement\.classList\.contains\("upright"\)\) return;/);
});

test("Redesign 126: the system's Yes / No under the pointer: the cursor goes to the button pointed at, and one click on either answers (0x49f00's two taps are gone)", () => {
  const r = windowRig();
  const log = [];
  r.ui.dialog("Load?", () => log.push("yes"), () => log.push("no"));
  const [no, yes] = buttons(r.box());
  no.fire("pointermove", { pointerType: "mouse" });
  no.fire("click");
  assert.equal(r.ui.sel, 1, "nothing while the window opens");
  r.frames(15);
  assert.equal(r.ui.sel, 1, "the cursor starts on Yes");
  r.sounds.length = 0;
  no.fire("pointermove", { pointerType: "mouse" });
  assert.equal(r.ui.sel, 0, "the pointer moves it");
  assert.deepEqual(r.sounds, [0]);
  assert.deepEqual([no.on, yes.on], [true, false]);
  yes.fire("click");
  r.frames(16);
  assert.deepEqual(log, ["yes"], "a click answers at once, whatever had the cursor");
  const r2 = windowRig();
  const log2 = [];
  r2.ui.dialog("Overwrite?", () => log2.push("yes"), () => log2.push("no"), { startNo: true });
  r2.frames(15);
  r2.box().fire("click");
  r2.frames(16);
  assert.deepEqual(log2, [], "a click off the buttons answers nothing");
  r2.ui.back();        // a right click or Esc
  r2.frames(3);
  assert.deepEqual(log2, ["no"]);
  r.done(); r2.done();
});

test("Redesign 126: SELS and SELA under the pointer: neither picked at first, the pointer picks, a click on a button answers; a click elsewhere and Back do nothing (0x85690's press-anywhere is gone)", () => {
  const r = windowRig();
  const log = [];
  r.ui.dialog("Enter hint corner?", () => log.push("yes"), () => log.push("no"), { kind: "story" });
  r.frames(10);
  const [no, yes] = buttons(r.box());
  assert.equal(r.ui.sel, -1);
  r.box().fire("click");
  r.ui.back();
  r.frames(12);
  assert.deepEqual(log, [], "nothing but a button answers");
  yes.fire("pointermove", { pointerType: "mouse" });
  assert.equal(r.ui.sel, 1, "the pointer picks the button under it");
  no.fire("pointermove", { pointerType: "mouse" });
  assert.equal(r.ui.sel, 0);
  yes.fire("click");
  assert.deepEqual(log, [], "the answer waits for the fade");
  r.frames(10);
  assert.deepEqual(log, ["yes"]);
  const r2 = windowRig();
  const log2 = [];
  r2.ui.dialog("Save Progress?", () => log2.push("yes"), () => log2.push("no"), { kind: "story", saveAsk: true });
  r2.frames(10);
  const [no2] = buttons(r2.box());
  no2.fire("click");   // one click, with nothing picked before
  r2.frames(10);
  assert.deepEqual(log2, ["no"]);
  r.done(); r2.done();
});

test("N2-49 / N2-157 / N2-158 / N2-50: SELS and SELA fade all together at 0.1 a frame, unscaled as they open; the window at x 321; the smaller question (0x85900)", () => {
  const r = windowRig();
  r.ui.dialog("Enter hint corner?", () => {}, () => {}, { kind: "story" });
  const box = r.box(), [no, yes] = buttons(box);
  assert.equal(box.cls.has("story"), true);
  r.frames(5);
  assert.equal(win(box).style.transform, "scale(1)", "no scale while it opens (state 0)");
  assert.ok(Math.abs(Number(q(box).style.opacity) - 0.5) < 1e-9, "the question fades with the window");
  assert.ok(Math.abs(Number(yes.style.opacity) - 0.5) < 1e-9, "and the buttons");
  assert.equal(yes.style.visibility, "visible", "already showing");
  // closing: the window shrinks by 0.05 (1 - t), the question with it
  r.frames(5);
  no.fire("click");
  r.frames(5);
  assert.ok(Math.abs(parseFloat(win(box).style.transform.slice(6)) - (1 - 0.05 * 0.5)) < 1e-9);
  assert.equal(win(box).style.transform, q(box).style.transform);
  // SELA's Yes fades at its size (state 5)
  const r2 = windowRig();
  r2.ui.dialog("Save Progress?", () => {}, () => {}, { kind: "story", saveAsk: true });
  r2.frames(10);
  const box2 = r2.box(), [, yes2] = buttons(box2);
  yes2.fire("click");
  r2.frames(5);
  assert.equal(win(box2).style.transform, "scale(1)", "Yes on Save Progress? keeps the window's size");
  // the window's place and the question's size
  assert.match(css, /\.dialog\.story \.dialog-win \{ left: 551px; \}/);
  assert.match(css, /\.dialog\.story \.dialog-q \{ font-size: 30px;/);
  r.done(); r2.done();
});

test("N2-155 / N2-156 / N2-162: the Quick Load picture only at t = 1, a second line below the first, the first lit button already steady (0x4ae90, 0xae840)", () => {
  const r = windowRig();
  r.ui.dialog("Quick Load?", () => {}, () => {}, { picture: "x.jpg", startNo: true });
  const box = r.box(), pic = box.findAll((c) => c.cls.has("dialog-pic"))[0];
  assert.equal(pic.style.visibility, "hidden", "not during the opening");
  r.frames(14);
  assert.equal(pic.style.visibility, "hidden");
  const [no] = buttons(box);
  // the flash has run down while the button was unseen (it lights from the first frame)
  r.frames(1);
  assert.equal(pic.style.visibility, "visible");
  assert.equal(no.style.visibility, "visible");
  assert.equal(no.flash.style.opacity, "0", "steady when it first shows");
  // closing: gone again on the first frame of the fade
  r.ui.choose(r.ui.sel);
  r.frames(16);
  assert.equal(pic.style.visibility, "hidden");
  const r2 = windowRig();
  r2.ui.dialog("Change All Settings to Default.\nAre you sure?", () => {}, null, { startNo: true });
  assert.equal(q(r2.box()).style.top, undefined, "a two-line question starts where a one-line one does");
  assert.match(css, /font: 500 40px\/64px Georgia/);
  r.done(); r2.done();
});

test("N2-161: the buttons' hit boxes come from the tables, taking both ends of each whole unit (0xae840, 0x590f08, 0x65bbc0)", () => {
  assert.deepEqual(uifx.hitBoxPixels([241, 238.5183], uifx.STORY_HIT), { left: 693, right: 906, top: 551, bottom: 686 }, "story No");
  assert.deepEqual(uifx.hitBoxPixels([327, 238.5183], uifx.STORY_HIT), { left: 951, right: 1164, top: 551, bottom: 686 }, "story Yes");
  assert.deepEqual(uifx.hitBoxPixels([252, 249.0074], uifx.SYSTEM_HIT), { left: 756, right: 975, top: 596, bottom: 662 }, "system No");
  assert.deepEqual(uifx.hitBoxPixels([330, 261.4554], uifx.SYSTEM_HIT), { left: 990, right: 1209, top: 626, bottom: 690 }, "system Yes with the picture");
  const r = windowRig();
  r.ui.dialog("X", () => {}, () => {}, { kind: "story" });
  const [no] = buttons(r.box());
  assert.match(no.style.cssText, /^left:693px;top:551px;width:213px;height:135px;/);
  r.done();
});

test("Notices (0x4abe0, 0x49750, 0x48540): no backdrop, the window growing into place, the text lower, drawn under the questions", () => {
  const r = windowRig();
  r.ui.keyFn = null;
  r.ui.notify("Saving", { hold: 1200, held: true });
  const box = r.sysui.children[0];
  assert.equal(box.findAll((c) => /dialog_BG/.test(c.style.cssText || "")).length, 0, "no backdrop");
  r.frames(1);
  const s = parseFloat(win(box).style.transform.slice(6));
  assert.ok(Math.abs(s - (1 - 0.2 * 0.93) ** 2) < 1e-9, "grows from (1 - 0.2)^2");
  assert.ok(s < 1);
  assert.equal(q(box).style.visibility, "hidden");
  r.frames(14);
  assert.equal(q(box).style.visibility, "visible");
  assert.match(css, /\.dialog\.notice \.dialog-q \{ top: 509\.3px; \}/);
  assert.match(css, /\.dialog \{[^}]*z-index: 1;[^}]*\}/);
  assert.match(css, /\.dialog\.notice \{ z-index: 0; \}/);
  r.done();
});

test("N2-176: a notice gives the keys back the moment it starts to close, and says so to its caller (0xb34b44 = 0 with state 3; 0x6764 state 7, 0x50fc0 cases 8, 0x13)", async () => {
  const r = windowRig();
  const before = () => false;
  r.ui.keyFn = before;
  const n = r.ui.notify("Flowchart is not yet available");
  assert.notEqual(r.ui.keyFn, before);
  r.frames(15);
  r.ui.keyFn({ key: "Enter" });
  r.frames(1);
  assert.equal(r.ui.keyFn, before, "the keys are the screen's again as it starts to fade");
  await n;                                                  // and the caller goes on then too
  const box = r.sysui.children[0];
  assert.ok(box, "while the window finishes fading");
  r.frames(15);
  assert.equal(r.sysui.children.length, 0);
  r.done();
});

test("N2-31: Return to Title waits behind the Auto Save popup; A or a tap hurries it (0x4d710, 0x3b480)", async () => {
  globalThis.requestAnimationFrame = (f) => setTimeout(() => f(performance.now()), 1);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  const r = windowRig();
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  let fading = 0, hurried = 0, busy = true;
  r.ui.menuFade = () => { fading++; };
  const p = r.ui.waitForPopup(() => busy, () => { hurried++; });
  assert.equal(fading, 1, "the menu starts to fade with the popup over it");
  r.ui.keyFn({ key: "Enter" });
  assert.equal(hurried, 1, "a press hurries the popup");
  busy = false;
  await p;
  assert.equal(r.ui.keyFn, null);
  const main = readFileSync(new URL("../../web/app/js/main.js", import.meta.url), "utf8");
  assert.match(main, /const wrote = fromStory \? autosave\(\) : false;/);
  assert.match(main, /if \(wrote\) await ui\.waitForPopup\(popupBusy, popupHurry\);/);
  delete globalThis.addEventListener;
  delete globalThis.removeEventListener;
  r.done();
});

test("N2-131: the popup sits under the menus and the mode panel, over the covers (task 0xe at priority 82, 0x3b4b0)", () => {
  const html = readFileSync(new URL("../../web/app/index.html", import.meta.url), "utf8");
  assert.ok(html.indexOf('id="popup"') < html.indexOf('id="ui"'), "before the screens");
  assert.ok(html.indexOf('id="popup"') > html.indexOf('id="note"'), "after the story's text");
  assert.doesNotMatch(css, /#popup \{[^}]*z-index/, "no z-index of its own");
  assert.match(css, /\.modepanel \{[^}]*z-index: 5/);
  const main = readFileSync(new URL("../../web/app/js/main.js", import.meta.url), "utf8");
  assert.match(main, /insertBefore\(el, \$\("popup"\)\)/, "the skip black under it");
  assert.match(main, /\$\("popup"\)\.before\(el\)/, "and the story black");
});

test("N2-172: a read scene's RDAS hurries a popup that has come up and waits for it to go (0x79bc4-0x79bcc); not otherwise", async () => {
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 1);
  const popup = { busy: () => popup.up, hurry() { popup.calls++; if (popup.calls >= 3) popup.up = false; }, calls: 0, up: true };
  const vm = machine({ hooks: { popup } });
  vm.flow.completed.add(486);
  vm.skipRead = true;
  vm.skipConfirm = false;
  vm.running = true;
  vm.instant = true;                                       // skip the countdown part
  await vm.op_RDAS("486");
  assert.equal(popup.up, false);
  assert.equal(popup.calls, 3, "hurried every frame until it has gone");
  // an unread scene, or the setting off: not touched
  popup.up = true; popup.calls = 0;
  vm.skipRead = false;
  await vm.op_RDAS("486");
  assert.equal(popup.calls, 0);
  vm.skipRead = true;
  await vm.op_RDAS("487");
  assert.equal(popup.calls, 0);
});

test("N2-37: a manual or automatic save sets F1118 in its record; a save made before this loads as it was and asks as it did (0x52aa0, 0x50fc0)", async () => {
  assert.deepEqual(markSaved({ F1118: 0, F023: 7 }), { F1118: 1, F023: 7 });
  const main = readFileSync(new URL("../../web/app/js/main.js", import.meta.url), "utf8");
  assert.match(main, /if \(!quick\) s\.vars = markSaved\(p\.vars\);/);
  assert.match(main, /auto: true, vars: markSaved\(p\.vars\)/);
  assert.match(main, /makeSave\(\{ quick: true \}\)/, "the quick save leaves it");
  const vm = machine();
  const asked = [];
  vm.onAskSave = async (q2) => { asked.push(q2); return false; };
  vm.op_ATSV?.();
  const point = vm.snapshot();
  // the record written after this fix does not ask
  point.vars = markSaved(point.vars);
  const s = { ...point, waiting: false };
  vm.getScript = async () => vm.script;
  vm.flow.restore = () => {};
  vm.loop = () => {};
  await vm.restore(s, { rewind: true });
  assert.equal(vm.getVar("F1118"), 1);
  await vm.op_SELA("_D000");
  assert.deepEqual(asked, [], "not asked again after loading a save made through Save Progress?");
  // an older record (no F1118 in it) still loads, and asks as it did
  const old = { ...point, vars: { ...point.vars }, waiting: false };
  delete old.vars.F1118;
  await vm.restore(old, { rewind: true });
  assert.equal(vm.getVar("F1118"), 0);
  await vm.op_SELA("_D000");
  assert.deepEqual(asked, ["Save Progress?"]);
});

test("N2-46: Default on Yes changes the values in place: the config keeps its level and its page (0x2c810 case 8)", () => {
  const ui = readFileSync(new URL("../../web/app/js/ui.js", import.meta.url), "utf8");
  assert.match(ui, /\(restoreKeys\) => \{ restoreKeys\(\); this\.env\.resetSettings\(\); build\(\); restore\(\); \}/);
  assert.doesNotMatch(ui, /resetSettings\(\); this\.config\(TABS\[C\.page\], fromTitle\)/);
  if (!existsSync(asset("system.json"))) return;
  const sys = readAsset("system.json");
  const r = windowRig();
  const had = { add: globalThis.addEventListener, rem: globalThis.removeEventListener };
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  const fx = [];
  let reset = 0, begun = 0, asked = null;
  const page = new r.El("div");
  const ui2 = Object.assign(r.ui, {
    items: [], fx, sel: 0, animate(f) { fx.push(f); }, showCaption() {}, setBack() {}, stopFx() {}, closePanel() {},
    menuBackground() { return new r.El("div"); }, helpBar() {},
    env: { settings: { textSpeed: 35, readSpeed: 15, autoPage: 3000, autoClick: 2200 }, setSetting() {}, resetSettings() { reset++; } },
    audio: { vol: { chars: [], charOn: [] } }, vm: { system: sys, flow: { started: new Set() }, getVar: () => 0, scriptIndex: 0, running: false },
    begin() { begun++; this.items = []; this.sel = 0; this.screenFocus = this.screenClose = null; return page; },
    dialog(q2, yes, no) { asked = { yes, no }; },
  });
  ui2.config("system", true);
  const first = begun;
  ui2.items.find((it) => it.el.confId === 54).fn();
  assert.ok(asked, "Default asks");
  // Yes: the settings reset, the screen stays
  asked.yes(() => {});
  assert.equal(reset, 1);
  assert.equal(begun, first, "the screen is not built again");
  globalThis.addEventListener = had.add;
  globalThis.removeEventListener = had.rem;
  r.done();
});

test("A question from the mode panel keeps the panel down under it (0x4e170 state 5); Continue's Loading closes as soon as it is up, the black after it (0x8e200 states 0x1c, 0x1e)", async () => {
  const r = windowRig();
  const log = [];
  let closed = 0;
  r.ui.panel = { open: true, el: { classList: { add() {}, remove() {} } } };
  r.ui.closePanel = () => { closed++; r.ui.panel.open = false; };
  r.ui.begin = function (s, o = {}) { if (!o.keepPanel) this.closePanel(); return {}; };
  r.ui.close = function () { log.push("close"); };
  r.ui.vm = { running: true };
  r.ui.screen = null;                                     // the question opens over the story
  const answer = r.ui.confirmSystem("Quick Load?", { startNo: true });
  assert.equal(closed, 0, "the panel stays");
  r.frames(15);
  r.ui.choose(r.ui.sel);                                  // No
  r.frames(16);
  assert.equal(await answer, false);
  assert.equal(closed, 0, "No goes back to it");
  r.ui.panel.open = true;
  const answer2 = r.ui.confirmSystem("Quick Load?", {});
  r.frames(15);
  r.ui.choose(r.ui.sel);                                  // Yes
  r.frames(16);
  assert.equal(await answer2, true);
  assert.equal(closed, 1, "Yes sends it up");
  // Continue
  const order = [];
  const c = windowRig();
  c.ui.newestRecord = () => ({ when: 1 });
  c.ui.after = (n, fn) => { order.push(["after", n]); c.pending = fn; };
  c.ui.audio = { fadeBGMRate(rate) { order.push(["music", rate]); } };
  c.ui.env = { titleVideo() {}, loadSave() { order.push(["load"]); } };
  c.ui.close = () => {};
  c.ui.blackout = () => ({});
  c.ui.fadeBlack = (b, to, rate, done) => { order.push(["black", to, rate]); done(); };
  c.ui.vm = { system: null };
  c.ui.continueGame({});
  c.frames(15);
  assert.deepEqual(order, [["after", 16]], "closed 16 frames after it opens");
  c.pending();
  c.frames(1);                                            // it starts to close: the rest follows
  await new Promise((res) => setTimeout(res, 0));
  assert.deepEqual(order.slice(1), [["music", 1.5], ["black", 1.2, 0.01], ["load"]]);
  r.done(); c.done();
});

// ---- Priority 1 of audit/TODO.md: skip, its sounds, movies and the gallery's replays --------------------------------------------------------------
test("N2-24: a sound played once starts nothing under the skip flag, a loop on its channel stops, the last volume stays; loops still start (0x6a340)", async () => {
  const { audio } = sound();
  const vm = machine({ audio });
  vm.audio = audio;
  await audio.playSE(4, true, "MOON_SE03023", { "017": 50 });
  const loop = audio.se.get(4);
  audio.seLast[4] = 50;
  audio.seChar[4] = 0;
  vm.skip = true;
  vm.op_SEPL("4", "0", "MOON_SE02009", "`017:70", "`070:3");
  await settle();
  assert.equal(audio.se.has(4), false);
  assert.equal(loop.state, 0);
  assert.equal(audio.seLast[4], 50, "returns before storing the last volume");
  assert.equal(audio.seChar[4], 0, "and the character");
  vm.op_SEPL("6", "0", "MOON_SE02009", "`017:70");
  await settle();
  assert.equal(audio.se.has(6), false, "no loop there: nothing happens");
  vm.op_SEPL("7", "1", "MOON_SE03023", "`017:70");
  await settle();
  assert.equal(audio.se.get(7)?.loop, true, "a loop plays while skipping");
  vm.skip = false;
  vm.op_SEPL("8", "0", "MOON_SE02009", "`017:70");
  await settle();
  assert.equal(audio.se.has(8), true, "heard when not skipping");
});

test("N2-124: the delay runs at the skip's speed and a one-shot it reaches while the skip is up is dropped; fades and volumes act; off again it plays (0x65780, 0x65e50)", async () => {
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const { audio } = sound();
  const vm = machine({ audio });
  vm.audio = audio;
  vm.skip = true;
  vm.op_SEPL("5", "0", "MOON_SE02009", "`017:70", "`068:900");   // 54 frames: with 64 + 1 a frame, one or two frames
  assert.equal(vm.delayed.has(5), true, "the skip does not bypass the queue");
  await delay(90);
  assert.equal(vm.delayed.has(5), false, "the countdown ran at the skip's speed");
  assert.equal(audio.se.has(5), false, "and the sound was passed over");
  // kinds 2 and 3 act
  await audio.playSE(6, true, "MOON_SE03023", { "017": 50 });
  audio.seLast[6] = 50;
  vm.op_SEVL("6", "`017:20", "`068:300");
  await delay(60);
  assert.equal(vm.delayed.has(6), false);
  assert.equal(audio.seLast[6], 20);
  // the same command with the skip off waits and plays
  vm.skip = false;
  vm.op_SEPL("7", "0", "MOON_SE02009", "`017:70", "`068:30");
  assert.equal(vm.delayed.has(7), true);
  await delay(50);
  assert.equal(audio.se.has(7), true);
  vm.cancelDelayed();
});

test("N2-74: an instant run stops everything at its start, keeps the recorded state, restarts it where it stops; a TOMP leaves silence (0x802c0, 0x5ef10, 0x6ef30)", async () => {
  const { audio } = sound();
  const vm = machine({ audio });
  vm.audio = audio;
  vm.running = true;
  await audio.playBGM(2, {});
  await audio.playSE(4, true, "MOON_SE03023", { "017": 50 });
  audio.seLast[4] = 50;
  let voice = 0;
  audio.stopVoice = () => { voice++; };
  const music = audio.bgm, loop = audio.se.get(4);
  vm.beginInstant();
  assert.equal(voice, 1);
  assert.equal(audio.bgm, null);
  assert.equal(audio.bgmState, null, "its number is -1");
  assert.equal(music.state, 0);
  assert.equal(loop.state, 0);
  assert.equal(audio.seLast[4], 50, "0x5ef10(0) keeps the records");
  vm.op_ATSV("");                                          // the run's stop: the track and the loop start again from their tops (0x5d7e0)
  await settle();
  assert.notEqual(audio.bgm, music);
  assert.equal(audio.bgmState.n, 2);
  assert.equal(audio.se.get(4)?.name, "MOON_SE03023");
  assert.notEqual(audio.se.get(4), loop);
  // a run that ends at a movie: the sound stays stopped, the run's records stay
  vm.beginInstant();
  vm.op_MFAD("`001:0");
  vm.op_SEPL("9", "0", "MOON_SE02009", "`017:30");
  vm.movieFor = () => null;
  vm.unlocks = { movies: new Set(), watched() {} };
  vm.op_TOMP("5");
  await settle();
  assert.equal(audio.bgmState, null);
  assert.equal(audio.se.size, 0);
  assert.equal(audio.seLast[9], 30, "a one-shot in the run still sets its channel's last volume (no skip flag)");
});

test("N2-130: the read-scene skip's frames hold the script at its first wait: nothing after it runs or sounds before the instant run (0x40ed0 states 1-3)", async () => {
  globalThis.requestAnimationFrame = (f) => setTimeout(() => f(0), 1);
  try {
    const { audio } = sound();
    const played = [];
    audio.playSE = (ch, loop, name) => played.push(name);
    audio.playVoice = () => played.push("voice");
    const vm = machine({ audio });
    vm.audio = audio;
    vm.flow.completed.add(29);
    vm.skipRead = true; vm.skipConfirm = false;
    const seen = [];
    vm.onCountdown = (v) => seen.push([v, vm.instant, played.length]);
    vm.script = { name: "a", labels: {}, zm: {}, zl: {}, ops: [["RDAS", "29"], ["SEPL", "1", "0", "BEFORE_WAIT"], ["WTTM", "5000", "1"], ["SEPL", "2", "0", "AFTER_WAIT"], ["VPLY", "x"], ["ATSV", ""], ["RTM_"]] };
    vm.lines = [];
    vm.running = true;
    vm.pc = 0;
    const loop = vm.loop(vm.generation);
    for (let t = 0; t < 400 && vm.running; t++) await settle();
    await loop;
    assert.deepEqual(seen.map(([v, inst]) => [v, inst]), [[3, false], [2, false], [1, false], [0, false]]);
    assert.deepEqual(played, ["BEFORE_WAIT"], "the sound before the first wait played; the one after it was not (the run passes it over)");
    assert.equal(seen.at(-1)[2], 1, "nothing more until the countdown ended");
    assert.equal(vm.sceneSkip, null);
  } finally { delete globalThis.requestAnimationFrame; }
});

test("N2-130: with \"Display confirmation\" the question comes up on the next frame; No lets the script go on", async () => {
  globalThis.requestAnimationFrame = (f) => setTimeout(() => f(0), 1);
  try {
    let answer, asked = 0;
    const vm = machine({ hooks: { onSceneSkip: () => { asked++; return new Promise((r) => { answer = r; }); } } });
    vm.flow.completed.add(29);
    vm.skipRead = true; vm.skipConfirm = true; vm.running = true;
    await vm.op_RDAS("29");
    assert.equal(asked, 0, "RDAS only sets the state");
    for (let t = 0; t < 100 && !asked; t++) await new Promise((r) => setTimeout(r, 2));
    assert.equal(asked, 1);
    const run = vm.sceneSkip;
    answer(false);
    await run;
    assert.equal(vm.instant, false);
    assert.equal(vm.sceneSkip, null);
  } finally { delete globalThis.requestAnimationFrame; }
});

test("N2-208: an instant run gives the skip flags back as it found them (0x802c0 and 0x6ef30 leave 0xae0660 alone)", () => {
  const vm = machine();
  vm.running = true;
  const run = (end) => { vm.beginInstant(); assert.equal(vm.skip, true); assert.equal(vm.forceSkip, true); end(); };
  // off
  run(() => vm.endInstant());
  assert.equal(vm.skip, false);
  assert.equal(vm.forceSkip, false);
  // the toggle on
  vm.skip = true; vm.forceSkip = false;
  run(() => vm.endInstant(false));
  assert.equal(vm.skip, true);
  assert.equal(vm.forceSkip, false);
  // the fast-forward key
  vm.skip = true; vm.forceSkip = true;
  run(() => vm.endInstant());
  assert.equal(vm.skip, true);
  assert.equal(vm.forceSkip, true);
  // a skip waiting at unread text goes on waiting
  vm.skip = false; vm.forceSkip = false; vm.skipPaused = { force: false, held: false };
  run(() => assert.equal(vm.skipPaused, null));
  vm.endInstant();
  assert.equal(vm.skip, false);
  assert.deepEqual(vm.skipPaused, { force: false, held: false });
});

test("N2-208, N2-209, N2-28: the skip toggle and the fast-forward key are the game's: read every frame, put aside by a movie, and the menu turns the toggle off", () => {
  const main = readFileSync(new URL("../../web/app/js/main.js", import.meta.url), "utf8");
  // the toggle comes back after a movie (0x402a0, 0x40a00), the key by itself
  assert.match(main, /const modes = opts\.story \? \{ skip: vm\.skipToggle, auto: vm\.auto \} : null;/);
  assert.match(main, /if \(modes\.skip\) \{ vm\.skipToggle = true; vm\.skip = true;/);
  assert.match(main, /else if \(ffKey && vm\.running && !vm\.locked && !vm\.instant && !ui\.open && !ui\.panelOpen && !moviesDone\) holdFastForward\(\);/);
  assert.match(main, /syncFastForward\(\);/);
  // the key is seen wherever the game is, and its release goes back to the toggle
  assert.match(main, /if \(isFastKey\(e\)\) fastForwardKey\(true\);\n  if \(ui\.open\) return;/);   // the Fast forward key of the map (Ctrl)
  assert.match(main, /if \(isFastKey\(e\)\) fastForwardKey\(false\);/);
  assert.match(main, /if \(btn === "ZR"\) \{ fastForwardKey\(down\); return; \}/);
  // the system menu turns the toggle off (0x40ed0 at 0x421ac), from the key and the right click
  assert.match(main, /function systemMenu\(row = null\) \{\n  setSkip\(false\);\n  ui\.system\(/);
  assert.equal([...main.matchAll(/ui\.system\(/g)].length, 1);
  const html = readFileSync(new URL("../../web/app/index.html", import.meta.url), "utf8");
  for (const id of ["mode-skip", "mode-back", "mode-auto"]) assert.ok(html.indexOf(`id="${id}"`) < html.indexOf('id="ui"'), `${id} under the screens (priority 82, 0x3b5f0)`);
  const style = readFileSync(new URL("../../web/app/style.css", import.meta.url), "utf8");
  assert.doesNotMatch(style, /#mode-skip \{[^}]*z-index/);
  assert.doesNotMatch(style, /#mode-back \{[^}]*z-index/);
});

test("N2-26 / N2-27: a replay from the gallery's flowchart goes through ARCHIVE and JUMP00 .. JUMPQA, which pick the scene and set what it reads", async () => {
  const main = readFileSync(new URL("../../web/app/js/main.js", import.meta.url), "utf8");
  assert.match(main, /replayScene\(node\?\.jump, \(\) => galleryFlowchart\(node\?\.flag\)\)/);
  assert.match(main, /vm\.setVar\("G008", jump\);\n  startAt\(vm\.index\.jump\[3000\], undefined, \{ replay: true, then \}\);/);
  if (!existsSync(asset("scripts/index.json"))) return;
  const index = readAsset("scripts/index.json");
  const run = async (jump) => {
    const vm = machine();
    vm.index = index;
    vm.getScript = async (i) => readAsset(`scripts/${i}.json`);
    vm.replay = true;
    vm.vars = {};
    vm.globals = { G008: jump };
    vm.flowChart = null;
    await vm.enter(index.jump[3000]);
    for (let n = 0; n < 200; n++) {
      const op = vm.script.ops[vm.pc++];
      if (!["WKST", "IF__", "IFSC", "JUMP", "GOTO"].includes(op[0])) { if (vm.script.name !== "ARCHIVE") break; continue; }
      await vm[`op_${op[0]}`](...op.slice(1));
    }
    return { name: vm.script.name, vars: vm.vars };
  };
  assert.equal((await run(260)).name, "00_02", "the first node is the text prologue (JUMP00: G008 260 -> script 270)");
  assert.equal((await run(240)).name, index.names[index.jump[240]], "the others go to their own");
  const hall1 = await run(326), hall2 = await run(354);
  assert.equal(hall1.vars.F050, 1);
  assert.equal(hall2.vars.F054, 1);
  assert.equal(hall1.name, index.names[index.jump[326]]);
  assert.equal(hall2.name, index.names[index.jump[354]]);
  const replay = (s) => [s.vars.F024, s.vars.F025, s.vars.F028];
  assert.deepEqual(replay(hall1), [1, 1, 1]);
  assert.equal(hall1.vars.F026, 326);
});

test("N2-98: a transition's old picture is redrawn from the frame last shown, not the live layers, which the commands before the FADS have changed (0x4b740; 05_01_CIEL05_4B ops 951-971)", async () => {
  const { Renderer } = await import("../../web/app/js/renderer.js");
  const { Value } = await import("../../web/app/js/animation.js");
  const { makeEffect } = await import("../../web/app/js/effects.js");
  const gl = new Proxy({}, { get: () => () => {} });
  const r = Object.create(Renderer.prototype);
  Object.assign(r, { gl, scene: { fbo: 1 }, prev: { fbo: 2 }, layerProg: { p: 0, u: { back: 0 } }, backTex: { tex: 0 }, images: null, held: false, split: null, lines: null });
  const l = { id: 16, image: null, ready: null, x: new Value(240), y: new Value(136), zx: new Value(1000), zy: new Value(1000), rot: new Value(0), alpha: new Value(255), z: 7, blend: 0, blurX: 0, blurY: 0,
    parent: -1, link: -1, pivot: null, clip: null, border: 0, frame: 0, clipRot: 0, absolute: false, offset: null, scale: 1000, stretch: false, cut: false, base: null, motion: null, effects: {} };
  // no shake or split on screen: nothing to keep
  r.shake = null;
  r.drawLayers([l], 400, new Map([[16, l]]));
  assert.equal(r.shown, null);
  // with one, each frame keeps what it shows; a later STCP does not reach it, and a held frame does not replace it
  r.shake = makeEffect("impact", [0, 3, 85, 9], 0);
  r.drawLayers([l], 500, new Map([[16, l]]));
  assert.equal(r.shown.now, 500);
  l.z = 0;
  assert.equal(r.shown.layers[0].z, 7);
  r.held = true;
  r.drawLayers([l], 520, new Map([[16, l]]));
  assert.equal(r.shown.now, 500);
  // the old picture: that frame, with no shake and no split, drawn before the two targets swap
  const prev = r.prev, cur = r.scene, shake = r.shake, shown = r.shown, calls = [];
  r.drawLayers = (layers, now, all) => calls.push({ layers, now, shake: r.shake, noSplit: r.noSplit, held: r.held, ids: [...all.keys()], target: r.scene });
  r.beginFade(100, null, 2000);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].layers, shown.layers);
  assert.deepEqual([calls[0].now, calls[0].shake, calls[0].noSplit, calls[0].held, calls[0].ids, calls[0].target], [500, null, true, false, [16], cur]);
  assert.equal(r.shake, shake);
  assert.deepEqual([r.prev, r.scene], [cur, prev]);
  assert.equal(r.fade.ms, 100);
  // with nothing kept the last picture is used as it is
  const direct = Object.create(Renderer.prototype);
  Object.assign(direct, { prev: "a", scene: "b", shown: null, shake: shake, drawLayers() { throw new Error("no redraw"); } });
  direct.beginFade(50, null, 1);
  assert.deepEqual([direct.prev, direct.scene], ["b", "a"]);
});

// ---- the system menu and the screens beside it (TODO items 19 to 23) -------------------------------------------------------------
// The menu's real code on the fake page: each frame steps the screen's loops, the menu's background (which the real menuBackground steps) and the windows.
function menuRig({ replay = false, slots = 0, flowOpen = true, offColumn = false } = {}) {
  const r = windowRig();
  const { ui, El } = r;
  const seen = { back: [], calls: [], bg: null };
  const store = {};
  for (let i = 0; i < slots; i++) store[i] = { when: 1000 - i, name: "01_00_ARC01_1", vars: { F023: 1, F022: 1 }, note: `note ${i}`, thumb: "data:," };
  localStorage.setItem("tsuki.saves", JSON.stringify(store));
  Object.assign(ui, {
    saveKey: "tsuki.saves", fx: [], screenFocus: null, screenClose: null, env: null,
    stopFx() { this.fx = []; },
    menuBackground(page, o = {}) { seen.bg = o.fade ?? seen.bg; return new El("div"); },
    helpBar() {},
    setBack(on) { seen.back.push(!!on); },
    vm: { running: true, replay, paused: false, resume() { seen.calls.push("resume"); }, getVar: () => 0, system: {}, script: { name: "01_00_ARC01_1" },
      flow: { path: new Set(flowOpen ? [1] : []), current: 5 } },
    env: { replayFrom: () => "story", flowchart() { seen.calls.push("flowchart"); }, toTitle(show, o) { seen.calls.push("toTitle"); seen.title = o; }, endReplay(l) { seen.calls.push("endReplay"); seen.leave = l; },
      loadSave(rec) { seen.calls.push(`load ${rec.note}`); }, titleVideo() {}, makeSave: () => ({ when: 2000, name: "x", vars: {}, note: "new" }), savedNow() {} },
  });
  const step = (n = 1) => { for (let k = 0; k < n; k++) { seen.bg?.step(1); for (const f of [...ui.fx]) f(1); for (const f of [...r.loops]) f(1); } };
  const key = (k, extra = {}) => ui.key({ key: k, repeat: false, preventDefault() {}, stopPropagation() {}, ...extra });
  const page = () => ui.root.children.at(-1);
  const opened = () => { ui.system(); step(20); };
  return { ...r, seen, step, key, page, opened };
}
const fgLevel = (r) => r.ui.menuLevel;
const saveLevel = (r) => Number(r.page().style["--a"]);
const lit = (r) => r.page().findAll((e) => e.cls.has("slotbg")).map((e) => (e.cls.has("hi") ? 1 : 0)).join("");

test("N2-30: Save and Load fade in over 42 frames and out over 21, taking no key or press meanwhile (0x50fc0 states 1, 5, 0x1b)", () => {
  const r = menuRig({ slots: 3 });
  r.opened();
  r.ui.savesScreen("save");
  assert.equal(saveLevel(r), 0);
  assert.equal(r.ui.menuBusy, true);
  assert.equal(r.page().style.pointerEvents, "none");
  r.step();
  assert.ok(Math.abs(saveLevel(r) - 0.024) < 1e-9);
  r.step(20);
  r.key("Escape");   // Back, Enter and a direction do nothing during the fade
  r.key("Enter");
  r.key("ArrowDown");
  assert.equal(r.ui.screen, "save");
  assert.equal(r.ui.sel, 8, "still the lowest empty slot (No. 004, after the three in use)");
  assert.deepEqual(r.sounds.filter((n) => n === 2), []);
  r.step(21);
  assert.equal(saveLevel(r), 1);
  assert.equal(r.ui.menuBusy, false);
  assert.equal(r.page().style.pointerEvents, "");
  // Back: the rows empty at once, the screen falls over 21 frames and the menu comes back under it
  r.key("Escape");
  assert.ok(r.page().cls.has("save-out"), "the list is emptied first");
  r.step(20);
  assert.equal(r.ui.screen, "save");
  assert.ok(saveLevel(r) > 0);
  r.step(1);
  assert.equal(r.ui.screen, "system");
  assert.equal(r.ui.menuBusy, false);
  const css = readFileSync(new URL("../../web/app/style.css", import.meta.url), "utf8");
  for (const piece of [".slot img", ".slotdigits", ".slottitle", ".slotscene", ".saveinfo"]) assert.ok(css.includes(`.savefx.save-out ${piece}`), piece);
  for (const piece of [".savea", ".slotbg", ".slot img", ".slotdigits .sp", ".slottitle", ".slotscene", ".saveinfo .sp", ".savenote", ".scrollbar", ".helpbar .hint", ".slotlabel", ".slotempty"]) assert.ok(css.includes(`.savefx ${piece}`), `each piece at the level: ${piece}`);
  r.done();
});

test("N2-30: a column choice waits for the screen's fade, and the list coming back from a save does not fade (0x4d340, 0x5912ec, 0x50fc0 state 9)", () => {
  const r = menuRig({ slots: 6 });
  r.opened();
  r.ui.savesScreen("save");
  r.step(43);
  r.key("ArrowLeft");
  assert.equal(r.ui.sel, 0, "the column has the cursor");
  r.key("ArrowDown");   // Load
  r.ui.choose(r.ui.sel);
  assert.ok(r.page().cls.has("save-out"));
  assert.equal(r.ui.screen, "save");
  r.step(20);
  assert.equal(r.ui.screen, "save");
  r.step(1);
  assert.equal(r.ui.screen, "load");
  assert.equal(saveLevel(r), 0);
  // the list after a save: at full at once, the cursor on the slot written
  r.ui.savesScreen("save", false, { again: true, slot: 6 });
  assert.equal(saveLevel(r), 1);
  assert.equal(r.ui.menuBusy, false);
  assert.equal(r.ui.sel, 5 + 6, "the seventh slot's row");
  assert.equal(lit(r), "0".repeat(6) + "1" + "0".repeat(93), "all 100 slots listed, that one lit");
  r.done();
});

test("N2-30: a load fades the screen after its notice and goes on when the screen has gone; from the title too (0x50fc0 states 0x13, 5, 0x1b)", async () => {
  const r = menuRig({ slots: 2 });
  r.opened();
  r.ui.savesScreen("load");
  r.step(43);
  r.ui.dialog = (q2, yes) => yes(() => {});   // Yes at once
  r.ui.choose(r.ui.sel);
  r.step(17);          // "Loading" comes up, then closes
  await new Promise((res) => setTimeout(res));
  assert.ok(r.page().cls.has("save-out"), "the fade starts as the notice closes");
  r.step(20);
  assert.deepEqual(r.seen.calls.filter((c) => c.startsWith("load")), []);
  r.step(1);
  assert.deepEqual(r.seen.calls.filter((c) => c.startsWith("load")), ["load note 0"]);
  // the title's Load has the same fades and no column to go to
  const t = menuRig({ slots: 1 });
  t.ui.titleBack = () => t.seen.calls.push("title");
  t.ui.savesScreen("load", true);
  t.step(43);
  assert.equal(t.ui.items[0].left, undefined, "no column from the title");
  t.key("Escape");
  t.step(21);
  assert.deepEqual(t.seen.calls, ["title"]);
  t.done();
  r.done();
});

test("A cover at nothing is not drawn, and comes back as it rises", () => {
  const r = menuRig({ slots: 1 });
  const { ui } = r;
  const page = ui.begin("titlemenu");
  const white = ui.whiteCover(page);
  assert.equal(white.style.display, "none");
  assert.equal(white.added.style.display, "none");
  ui.fadeBlack(white, 1.2, 0.01);
  r.step(10);
  assert.equal(white.style.display, "");
  assert.equal(white.added.style.display, "");
  assert.ok(Math.abs(Number(white.style.opacity) - 0.1) < 0.02);
  r.done();
});

test("N2-128: a load from the title leaves the title alone, logo down, while the music falls and the picture goes to black (0x8ea94 -> 0x8f2b0)", async () => {
  const r = menuRig({ slots: 1 });
  const { ui } = r;
  const title = ui.begin("titlemenu");
  const live = ui.titleLive = { page: title, fx: null, cover: null, resume() {} };
  const falls = [];
  ui.audio = { ...ui.audio, fadeBGMRate: (rate) => falls.push(rate) };
  ui.savesScreen("load", true);
  r.step(43);
  ui.dialog = (q2, yes) => yes(() => {});
  ui.choose(ui.sel);
  r.step(17);
  await new Promise((res) => setTimeout(res));
  assert.deepEqual(falls, [], "the music waits for the screen to go");
  r.step(21);
  const black = title.findAll((e) => e.cls.has("blackout"))[0];
  assert.ok(black, "the black is over the title");
  assert.equal(ui.root.children.at(-1), title, "the list has gone");
  assert.equal(live.cover.level, 1, "the logo stays down");
  assert.deepEqual(falls, [1.5]);
  r.step(50);
  assert.ok(Math.abs(black.level - 0.5) < 0.02);
  assert.deepEqual(r.seen.calls.filter((c) => c.startsWith("load")), []);
  r.step(72);
  assert.deepEqual(r.seen.calls.filter((c) => c.startsWith("load")), ["load note 0"]);
  r.done();
});

test("N2-29, N2-142: Config and Load leave the title running under them and give it back as it was; any other screen ends it (0x8e200 states 0x20, 0x21)", () => {
  const r = menuRig({ slots: 1 });
  const { ui, El } = r;
  ui.stopFx = function () { for (const stop of this.fx || []) stop(); this.fx = []; };   // the real one (the rig's drops them)
  const title = ui.begin("titlemenu");
  let stopped = 0, resumed = 0;
  const keys = () => false;
  const items = [{ el: new El("button"), fn() {} }];
  ui.fx = [() => { stopped++; }];
  Object.assign(ui, { items, sel: 0, keyFn: keys, titleLive: { page: title, fx: null, cover: null, resume() { resumed++; } } });
  const over = ui.begin("config", { title: "hold" });
  assert.deepEqual(ui.root.children, [title, over], "the title stays under the screen");
  assert.equal(stopped, 0, "its loops keep running");
  assert.equal(title.style.pointerEvents, "none", "and it takes no pointer");
  assert.notEqual(ui.items, items);
  ui.titleBack();
  assert.equal(ui.screen, "titlemenu");
  assert.deepEqual(ui.root.children, [title]);
  assert.equal(ui.items, items);
  assert.equal(ui.keyFn, keys);
  assert.equal(title.style.pointerEvents, "");
  assert.equal(resumed, 1);
  assert.equal(stopped, 0);
  ui.begin("gallery");
  assert.equal(stopped, 1, "a screen that replaces the title stops it");
  assert.equal(ui.titleLive, null);
  r.done();
});

test("N2-41: a new fade on a layer takes over from the one before (the press's black against the fade in)", () => {
  const r = menuRig({ slots: 1 });
  const { ui } = r;
  const fns = [];
  ui.animate = (f) => fns.push(f);
  const b = { level: 0.5, style: {} };
  ui.fadeBlack(b, 0, 0.012);
  ui.fadeBlack(b, 1.2, 0.02);
  for (const f of fns) f(1);
  assert.ok(Math.abs(b.level - 0.52) < 1e-9, `${b.level}`);
  r.done();
});

test("N2-32: Return to Title closes the text window from the press, fades the menu over 30 frames, then cuts the music and only then goes to black (0x4cea0 case 4, states 0x12, 0x15, 0x5f200)", async () => {
  const main = readFileSync(new URL("../../web/app/js/main.js", import.meta.url), "utf8");
  const body = main.slice(main.indexOf("async function toTitle"), main.indexOf("// The flowchart's jump to a scene"));
  const at = (t) => { const i = body.indexOf(t); assert.ok(i >= 0, t); return i; };
  assert.ok(at("text.closeWindow()") < at("await new Promise((next) => leave(next))"));
  assert.ok(at("await new Promise((next) => leave(next))") < at("await ui.waitForPopup"));
  assert.ok(at("await ui.waitForPopup") < at("await ui.menuGone"));
  assert.ok(at("await ui.menuGone") < at("audio.stopAll({ keepMusic: vm.keepMusic })"));
  assert.ok(at("audio.stopAll({ keepMusic: vm.keepMusic })") < at("await fadeToBlack(0.02)"));
  const r = menuRig();
  r.stage.classList.add("menu-blur");
  r.opened();
  let gone = false;
  r.ui.menuGone().then(() => { gone = true; });
  r.step(29);
  await new Promise((res) => setTimeout(res));
  assert.equal(gone, false);
  assert.ok(fgLevel(r) > 0);
  assert.ok(r.stage.cls.has("menu-blur"), "the blur is up until the menu has gone");
  assert.ok(Math.abs(r.seen.bg.level - fgLevel(r)) < 1e-9, "the background falls with it");
  r.step(2);
  await new Promise((res) => setTimeout(res));
  assert.equal(gone, true);
  assert.equal(fgLevel(r), 0);
  assert.ok(!r.stage.cls.has("menu-blur"), "at level 0 the blur goes at once (0x4b880 -> 0x2e030), under the popup too");
  r.done();
});

test("N2-32: the text window closes by itself at its own rate; a screen beside the column closes first (0x38d40, 0x5912ec)", async () => {
  const { TextBox } = await import("../../web/app/js/textbox.js").catch(() => ({}));
  const src = readFileSync(new URL("../../web/app/js/textbox.js", import.meta.url), "utf8");
  assert.match(src, /closeWindow\(\) \{\s*this\.open = false;\s*this\.fastClose = false;\s*\}/, "panelAlpha left alone, so tick() takes it down at WINDOW_RATE");
  void TextBox;
  const r = menuRig({ slots: 2 });
  r.opened();
  r.ui.savesScreen("save");
  r.step(43);
  r.key("ArrowLeft");
  r.ui.menuRow = 4;
  r.ui.select(4);
  r.ui.choose(4);       // Title
  assert.deepEqual(r.seen.calls.filter((c) => c === "toTitle"), ["toTitle"]);
  assert.equal(r.seen.title.fade, true);
  let closed = false;
  r.seen.title.leave(() => { closed = true; });
  assert.ok(r.page().cls.has("save-out"), "the screen goes first");
  r.step(21);
  assert.equal(closed, true, "then the menu's own close");
  assert.equal(r.ui.screen, "system");
  r.done();
});

test("N2-33: the FlowChart takes 12 frames out with the background left up, and comes back the same way with the row lit at the end (states 0xe, 0x10)", () => {
  const r = menuRig();
  r.opened();
  r.ui.menuRow = 3;
  r.ui.select(3);
  r.ui.flowchartFromMenu();
  assert.equal(r.ui.menuBusy, true);
  assert.equal(r.ui.sel, -1, "no row lit");
  r.step(1);
  assert.ok(Math.abs(fgLevel(r) - 11 / 12) < 1e-9);
  r.step(10);
  assert.deepEqual(r.seen.calls, []);
  r.step(2);
  assert.deepEqual(r.seen.calls, ["flowchart"]);
  assert.equal(r.seen.bg.level, 1, "the background stays");
  // back from the flowchart
  r.ui.system({ flowBack: true });
  assert.equal(fgLevel(r), 0);
  assert.equal(r.ui.menuBusy, true);
  r.step(11);
  assert.ok(fgLevel(r) > 0.9 && fgLevel(r) < 1);
  r.step(2);
  assert.equal(fgLevel(r), 1);
  assert.equal(r.ui.menuBusy, false);
  assert.equal(r.ui.sel, 3);
  assert.equal(r.seen.bg.level, 1);
  r.done();
});

test("The FlowChart not yet available takes the same fades: the notice shows over the background alone (0x1767c state 3, native frames)", async () => {
  const r = menuRig({ flowOpen: false });
  r.opened();
  r.ui.menuRow = 3;
  r.ui.flowchartFromMenu();
  r.step(13);
  assert.equal(fgLevel(r), 0);
  assert.equal(r.sysui.children.filter((c) => c.cls.has("notice")).length, 1);
  assert.deepEqual(r.seen.calls, []);
  r.frames(16);
  r.ui.keyFn({ key: "Enter" });   // closes it
  r.frames(1);
  await new Promise((res) => setTimeout(res));
  r.step(14);
  assert.equal(fgLevel(r), 1);
  assert.equal(r.ui.menuBusy, false);
  assert.equal(r.ui.sel, 3);
  r.done();
});

test("N2-132: the bands follow their own timer at their own alpha, whatever the menu's level; closing keeps them in place (0x4b880, 0x49630)", async () => {
  const { MENU_BANDS, MenuBgFade, bandAt, MENU_FADE } = await import("../../web/app/js/uifx.js");
  const r = menuRig();
  r.ui.system();
  assert.ok(r.seen.bg instanceof MenuBgFade, "the menu runs on the session's background fade");
  assert.ok(Math.abs(r.seen.bg.rate - MENU_FADE.open) < 1e-9);
  r.step(4);
  const t = r.seen.bg.t;
  assert.ok(Math.abs(t - 5 / 60) < 1e-9, "1/60 a frame, not the level");
  assert.deepEqual(r.seen.bg.band(MENU_BANDS[0]), bandAt(MENU_BANDS[0], t, false));
  r.step(100);
  assert.equal(r.seen.bg.level, 1);
  assert.equal(r.seen.bg.rate, 0);
  r.key("Escape");
  r.step(15);
  const b = MENU_BANDS[0], at = r.seen.bg.band(b);
  assert.ok(Math.abs(at.alpha - (0.75 * b[3]) / 255) < 1e-6, "15 frames in, 0.75 of its alpha");
  assert.equal(at.y, bandAt(b, 1, true).y, "in place");
  r.ui.close = () => {};
  r.step(16);
  r.done();
});

test("N2-133: from level 0 the cursor's line, stretch and light start again; coming back from a screen they carry on (0x4cba0)", () => {
  const r = menuRig();
  r.opened();
  r.step(60);
  const cur = r.ui.menuCursor;
  assert.equal(cur.line, 1);
  assert.ok(cur.light > 0.5);
  const was = cur.light;
  r.ui.system({ back: true });
  assert.equal(r.ui.menuCursor.light, was, "not when it comes back from a screen");
  r.ui.close = () => {};
  r.ui.system();
  assert.deepEqual([cur.line, cur.stretch, cur.light, cur.dir], [0, 0, 0, 1 / 60]);
  r.done();
});

test("N2-135: the menu takes no key or press during its opening or closing fades (0x4d8c0: only state 3 runs 0x4cea0)", () => {
  const r = menuRig();
  r.ui.system();
  assert.equal(r.ui.menuBusy, true);
  assert.equal(r.page().style.pointerEvents, "none");
  r.key("ArrowDown");
  r.key("Enter");
  r.key("Escape");
  r.ui.back();
  assert.equal(r.ui.sel, 0);
  assert.deepEqual(r.sounds, []);
  assert.equal(r.ui.screen, "system");
  assert.ok(fgLevel(r) < 1);
  r.step(18);
  assert.equal(r.ui.menuBusy, false);
  r.key("ArrowDown");
  assert.equal(r.ui.sel, 1, "and then it does");
  assert.deepEqual(r.sounds, [0]);
  let closed = 0;
  r.ui.close = () => { closed++; };
  r.key("Escape");
  r.key("ArrowDown");
  assert.equal(r.ui.sel, 1, "not while closing");
  assert.equal(r.page().style.pointerEvents, "none");
  r.step(31);
  assert.equal(closed, 1);
  r.done();
});

test("N2-137: Left gives the column the cursor, the list keeping its row lit, and Right or the column's own button gives it back with the flash (0x50ed0, 0x4d340)", () => {
  const r = menuRig({ slots: 4 });
  r.opened();
  r.ui.savesScreen("save");
  r.step(43);
  assert.equal(r.ui.sel, 5 + 4, "saving starts on the lowest empty slot");
  r.key("ArrowDown");
  r.key("ArrowDown");
  assert.equal(r.ui.sel, 11);
  const only = (k) => "0".repeat(k) + "1" + "0".repeat(99 - k);
  assert.equal(lit(r), only(6));
  r.sounds.length = 0;
  r.key("ArrowLeft");
  assert.equal(r.ui.sel, 0);
  assert.deepEqual(r.sounds, [0]);
  assert.equal(lit(r), only(6), "the row stays lit");
  const flash = r.ui.items[11].el.flash;
  flash.cls.delete("go");
  r.sounds.length = 0;
  r.key("ArrowRight");
  assert.equal(r.ui.sel, 11, "back on the row it kept");
  assert.deepEqual(r.sounds, [0]);
  assert.ok(flash.cls.has("go"), "with the row's flash");
  r.key("ArrowLeft");
  flash.cls.delete("go");
  r.sounds.length = 0;
  r.ui.choose(0);      // the column's own Save
  assert.equal(r.ui.sel, 11);
  assert.deepEqual(r.sounds, [1, 0]);
  assert.ok(flash.cls.has("go"));
  // keys stay on their own side: Up from the first row wraps within the list on a fresh press, and stops on a held key
  r.ui.select(5);
  r.key("ArrowUp", { repeat: true });
  assert.equal(r.ui.sel, 5);
  r.key("ArrowUp");
  assert.equal(r.ui.sel, 104, "the last row, not the column");
  r.key("ArrowDown", { repeat: true });
  assert.equal(r.ui.sel, 104);
  r.key("ArrowDown");
  assert.equal(r.ui.sel, 5);
  // Page Up / Page Down move four rows, Home / End to the ends
  r.key("PageDown");
  assert.equal(r.ui.sel, 9);
  r.key("End");
  assert.equal(r.ui.sel, 104);
  r.key("PageUp");
  assert.equal(r.ui.sel, 100);
  r.key("Home");
  assert.equal(r.ui.sel, 5);
  r.done();
});

test("N2-137: on the column the keys are 0x4cea0's: Left the first row, Right the last, Up and Down wrapping only on a fresh press; the title's and SELA's lists have no column to go to", () => {
  const r = menuRig();
  r.opened();
  r.key("ArrowRight");
  assert.equal(r.ui.sel, 4);
  r.key("ArrowDown", { repeat: true });
  assert.equal(r.ui.sel, 4, "a held key stops at the end");
  r.key("ArrowDown");
  assert.equal(r.ui.sel, 0);
  r.key("ArrowUp", { repeat: true });
  assert.equal(r.ui.sel, 0);
  r.key("ArrowUp");
  assert.equal(r.ui.sel, 4);
  r.key("ArrowLeft");
  assert.equal(r.ui.sel, 0);
  r.key("ArrowRight", { repeat: true });
  assert.equal(r.ui.sel, 0, "Left and Right want a fresh press");
  const sela = menuRig({ slots: 2 });
  sela.ui.savesScreen("save", false, { onBack: () => {} });
  sela.step(43);
  const first = sela.ui.sel;
  sela.key("ArrowLeft");
  assert.equal(sela.ui.sel, first, "SELA's list keeps the cursor");
  sela.done();
  r.done();
});

test("Player's report: the config and the save screen lie over the system menu's column, so the help bar covers its window, and the config's full-screen layers leave its buttons pressable (draw tasks: menu 84, config 90, save 100)", () => {
  const had = { add: globalThis.addEventListener, rem: globalThis.removeEventListener };
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  const r = menuRig({ slots: 1 });
  r.ui.vm.system = readAsset("system.json");
  r.ui.audio = { vol: { chars: [], charOn: [] } };
  r.ui.env.settings = { textSpeed: 35, readSpeed: 15, autoPage: 3000, autoClick: 2200 };
  r.ui.helpBar = (page) => { const bar = new r.El("div"); bar.className = "helpbar"; page.append(bar); };
  r.opened();
  const order = () => { const all = r.page().findAll(() => true); return (c) => all.findIndex((e) => e.cls.has(c)); };
  r.ui.config("system");
  let at = order();
  assert.ok(at("menucol") >= 0 && at("helpbar") >= 0);
  assert.ok(at("menucol") < at("conffg"), "the column before the config's layer");
  assert.ok(at("menucol") < at("helpbar"), "the help bar after the column");
  r.ui.savesScreen("save");
  at = order();
  assert.ok(at("menucol") >= 0);
  assert.ok(r.page().children.findIndex((c) => c.cls.has("savea")) > r.page().children.findIndex((c) => c.findAll((e) => e.cls.has("menucol")).length), "the save screen's backdrop after the column");
  assert.ok(at("menucol") < at("helpbar"));
  assert.match(css, /\.conffg, \.confpage \{ pointer-events: none; \}/);
  assert.match(css, /\.conffg > \.confbtn,/, "the tabs and Reset take the pointer");
  globalThis.addEventListener = had.add;
  globalThis.removeEventListener = had.rem;
  r.done();
});

// ---- TODO items 11 and 12 (2026-11-09): the rendering functions never re-read, and the fixes compared with native frames ---------
test("Item 11 (0x62a40): STCP's depth waits for the next commit on a picture already on screen; a staged one and a save take the state", async () => {
  const { drawn } = await import("../../web/app/js/renderer.js");
  const vm = machine();
  vm.op_STCH("3", "img0001", "100", "60", "1000", "255", "30");
  await vm.commit();
  const l = vm.layers.get(3);
  vm.op_STCP("3", "0");
  assert.equal(l.z, 30);                                   // still drawn: 0x3bba0 sorts the record's table, which only a commit writes (0x32450)
  assert.equal(l.zNext, 0);
  assert.ok(drawn({ ...l, ready: { tex: {} } }, { alpha: 1 }));
  assert.equal(vm.snapshot().layers.find((d) => d.id === 3).z, 0);   // a save holds the state
  // STCH from the number as a source copies the state's depth, as SCH2 keeps it
  vm.op_SCH2("5", "img0001", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "3");
  assert.equal(vm.pending.get(5).z, 0);
  await vm.commit();
  assert.equal(l.z, 0);
  assert.equal(l.zNext, undefined);
  assert.ok(!drawn({ ...l, ready: {} }, { alpha: 1 }));
  // on a layer staged this frame, or a number with no picture, the depth is just its state
  vm.op_STCH("7", "img0001");
  vm.op_STCP("7", "44");
  assert.equal(vm.pending.get(7).z, 44);
  vm.op_STCP("9", "12");
  assert.equal(vm.ghosts.get(9).z, 12);
});

test("Item 11 (0x37f50): SOXY's offset is in screen pixels, for the layer itself only", async () => {
  const { place } = await import("../../web/app/js/transform.js");
  const layer = (id, extra = {}) => ({ id, image: "img0001", parent: -1, link: -1, pivot: null, clip: null, border: 0, clipRot: 0, absolute: false, offset: null, scale: 1000, ...extra });
  const st = (x, y) => ({ x, y, zx: 1000, zy: 1000, rot: 0, alpha: 255 });
  const info = () => [1280, 720];
  const at = (offset) => { const a = layer(0, { offset }); return place([a], new Map([[a, st(100, 60)]]), info).get(a); };
  const base = at(null);
  for (const [ox, oy] of [[-180, -195], [20, 20], [-2, -4], [1, 0]]) {   // the moves measured on native frames: exactly these pixels
    const p = at([ox, oy]);
    assert.ok(Math.abs(p.x - base.x - ox) < 1e-9 && Math.abs(p.y - base.y - oy) < 1e-9, `${ox}, ${oy}`);
  }
  // a child is placed from its parent's own position, not its offset one (0x38730)
  const p = layer(1, { offset: [60, 30] }), c = layer(2, { parent: 1 });
  const states = new Map([[p, st(100, 50)], [c, st(250, 156)]]);
  const withOffset = place([p, c], states, info).get(c);
  p.offset = null;
  const without = place([p, c], states, info).get(c);
  assert.deepEqual([withOffset.x, withOffset.y], [without.x, without.y]);
});

test("Item 11 (0xa0a90, 0x3bba0, 0x391a0): no mipmaps on pictures, the speed lines after the split, the choice glow blurred", () => {
  const src = readFileSync(new URL("../../web/app/js/renderer.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../web/app/style.css", import.meta.url), "utf8");
  // a picture drawn smaller than stored is sampled bilinearly from the full picture (a native frame of IMG2472 at a quarter size)
  const load = src.slice(src.indexOf("  load(name) {"), src.indexOf("  evict(all = false) {"));   // (the texture itself is made in upload, between the two)
  assert.match(load, /TEXTURE_MIN_FILTER, gl\.LINEAR\)/);
  assert.doesNotMatch(load, /generateMipmap|LINEAR_MIPMAP/);
  // the split, then the lines (the window's task draws them: priority 80 against the split's 60)
  const draw = src.slice(src.indexOf("  drawLayers(layers, now, all) {"), src.indexOf("  drawLines(now) {"));
  assert.ok(draw.lastIndexOf("this.drawSplit(now)") < draw.lastIndexOf("this.drawLines(now)"));
  // the menu's blur runs its two passes twice
  const gauss = src.slice(src.indexOf("  menuGaussian() {"), src.indexOf("  hold(on = true)"));
  assert.equal((gauss.match(/pass\(this\./g) || []).length, 4);
  // the glow of a choice's row is the label blurred (0x83e50 -> 0xa0a90(2, 0, -2): 13 taps 1.5 px apart, twice over)
  assert.match(css, /\.choice-glow \{[^}]*filter: blur\(4\.27px\)/);
});
