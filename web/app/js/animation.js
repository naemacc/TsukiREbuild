// Motion keyframes exported from the original engine. Times are milliseconds;
// coordinates, zoom (1000 = 1x), and rotation (100 = one degree) stay in script units.
export const PROPERTIES = ["x", "y", "alpha", "rot", "zx", "zy", "blurX", "blurY"];
// Whether the game has the picture a layer's blur numbers name, `<name>_XX_YY`: (image, blurX, blurY) -> true / false.
// The script machine sets it once it has the picture table (vm.js); with none set every pair counts as there.
let blurHasPicture = null;
export function setBlurLookup(fn) { blurHasPicture = fn; }
const FRAME_MS = 1000 / 60;
const clamp = (x) => Math.max(0, Math.min(1, x));
const bounce = (x) => {
  if (x < 1 / 2.75) return 7.5625 * x * x;
  if (x < 2 / 2.75) return 7.5625 * (x -= 1.5 / 2.75) * x + 0.75;
  if (x < 2.5 / 2.75) return 7.5625 * (x -= 2.25 / 2.75) * x + 0.9375;
  return 7.5625 * (x -= 2.625 / 2.75) * x + 0.984375;
};

// The engine's easing (0x30c80 for tweens, the identical 0x961b0 for motion tracks): Penner's equations. Ids 2-41 are
// in / out / in-out / out-in of quad, cubic, quart, quint, sine, circ, expo, elastic, back and bounce; 0, 1 and the
// rest are linear. In-out and out-in are the in and out curves on each half, except where the engine has its own:
// expo carries Penner's 0.001 corrections (26-29), elastic in-out has a period of 0.45 of the whole tween (32) and
// back in-out an overshoot of 1.70158 x 1.525 (36).
const expoIn = (x) => (x === 0 ? 0 : 2 ** (10 * (x - 1)) - 0.001);
const expoOut = (x) => (x === 1 ? 1 : 1.001 * (1 - 2 ** (-10 * x)));
export function ease(id, t) {
  t = clamp(t);
  if (t === 0 || t === 1 || id < 2 || id > 41) return t;
  const family = Math.floor((id - 2) / 4), direction = (id - 2) % 4;
  if (family === 6) {
    if (direction === 0) return expoIn(t);
    if (direction === 1) return expoOut(t);
    const p = t * 2;
    if (direction === 2) return p < 1 ? 0.5 * 2 ** (10 * (p - 1)) - 0.0005 : 0.5 * 1.0005 * (2 - 2 ** (-10 * (p - 1)));
    return t < 0.5 ? 0.5 * expoOut(p) : 0.5 + 0.5 * expoIn(p - 1);
  }
  if (family === 7 && direction === 2) {
    const f = t * 2 - 1, s = Math.sin((f - 0.1125) * 2 * Math.PI / 0.45);
    return f < 0 ? -0.5 * 2 ** (10 * f) * s : 0.5 * 2 ** (-10 * f) * s + 1;
  }
  if (family === 8 && direction === 2) {
    const k = 1.70158 * 1.525, p = t * 2;
    if (p < 1) return 0.5 * p * p * ((k + 1) * p - k);
    const f = p - 2;
    return 0.5 * (f * f * ((k + 1) * f + k) + 2);
  }
  const input = (x) => {
    if (family < 4) return x ** (family + 2);
    if (family === 4) return 1 - Math.cos(x * Math.PI / 2);
    if (family === 5) return 1 - Math.sqrt(Math.max(0, 1 - x * x));
    if (family === 6) return x === 0 ? 0 : 2 ** (10 * (x - 1));
    if (family === 7) return x === 0 || x === 1 ? x : -(2 ** (10 * (x - 1))) * Math.sin((x - 1.075) * 2 * Math.PI / 0.3);
    if (family === 8) return x * x * (2.70158 * x - 1.70158);
    return 1 - bounce(1 - x);
  };
  const output = (x) => 1 - input(1 - x);
  if (direction === 0) return input(t);
  if (direction === 1) return output(t);
  if (direction === 2) return t < 0.5 ? input(t * 2) / 2 : 0.5 + output(t * 2 - 1) / 2;
  return t < 0.5 ? output(t * 2) / 2 : 0.5 + input(t * 2 - 1) / 2;
}

