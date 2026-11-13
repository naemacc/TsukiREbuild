// transform.js - where the original engine puts a layer: parents, pivots, panel clips and links.
//
// Read from the Japanese image (SHA-256 ac6b0120…), module-relative addresses:
//   0x892b0 / 0x89420   world x / y, recursing through the SBAS parent (+0x93c)
//   0x89190 / 0x89220   zoom through the parent chain, times the parent's size class
//   0x8c480             rotation: own plus the parent's
//   0x639a0             STPV: pivot in image space (script units from the top left), optional rotation
//                       A layer's position is where its pivot is drawn. (The scripts confirm it: of the
//                       backgrounds given a pivot, three times as many cover the screen drawn that way.)
//   0x60840             STCH: arg 11 links a layer to another; args 12-15 a clip rect in 1920x1080 pixels,
//                       arg 16 the width of its feathered edge, arg 17 the colour of a frame over that edge
//                       (0 none); arg 4 a scale kept apart from STZ4's zoom
//   0x884f0, 0x89ad0    per-frame placement and drawing: a linked layer uses its link's clip, is moved by that
//                       clip's origin unless SACL is set (0x88cc8 tests the link first: a layer with no link is
//                       never moved, so a panel's own picture stays where the script puts it), and is multiplied
//                       by its link's alpha
// The engine works in its own units: x is script x / 2 and y is script y * 2/3, which the screen maps at
// 8 and 1080/181.33 pixels. Rotating through a parent happens in those units, as it does in the original.

export const SX = 4, SY = 1080 / 272;      // screen pixels per script unit
const IX = 0.5, IY = 2 / 3;                // engine units per script unit
const PX = SX / IX, PY = SY / IY;          // screen pixels per engine unit
const F = 1.5;                             // screen pixels per stored image pixel at zoom 1

// The smaller stored sizes of a sprite: L, M and S are 1/2, 1/4 and 1/8 of the A image.
// (the engine reads the class from the picture's table record, +0x46: 1, 2, 3 for 0.5, 0.25, 0.125; all but one of the
// 14,713 records agree with the name's size letter, including prefixes with digits such as Z20_L_ and Y00_M_ (N2-7))
export function sizeClass(name) {
  const n = (name || "").toUpperCase();
  if (n === "IMG5028") return 0.25;   // the one record whose class is not in its name
  const m = /^[A-Z0-9]+_([LMS])_/.exec(n);
  return m ? { L: 0.5, M: 0.25, S: 0.125 }[m[1]] : 1;
}

// The picture's size in script units at zoom 1.
export function imageSize(info) {
  return info ? [info[0] * F / SX, info[1] * F / SY] : [0, 0];
}

// The picture's own pivot as fractions of its size: the engine's image table (+0x34/+0x38, kept by build_system.py
// as info[3], info[4] for the pictures whose pivot is not their centre). STCH gives the layer this pivot (0x60840) and
// the draw anchors the picture there (0x89ad0 -> 0xb0710), so a sprite stands on its own point, not its canvas centre.
export function defaultPivot(info) {
  return [info && info[3] != null ? info[3] : 0.5, info && info[4] != null ? info[4] : 0.5];
}

