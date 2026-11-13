// The motion fields beyond position, zoom, rotation, opacity and blur (0x97b80 / 0x97710 / 0x99ff0): the panel, pivot,
// depth, blend, colour, brightness, contrast and grain a track writes, the flag bits and start-only rule that decide
// when it writes them, SGMA's key and panel, and the export layout. Synthetic tracks; one check reads the generated
// motion tables when they are there.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { AnimationClock, EXTRA, Motion, Value, layerState } from "../../web/app/js/animation.js";
import { motionView } from "../../web/app/js/renderer.js";
import { place } from "../../web/app/js/transform.js";
import { VM } from "../../web/app/js/vm.js";

const H = -32767, R = -100001;
const BASE = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 8: 6, 9: 7, 10: 8, 22: 9, 23: 10 };
const ALL = [-1, -1];
// A keyframe from native field numbers, { 3: x, 11: panel x, ... }; everything else a hold.
function key(t, fields = {}, ease = 0, mode = 0) {
  const f = [t, ease, mode, H, H, H, R, H, H, H, H, ...EXTRA.map(() => H)];
  for (const [n, v] of Object.entries(fields)) f[n in BASE ? BASE[n] : 11 + EXTRA.indexOf(Number(n))] = v;
  return f;
}
const track = (frames, flags) => ({ duration: frames.at(-1)[0], loop: 0, flags, frames });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

function machine() {
  let now = 1000;
  const node = { innerHTML: "", style: { top: "" } };
  globalThis.document = { getElementById: () => node };
  const text = { pageParts: [], typing: false, intro: false, clear() { this.pageParts = []; }, setIntro() {}, setOpen() {} };
  const audio = { snapshot: () => ({}), restore() {}, stopVoice() {} };
  const gfx = { load: async () => ({ tex: null, w: 100, h: 100 }), tex: new Map() };
  const vm = new VM({ gfx, text, audio });
  vm.clock = new AnimationClock(() => now);
  vm.script = { name: "synthetic", ops: [] };
  return { vm, setTime: (t) => { now = t; } };
}

test("a track moves its layer's panel: QA_17 slides Neco-Arc and her panel right together (fields 11-14)", () => {
  // track 23539's shape: x 276 -> 325 and panel x 646 -> 843 over 1400 ms, ease 3; flags 0x14f406b1
  const tr = track([key(0, { 3: 276, 11: 646, 12: -40, 13: 910, 14: 1200, 15: 0, 16: 0 }, 3),
    key(1400, { 3: 325, 11: 843, 12: -40, 13: 910, 14: 1200 }, H, 2)], [351536817, 0]);
  const m = new Motion(23539, tr, {}, 0);
  const layer = { clip: [646, -40, 910, 1200], z: 2766, effect: 13, alpha: new Value(255) };
  assert.equal(m.sample(0, layer).clip, undefined, "at the start the panel is where STCH put it");
  const half = m.sample(700, layer);
  // quad out (ease 3) at a half is 0.75; the panel's x is stored as a whole number
  near(half.x, 276 + 49 * 0.75);
  assert.deepEqual(half.clip, [Math.trunc(646 + 197 * 0.75), -40, 910, 1200]);
  assert.deepEqual(m.sample(5000, layer).clip, [843, -40, 910, 1200]);
});

test("the renderer's view carries the sampled panel, and a layer linked to it moves with the panel's origin", () => {
  const owner = { id: 25, image: null, link: -1, parent: -1, clip: [646, -40, 910, 1200], z: 2766, effect: 0 };
  const view = motionView(owner, { clip: [843, -40, 910, 1200] });
  assert.notEqual(view, owner);
  assert.deepEqual(view.clip, [843, -40, 910, 1200]);
  assert.equal(view.z, 2766, "everything else is the layer's own");
  assert.deepEqual(owner.clip, [646, -40, 910, 1200], "the layer itself is not changed");
  assert.equal(motionView(owner, { x: 1, y: 2 }), owner, "a track writing only the transform needs no view");
  const linked = { id: 26, image: null, link: 25, parent: -1, z: 2906 };
  const all = new Map([[25, view], [26, linked]]);
  const states = new Map([[view, { x: 300, y: 203, zx: 1000, zy: 1000, rot: 0, alpha: 255 }],
    [linked, { x: 121, y: 231, zx: 1000, zy: 1000, rot: 0, alpha: 114 }]]);
  const placed = place([view, linked], states, () => null, all);
  assert.deepEqual(placed.get(linked).clip.rect, [843, -40, 910, 1200]);
  near(placed.get(linked).x, 121 * 4 + 843);
});