export class AnimationClock {
  constructor(read = () => performance.now()) { this.read = read; this.offset = 0; this.reasons = new Set(); this.held = 0; }
  now(real = this.read()) { return this.reasons.size ? this.held : real - this.offset; }
  pause(reason, on) {
    const real = this.read();
    if (on && !this.reasons.has(reason)) {
      if (!this.reasons.size) this.held = real - this.offset;
      this.reasons.add(reason);
    } else if (!on && this.reasons.delete(reason) && !this.reasons.size) this.offset = real - this.held;
  }
  // Moves the clock on by ms, held or not: fast forward's frames, which each stand for 33 (vm.js `tick`).
  advance(ms) { if (this.reasons.size) this.held += ms; else this.offset -= ms; }
}

export class Value {
  constructor(v) { this.a = v; this.b = v; this.t0 = 0; this.ms = 0; this.step = 4096; this.nominal = 0; this.ease = 0; }
  // A tween counts frames = ms x 60 / 1000 (a whole number) down from 4096 by the integer step 4096 / frames, each frame
  // (0x637a0 / 0x62d20 / 0x62b20 / 0x625c0 set it up: 0x32820, 0x31f30, 0x32630; 0x3c970 runs it), so the progress at
  // frame n is n x step / 4096 and it lasts ceil(4096 / step) frames: 3000 ms is 187 frames, 40000 ms 4096 (N2-91).
  at(now) {
    if (this.ms <= 0 || now >= this.t0 + this.ms) return this.b;
    const k = Math.min(1, ((now - this.t0) / FRAME_MS) * this.step / 4096);
    return this.a + (this.b - this.a) * ease(this.ease, k);
  }
  // A blank start is the value last asked for (the engine keeps each tween's target and starts from it: STGS +0x1e4,
  // STRT +0x284, STZ4 +0x7d4 / +0x824), so a tween cut short jumps to where it was going. A blank end is `blank`:
  // 0 for STGS and STRT (0x637a0, 0x62b20), the last target for STZ4 (0x62d20); by default the start.
  to(from, to, ms, curve, now, blank) {
    const last = this.b;
    this.a = from === undefined ? last : from;
    this.b = to !== undefined ? to : blank === "last" ? last : blank !== undefined ? blank : this.a;
    this.t0 = now;
    this.ease = curve || 0;
    this.nominal = Math.max(0, ms || 0);
    const frames = Math.trunc(this.nominal * 60 / 1000);
    if (frames < 1) { this.ms = 0; this.step = 4096; return; }
    this.step = Math.max(1, Math.trunc(4096 / frames));
    this.ms = Math.ceil(4096 / this.step) * FRAME_MS;
  }
  done(now) { return this.ms <= 0 || now >= this.t0 + this.ms; }
  end(now) { return Math.max(0, this.t0 + this.ms - now); }
  toJSON() { return this.b; }
  snapshot(now) { return { a: this.a, b: this.b, ms: this.nominal, elapsed: this.ms ? Math.max(0, now - this.t0) : 0, ease: this.ease }; }
  static restore(s, fallback, now) {
    const v = new Value(fallback);
    if (s) v.to(s.a, s.b, s.ms, s.ease, now - (s.elapsed || 0));
    return v;
  }
}