// The pivot in the layer's own picture, in script units from its top left. STPV gives it in A-image units. STCH and
// SCH2 without a source give the table's pivot cut to whole 640 x 362 units (0x60840 at 0x62024, fcvtzs): `cut`,
// with what that loses kept by build_system.py as info[5], info[6] (fractions of the size).
// A blurred picture given a pivot (STPV, 0x639a0 at 0x63fdc-0x64000 and the y twin): the table pivot of the blurred entry
// less the base picture's (blurred record's +0x43 bit 0, _XX_YY digits not 0 and the base name in the table) is added
// to each axis given, so the blur margin does not move the picture (N2-13). `base`: the base picture's entry.
export function pivotOf(l, info, base = null) {
  const [w, h] = imageSize(info);
  let [ax, ay] = defaultPivot(info);
  if (l.cut && info) { ax -= info[5] || 0; ay -= info[6] || 0; }
  if (!l.pivot) return [w * ax, h * ay];
  const k = sizeClass(l.image);
  let dx = 0, dy = 0;
  if (base && info !== base) {
    const [bw, bh] = imageSize(base), [bax, bay] = defaultPivot(base), [ax0, ay0] = defaultPivot(info);
    dx = w * ax0 - bw * bax;
    dy = h * ay0 - bh * bay;
  }
  return [l.pivot[0] == null ? w * ax : l.pivot[0] * k + dx, l.pivot[1] == null ? h * ay : l.pivot[1] * k + dy];
}

// A clip is on when it has a size (0x36520: w and h not 0). A full 1920 x 1080 one still counts: 0x32050 adds the quake,
// shake and 2 x SHOK to it whenever any of x, y, w, h is not 0, so during a shake it is cut at the moved edge, and one
// at an offset cuts the picture there (N2-5; 10_00_ARC10_3_2, 10_01_CIEL10_5).
function activeClip(c) {
  return c && c[2] && c[3] ? c : null;
}

// The panel groups of the draw task (0x3bba0, listing 0x3bd78-0x3bdd8 and 0x3c1e8 on). Every layer's number is its link,
// or -1 at depth 0 or with no picture; an owner of a linked layer takes the group's number too if it has none of its
// own (in layer order). A group is a run of neighbours in depth order with one number other than -1; the first one
// is opened by 0xa2ba0(1) and closed by state 2. Only a run of two or more whose owner has a panel (0x36520's panel path)
// is composited as a group: the rest are drawn one by one (a run of one and a link to an owner without a clip fall
// through the same plain or panel paths as any layer).
// How a group composites when the first layer drawn is translucent (0xa6570 and 0xa2c30; measured on native frames with a
// grid of opacities): the first layer goes into the group's buffer at full, each later one at min(1, own alpha / the
// first's) (not multiplied by the link's alpha), and the buffer goes over the scene at the first alpha when the
// owner's panel has an edge width (arg 16), its square when it has none.
export function groupOpacity(firstAlpha, border) {
  return firstAlpha > 0 ? (border > 0 ? firstAlpha : firstAlpha * firstAlpha) : 0;
}
// Where the opacity comes from: the buffer's own alpha is the first alpha when the panel has no edge width and 1 when it
// has one (the coverage here), and the pass that lays it over the scene multiplies by the first alpha again. The two
// only show apart in a shader that uses the opacity without the texel's alpha (dodge, add).
export function groupCoverage(firstAlpha, border) {
  return border > 0 ? 1 : Math.max(0, firstAlpha);
}
// A group is made in a buffer when its first layer is translucent or has a blend shader: 0xa2c30 / 0x37ea0 lay the
// buffer over the scene with the first layer's blend at any alpha, so at full alpha too its picture only reaches the
// scene through that blend (02_00_ARC02_1: a grey `ps_lighten` owner, whose opaque room and subtracted lines stay under
// the scene's own room). A panel with an edge width needs the buffer at full alpha too: its mask fades the finished group
// once, so a picture that covers the owner leaves none of the owner showing in the fade (N2-211; 02_00_ARC02_1B op 1264,
// compared with native frames). A plain first layer at full alpha and no edge gives the same picture drawn directly.
export function groupNeedsBuffer(firstAlpha, firstShader, border = 0) {
  return firstAlpha < 1 || !!firstShader || border > 0;
}
export function groupRelative(alpha, firstAlpha) {
  return firstAlpha > 0 ? Math.min(1, alpha / firstAlpha) : 0;
}