test("a field given only at time 0 is written once as STMA starts the track, so a later fade works (0x99620)", () => {
  const { vm, setTime } = machine();
  vm.motions = { 7: track([key(0, { 5: 255, 3: 100 }), key(1000, { 3: 200 })], ALL) };
  vm.op_STCH("1", "test");
  vm.op_STMA("1", "7");
  const l = vm.layerFor(1);
  assert.equal(l.alpha.at(1000), 255, "the start-only opacity stays on the layer");
  vm.op_STGS("1", "255", "0", "1000", "0");
  setTime(1500);
  const s = layerState(l, vm.now());
  near(s.alpha, 255 - 255 * (30 * 68 / 4096));   // a 1000 ms tween: 60 frames, step 68 (N2-91)
  near(s.x, 150, "x has a later key: the track goes on writing it");
});

test("flag bits decide which fields a track writes; the depth needs a layer whose own depth is not 0 (0x97b80)", () => {
  const frames = [key(0, { 3: 100, 27: 900 }), key(1000, { 3: 200, 27: 900 })];
  assert.deepEqual(new Motion(1, track(frames, [0, 0]), {}, 0).sample(500, { z: 5 }), {});
  assert.deepEqual(Object.keys(new Motion(1, track(frames, [1 << 18, 0]), {}, 0).sample(500, { z: 5 })), ["x"]);
  const depth = new Motion(1, track(frames, [1, 0]), {}, 0);
  assert.equal(depth.sample(500, { z: 5 }).z, 900);
  assert.equal(depth.sample(500, { z: 0 }).z, undefined);
});

test("blend, depth, grain and frame style step at keys; blend 0 is normal and 8 needs full opacity", () => {
  const frames = [key(0, { 17: 22, 27: 100, 26: 2, 15: 3, 5: 255 }), key(1000, { 17: 8, 27: 300, 26: 0, 15: 1, 5: 100 })];
  const m = new Motion(1, track(frames, ALL), {}, 0);
  const layer = { z: 5, alpha: new Value(255) };
  const mid = m.sample(500, layer);
  assert.deepEqual([mid.blend, mid.z, mid.grain, mid.frame], [22, 100, 2, 3]);
  near(mid.alpha, 177.5);
  const end = m.sample(1000, layer);
  assert.deepEqual([end.z, end.grain, end.frame], [300, 0, 1]);
  assert.equal(end.blend, 0, "blend 8 while the track's opacity is 100 is normal");
  const opaque = new Motion(1, track([key(0, { 17: 0 }), key(1000, { 17: 8 })], ALL), {}, 0);
  assert.equal(opaque.sample(500, layer).blend, 0);
  assert.equal(opaque.sample(1000, layer).blend, 8);
});

test("a track's preset 1 colours a layer that is not a silhouette, never one that is; bit 33 sets the colour", () => {
  const frames = [key(0, { 18: 1, 19: 255, 20: 19, 21: 19 }), key(1000, {})];
  const m = new Motion(1, track(frames, [1 << 9, 0]), {}, 0);
  assert.deepEqual(m.sample(500, { effect: 0 }).colour, [1, 19 / 255, 19 / 255]);
  assert.equal(m.sample(500, { effect: 1 }).colour, undefined);
  const plain = { id: 3, effect: 0, tint: null, mul: null };
  const v = motionView(plain, { colour: [1, 0, 0] });
  assert.deepEqual([v.mul, v.tint], [[1, 0, 0], null]);
  assert.deepEqual(motionView({ ...plain, effect: 1, tint: [0, 0, 0] }, { colour: [1, 1, 1] }).tint, [1, 1, 1]);
  const white = new Motion(1, track([key(0, { 19: 255, 20: 255, 21: 255 }), key(1000, {})], [0, 2]), {}, 0);
  assert.deepEqual(white.sample(500, { effect: 1 }).colour, [1, 1, 1]);
});