// ---- motion tracks (STMA) -------------------------------------------------------------------------------------
// A keyframe holds 28 fields, which 0x99ff0 reads one by one. An exported frame (tools/build_animations.py) has the
// port's first eleven, native fields 0-5, 8-10, 22 and 23 (time, ease, mode, x, y, alpha, rotation, zoom x / y and the
// blur pair), then EXTRA's in that order, as many as were not trailing holds: depth, blend, colour preset, the panel's
// x, y, width and height, its frame style and edge width, red, green, blue, brightness, contrast, the pivot's x and y
// and film grain.
export const EXTRA = [27, 17, 18, 11, 12, 13, 14, 15, 16, 19, 20, 21, 24, 25, 6, 7, 26];
const SLOT = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 8: 6, 9: 7, 10: 8, 22: 9, 23: 10 };
EXTRA.forEach((f, i) => { SLOT[f] = 11 + i; });
const ROT = 8;
// The rotation's hold and skip are -100001 and -100000, every other field's -32767 and -32766 (0x97710).
const holdOf = (f) => (f === ROT ? -100001 : -32767);
const skipOf = (f) => (f === ROT ? -100000 : -32766);
const field = (frame, f) => { const v = frame[SLOT[f]]; return v === undefined || v === null ? holdOf(f) : v; };
const unset = (v) => v === -32767 || v === -32766;   // an ease or a mode not given
// The frame style and fields 17-27 keep the earlier key's value until the next key: 0x97710 returns it for them
// before it looks at the mode.
const STEPS = new Set([15, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27]);
// The properties the base of a spline channel comes from when its first key is a hold.
const NAMES = { 3: "x", 4: "y", 5: "alpha", 8: "rot", 9: "zx", 10: "zy", 22: "blurX", 23: "blurY" };
// Written once as a track starts unless a later key gives them (see writes); STMA keeps them on the layer.
export const START_ONLY = ["x", "y", "alpha", "zx", "zy", "blurX", "blurY", "blend"];

// 0x97710: one field's value at time t, `next` being the first key at or after t, or undefined where the engine hands
// back the value the layer already has. A hold repeats the value before it (from its own time); a skip leaves the key
// out for this field. The ease is that of the last earlier key that has the field and an ease, the mode that of the
// last earlier key with a mode: 2 keeps the earlier value, 1 is the engine's spline, anything else a straight line.
function fieldAt(frames, t, f, next, whole, moments) {
  const H = holdOf(f), K = skipOf(f), last = frames.length - 1;
  const val = (i) => field(frames[i], f);
  if (t < frames[0][0]) return undefined;
  let i = next, nv = val(i), nt = frames[i][0];
  while (i < last && nv === K) { i++; nv = val(i); nt = frames[i][0]; }
  let pv, pt = 0, from = -1;
  if (next === 0 || nt <= t) {
    let j = i;
    pv = val(j);
    while ((pv === H || pv === K) && j > 0) { j--; pv = val(j); }
  } else {
    let k = next - 1;
    pv = val(k); pt = frames[k][0];
    while (pv === K && k > 0) { k--; pv = val(k); pt = frames[k][0]; }
    from = k;
    if (nv !== H && pv === H && k > 0) {
      for (let j = k - 1; ; j--) { pv = val(j); if ((pv !== K && pv !== H) || j <= 0) break; }
    }
  }
  if (nv === H) {
    let j = next, v = val(j);
    while ((v === H || v === K) && j > 0) { j--; v = val(j); }
    return v === H || v === K ? undefined : v;
  }
  if (pv === H) return undefined;
  if (nv === K) {
    for (let j = last; j > 0;) { j--; const v = val(j); if (v !== K) return v; }
    return undefined;
  }
  if (pv === K) return undefined;
  let k = 1;
  if (nt > pt) {
    let id = 0;
    if (!whole) {
      let e = -32767;
      if (next === 0) e = frames[0][1];
      else for (let j = next; j > 0;) { j--; if (val(j) === K) continue; e = frames[j][1]; if (!unset(e)) break; }
      id = unset(e) ? 0 : e;
    }
    k = ease(id, (t - pt) / (nt - pt));
  }
  if (STEPS.has(f)) return pv;
  let mode;
  if (next === 0) mode = frames[0][2];
  else { let j = next; do { j--; mode = frames[j][2]; } while (unset(mode) && j > 0); }
  if (mode === 2) return pv;
  const m = mode === 1 && next >= 1 && moments ? moments.get(next - 1) : null;
  if (m) return pv + k * (((nv - pv) - (m[1] + 2 * m[0])) + k * (3 * m[0] + k * (m[1] - m[0])));
  return pv + (nv - pv) * k;
}