// What 0xa2ba0 is told for each layer of the draw loop (0x3bba0): 0 for a layer with no number, 1 when the next layer in
// depth order has the same number, 2 when it does not. Layer numbers as in panelRuns.
export function groupModes(order, all) {
  const number = new Map();
  for (const [id, l] of [...all.entries()].sort((a, b) => a[0] - b[0])) {
    number.set(id, l.z >= 1 && l.ready && l.link >= 0 && l.link !== id ? l.link : -1);
  }
  for (const [id, n] of [...number.entries()]) if (n !== -1 && (number.get(n) ?? -1) === -1) number.set(n, n);
  const modes = new Map();
  order.forEach((l, i) => {
    const n = number.get(l.id) ?? -1;
    const next = i + 1 < order.length ? number.get(order[i + 1].id) ?? -1 : -1;
    modes.set(l, { number: n, mode: n === -1 ? 0 : next === n ? 1 : 2 });
  });
  return modes;
}
// Linked layers come as plain groups when every member with a panelled owner sits in a run that starts with its owner. The
// other arrangements (an owner above its child, a member alone between unlinked layers) need the state machine in
// drawLayers: 83 story moments in 18 scripts reach them.
export function plainGroups(order, all, modes, runs) {
  for (const l of order) {
    const m = modes.get(l);
    if (!m.mode) continue;
    const owner = all.get(m.number);
    if (!owner || !owner.clip || !owner.clip[2] || !owner.clip[3]) continue;   // a link to an owner with no panel draws plainly
    const run = runs.get(l);
    if (!run || run.layers[0].id !== m.number) return false;
  }
  return true;
}

// order: the layers in depth order (the draw loop's); all: every layer by number. Returns layer -> { layers, owner }.
export function panelRuns(order, all) {
  const number = new Map();
  for (const [id, l] of [...all.entries()].sort((a, b) => a[0] - b[0])) {
    number.set(id, l.z >= 1 && l.ready && l.link >= 0 && l.link !== id ? l.link : -1);
  }
  for (const [id, n] of [...number.entries()]) if (n !== -1 && (number.get(n) ?? -1) === -1) number.set(n, n);
  const runs = new Map();
  for (let i = 0; i < order.length;) {
    const n = number.get(order[i].id) ?? -1;
    let j = i + 1;
    while (j < order.length && n !== -1 && (number.get(order[j].id) ?? -1) === n) j++;
    if (n !== -1 && j - i >= 2) {
      const owner = all.get(n);
      if (owner && owner.clip && owner.clip[2] && owner.clip[3]) {
        const run = { number: n, layers: order.slice(i, j), owner };
        for (const l of run.layers) runs.set(l, run);
      }
    }
    i = j;
  }
  return runs;
}

// How far the game's pre-blurred pictures are softened (`<name>_XX_YY`, in the stored picture's pixels), measured on the files
// themselves against their unblurred pictures (about 120 pairs, all four size classes and every width from 1 to 64): a Gaussian
// of 0.65 x n x the picture's size class, on top of the half-pixel softness of the variant being resampled. n is not a radius
// in pixels: a small (S) sprite at 15 has a sigma of about 1.3 pixels.
export function blurSigma(name, n) {
  const v = (Math.trunc(n) || 0) % 100;   // the two digits of the file name
  if (v <= 0) return 0;
  const own = BLUR_MEASURED[String(name).toUpperCase()]?.[v];
  if (own) return own;
  return Math.sqrt((0.65 * v * sizeClass(name)) ** 2 + 0.3);
}
// Files that are not the rule's. The rule holds to the top of the range (fitted again per axis on every picture the
// scripts blur above 64: `aru_l_60_00_n00` at 99 gives 31.3 for the rule's 32.2, `img0668` 64.7 for 64.4, `img2314`
// 63.1 for 64.4), but the `_99` files of two pictures are softer than it says, each measured the same way against
// its own sharp picture (2026-11-13). Their 30 and 64 files are the rule's to a tenth, and the second picture is off
// by the same 1.31 at all three of its sizes, so these are the files and not the fit. Both are in the Q&A corners:
// `img2450` is Neco-Arc's shadow in QA_13 (against a native frame, 3.1 levels of 255 over the shadow with the rule
// and 1.6 with this), `aru_?_84_10_n00` is QA_21's.
const BLUR_MEASURED = {
  IMG2450: { 99: 157.7 },
  ARU_A_84_10_N00: { 99: 84.3 }, ARU_L_84_10_N00: { 99: 42.2 }, ARU_M_84_10_N00: { 99: 21.2 },
};