test("brightness and contrast keys are in SNX2's and SNX3's units; a track can move the pivot (fields 6, 7, 24, 25)", () => {
  const m = new Motion(1, track([key(0, { 24: 51, 25: 50, 6: 100, 7: 50 }), key(1000, { 6: 200 })], [0x146, 0]), {}, 0);
  const s = m.sample(500, { pivot: null });
  near(s.bright, 51 / 255 + 1);
  near(s.contrast, 1.5);
  assert.deepEqual(s.pivot, [150, 50]);
});

test("STEC sets the layer's colour back to white, as every preset but 1 does (0x3de0)", () => {
  const { vm } = machine();
  vm.op_STCH("4", "test");
  const l = vm.layerFor(4);
  l.mul = [0, 0, 0];
  vm.op_STEC("4", "13");
  assert.equal(l.mul, null);
});

test("SGMA writes the layer over the key its third argument names, with its panel (0x9a270)", () => {
  const { vm, setTime } = machine();
  vm.motions = { 9: track([key(0, { 3: 0 }), key(500, { 3: 50 }), key(1000, { 3: 100 })], ALL) };
  vm.op_STCH("2", "test", "77", "", "", "", "", "", "", "", "", "", "300", "10", "200", "100");
  vm.op_SGMA("2", "9", "1");
  // (the blank y keeps layer 2's cleared state, 0: 0x60840 writes y only when given)
  assert.deepEqual(vm.motionStarts[9][1], { x: 77, y: 0, alpha: 255, rot: 0, zx: 1000, zy: 1000, clip: [300, 10, 200, 100] });
  vm.op_STMA("2", "9");
  setTime(1500);
  near(layerState(vm.layerFor(2), vm.now()).x, 77);
});

test("the exporter writes the extra fields in the order animation.js reads them", () => {
  const src = readFileSync(new URL("../tools/build_animations.py", import.meta.url), "utf8");
  const m = /^EXTRA = \(([^)]*)\)/m.exec(src);
  assert.deepEqual(m[1].split(",").map((s) => Number(s.trim())), EXTRA);
});

test("QA_17's Neco-Arc track carries her panel from x 646 to 843 (generated tables)", () => {
  const url = new URL("../../web/assets/animations.json", import.meta.url);
  if (!existsSync(url)) return;   // generated files stay local
  const tracks = JSON.parse(readFileSync(url, "utf8")).tracks;
  const m = new Motion(23539, tracks[23539], {}, 0);
  const layer = { clip: [646, -40, 910, 1200], z: 2766, effect: 13, alpha: new Value(255) };
  const end = m.sample(1400, layer);
  assert.deepEqual(end.clip, [843, -40, 910, 1200]);
  near(end.x, 325);
});

test("a linked layer is drawn through its owner's picture when the owner has a clip and the layer is not SACL", async () => {
  const { maskOwner } = await import("../../web/app/js/renderer.js");
  const tex = { tex: {} };
  const owner = { id: 25, link: -1, clip: [646, -40, 910, 1200], ready: tex };
  const byId = new Map([[25, owner]]);
  assert.equal(maskOwner({ id: 26, link: 25, absolute: false }, byId), owner);
  assert.equal(maskOwner({ id: 26, link: 25, absolute: true }, byId), null, "SACL keeps its own clip, unmasked");
  assert.equal(maskOwner({ id: 26, link: 26 }, byId), null);
  assert.equal(maskOwner({ id: 26, link: -1 }, byId), null);
  assert.equal(maskOwner({ id: 26, link: 25 }, new Map([[25, { ...owner, clip: [0, 0, 0, 0] }]])), null, "no clip, no mask");
  assert.equal(maskOwner({ id: 26, link: 25 }, new Map([[25, { ...owner, ready: null }]])), null);
  // a full-screen clip still masks (0x36520 tests only for an empty one): 05_00_ARC05_9's img5007
  assert.equal(maskOwner({ id: 6, link: 5 }, new Map([[5, { ...owner, id: 5, clip: [0, 0, 1920, 1080] }]])).id, 5);
});

test("a blurred layer is placed by the pre-blurred picture's table entry, `<name>_XX_YY` (0x60840)", async () => {
  const { blurName, place } = await import("../../web/app/js/transform.js");
  assert.equal(blurName("aru_a_84_04_n00", 4, 4), "aru_a_84_04_n00_04_04");
  assert.equal(blurName("img0900", 1, 0), "img0900_01_00");
  assert.equal(blurName("img0900", 0, 0), "img0900");
  assert.equal(blurName("img0900", 123, -2), "img0900_23_00");
  const info = (n) => ({ PIC: [100, 100, 1], PIC_04_04: [116, 116, 1, 0.5, 0.75] })[n.toUpperCase()];
  const l = { id: 1, image: "pic", link: -1, parent: -1, pivot: null };
  const at = (blur) => place([l], new Map([[l, { x: 240, y: 136, zx: 1000, zy: 1000, rot: 0, alpha: 255, blurX: blur, blurY: blur }]]), info).get(l);
  assert.deepEqual(at(0).pivot, [0, 0]);
  assert.ok(at(4).pivot[1] > 0, "the variant's pivot, below its middle");
});