// The spline's moments for one field (0x972c0), by frame index: the points are the frames' raw field values: a frame that
// is a skip, or equal to both its raw neighbours (holds compare as their sentinel), joins the point before it (N2-104), and
// the last frame adds a point unless it equals the frame before it or is a hold; a point takes its raw value, or
// walking back over holds and skips the last real one, or the base when there is none. Fewer than three points: a straight
// line. With m the moments (M / 6), m[i-1] + 4 m[i] + m[i+1] = (y[i+1] - y[i]) - (y[i] - y[i-1]), m = 0 at both ends, a
// segment is y0 + k (y1 - y0) - k (2 m0 + m1) + 3 m0 k^2 + (m1 - m0) k^3 (0x97710).
function splineFor(frames, f, base) {
  const H = holdOf(f), K = skipOf(f), last = frames.length - 1;
  const val = (i) => field(frames[i], f);
  const real = (i) => { let j = i, v = val(j); while ((v === H || v === K) && j > 0) { j--; v = val(j); } return v === H || v === K ? base : v; };
  const ys = [real(0)], pointOf = new Array(frames.length).fill(0);
  for (let i = 1; i < last; i++) {
    const prev = val(i - 1), cur = val(i), next = val(i + 1);
    if (cur === K || (prev === cur && cur === next)) { pointOf[i] = ys.length - 1; continue; }
    pointOf[i] = ys.length;
    ys.push(real(i));
  }
  if (last >= 1) {
    if (val(last - 1) !== val(last) && val(last) !== H) { pointOf[last] = ys.length; ys.push(real(last)); }
    else pointOf[last] = ys.length - 1;
  }
  const m = splineMoments(ys);
  return new Map(frames.map((_, i) => [i, [m[pointOf[i]] ?? 0, m[pointOf[i] + 1] ?? 0]]));
}

// The solve the engine does (0x972c0, listing 0x9760c-0x97624): the forward pass has b[1] = 4, b[i] = 4 - 1 / b[i-1], and its
// right-hand side at i >= 2 subtracts b x (1 / b) = 1 where a Thomas algorithm would subtract the previous term / b (N2-103);
// the back substitution is the usual m[i] = (R[i] - m[i+1]) / b[i]. y = 0, 255, 255, 0 gives m1 = -46.68.
function splineMoments(ys) {
  const n = ys.length, m = new Array(n + 1).fill(0);
  if (n < 3) return m;
  const d = [], b = new Array(n).fill(0), R = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d[i] = ys[i + 1] - ys[i];
  b[1] = 4;
  R[1] = d[1] - d[0];
  for (let i = 2; i <= n - 2; i++) { b[i] = 4 - 1 / b[i - 1]; R[i] = (d[i] - d[i - 1]) - 1; }
  m[n - 2] = R[n - 2] / b[n - 2];
  for (let i = n - 3; i >= 1; i--) m[i] = (R[i] - m[i + 1]) / b[i];
  return m;
}

// 0x97b80 writes a field only when the track's flags (0x36ab38, 64 bits as [low, high]) let it. Position, opacity,
// zoom, the blur pair and the blend are written past the start only when a key after time 0 gives them (a skip counts,
// a hold does not); given only at time 0 they are written once, as STMA starts the track (0x99620 runs 0x97b80 at
// time 0), and then left to the script. Each of those tests clears its own bits, and x's (7, 11, 18) and y's (20, 24,
// 26) also close the panel's x / width (bits 7, 28) and y / height (10, 26) when no other bit opens them. A track
// without flags (the tests' own) writes everything.
function writes(frames, flags, next, later) {
  let lo = flags ? flags[0] | 0 : -1, hi = flags ? flags[1] | 0 : -1;
  const live = (f) => frames[next][0] === 0 || later.has(f);
  if (!live(3)) lo &= ~0x40880;
  if (!live(4)) lo &= ~0x5100000;
  if (!live(5)) lo &= ~0x4000;
  const bx = live(22), by = live(23);
  if (bx && !by) lo &= ~0x40000000;
  else if (!bx && by) lo &= ~0x20000000;
  else if (!bx && !by) lo &= ~0x60000000;
  const zx = live(9), zy = live(10);
  if (zx && !zy) { lo &= ~0x400000; hi &= ~1; }
  else if (!zx && !zy) { lo &= ~0x80600000; hi &= ~1; }
  else if (!zx && zy) lo &= ~0x80200000;
  return {
    x: lo & 0x40880, y: lo & 0x5100000, alpha: lo & 0x4000, blurX: lo & 0x20000000, blurY: lo & 0x40000000,
    pivotX: lo & 0x10002, pivotY: lo & 0x20004, rot: lo & 0x88000, clipRot: hi & 4,
    zx: lo & 0x80200000, zy: (lo & 0x400000) | (hi & 1), clipX: lo & 0x10000080, clipY: lo & 0x4000400,
    frame: lo & 0x10, border: lo & 0x20, blend: live(17) && (lo & 0x2000000), preset: lo & 0x200, colour: hi & 2,
    bright: lo & 0x40, contrast: lo & 0x100, grain: lo & 0x1000, depth: lo & 1,
  };
}