// A blurred layer shows the engine's pre-blurred picture `<name>_XX_YY`: STCH (0x60840) appends the suffix from args
// 9-10 before it looks the picture up, and a track's blur fields switch to it the same way (0x97b80), so the layer
// takes that picture's size and pivot from the image table. Two digits each (the count mod 100; 0 or less is 00),
// and no suffix when both are 0.
export function blurName(name, bx, by) {
  const x = Math.trunc(bx) || 0, y = Math.trunc(by) || 0;
  if (!name || (x <= 0 && y <= 0)) return name;
  const two = (n) => (n > 0 ? String(n % 100).padStart(2, "0") : "00");
  return `${name}_${two(x)}_${two(y)}`;
}

// layers: drawable layers; states: layer -> sampled state; info: image name -> [w, h]; all: id -> layer
// (parents and links may be layers that are not drawn). Returns layer -> placement.
export function place(layers, states, info, all = new Map(layers.map((l) => [l.id, l]))) {
  const worlds = new Map();
  const stateOf = (l) => states.get(l) || l.state0 || { x: 240, y: 136, zx: 1000, zy: 1000, rot: 0, alpha: 255 };
  // The port blurs the picture itself (renderer.js `blurred`, padded evenly round it), but places a blurred layer by
  // the pre-blurred picture's entry where the table has one: its own pivot can differ from the picture's (QA_17's
  // Neco-Arc overlay, `ARU_A_84_04_N00_04_04`, has its pivot 3% below the middle where the picture's is the middle).
  const infoOf = (l) => {
    const s = stateOf(l), blurred = blurName(l.image, s.blurX, s.blurY);
    return (blurred !== l.image && info(blurred)) || info(l.image);
  };
  // the base picture of a layer shown through its blurred entry (for STPV's correction, pivotOf)
  const baseOf = (l) => {
    const s = stateOf(l), blurred = blurName(l.image, s.blurX, s.blurY);
    return blurred !== l.image && info(blurred) && info(l.image) ? info(l.image) : null;
  };

  function world(l, depth = 0) {
    const hit = worlds.get(l);
    if (hit) return hit;
    const s = stateOf(l);
    const p = l.parent >= 0 && l.parent !== l.id && depth < 40 ? all.get(l.parent) : null;
    let w;
    if (!p) w = { X: s.x * IX, Y: s.y * IY, zx: s.zx / 1000, zy: s.zy / 1000, rot: s.rot };
    else {
      const P = world(p, depth + 1), k = sizeClass(p.image), [ppx, ppy] = pivotOf(p, infoOf(p), baseOf(p));
      // 0x38730 / 0x388d0: the parent's pivot is x x 0.375 of its 640-unit value, y x 0.5 of its 362-unit value: script
      // y x 181 / 272, not 2/3 (N2-95)
      const u = s.x * IX * k - ppx * IX, v = s.y * IY * k - ppy * (181 / 272);
      const a = P.rot * Math.PI / 18000, c = Math.cos(a), sn = Math.sin(a);
      w = {
        X: P.X + P.zx * u * c - P.zy * v * sn,
        Y: P.Y + P.zx * u * sn + P.zy * v * c,
        zx: s.zx / 1000 * P.zx * k, zy: s.zy / 1000 * P.zy * k, rot: s.rot + P.rot,
      };
    }
    worlds.set(l, w);
    return w;
  }

  const out = new Map();
  for (const l of layers) {
    const s = stateOf(l), w = world(l);
    const link = l.link >= 0 && l.link !== l.id ? all.get(l.link) : null;
    // A SACL layer stays inside its link's panel: 0x37f50 copies the link's clip into the layer's record only without
    // SACL (listing 0x38418-0x38440, flag bit 6), as it moves it by the clip's origin only then, but the draw task
    // groups layers by link alone (0x3bba0: record +0x110, SACL not looked at) and composites the group through its
    // owner (0xa2ba0 / 0xa2c30), so the panel still bounds it (08_01_CIEL08_4_1 op 177: Arcueid in a letterbox strip).
    const owner = link || l;
    const clip = activeClip(owner.clip);
    let X = w.X, Y = w.Y;
    // SOXY's offset is in screen pixels: 0x37f50 adds x / 3 and y x 448 / 1080 of the record's raw values (+0x11c / +0x11e)
    // to the position 0x34440 returns in the 640 x 448 view, 3 and 1080 / 448 px a unit (listing 0x3859c-0x385e0; a native
    // frame of SOXY -180, -195 moves the picture by exactly that many pixels). Only this layer: children are placed from
    // the parent's own position (0x38730).
    if (l.offset) { X += l.offset[0] / PX; Y += l.offset[1] / PY; }
    if (link && link.clip && !l.absolute) { X += link.clip[0] / PX; Y += link.clip[1] / PY; }
    const scale = (l.scale ?? 1000) / 1000;
    // The position is where the pivot goes; zoom and rotation turn about it. Without STPV it is the picture's own
    // pivot from the image table (the centre for most backgrounds).
    const [iw, ih] = imageSize(infoOf(l)), [px, py] = pivotOf(l, infoOf(l), baseOf(l));
    const pivot = [(px - iw / 2) * SX, (py - ih / 2) * SY];
    // The draw (0x34440) adds to the position the pivot less the one recorded with it (record +0x48, the state's
    // -pivot at +0x16d6, which STPV and 0x60840 store cut to whole units and every commit copies): a fractional pivot
    // moves the picture by its fraction, and STCH from a source, which resets the pivot to the table's after the copy
    // recorded the source's (`base`), keeps the picture where the copy put it. 640 x 362 units: 3 px across, and
    // 1080 x 1.25 / 448 px down.
    // Per axis: an STPV pivot is off by its own fraction; the table's pivot cut by STCH / SCH2 without a source by
    // nothing; the table's pivot set whole by STCH from a source by the recorded one; otherwise by the table's fraction.
    const info = infoOf(l), p6 = [px * 4 / 3, py * 362 / 272], size6 = [iw * 4 / 3, ih * 362 / 272];
    const shift = [0, 1].map((i) => {
      if (l.pivot && l.pivot[i] != null) return p6[i] - (l.base ? l.base[i] : Math.trunc(p6[i]));
      if (l.cut) return 0;
      if (l.base) return p6[i] - l.base[i];
      return ((info && info[5 + i]) || 0) * size6[i];
    });
    X += shift[0] * 3 / PX;
    Y += shift[1] * (1080 * 1.25 / 448) / PY;
    // A layer linked to a layer that is not there (its record empty, +0xc == 0) gets alpha factor 0 and is not drawn
    // (0x37f50, listing 0x37ff8-0x38030).
    const orphan = l.link >= 0 && l.link !== l.id && !link;
    const alpha = orphan ? 0 : s.alpha / 255 * (link ? stateOf(link).alpha / 255 : 1);
    // STZ4's eighth argument (record +0xa2): 0x37f50 leaves the zoom out of the picture's scale and hands it to
    // 0xb3780; the sprite submit (0xbbb28) then multiplies the x and y parts of the finished matrix's axes by it, the
    // translation (the anchor) untouched: a stretch along the screen's axes about the anchor, after the rotation.
    const stretch = l.stretch ? [w.zx, w.zy] : null;
    out.set(l, {
      x: X * PX, y: Y * PY, zx: stretch ? scale : w.zx * scale, zy: stretch ? scale : w.zy * scale, rot: w.rot, alpha, pivot, stretch,
      clip: clip ? { rect: clip, border: owner.border || 0, frame: owner.frame || 0, rot: owner.clipRot || 0, group: owner } : null,
    });
  }
  return out;
}