test("a track's blur takes hold only where the game has the picture it names; a pair with no file leaves the layer's own", async () => {
  const { setBlurLookup } = await import("../../web/app/js/animation.js");
  const { blurName, blurSigma } = await import("../../web/app/js/transform.js");
  // the game's files for one picture: a ladder along x, as the scripts' tweened blurs have (`img2473_01_00` .. `_20_00`)
  const files = new Set(["PIC", ...Array.from({ length: 20 }, (_, i) => `PIC_${String(i + 1).padStart(2, "0")}_00`)]);
  setBlurLookup((image, bx, by) => { const n = blurName(image, bx, by); return !n || n === image || files.has(n.toUpperCase()); });
  try {
    const layer = { image: "pic", blurX: 20, blurY: 0, x: new Value(0), y: new Value(0) };
    // a blur every step of which has a file is followed (native: 5.4 levels of 255 from the port's, 18.6 from a sharp picture)
    const tween = new Motion(1, track([key(0, { 22: 0 }), key(250, { 22: 20 })], ALL), {}, 0);
    assert.equal(tween.sample(125, { ...layer, blurX: 0 }).blurX, 0);
    assert.equal(tween.sample(250, { ...layer, blurX: 0 }).blurX, 20);
    assert.equal(layerState({ ...layer, blurX: 0, motion: tween }, 250).blurX, 20);
    // 4,4 has no file: the layer goes on showing its 20,0 (native: 2.1 from that, 5.1 from a 4,4 blur, 29.5 from nothing)
    const lost = new Motion(2, track([key(0, { 22: 4, 23: 4 }), key(1000, { 5: 255 })], ALL), {}, 0);
    const s = lost.sample(0, layer);
    assert.ok(!("blurX" in s) && !("blurY" in s), "the pair is not written");
    assert.deepEqual([layerState({ ...layer, motion: lost }, 0).blurX, layerState({ ...layer, motion: lost }, 0).blurY], [20, 0]);
    // one axis given, the other the layer's own: 3 with the layer's 0 is `_03_00`, which is there; with its 5 it is not
    const x3 = new Motion(3, track([key(0, { 22: 3 }), key(100, { 5: 255 })], ALL), {}, 0);
    assert.equal(x3.sample(0, { ...layer, blurX: 0, blurY: 0 }).blurX, 3);
    assert.ok(!("blurX" in x3.sample(0, { ...layer, blurX: 0, blurY: 5 })));
    // with no layer there is nothing to ask about, and a layer with no picture has none to lose
    assert.equal(lost.sample(0).blurX, 4);
    assert.equal(lost.sample(0, { ...layer, image: null }).blurX, 4);
  } finally { setBlurLookup(null); }
  // with no table set every pair counts as there (the tests above this one, a machine whose table has not come)
  const free = new Motion(4, track([key(0, { 22: 4, 23: 4 }), key(1000, { 5: 255 })], ALL), {}, 0);
  assert.equal(free.sample(0, { image: "pic", blurX: 20, blurY: 0 }).blurX, 4);

  // the two pictures whose `_99` files are softer than the rule, as measured on the files; their other steps are the rule's
  assert.equal(blurSigma("IMG2450", 99), 157.7);
  assert.equal(blurSigma("img2450", 99), 157.7);
  near(blurSigma("IMG2450", 64), Math.hypot(41.6, Math.sqrt(0.3)));
  assert.deepEqual(["A", "L", "M"].map((c) => blurSigma(`ARU_${c}_84_10_N00`, 99)), [84.3, 42.2, 21.2]);
  near(blurSigma("ARU_L_84_10_N00", 64), Math.hypot(20.8, Math.sqrt(0.3)));
  near(blurSigma("ARU_L_60_00_N00", 99), Math.hypot(32.175, Math.sqrt(0.3)));
});