// SGMA (0x9a270) writes the layer's x, y, opacity, rotation and zoom, and its panel when the panel's x is not 0, over
// one keyframe of the track: its third argument, 0 when blank. Saves from before that argument was kept hold the
// start values alone.
function withCaptured(frames, captured) {
  if (!captured || !frames.length) return frames;
  const byKey = "x" in captured || "zx" in captured ? { 0: captured } : captured;
  const out = frames.slice();
  for (const [n, c] of Object.entries(byKey)) {
    const i = Number(n);
    if (!c || !(i >= 0 && i < out.length)) continue;
    const frame = out[i].slice();
    while (frame.length < 11 + EXTRA.length) frame.push(-32767);
    const put = (f, v) => { if (v !== undefined && v !== null) frame[SLOT[f]] = Math.trunc(v); };
    put(3, c.x); put(4, c.y); put(5, c.alpha); put(ROT, c.rot); put(9, c.zx); put(10, c.zy);
    if (c.clip) c.clip.forEach((v, k) => put(11 + k, v));
    out[i] = frame;
  }
  return out;
}

const own = (layer, k, now) => { const v = layer?.[k]; return v instanceof Value ? v.at(now) : v; };
// 0x3b30 takes red, green and blue as one number: red x 65536 + green x 256 + blue, then a byte each.
function rgbOf(at) {
  const c = (f) => { const v = at(f); return v === undefined ? 0 : Math.trunc(v); };
  const n = (c(19) << 16) + (c(20) << 8) + c(21);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class Motion {
  constructor(id, track, base, now, captured = null) {
    this.id = id; this.track = track; this.base = { ...base }; this.captured = captured ? structuredClone(captured) : null;
    this.start = now; this.held = null;
    this.frames = withCaptured(track.frames || [], this.captured);
    // the start-only fields some key after time 0 gives (0x97b80's tests: anything but a hold)
    this.later = new Set();
    for (const frame of this.frames) {
      if (frame[0] === 0) continue;
      for (const f of [3, 4, 5, 9, 10, 17, 22, 23]) { const v = field(frame, f); if (v !== -32767 && v !== -100001) this.later.add(f); }
    }
    this.curved = this.frames.some((frame) => frame[2] === 1);
    this.splines = new Map();
    const presets = new Set(this.frames.map((frame) => field(frame, 18)).filter((v) => !unset(v)));
    this.presetVaries = presets.has(1) && presets.size > 1;
    this.step = 0;   // STMA's fourth argument: with 2 or more the track moves on every `step` frames (0x95938)
  }
  elapsed(now) { return Math.max(0, (this.held ?? now) - this.start); }
  time(now) {
    let elapsed = this.elapsed(now);
    if (this.step >= 2) elapsed = Math.floor(elapsed / (this.step * FRAME_MS) + 1e-7) * this.step * FRAME_MS;
    const duration = this.track.duration;
    if (this.track.loop && elapsed > duration) {
      const start = this.track.loop === 1 ? 0 : Math.min(duration - 1, this.track.loop);
      return start + (elapsed - start) % Math.max(1, duration - start);
    }
    return Math.min(duration, elapsed);
  }
  pause(on, now) {
    if (on && this.held === null) this.held = now;
    else if (!on && this.held !== null) { this.start += now - this.held; this.held = null; }
  }
  remaining(now) { return this.track.loop || this.held !== null ? 0 : Math.max(0, this.track.duration - this.elapsed(now)); }
  spline(f) {
    if (!this.curved) return null;
    if (!this.splines.has(f)) this.splines.set(f, splineFor(this.frames, f, this.base[NAMES[f]] ?? 0));
    return this.splines.get(f);
  }
  // The fields' values at track time t (ms): a function of the field number, undefined where the layer keeps its own.
  reader(t) {
    const F = this.frames;
    let next = F.findIndex((frame) => frame[0] >= t);
    if (next < 0) next = F.length - 1;
    const whole = this.id === 9999;
    return { next, at: (f) => fieldAt(F, t, f, next, whole, this.spline(f)) };
  }
  // What 0x97b80 writes to the layer at `now`: x, y, alpha, rot, zx, zy, blurX, blurY (script units, as the layer's
  // own), pivot, clip, clipRot, frame, border, blend, colour, bright, contrast, grain and z. `layer`, when given, is
  // the layer the track runs on: its own values fill what a field leaves out and decide the writes that depend on it.
  sample(now, layer = null) {
    let t = this.time(now);
    const F = this.frames, out = {};
    if (!F.length) return out;
    // The original reserves track 9999 for easing the complete timeline (0x99950).
    if (this.id === 9999 && this.track.duration) t = ease(F[0][1], t / this.track.duration) * this.track.duration;
    if (t < F[0][0]) return out;
    const { next, at } = this.reader(t);
    const w = writes(F, this.track.flags, next, this.later);
    const put = (k, f, map = (v) => v) => { const v = at(f); if (v !== undefined) out[k] = map(v); };
    if (w.x) put("x", 3);
    if (w.y) put("y", 4);
    if (w.alpha) put("alpha", 5, (v) => Math.max(0, Math.min(255, v)));
    if (w.blurX) put("blurX", 22);
    if (w.blurY) put("blurY", 23);
    // The blur pair names a picture and the track switches the layer to it only when the game has that file: a pair
    // with none leaves the layer on the picture it had. Native frames against the port's, same commands, 2026-11-13:
    // img2473 put up at blur 20,0 and track 3443 writing 4,4 (no `_04_04` of it) goes on showing the 20,0 picture
    // (2.1 levels of 255 from that, 5.1 from a 4,4 blur, 29.5 from nothing), while track 23377's 0 -> 20, every step
    // of which has a file, is followed (5.4 against 18.6 for a picture left sharp). QA_13's shadow is the case in
    // the story: img2450 at 99,99 with track 23384 writing 255.
    if ((out.blurX !== undefined || out.blurY !== undefined) && layer && blurHasPicture) {
      const own = (k) => (layer[k] instanceof Value ? layer[k].at(now) : layer[k] ?? 0);
      if (!blurHasPicture(layer.image, out.blurX ?? own("blurX"), out.blurY ?? own("blurY"))) { delete out.blurX; delete out.blurY; }
    }
    // the pivot, in STPV's units (0x639a0 and 0x97b80 convert both alike)
    if (w.pivotX || w.pivotY) {
      const px = w.pivotX ? at(6) : undefined, py = w.pivotY ? at(7) : undefined;
      const mine = layer?.pivot || [null, null];
      if (px !== undefined || py !== undefined) out.pivot = [px ?? mine[0] ?? null, py ?? mine[1] ?? null];
    }
    if (w.rot) put("rot", ROT);
    // flag bit 34: the panel turns with the rotation field, stored as 16 bits (record +0x148), or with the layer's
    // rotation where the field has no value
    if (w.clipRot) {
      const v = at(ROT);
      out.clipRot = (Math.trunc(v !== undefined ? v : out.rot ?? own(layer, "rot", now) ?? 0) << 16) >> 16;
    }
    if (w.zx) put("zx", 9);
    if (w.zy) put("zy", 10);
    // the panel: x and width together, y and height together; width and height are made even (0x97b80)
    if (w.clipX || w.clipY) {
      const mine = layer?.clip || [0, 0, 0, 0], c = [0, 1, 2, 3].map((k) => mine[k] ?? 0);
      const even = (v) => Math.trunc(v) & ~1;
      if (w.clipX) { const x = at(11), cw = at(13); if (x !== undefined) c[0] = (Math.trunc(x) << 16) >> 16; c[2] = even(cw !== undefined ? cw : c[2]); }
      if (w.clipY) { const y = at(12), ch = at(14); if (y !== undefined) c[1] = (Math.trunc(y) << 16) >> 16; c[3] = even(ch !== undefined ? ch : c[3]); }
      if (c.some((v, k) => v !== (mine[k] ?? 0))) out.clip = c;
    }
    if (w.frame) put("frame", 15, (v) => (Math.trunc(v) << 24) >> 24);
    if (w.border) put("border", 16, (v) => Math.max(0, Math.trunc(v)));
    // the blend: 0 is normal, and 8 is normal too while the layer is not fully opaque
    if (w.blend) {
      put("blend", 17, (v) => {
        const b = Math.trunc(v), alpha = out.alpha ?? own(layer, "alpha", now) ?? 255;
        return b <= 0 || (b === 8 && alpha < 255) ? 0 : b;
      });
    }
    // the colour (record +0x1cc): field 18 never changes the preset, but where the track asks for preset 1 and the
    // layer has another, the layer takes fields 19-21 as its colour; flag bit 33 writes them whatever the preset
    let colour;
    if (w.preset && (layer?.effect ?? 0) !== 1) colour = this.presetColour(t, at);
    if (w.colour) colour = rgbOf(at);
    if (colour) out.colour = colour;
    // SNX2's and SNX3's units; a field with no value counts as 0 here, which is 1, unchanged
    if (w.bright) { const v = at(24); out.bright = (v ?? 0) / 255 + 1; }
    if (w.contrast) { const v = at(25); out.contrast = (v ?? 0) * 0.01 + 1; }
    if (w.grain) put("grain", 26, (v) => (Math.trunc(v) << 24) >> 24);
    // the depth, unless it is 0 or the layer's own is 0
    if (w.depth) { const v = at(27); if (v !== undefined && v !== 0 && (layer?.z ?? 0) !== 0) out.z = Math.trunc(v); }
    return out;
  }
  // The colour last written through field 18: at t, or at the latest earlier key where the track asked for preset 1.
  presetColour(t, at) {
    const p = at(18);
    if (p !== undefined && Math.trunc(p) === 1) return rgbOf(at);
    if (!this.presetVaries) return undefined;
    for (let k = this.frames.length - 1; k >= 0; k--) {
      const tk = this.frames[k][0];
      if (tk >= t) continue;
      const r = this.reader(tk), q = r.at(18);
      if (q !== undefined && Math.trunc(q) === 1) return rgbOf(r.at);
    }
    return undefined;
  }
  snapshot(now) { return { id: this.id, elapsed: this.elapsed(now), paused: this.held !== null, base: this.base, captured: this.captured, step: this.step }; }
  static restore(s, tracks, now) {
    if (!s || !tracks[s.id]) return null;
    const motion = new Motion(s.id, tracks[s.id], s.base, now - s.elapsed, s.captured);
    if (s.paused) motion.held = now;
    motion.step = s.step || 0;
    return motion;
  }
}

export function layerState(layer, now) {
  const state = {};
  for (const k of PROPERTIES) state[k] = layer[k] instanceof Value ? layer[k].at(now) : layer[k] ?? 0;
  if (layer.motion) Object.assign(state, layer.motion.sample(now, layer));
  state.alpha = Math.max(0, Math.min(255, state.alpha));
  state.blurX = Math.max(0, state.blurX); state.blurY = Math.max(0, state.blurY);
  return state;
}