// One set of panel edges, as the live mask (0x32e30) and the band (0x34a70) both work them out (listing 0x33104-0x33154):
// the width is cut to half the clip's width and height; a turned panel has it on every side; otherwise a side has it
// unless the clip's edge lies the width or more beyond the screen's (left x <= -b, right x + w >= 1920 + b, likewise
// down), and a clip exactly as wide (tall) as the screen has none across (down).
function edges(x, y, w, h, width, turned) {
  const b = Math.max(0, Math.min(width, w / 2, h / 2));
  if (!(b > 0)) return { b: 0, sides: [0, 0, 0, 0] };
  if (turned) return { b, sides: [1, 1, 1, 1] };
  const across = !(x === 0 && w === 1920), down = !(y === 0 && h === 1080);
  return { b, sides: [across && x > -b, down && y > -b, across && x + w < 1920 + b, down && y + h < 1080 + b].map(Number) };
}

const shrink = ([x, y, w, h], b, [l, t, r, bt]) =>
  [x + l * b, y + t * b, Math.max(0, w - (l + r) * b), Math.max(0, h - (t + bt) * b)];

// A panel's edge. The engine draws a mask: the inner rectangle solid, and around it, on each side that carries an edge,
// pieces of a radial alpha blob (BORDER_PARTS/alphagradation*, scaled to the edge width), so the picture fades out
// over that width; the corners are rounded. The mask's width is STCH arg 16 rounded up to even, doubled for frame
// style 7 (0x32e30). Frame styles 1-6 (STCH arg 17) draw a coloured band of the plain width into the panel's own picture
// before the mask, so the mask fades the band too (0x36520: 0xb6f60, then 0x34a70, then 0x32e30; both callers of
// 0x34a70 pass a target); other styles and widths under 2 draw none. On an unturned panel the band's outer half is a
// plain rectangle (`solid`, 0xb1580) and only its inner half comes from the blob; a turned panel uses the blob for both.
export function clipGeometry({ rect, border, rot, frame = 0 }) {
  const [x, y, w, h] = rect;
  const raw = Math.max(0, border || 0);
  const turned = (rot || 0) % 36000 !== 0;
  const mask = edges(x, y, w, h, (raw + (raw & 1)) * (frame === 7 ? 2 : 1), turned);
  const colour = FRAME_COLOURS[frame] || null;
  const band = colour && raw >= 2 ? edges(x, y, w, h, raw, turned) : null;
  return { outer: [x, y, w, h], inner: shrink(rect, mask.b, mask.sides), sides: mask.sides, border: mask.b,
    band: band && band.b > 0 ? { inner: shrink(rect, band.b, band.sides), sides: band.sides, border: band.b, solid: !turned } : null,
    angle: (rot || 0) * Math.PI / 18000, centre: [x + w / 2, y + h / 2], colour };
}

// 0x34a70's band colours by frame style (1-6).
const FRAME_COLOURS = { 1: [0, 0, 0], 2: [1, 1, 1], 3: [1, 0, 0], 4: [0.176, 0.0745, 0], 5: [0.965, 0.957, 0.91], 6: [1, 0.91, 0.824] };

// Script rotation for panels (STRR and STCH arg 19): wrapped to -180..180 degrees, in hundredths.
export function wrapRotation(r) {
  if (r === -99999) return -32768;
  r %= 36000;
  if (r < -18000) return r + 36000;
  return r > 18000 ? r - 36000 : r;
}
