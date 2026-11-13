// renderer.js - the game's picture with WebGL2: layers with zoom, rotation, alpha, blend modes and blur; crossfades.
// Screen: 1920 x 1080. Script coordinates are 480 x 272 from the top left (4 and 1080/272 pixels per unit).
// The game's logical screen is 1280 wide: a stored image is drawn at 1.5 screen pixels per stored pixel, times its zoom.
import { layerState } from "./animation.js";
import { clipShift, hazeConstants, impactPixels, layerShiftPixels } from "./effects.js";
import { place, clipGeometry, panelRuns, groupModes, plainGroups, groupCoverage, groupNeedsBuffer, groupOpacity, groupRelative, blurSigma } from "./transform.js";
import { grainSample, linesSample, splitSample } from "./screenfx.js";
import { asset } from "./lang.js";
const F = 1.5;
// STBR's number -> the shader that draws the layer, as positions in the engine's shader table (0x264668). The draw
// (0x89ad0) looks the number up in 0x34dd70 (the identity for 0-39) and maps it with 0xa2790 to a shader; shaders of
// type 7 (0xa27c0) composite the layer over a copy of the screen. 0 draws normally; 2 and 3 are fixed-function draws.
export const SHADER = { ps_add: 27, ps_darken: 38, dodge: 20, ps_lighten: 37, ps_mul: 29, noalpha: 2, ps_screen: 30,
  sub: 26, ps_burn: 36, differnce: 39, differnce5: 40, ps_dodge: 34, ps_dodge5: 35, exclusion: 41, hardlight: 32,
  overlay: 31, softlight: 33, ps_sub: 28, hardlight_ex: 42, add: 18, sub_noalpha: 43 };
export const BLEND_SHADER = [0, SHADER.ps_add, 0, 0, SHADER.ps_darken, SHADER.dodge, SHADER.ps_lighten, SHADER.ps_mul,
  SHADER.noalpha, SHADER.ps_screen, SHADER.sub, SHADER.ps_add, SHADER.ps_burn, SHADER.ps_darken, SHADER.differnce,
  SHADER.differnce5, SHADER.ps_dodge, SHADER.ps_dodge5, SHADER.exclusion, SHADER.hardlight, SHADER.ps_lighten,
  SHADER.ps_mul, SHADER.overlay, SHADER.ps_screen, SHADER.softlight, SHADER.ps_sub, SHADER.hardlight_ex, 0, SHADER.add, SHADER.sub_noalpha];
// The shader a layer with STBR n is composited with, or 0 for a plain draw (blend 2 and 3 keep their own draws).
export function blendShader(n) { return BLEND_SHADER[n] || 0; }

// The system menu's background (0x2e000 freezes the frame, 0x3bba0 runs it, 0xa0a90 blurs, 0xa2680 draws): the story
// frame blurred across, down, across and down again (0xa0a90 runs its two passes twice: listing 0xa1328, 0xa1798,
// 0xa1c34), each pass 2 x ceil(3s) + 1 = 15 copies of the picture 1.75 px apart (at 1920 wide; frintp at 0xa0acc rounds
// 3s up) added at exp(-i^2 / 2s^2) / sqrt(2 pi s^2) with s = 2.25, not normalised: a sigma of about 5.6 px, as measured on
// a native frame's edges (5.5 to 5.7; one pair of 13-tap passes gave 3.7). A copy leaves nothing where it has moved off
// the picture. It comes in over the frame at 0.001 + n / 12 in the n-th frame (the first frame only freezes), drawn at
// that level cut to 1/255 (0xa2680), with no darkening. Closing the menu (0x2e030(0, 1)) ends it at once.
const GAUSS_S = 2.25, GAUSS_STEP = 1.75;
export const GAUSS = (() => {
  const n = 2 * Math.ceil(GAUSS_S * 3) + 1, h = (n - 1) >> 1, v = 2 * GAUSS_S * GAUSS_S;
  return Array.from({ length: n }, (_, i) => Math.exp(-((i - h) ** 2) / v) / Math.sqrt(v * Math.PI));
})();
export function menuBlurAlpha(frame) {
  return frame < 2 ? 0 : Math.trunc(Math.min(1, 0.001 + frame / 12) * 255) / 255;
}

// Whether a placed layer is drawn: z 1 or more (0x3bba0: cmp w8, #1; b.lt), its picture loaded, some alpha.
// What a motion wrote this frame over the layer, as a view of it (Object.create keeps every other property the
// layer's own); the layer itself when the motion writes none of these.
const VIEWED = ["z", "blend", "bright", "contrast", "grain", "clip", "border", "frame", "clipRot", "pivot"];
export function motionView(l, st) {
  if (!VIEWED.some((k) => st[k] !== undefined) && !st.colour) return l;
  const v = Object.create(l);
  for (const k of VIEWED) if (st[k] !== undefined) v[k] = st[k];
  // a track writes the pivot and its record together (0x97b80: record +0x48 = -pivot), so it is drawn where it says
  if (st.pivot !== undefined) { v.base = null; v.cut = false; }
  if (st.colour) { if (l.effect === 1) v.tint = st.colour; else v.mul = st.colour; }
  return v;
}

// The layer whose picture a linked layer is drawn through: 0x32e30 draws the owner's picture (opaque, at the owner's
// place) into the mask the layer is drawn with, when the owner has a clip (0x36520 draws a layer with an empty one
// unmasked) and the layer is not SACL (0x37f50 keeps the layer's own clip then); a panel drawn as one group
// composites through its owner the same way (0xa2ba0, 0xa2c30). So a linked layer shows only where its owner's
// picture is: QA_17's darkening of Neco-Arc (layer 26, linked to her layer 25) stays inside her outline, leaving the
// light rim on her left, as in the original game. Null when there is no such owner (or its picture is not loaded).
export function maskOwner(l, byId) {
  const o = l.link >= 0 && l.link !== l.id && !l.absolute ? byId.get(l.link) : null;
  return o && o.clip && o.clip[2] > 0 && o.clip[3] > 0 && o.ready && o.ready.tex ? o : null;
}

export function drawn(l, at) {
  return l.z >= 1 && !!l.ready && !!at && at.alpha > 0.001;
}

// STZ4's eighth argument: the layer's matrix (column-major, unit square to screen pixels) stretched by [kx, ky] along
// the screen's axes about the anchor (ax, ay), after its rotation (0xbbb28; transform.js `stretch`).
export function stretchMatrix(m, k, ax, ay) {
  if (!k) return m;
  const [kx, ky] = k;
  return [m[0] * kx, m[1] * ky, 0, m[3] * kx, m[4] * ky, 0, ax + (m[6] - ax) * kx, ay + (m[7] - ay) * ky, 1];
}
const VS = `#version 300 es
in vec2 p;
uniform mat3 m;
uniform vec4 uvr;
out vec2 uv;
out vec2 suv;
out vec2 pv;
void main() {
  vec3 q = m * vec3(p, 1.0);
  pv = p;
  uv = uvr.xy + p * uvr.zw;
  suv = vec2(q.x / 1920.0, 1.0 - q.y / 1080.0);
  gl_Position = vec4(q.x / 960.0 - 1.0, 1.0 - q.y / 540.0, 0.0, 1.0);
}`;

const FS_LAYER = `#version 300 es
precision highp float;
in vec2 uv;
in vec2 suv;
in vec2 pv;                // the point in the picture, 0-1 from its top left
uniform vec4 uvr;
uniform sampler2D t;
// STRA's heat haze (0x362a0 -> nexl_nxshader_haze, SPIR-V 33906951eb996a33): per axis the texture size, the amplitude
// in texture pixels, the waves per picture height and the phase. Both shifts follow v, the coordinate down the picture.
uniform int hazeOn;
uniform vec4 hazeX;
uniform vec4 hazeY;
uniform sampler2D back;
uniform float alpha;
uniform float coverage;     // a panel group's buffer: its alpha is scaled by this before the blend (groupCoverage)
uniform int picture;        // 1: t is a stored picture, 0: t is a buffer already in the engine's working space
uniform vec4 tint;
uniform vec3 mul;          // the layer's colour when it is not a silhouette: the picture is multiplied by it (0xb03e0)
uniform int mode;
// A panel: the picture shows only inside this rectangle (screen pixels, y down), turned about its centre.
uniform int clipOn;
uniform vec4 clip;         // the outer rectangle
uniform vec4 clipInner;    // where the picture is whole; it fades out from here to the outer edge
uniform float clipEdge;    // the width of that fade
uniform int bandOn;        // the panel has a frame with a solid outer half: none of the picture shows under it
uniform vec4 bandInner;    // the rectangle inside that outer half
uniform vec4 clipCentre;   // centre x, y, cos, sin
uniform sampler2D feather; // the engine's alpha blob: its centre column, from the middle out, is the fade
uniform int featherOn;     // 0 until the picture has loaded: a smoothstep, which it closely follows
// The engine's colour effect (pre_alter, chosen by STEC and by SNX2/SNX3), in 0-255 straight colour.
uniform int fx;
uniform int fxSil;          // silhouette: the picture's shape in fxSilColor
uniform vec3 fxSilColor;
uniform int fxGray;
uniform float fxAmount;
uniform vec3 fxGamma;
uniform vec3 fxBlack;
uniform vec3 fxWhite;
uniform vec4 fxLayer1;      // colour 0-1, opacity 0-1
uniform vec4 fxLayer2;
uniform vec2 fxModes;
uniform float fxBright;     // 1 = none; SNX2 adds (b - 1) * 255
uniform float fxContrast;   // 1 = none; SNX3
// STTR: the layer's alpha becomes a wipe through a rule picture laid over the screen (0x36520 -> 0xa7190).
uniform int maskOn;
uniform sampler2D mask;
uniform int maskFlip;
uniform int ruleWhole;      // no panel: the wipe alone gives the coverage; the layer's alpha only sets the threshold (0xa6e90)
uniform int hazeTwice;      // a hazed layer outside a panel: drawn into a buffer first with SrcAlpha, so its colour counts alpha twice
// A layer linked to a panel shows only where the panel's owner is (0x32e30 draws the owner's picture, opaque, at the
// owner's place, into the mask the layer is drawn through): ownerMask holds that picture's coverage of the screen.
uniform int ownerOn;
uniform sampler2D ownerMask;
// STNS: the moving static drawn in the layer's place, through the layer's shape (noise, its offset in pixels, its flips).
uniform int grainOn;
uniform sampler2D grain;
uniform vec4 grainAt;
out vec4 o;
vec3 unp(vec4 c) { return c.a > 0.0 ? c.rgb / c.a : vec3(0.0); }
float level(float v, float g, float lo, float hi) {
  if (g <= 0.0) v = 0.0;
  else if (g != 1.0) v = pow(v / 255.0, 1.0 / g) * 255.0;
  return lo + (hi - lo) * v / 255.0;
}
// A colour layer over the picture, with the blend modes pre_alter has.
vec3 fxLayer(vec3 v, vec4 L, float mode) {
  vec3 C = L.rgb * 255.0, Cn = L.rgb;
  float a = L.a;
  if (mode == 2.0) return mix(v, C, a);
  if (mode == 3.0) return min(v + C * a, 255.0);
  if (mode == 5.0) return mix(v, C * v / 255.0, a);
  if (mode == 8.0) {
    vec3 r = min(v * 255.0 / max(vec3(255.0) - C * a, vec3(0.001)), 255.0);
    return mix(r, vec3(0.0), vec3(lessThanEqual(v, vec3(3.0))));
  }
  if (mode == 14.0) return mix(v, min(v + C, 255.0), a);
  if (mode == 17.0) return mix(v, 255.0 - (255.0 - C) * (255.0 - v) / 255.0, a);
  if (mode == 18.0) {
    vec3 lo = v * 2.0 * Cn, hi = 255.0 - (255.0 - v) * (2.0 - 2.0 * Cn);
    return mix(v, mix(hi, lo, vec3(lessThan(v, vec3(128.0)))), a);
  }
  return v;
}
vec3 effect(vec3 rgb) {
  vec3 v = rgb * 255.0;
  if (fxSil == 1) v = fxSilColor * 255.0;
  else if (fxGray == 1) v = vec3((v.r * 54.0 + v.g * 183.0 + v.b * 19.0) / 256.0);
  float k = clamp(fxAmount, 0.0, 1.0);
  if (k > 0.0) {
    vec3 l = vec3(level(v.r, fxGamma.r, fxBlack.r, fxWhite.r), level(v.g, fxGamma.g, fxBlack.g, fxWhite.g), level(v.b, fxGamma.b, fxBlack.b, fxWhite.b));
    v = mix(v, l, k);
  }
  if (fxModes.x > 0.0) v = fxLayer(v, fxLayer1, fxModes.x);
  if (fxModes.y > 0.0) v = fxLayer(v, fxLayer2, fxModes.y);
  v = max(vec3(0.0), min(v + 255.0 * fxBright - 255.0, 255.0));
  float c = fxContrast <= 1.0 ? (200.0 * fxContrast + 55.0) / 255.0 : 127.5 / max(0.5, 127.5 - (100.0 * fxContrast - 100.0));
  return clamp((v - 127.5) * c + 127.5, 0.0, 255.0) / 255.0;
}
float ovl(float b, float s) { return b < 0.5 ? 2.0*b*s : 1.0 - 2.0*(1.0-b)*(1.0-s); }
vec3 overlay(vec3 b, vec3 s) { return vec3(ovl(b.r,s.r), ovl(b.g,s.g), ovl(b.b,s.b)); }
// colour burn as the burn shaders have it: a channel with no source is black.
vec3 burnOf(vec3 b, vec3 s) {
  vec3 r = max(vec3(0.0), 1.0 - (1.0 - b) / max(s, vec3(1e-6)));
  return mix(r, vec3(0.0), vec3(lessThanEqual(s, vec3(0.0))));
}
// dodge with the opacity already in the divisor; dark pixels at or under floor_ stay black (the shader's constant).
vec3 dodgeOf(vec3 b, vec3 d, float floor_) {
  vec3 cap = vec3(greaterThan(b, vec3(floor_)));
  return min(b / max(d, vec3(1e-6)), cap);
}
float soft(float b, float s) { b = max(b, 0.0); return s < 0.5 ? pow(b, 2.0 - 2.0 * s) : pow(b, 0.5 / s); }
// mode is the shader's position in the engine's table (BLEND_SHADER maps STBR's number to it). Each case is that
// shader's own arithmetic, read from its translated SPIR-V (nexl_nxshader_<name>.bnsh; see ANIMATIONS.md, "Blend
// modes"). b: what is under the layer; s: the layer's straight colour; a: its texel alpha (with clip edge, mask and
// grain); op: the layer's opacity. Most shaders end with mix(b, r, a * op); dodge, ps_dodge5 and differnce5 put the
// opacity elsewhere, and noalpha ignores alpha and the screen.
vec3 composite(vec3 b, vec3 s, float a, float op) {
  float ao = a * op;
  switch (mode) {
    // add (STBR 28; nexl_nxshader_add.bnsh is not in the base RomFS but in the translation patch's romfs/shader, the
    // patch including the 1.0.2 update; SPIR-V 2a7200ca9de7d6a9): min(b + s x op, 1), the texel's alpha not used
    case 18: return min(b + s * op, 1.0);
    // sub_noalpha (STBR 29, also in the patch's shaders; SPIR-V b1e7d7ff023a0eea): max(0, b + op (s - 1)), the texel's alpha
    // not used (03_01_CIEL03_3_3B's STBR(26,10,29))
    case 43: return max(b + op * (s - 1.0), 0.0);
    case 27: return mix(b, min(b + s, 1.0), ao);                         // ps_add
    case 29: return mix(b, b * s, ao);                                   // ps_mul
    case 20: return ao == 0.0 ? b : dodgeOf(b, max(vec3(0.0), 1.0 - s * op), 1.0 / 255.0);   // dodge
    case 2: return s;                                                    // noalpha: the picture, opaque
    case 30: return mix(b, b + s - b * s, ao);                           // ps_screen
    case 26: return max(b + ao * (s - 1.0), 0.0);                        // sub: a white source changes nothing
    case 28: return mix(b, max(b + s - 1.0, 0.0), ao);                   // ps_sub
    case 31: return mix(b, overlay(b, s), ao);                           // overlay
    // hardlight; hardlight_ex (STBR 26, one use: STBR(22,19,26) in 09_00_ARC09_6, shader in the translation patch, SPIR-V
    // c7257a907506ee2d: b where a x op is 0, else hard light of min(s / a, 1)): the same formula, s already straight
    case 32: case 42: return mix(b, overlay(s, b), ao);
    case 33: return ao == 0.0 ? b : mix(b, vec3(soft(b.r, s.r), soft(b.g, s.g), soft(b.b, s.b)), ao);   // softlight
    case 34: return mix(b, mix(min(b / max(1.0 - s, vec3(1e-6)), 1.0), vec3(1.0), vec3(lessThanEqual(1.0 - s, vec3(0.0)))), ao);   // ps_dodge
    case 35: return ao == 0.0 ? b : dodgeOf(b, max(vec3(0.0), 1.0 - ao * s), 3.0 / 255.0);   // ps_dodge5: no outer mix
    case 36: return mix(b, burnOf(b, s), ao);                            // ps_burn
    case 37: return mix(b, max(b, s), ao);                               // ps_lighten
    case 38: return mix(b, min(b, s), ao);                               // ps_darken
    case 39: return mix(b, abs(b - s), ao);                              // differnce
    case 40: return ao == 0.0 ? b : abs(b - ao * s);                     // differnce5
    case 41: return mix(b, b + s - 2.0 * b * s, ao);                     // exclusion
  }
  return mix(b, s, ao);
}
// The engine reads its pictures through an sRGB view and bakes them into its targets as x^(1/2.2), the inverse of the last
// pass (FS_DISPLAY): an untouched picture comes out as it was stored, and blending happens in this space.
vec3 working(vec3 s) {
  vec3 l = mix(s / 12.92, pow((s + 0.055) / 1.055, vec3(2.4)), vec3(greaterThan(s, vec3(0.04045))));
  return pow(max(l, vec3(0.0)), vec3(1.0 / 2.2));
}
vec2 hazeShift(float v) {
  vec2 d = vec2(0.0);
  if (hazeX.x > 0.0) d.x = sin((fract(hazeX.w) + fract(v * hazeX.z)) * 6.2831855) * hazeX.y / hazeX.x;
  if (hazeY.x > 0.0) d.y = cos((fract(hazeY.w) + fract(v * hazeY.z)) * 6.2831855) * hazeY.y / hazeY.x;
  return d;
}
float edgeFade(vec2 p) {
  vec2 past = p - clipInner.xy - clipInner.zw;   // over 0 beyond the inner rectangle's right / bottom side
  vec2 d = max(vec2(0.0), max(clipInner.xy - p, past));
  if (clipEdge <= 0.0 || (d.x <= 0.0 && d.y <= 0.0)) return 1.0;
  vec2 q = d / clipEdge;
  if (featherOn != 1) { float r = length(q); return r >= 1.0 ? 0.0 : 1.0 - smoothstep(0.0, 1.0, r); }
  if (q.x >= 1.0 || q.y >= 1.0) return 0.0;
  // The mask's pieces are the blob's own quarters and its middle row and column (0x32e30, rectangles 0x572990): the left and top
  // sides read its left and upper halves, the right and bottom sides its right and lower ones. The plain blobs are the same on
  // both, but style 7's (_2) reach their plateau a texel sooner on the right and lower halves, which is 2 px at a width of 60:
  // native frames of a style 7 panel have the right and bottom fades that much further out than the left and top ones.
  vec2 half_ = 0.5 / vec2(textureSize(feather, 0));
  vec2 uv = vec2(d.x > 0.0 ? 0.5 + (past.x > 0.0 ? 0.5 : -0.5) * q.x : 0.5 - half_.x, d.y > 0.0 ? 0.5 + (past.y > 0.0 ? 0.5 : -0.5) * q.y : 0.5 - half_.y);
  return texture(feather, uv).a;
}
void main() {
  float edge = 1.0;
  if (clipOn == 1) {
    vec2 p = vec2(gl_FragCoord.x, 1080.0 - gl_FragCoord.y) - clipCentre.xy;
    p = vec2(clipCentre.z * p.x + clipCentre.w * p.y, -clipCentre.w * p.x + clipCentre.z * p.y) + clipCentre.xy;
    if (p.x < clip.x || p.y < clip.y || p.x >= clip.x + clip.z || p.y >= clip.y + clip.w) discard;
    if (bandOn == 1 && (p.x < bandInner.x || p.y < bandInner.y || p.x >= bandInner.x + bandInner.z || p.y >= bandInner.y + bandInner.w)) discard;
    edge = edgeFade(p);
    if (edge <= 0.0) discard;
  }
  vec4 c = texture(t, hazeOn == 1 ? uv + hazeShift(pv.y) * uvr.zw : uv) * edge * coverage;
  if (picture == 1) c.rgb = working(unp(c)) * c.a;
  c.rgb *= mul;
  if (ownerOn == 1) c *= texture(ownerMask, gl_FragCoord.xy / vec2(1920.0, 1080.0)).a;
  if (maskOn == 1) {
    // 0xa7190's constants: x = the alpha (1 - (1 - alpha)), softness 128, direction -1, w = STTR's flip (1 across,
    // 2 up and down, 3 both). The layer is drawn at its alpha and then shows where the rule is under a threshold that
    // rises with the alpha: at 0 nothing, at 1 everything, the rule's dark parts first.
    vec2 r = vec2(gl_FragCoord.x, 1080.0 - gl_FragCoord.y) / vec2(1920.0, 1080.0);
    if (maskFlip == 1 || maskFlip == 3) r.x = 1.0 - r.x;
    if (maskFlip == 2 || maskFlip == 3) r.y = 1.0 - r.y;
    float sm = 128.0, q = (255.0 + 2.0 * sm) * alpha - sm, lo = (q - 0.5 * sm) / 255.0;
    float k = clamp((texture(mask, r).r - lo) * 255.0 / sm, 0.0, 1.0);
    c *= 1.0 - k * k * (3.0 - 2.0 * k);
  }
  if (fx == 1) c.rgb = effect(unp(c)) * c.a;
  else if (tint.a > 0.0) c.rgb = mix(c.rgb, tint.rgb * c.a, tint.a);
  if (grainOn == 1) {
    // STNS (0x35fc0): the static takes the place of the picture's colours and the picture is only the shape it shows
    // through (exalpha, d8c6f5ebc4620f7f: static rgb x the layer's colour, alpha = static a x opacity x the picture's a).
    // It is drawn at 0.6 of its 1920 x 1080 size in a 960-wide space: 2304 x 1296 pixels.
    vec2 p = (vec2(gl_FragCoord.x, 1080.0 - gl_FragCoord.y) - grainAt.xy) / vec2(2304.0, 1296.0);
    c.rgb = working(texture(grain, fract(p * grainAt.zw)).rgb) * mul * c.a;
  }
  if (hazeTwice == 1) c.rgb *= c.a;   // (0x36520's haze branch: target 2 holds s a, a; the composite multiplies again)
  if (mode == 0) { o = maskOn == 1 && ruleWhole == 1 ? c : c * alpha; return; }
  vec4 bb = texture(back, suv);
  vec3 b = bb.rgb;
  vec3 s = unp(c);
  // a panel group's buffer has alpha to keep where the layer leaves it (the scene is opaque: bb.a is 1 and stays so)
  o = vec4(clamp(composite(b, s, c.a, alpha), 0.0, 1.0), clamp(bb.a + (1.0 - bb.a) * c.a * alpha, 0.0, 1.0));
}`;

const FS_COPY = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D t;
out vec4 o;
void main() { o = texture(t, uv); }`;

// The engine's last pass (shader 138dd8be4ccf62ce, every frame): the picture goes out as x^2.2 into an sRGB screen target, so
// the screen shows sRGB(x^2.2). The two nearly cancel but not in the darks (the sRGB curve has a linear toe): a value of 16
// shows as 8, of 32 as 26, of 64 as 62, of 128 as 128. The layers and blends before it work on x, as everywhere here.
const FS_DISPLAY = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D t;
out vec4 o;
vec3 srgb(vec3 l) { return mix(12.92 * l, 1.055 * pow(l, vec3(1.0 / 2.4)) - 0.055, vec3(greaterThan(l, vec3(0.0031308)))); }
void main() { vec4 c = texture(t, uv); o = vec4(srgb(pow(max(c.rgb, vec3(0.0)), vec3(2.2))), c.a); }`;

// The text window's picture (0x391a0), blended into the frame before the last pass: read as any picture is (working()).
const FS_WINDOW = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D t;
uniform float alpha;
out vec4 o;
vec3 working(vec3 s) {
  vec3 l = mix(s / 12.92, pow((s + 0.055) / 1.055, vec3(2.4)), vec3(greaterThan(s, vec3(0.04045))));
  return pow(max(l, vec3(0.0)), vec3(1.0 / 2.2));
}
void main() {
  vec4 c = texture(t, uv);
  vec3 s = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  o = vec4(working(s) * c.a, c.a) * alpha;
}`;

const FS_FADE = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D a;
uniform sampler2D b;
uniform sampler2D rule;
uniform float k;
uniform float useRule;
out vec4 o;
// The engine's transition shader (0xa48c0: softness 128, direction +1, progress 1 - the level, i.e. k) draws the old
// picture over the new at alpha smoothstep((r - lo) / s), lo = ((255 + 2s) k - 1.5 s) / 255: the old stays longest
// where the rule is bright, so the new picture comes in where it is dark first (RULE_13, bright on the left, wipes
// from the right, as in the game).
void main() {
  float w = k;
  if (useRule > 0.5) {
    float r = texture(rule, vec2(uv.x, 1.0 - uv.y)).r;
    float s = 128.0;
    float q = (255.0 + 2.0 * s) * k - s, lo = q - s * 0.5;
    float t = clamp((r - lo / 255.0) * 255.0 / s, 0.0, 1.0);
    w = 1.0 - t * t * (3.0 - 2.0 * t);
  }
  o = mix(texture(a, uv), texture(b, uv), w);
}`;

// A panel's border (0x34a70): a band twice the edge width B in from each side that has one. Both callers pass a target
// (2 from 0x36520, -3 from 0x37ea0), so it goes into the panel's own picture before the mask. On an unturned panel the
// outer B is a plain rectangle (0xb1580), which the mask then fades at the panel's edge: here, the frame colour at the
// mask's level, with the picture left out (FS_LAYER's bandInner). Inside it the alpha blob of its size (bandBlob):
// across a side the falling half of the blob's middle column, nothing at 2B (UV rects 0x572990); at a corner the
// inverted blob's (_inv) quarter in the next B x B square in. A turned panel takes both halves from the blob: the
// column rises from the outer edge to its peak at B, and a corner's outer square is the plain blob's quarter.
const FS_FRAME = `#version 300 es
precision highp float;
uniform vec4 outer;
uniform vec4 sides;        // left, top, right, bottom: 1 where the band runs
uniform float edge;
uniform int solid;         // 1 on an unturned panel: the outer B is a rectangle, faded by the mask
uniform vec4 maskInner;    // the panel's mask, as FS_LAYER's edgeFade
uniform float maskEdge;
uniform vec4 clipCentre;
uniform vec3 colour;
uniform float alpha;
uniform sampler2D blob;    // BORDER_PARTS/alphagradationNNN
uniform sampler2D inv;     // BORDER_PARTS/alphagradation_invNNN
uniform int blobOn;
out vec4 o;
float plain(vec2 uv) {
  if (blobOn == 1) return texture(blob, clamp(uv, 0.0, 0.999)).a;
  return 1.0 - smoothstep(0.0, 1.0, length(uv - 0.5) * 2.0);
}
float inverted(vec2 uv) {
  if (blobOn == 1) return texture(inv, clamp(uv, 0.0, 0.999)).a;
  return smoothstep(0.0, 1.0, length(uv - 0.5) * 2.0);
}
float maskFade(vec2 p) {
  vec2 d = max(vec2(0.0), max(maskInner.xy - p, p - maskInner.xy - maskInner.zw));
  if (maskEdge <= 0.0 || (d.x <= 0.0 && d.y <= 0.0)) return 1.0;
  float r = length(d) / maskEdge;
  if (r >= 1.0) return 0.0;
  return blobOn == 1 ? texture(blob, vec2(0.5, 0.5 - 0.5 * r)).a : 1.0 - smoothstep(0.0, 1.0, r);
}
// One piece of the turned band: at is the piece's top-left corner and size its size in the panel's own axes, uv0 / uv1 the part of the
// blob it shows. Nothing outside the piece.
float piece(vec2 q, vec2 at, vec2 size, vec2 uv0, vec2 uv1, int inv) {
  vec2 f = (q - at) / size;
  if (f.x < 0.0 || f.y < 0.0 || f.x >= 1.0 || f.y >= 1.0) return 0.0;
  vec2 uv = mix(uv0, uv1, f);
  return inv == 1 ? inverted(uv) : plain(uv);
}
// A turned panel's band, as 0x34a70's turned branch places its pieces (listing 0x35ee0 on; native frames of a turned panel on black and
// on white). The branch takes the points it would give pieces hung by their middle, half a width in from each side, and hangs the pieces
// by a corner or a side there: every side has a strip 2 w deep whose far edge is on that point, rising to its peak there, and a strip
// w deep going on from it, falling; so the top and left bands peak half a width inside the edge and are gone at 1.5 w, while the bottom
// and right ones rise over 2 w from 2.5 w inside and peak half a width before the edge. The corners' squares are hung the same way,
// which leaves a gap of half a width beside each. q is the point from the panel's top-left corner, wh the panel's size, w the width.
float turnedBand(vec2 q, vec2 wh, float w) {
  float W = wh.x, H = wh.y, a = 0.0, k;
  vec2 c0 = vec2(0.5 * w), c1 = vec2(W - 0.5 * w, 0.5 * w), c2 = vec2(0.5 * w, H - 0.5 * w), c3 = vec2(W - 0.5 * w, H - 0.5 * w);
  // corners: the blob's quarter hung by its inner corner on the point, then the inverted blob's quarter by its outer corner
  k = piece(q, c0 - w, vec2(w), vec2(0.0, 0.0), vec2(0.5, 0.5), 0); a += (1.0 - a) * k;
  k = piece(q, c0, vec2(w), vec2(0.0, 0.0), vec2(0.5, 0.5), 1); a += (1.0 - a) * k;
  k = piece(q, c2 + vec2(-w, 0.0), vec2(w), vec2(0.0, 0.5), vec2(0.5, 1.0), 0); a += (1.0 - a) * k;
  k = piece(q, c2 + vec2(0.0, -w), vec2(w), vec2(0.0, 0.5), vec2(0.5, 1.0), 1); a += (1.0 - a) * k;
  k = piece(q, c1 + vec2(0.0, -w), vec2(w), vec2(0.5, 0.0), vec2(1.0, 0.5), 0); a += (1.0 - a) * k;
  k = piece(q, c1 + vec2(-w, 0.0), vec2(w), vec2(0.5, 0.0), vec2(1.0, 0.5), 1); a += (1.0 - a) * k;
  k = piece(q, c3, vec2(w), vec2(0.5, 0.5), vec2(1.0, 1.0), 0); a += (1.0 - a) * k;
  k = piece(q, c3 - w, vec2(w), vec2(0.5, 0.5), vec2(1.0, 1.0), 1); a += (1.0 - a) * k;
  // top and bottom: the blob's middle column, its upper half over 2 w above the point and its lower half over w below it
  k = piece(q, vec2(w, 0.5 * w - 2.0 * w), vec2(W - 2.0 * w, 2.0 * w), vec2(0.5, 0.0), vec2(0.5, 0.5), 0); a += (1.0 - a) * k;
  k = piece(q, vec2(2.0 * w, 0.5 * w), vec2(W - 4.0 * w, w), vec2(0.5, 0.5), vec2(0.5, 1.0), 0); a += (1.0 - a) * k;
  k = piece(q, vec2(w, H - 0.5 * w - 2.0 * w), vec2(W - 2.0 * w, 2.0 * w), vec2(0.5, 0.0), vec2(0.5, 0.5), 0); a += (1.0 - a) * k;
  k = piece(q, vec2(2.0 * w, H - 0.5 * w), vec2(W - 4.0 * w, w), vec2(0.5, 0.5), vec2(0.5, 1.0), 0); a += (1.0 - a) * k;
  // left and right: the middle row, its left half over 2 w left of the point and its right half over w right of it
  k = piece(q, vec2(0.5 * w - 2.0 * w, w), vec2(2.0 * w, H - 2.0 * w), vec2(0.0, 0.5), vec2(0.5, 0.5), 0); a += (1.0 - a) * k;
  k = piece(q, vec2(0.5 * w, 2.0 * w), vec2(w, H - 4.0 * w), vec2(0.5, 0.5), vec2(1.0, 0.5), 0); a += (1.0 - a) * k;
  k = piece(q, vec2(W - 0.5 * w - 2.0 * w, w), vec2(2.0 * w, H - 2.0 * w), vec2(0.0, 0.5), vec2(0.5, 0.5), 0); a += (1.0 - a) * k;
  k = piece(q, vec2(W - 0.5 * w, 2.0 * w), vec2(w, H - 4.0 * w), vec2(0.5, 0.5), vec2(1.0, 0.5), 0); a += (1.0 - a) * k;
  return a;
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, 1080.0 - gl_FragCoord.y) - clipCentre.xy;
  p = vec2(clipCentre.z * p.x + clipCentre.w * p.y, -clipCentre.w * p.x + clipCentre.z * p.y) + clipCentre.xy;
  if (p.x < outer.x || p.y < outer.y || p.x >= outer.x + outer.z || p.y >= outer.y + outer.w) discard;
  float far = 1e9;
  float dx = min(sides.x > 0.5 ? p.x - outer.x : far, sides.z > 0.5 ? outer.x + outer.z - p.x : far);
  float dy = min(sides.y > 0.5 ? p.y - outer.y : far, sides.w > 0.5 ? outer.y + outer.w - p.y : far);
  float b = edge, a;
  if (solid == 0) a = turnedBand(p - outer.xy, outer.zw, b) * maskFade(p);
  else if (dx < b || dy < b) a = maskFade(p);
  else if (dx < 2.0 * b && dy < 2.0 * b) {
    if (dx < b && dy < b) a = plain(vec2(dx, dy) / b * 0.5);
    else if (dx >= b && dy >= b) a = inverted((vec2(dx, dy) - b) / b * 0.5);
    else if (dy < b) a = plain(vec2(0.5, dy / b * 0.5));
    else a = plain(vec2(dx / b * 0.5, 0.5));
  } else if (dy < 2.0 * b) a = plain(vec2(0.5, dy / b * 0.5));
  else if (dx < 2.0 * b) a = plain(vec2(dx / b * 0.5, 0.5));
  else discard;
  a *= alpha;
  if (a <= 0.0) discard;
  o = vec4(colour * a, a);
}`;

// A panel group's mask over its finished buffer (blend: buffer x mask): FS_LAYER's rectangle and edgeFade. Native frames of
// an opaque picture over a green owner (02_00_ARC02_1B, N2-211): the edge is that picture alone, its alpha and colour both
// at the owner's fade. Pixels outside the rectangle (a SACL layer with no clip of its own) are left alone.
const FS_GROUP_EDGE = `#version 300 es
precision highp float;
uniform vec4 clip;
uniform vec4 clipInner;
uniform float clipEdge;
uniform vec4 clipCentre;
uniform int featherOn;
uniform sampler2D feather;
out vec4 o;
float edgeFade(vec2 p) {
  vec2 past = p - clipInner.xy - clipInner.zw;   // over 0 beyond the inner rectangle's right / bottom side
  vec2 d = max(vec2(0.0), max(clipInner.xy - p, past));
  if (clipEdge <= 0.0 || (d.x <= 0.0 && d.y <= 0.0)) return 1.0;
  vec2 q = d / clipEdge;
  if (featherOn != 1) { float r = length(q); return r >= 1.0 ? 0.0 : 1.0 - smoothstep(0.0, 1.0, r); }
  if (q.x >= 1.0 || q.y >= 1.0) return 0.0;
  // The mask's pieces are the blob's own quarters and its middle row and column (0x32e30, rectangles 0x572990): the left and top
  // sides read its left and upper halves, the right and bottom sides its right and lower ones. The plain blobs are the same on
  // both, but style 7's (_2) reach their plateau a texel sooner on the right and lower halves, which is 2 px at a width of 60:
  // native frames of a style 7 panel have the right and bottom fades that much further out than the left and top ones.
  vec2 half_ = 0.5 / vec2(textureSize(feather, 0));
  vec2 uv = vec2(d.x > 0.0 ? 0.5 + (past.x > 0.0 ? 0.5 : -0.5) * q.x : 0.5 - half_.x, d.y > 0.0 ? 0.5 + (past.y > 0.0 ? 0.5 : -0.5) * q.y : 0.5 - half_.y);
  return texture(feather, uv).a;
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, 1080.0 - gl_FragCoord.y) - clipCentre.xy;
  p = vec2(clipCentre.z * p.x + clipCentre.w * p.y, -clipCentre.w * p.x + clipCentre.z * p.y) + clipCentre.xy;
  if (p.x < clip.x || p.y < clip.y || p.x >= clip.x + clip.z || p.y >= clip.y + clip.w) discard;
  o = vec4(edgeFade(p));
}`;

// The blob a panel edge is drawn with, by its width in the engine's 960-wide units (0x32e30 / 0x34a70: slots
// 0x34d7d4, half-sizes 0x34d81c = 10, 32, 40, 64, 128, 256): the smallest whose half-size is past the width.
const BLOB_SIZES = ["020", "064", "080", "128", "256", "512"];
export function bandBlob(width960) {
  const w = width960;
  return BLOB_SIZES[w < 10 ? 0 : w < 32 ? 1 : w < 40 ? 2 : w < 64 ? 3 : w < 128 ? 4 : 5];
}

// FADE 40 (0x2fc50; screenfx.js splitPixel is the same in JavaScript): red moved by d, green by -d, blue by -2d, each
// over the unmoved screen where the moved copy leaves it, times gain (the pass colour, twice), laid over the screen
// with the overlay shader at the split's alpha. d is in texture units: a channel moved by d is read from uv - d.
export const FS_SPLIT = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D t;
uniform vec2 d;
uniform float gain;
uniform float alpha;
out vec4 o;
float ovl(float b, float s) { return b < 0.5 ? 2.0 * b * s : 1.0 - 2.0 * (1.0 - b) * (1.0 - s); }
vec3 moved(vec2 p, vec3 b) { return p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0 ? b : texture(t, p).rgb; }
void main() {
  vec3 b = texture(t, uv).rgb;
  vec3 s = vec3(moved(uv - d, b).r, moved(uv + d, b).g, moved(uv + 2.0 * d, b).b) * gain;
  o = vec4(mix(b, vec3(ovl(b.r, s.r), ovl(b.g, s.g), ovl(b.b, s.b)), alpha), 1.0);
}`;

// A speed line: the FocusLine picture's first row (an alpha ramp from its inner end) on a thin wedge.
const FS_LINE = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D t;
uniform float alpha;
out vec4 o;
void main() { o = texture(t, uv) * alpha; }   // the strip as it is (0x87150)
`;

// The menu background's Gaussian (0xa0a90): 15 taps along `dir`, weights as the engine computes them; opaque. The engine
// adds 15 moved copies of the picture, so a tap from beyond the picture's edge adds nothing.
const FS_GAUSS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D t;
uniform vec2 dir;
uniform float w[15];
out vec4 o;
void main() {
  vec3 s = vec3(0.0);
  for (int i = 0; i < 15; i++) {
    vec2 p = uv + dir * float(i - 7);
    if (p.x >= 0.0 && p.y >= 0.0 && p.x <= 1.0 && p.y <= 1.0) s += w[i] * texture(t, p).rgb;
  }
  o = vec4(s, 1.0);
}`;

// One axis of a Gaussian, for the pictures the game has pre-blurred (blurSigma).
const FS_BLUR = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D t;
uniform vec2 dir;
uniform float sigma;
uniform int r;
out vec4 o;
void main() {
  vec4 s = vec4(0.0);
  float sum = 0.0;
  for (int i = -r; i <= r; i++) {
    float w = sigma > 0.0 ? exp(-float(i * i) / (2.0 * sigma * sigma)) : (i == 0 ? 1.0 : 0.0);
    s += w * texture(t, uv + dir * float(i));
    sum += w;
  }
  o = s / sum;
}`;

function compile(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.bindAttribLocation(p, 0, "p");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name;
    u[name] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    this.layerProg = compile(gl, VS, FS_LAYER);
    this.copyProg = compile(gl, VS, FS_COPY);
    this.fadeProg = compile(gl, VS, FS_FADE);
    this.displayProg = compile(gl, VS, FS_DISPLAY);
    this.blurProg = compile(gl, VS, FS_BLUR);
    this.gaussProg = compile(gl, VS, FS_GAUSS);
    this.menu = null;         // the system menu's blurred background (setMenuBlur)
    this.frameProg = compile(gl, VS, FS_FRAME);
    this.groupEdgeProg = compile(gl, VS, FS_GROUP_EDGE);
    this.groupState = { first: true, shader: 0, opacity: 0, stored: 0, mask: 1, lastMask: 1 };   // the group machine (drawTangled)
    this.splitProg = compile(gl, VS, FS_SPLIT);
    this.lineProg = compile(gl, VS, FS_LINE);
    this.windowProg = compile(gl, VS, FS_WINDOW);
    this.windowPics = [];     // the text window's pictures this frame (main.js): { path, full | x, y, alpha, dx, dy }
    this.windowReady = false; // they are all loaded, so the canvas draws the window and the page's own element stays hidden
    this.post = this.target(1920, 1080);
    this.ui = new Map();      // interface art used by the renderer: path -> {tex} once loaded
    this.split = null;        // FADE 40
    this.lines = null;        // FCLN
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.scene = this.target(1920, 1080);
    this.prev = this.target(1920, 1080);
    this.backTex = this.target(1920, 1080);
    this.tex = new Map();     // name -> {tex, w, h, used, promise}
    this.bytes = 0;
    this.blurCache = new Map();
    this.fade = null;
    this.shake = null;
  }

  target(w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }

  freeTarget(t) {
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  // A picture of the game, as a texture. Resolves when it can be drawn.
  load(name) {
    const key = name.toUpperCase();
    const hit = this.tex.get(key);
    if (hit) {
      hit.used = performance.now();
      return hit.promise;
    }
    const e = { used: performance.now(), tex: null, w: 0, h: 0 };
    e.promise = (async () => {
      const res = await fetch(asset(`/assets/img/${encodeURIComponent(key)}.avif`));
      if (!res.ok) throw new Error(`no image ${key}`);
      const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: "premultiply", colorSpaceConversion: "none" });
      const gl = this.gl;
      e.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, e.tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
      // The game's pictures have no mipmaps: a picture drawn smaller than it is stored is sampled bilinearly from the full
      // picture, so it stays crisp (IMG2472 at a quarter of its size on a native frame: the same gradient energy as this,
      // where mipmaps gave 60% of it).
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const info = this.images ? this.images[key] : null;
      e.w = bmp.width;
      e.h = bmp.height;
      e.nw = info ? info[0] : bmp.width;
      e.nh = info ? info[1] : bmp.height;
      bmp.close();
      this.bytes += e.w * e.h * 4;
      this.evict();
      return e;
    })();
    e.promise.catch(() => this.tex.delete(key));
    this.tex.set(key, e);
    return e.promise;
  }

  evict(keep) {
    const limit = 1400 * 1024 * 1024;
    if (this.bytes < limit) return;
    const live = new Set();
    for (const l of this.liveLayers || []) if (l.image) live.add(l.image.toUpperCase());
    const all = [...this.tex.entries()].filter(([k, v]) => v.tex && !live.has(k)).sort((a, b) => a[1].used - b[1].used);
    for (const [k, v] of all) {
      if (this.bytes < limit * 0.8) break;
      this.gl.deleteTexture(v.tex);
      this.bytes -= v.w * v.h * 4;
      this.tex.delete(k);
    }
  }

  // A picture from assets/ui, as a repeating texture; null until it has loaded.
  uiTexture(path) {
    const hit = this.ui.get(path);
    if (hit) return hit.tex;
    const e = { tex: null };
    this.ui.set(path, e);
    e.loaded = fetch(asset(`/assets/ui/${path}.webp`)).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(path))))
      .then((b) => createImageBitmap(b, { premultiplyAlpha: "premultiply", colorSpaceConversion: "none" }))
      .then((bmp) => {
        const gl = this.gl;
        e.w = bmp.width; e.h = bmp.height;
        e.tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, e.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
        for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.REPEAT], [gl.TEXTURE_WRAP_T, gl.REPEAT]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
        bmp.close();
      })
      .catch((err) => console.warn("no interface art", err.message));
    return null;
  }

  // A picture softened as the game's pre-blurred `<name>_XX_YY` picture is (blurSigma; rx, ry are the script's blur numbers),
  // made once and kept while it is used.
  blurred(e, name, rx, ry) {
    const key = `${name}|${rx}|${ry}`;
    const hit = this.blurCache.get(key);
    if (hit) {
      hit.used = performance.now();
      return hit;
    }
    const gl = this.gl;
    const k = e.w / e.nw;                 // texture pixels per stored pixel
    const sx = blurSigma(name, rx) * k, sy = blurSigma(name, ry) * k;
    const f = Math.max(1, Math.floor(Math.max(sx, sy) / 4));
    const pad = Math.ceil(Math.max(sx, sy) * 3) + 2;
    const w = Math.max(2, Math.ceil((e.w + 2 * pad) / f)), h = Math.max(2, Math.ceil((e.h + 2 * pad) / f));
    const a = this.target(w, h), b = this.target(w, h);
    gl.disable(gl.BLEND);
    // place the image, padded, at the working scale. The vertex shader works in 1920 x 1080: map the target to that.
    gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.copyProg.p);
    const m = [1920 * (e.w / f) / w, 0, 0, 0, 1080 * (e.h / f) / h, 0, 1920 * (pad / f) / w, 1080 * (pad / f) / h, 1];
    gl.uniformMatrix3fv(this.copyProg.u.m, false, m);
    gl.uniform4f(this.copyProg.u.uvr, 0, 0, 1, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, e.tex);
    gl.uniform1i(this.copyProg.u.t, 0);
    // a wide blur starts from the picture shrunk f times: that one copy is averaged through mipmaps (the layers themselves
    // are drawn without any, as the game draws them)
    if (f > 1) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (f > 1) gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.useProgram(this.blurProg.p);
    gl.uniformMatrix3fv(this.blurProg.u.m, false, [1920, 0, 0, 0, 1080, 0, 0, 0, 1]);
    gl.uniform4f(this.blurProg.u.uvr, 0, 1, 1, -1);
    gl.uniform1i(this.blurProg.u.t, 0);
    const pass = (src, dst, dx, dy, sigma) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, w, h);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform2f(this.blurProg.u.dir, dx / w, dy / h);
      gl.uniform1f(this.blurProg.u.sigma, sigma);
      gl.uniform1i(this.blurProg.u.r, Math.ceil(sigma * 3));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    pass(a, b, 1, 0, sx / f);
    pass(b, a, 0, 1, sy / f);
    this.freeTarget(b);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.drawFbo || this.scene.fbo);   // back to the frame being drawn
    gl.viewport(0, 0, 1920, 1080);
    const out = { tex: a.tex, target: a, w: e.w + 2 * pad, h: e.h + 2 * pad, nw: (e.w + 2 * pad) / k, nh: (e.h + 2 * pad) / k, used: performance.now(), flipped: true };
    this.blurCache.set(key, out);
    if (this.blurCache.size > 24) {
      const old = [...this.blurCache.entries()].sort((x, y) => x[1].used - y[1].used)[0];
      this.freeTarget(old[1].target);
      this.blurCache.delete(old[0]);
    }
    return out;
  }

  // layers: what is on screen; all: every layer by id, for parents and links that are not drawn themselves.
  drawLayers(layers, now, all) {
    const gl = this.gl;
    this.liveLayers = layers;
    if (this.held) return;
    // While a shake or a split is on, what this frame shows is kept for the next transition's old picture (beginFade): the commands before a FADS have changed the
    // live layers by then (STCP hiding them, for example), and the native redraw reads the records, which those changes only reach at the commit.
    this.shown = !this.noSplit && (this.shake || this.split) ? { now, layers: layers.map((l) => ({ ...l, effects: { ...l.effects } })) } : null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);
    gl.viewport(0, 0, 1920, 1080);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    // the frame being drawn must not stay bound to any texture unit the layer shader samples
    gl.useProgram(this.layerProg.p);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.backTex.tex);
    gl.uniform1i(this.layerProg.u.back, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    // Each layer is drawn as its motion leaves it this frame (animation.js): besides position, zoom, rotation, opacity
    // and blur, which the state carries, a track writes depth, blend, colour, brightness, contrast, grain, the panel
    // and the pivot (0x97b80). A view puts those over the layer for placing and drawing; parents and links are viewed
    // too, so a panel moved by its owner's track carries the layers linked to it.
    const own = new Map(all || layers.map((l) => [l.id, l]));
    for (const l of layers) if (!own.has(l.id)) own.set(l.id, l);
    const views = new Map(), states = new Map();
    for (const l of new Set([...own.values(), ...layers])) {
      const st = layerState(l, now), v = motionView(l, st);
      views.set(l, v);
      states.set(v, st);
    }
    const byId = new Map([...own].map(([id, l]) => [id, views.get(l)]));
    const sorted = layers.map((l) => views.get(l)).sort((a, b) => a.z - b.z || a.id - b.id);
    const info = (name) => (name && this.images ? this.images[name.toUpperCase()] : null);
    const placed = place(sorted, states, info, byId);
    // SHOK moves every layer and every panel clip (0x34440, 0x32050); the text window stays put while it runs
    // (0x391a0, 0xafeb9c). A clip also moves with its owner's quake and shake (0x32050), and so do the layers linked
    // to it (0x37f50 adds the clip's origin) unless SACL; each layer adds its own as 0x34440 chooses (effects.js).
    const [sx, sy] = impactPixels(this.shake, now);
    const moved = new Map();
    const clipAt = (clip) => {
      if (!clip) return clip;
      if (!moved.has(clip.group)) {
        const [qx, qy] = clipShift(clip.group, byId, now);
        moved.set(clip.group, [sx + qx, sy + qy]);
      }
      const [dx, dy] = moved.get(clip.group);
      if (!dx && !dy) return clip;
      const [x, y, w, h] = clip.rect;
      return { ...clip, rect: [x + dx, y + dy, w, h] };
    };
    // A layer is drawn only with z 1 or more (0x3bba0, listing 0x3c198-0x3c1a0); the scripts hide layers with STCP 0.
    // Hidden layers still serve as parents and links (place() above). A panel's frame (style 1-6) goes over the last
    // of its pictures to be drawn.
    const visible = new Set(sorted.filter((l) => drawn(l, placed.get(l))));
    const order = sorted.filter((l) => l.z >= 1 && l.ready);
    const runs = panelRuns(order, byId);
    const modes = groupModes(order, byId);
    const tangled = !plainGroups(order, byId, modes, runs);
    const lastOfPanel = new Map();
    for (const l of order) {
      const c = visible.has(l) ? placed.get(l).clip : null;
      if (c && c.border > 0 && !(tangled ? modes.get(l).mode : runs.has(l))) lastOfPanel.set(c.group, l);
    }
    const shiftOf = (l) => {
      const [qx, qy] = layerShiftPixels(l, byId, now);
      const link = l.link >= 0 && l.link !== l.id ? byId.get(l.link) : null;
      const [cx, cy] = link && !l.absolute ? clipShift(link, byId, now) : [0, 0];
      return [qx + cx, qy + cy];
    };
    let masked = null, maskTex = null;
    this.drawFbo = this.scene.fbo;
    // edgeless: keep the panel's rectangle but leave out its fade, which the group's buffer takes as a whole (fadeGroupEdge)
    const drawOne = (l, alpha, unblended = false, coverage = 1, edgeless = false) => {
      const at0 = placed.get(l), at = at0.clip ? { ...at0, clip: clipAt(at0.clip) } : { ...at0 };
      if (edgeless && at.clip) at.clip = { ...at.clip, border: 0 };
      if (alpha !== undefined) at.alpha = alpha;
      const [dx, dy] = shiftOf(l);
      const owner = maskOwner(l, byId);
      if (owner && owner !== masked) {
        const atOwner = placed.get(owner) || place([owner], states, info, byId).get(owner);
        const [ox, oy] = shiftOf(owner);
        maskTex = this.drawOwnerMask(owner, atOwner, now, sx + ox, sy + oy, states.get(owner));
        masked = owner;
      }
      // the first layer of a group goes into the buffer with no blend (0xa4bc0's first draw: no shader, full alpha)
      this.drawLayer(unblended ? Object.create(l, { blend: { value: 0 } }) : l, at, now, sx + dx, sy + dy, states.get(l), owner ? maskTex : null, false, coverage);
      return at;
    };
    // A panel on its own whose band is the turned one (0x34a70's turned branch, FS_FRAME's turnedBand): that band reaches inside over
    // the picture where the mask is still falling, so the panel is made in a buffer the way the game makes it, the picture, the band,
    // then the mask over both (0x36520: 0xb6f60, 0x34a70, 0x32e30), and laid on at the layer's alpha. Native frames of a turned
    // panel with a black band on black and on white (TODO item 111). An unturned band needs none of this: its outer half is solid
    // and the picture is simply left out under it.
    const turnedAlone = (l) => {
      const c = placed.get(l).clip;
      if (!c || !(c.border > 0) || lastOfPanel.get(c.group) !== l || blendShader(l.blend || 0) !== 0 || l.rule || maskOwner(l, byId)) return false;
      const g = clipGeometry(clipAt(c));
      return !!g.band && !g.band.solid;
    };
    const drawTurnedAlone = (l, back) => {
      const clip = clipAt(placed.get(l).clip), alpha = placed.get(l).alpha;
      if (!this.panelTarget) this.panelTarget = this.target(1920, 1080);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.panelTarget.fbo);
      gl.viewport(0, 0, 1920, 1080);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.drawFbo = this.panelTarget.fbo;
      drawOne(l, 1, false, 1, true);
      this.drawFrame(clip, 1, true);
      this.fadeGroupEdge(clip);
      gl.bindFramebuffer(gl.FRAMEBUFFER, back);
      gl.viewport(0, 0, 1920, 1080);
      this.drawFbo = back;
      this.layGroup(this.panelTarget, alpha);
    };
    // The engine's group machine, for a frame with linked layers that are not plain neighbours of their owner (0x3bba0, 0x36520,
    // 0xa6570, 0xa74b0, 0x37ea0; native draw traces and frames of each arrangement, 2026-11-09). The first flag is set at the
    // start of every frame (0x9f020) and by a run of two or more (0xa2ba0(1) after 0); the first layer of a group to be drawn
    // clears the buffer. A lone member does not, so it adds to what the buffer already holds, and each lone member composites
    // the buffer again: what lies between owner and child is covered inside the panel. The owner's alpha, not the first layer's,
    // sets the group's opacity: it writes the mask and the stored alpha (0xa74b0) every time it is drawn. A linked layer writes
    // neither, except that as the first layer of a frame it leaves the stored alpha at 1 and a mask of its own alpha times the
    // previous mask. The buffer goes over the scene with the shader of the group's first layer, as ever.
    const drawTangled = () => {
      const g = this.groupState;
      g.first = true;
      let prev = 0, buffered = false;
      const toBuffer = (on) => {
        if (on === buffered) return;
        if (on && !this.groupTarget) this.groupTarget = this.target(1920, 1080);
        const t = on ? this.groupTarget : this.scene;
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
        gl.viewport(0, 0, 1920, 1080);
        this.drawFbo = t.fbo;
        masked = null;
        buffered = on;
      };
      for (const l of order) {
        const m = modes.get(l);
        const clipped = !!placed.get(l)?.clip;
        if (m.mode === 1 && prev === 0) g.first = true;
        prev = m.mode;
        if (!m.mode || !clipped) {
          // no group, or a link to an owner with no panel (0x36520's plain path, which never reaches the buffer)
          toBuffer(false);
          if (visible.has(l)) {
            if (turnedAlone(l)) drawTurnedAlone(l, this.scene.fbo);
            else {
              const at = drawOne(l);
              if (at.clip && lastOfPanel.get(at.clip.group) === l) this.drawFrame(at.clip, at.alpha);
            }
          }
          continue;
        }
        const owner = byId.get(m.number) || l;
        const edgeWidth = owner.border || 0, edge = edgeWidth > 0;
        const isChild = l.link >= 0 && l.link !== l.id;
        if (visible.has(l)) {
          toBuffer(true);
          const own = states.get(l).alpha / 255;
          if (g.first) {
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            g.shader = blendShader(l.blend || 0);
            g.opacity = own;
            g.stored = isChild ? 1 : own;
            g.mask = isChild ? own * g.lastMask : (edge ? 1 : own);
            g.first = false;
            drawOne(l, 1, !!g.shader, 1, edge);
          } else if (isChild && blendShader(l.blend || 0) !== 0) {
            drawOne(l, own, false, g.opacity, edge);
          } else {
            // later layers: a linked one relative to the group's opacity; an owner drawn later (below it a child came first, or
            // another group's) at its own alpha (native frames: A at 128 over a child gives half the owner whatever the child's)
            drawOne(l, isChild ? (g.opacity > 0 ? Math.min(1, own / g.opacity) : 0) : own, false, 1, edge);
          }
          if (!isChild) {
            g.opacity = g.stored = own;
            g.mask = g.lastMask = edge ? 1 : own;
          }
        }
        if (m.mode === 2 && !g.first) {
          toBuffer(true);
          const c0 = placed.get(l)?.clip || placed.get(owner)?.clip;
          let source = this.groupTarget;
          if (edge && c0) {
            // the mask fades the composite only (0xa74b0 keeps it in its own target), not the buffer the next member adds to
            if (!this.groupCopy) this.groupCopy = this.target(1920, 1080);
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.groupTarget.fbo);
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.groupCopy.fbo);
            gl.blitFramebuffer(0, 0, 1920, 1080, 0, 0, 1920, 1080, gl.COLOR_BUFFER_BIT, gl.NEAREST);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.groupCopy.fbo);
            const clip = { ...clipAt(c0), border: edgeWidth, frame: owner.frame || 0 };
            this.drawFrame(clip, 1, true);
            this.fadeGroupEdge(clip);
            source = this.groupCopy;
          }
          toBuffer(false);
          if (g.shader) this.compositeGroup(g.shader, g.stored, g.mask, source);
          else this.layGroup(source, g.stored * g.mask);
          prev = 0;
        }
      }
      toBuffer(false);
    };
    if (tangled) drawTangled();
    else for (const l of order) {
      const run = runs.get(l);
      if (!run) {
        if (visible.has(l)) {
          if (turnedAlone(l)) drawTurnedAlone(l, this.scene.fbo);
          else {
            const at = drawOne(l);
            if (at.clip && lastOfPanel.get(at.clip.group) === l) this.drawFrame(at.clip, at.alpha);
          }
        }
        continue;
      }
      if (run.layers[0] === l) run.drawn = run.layers.filter((m) => visible.has(m));
      if (run.drawn.length && run.drawn[0] === l) {
        // A group of a panel: the first layer drawn gives the group's opacity and the others are relative to it (0xa6570:
        // own alpha x 255 / first alpha, at most 255, the first at full; the link's alpha does not come into it). When
        // that first layer is translucent the group is one picture: a buffer, drawn over the scene at the first alpha
        // when the panel has an edge width, its square when it has none (0xa2c30 and 0x36520, measured on native frames).
        const first = run.drawn[0], A = states.get(first).alpha / 255, shader = blendShader(first.blend || 0);
        const edgeWidth = run.owner.border || 0;
        run.edge = edgeWidth > 0 && !!placed.get(first).clip;
        if (groupNeedsBuffer(A, shader, run.edge ? edgeWidth : 0)) {
          run.flatten = groupOpacity(A, edgeWidth);
          run.coverage = groupCoverage(A, edgeWidth);
          run.first = A;
          run.shader = shader;
          if (!this.groupTarget) this.groupTarget = this.target(1920, 1080);
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.groupTarget.fbo);
          gl.viewport(0, 0, 1920, 1080);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          this.drawFbo = this.groupTarget.fbo;
          masked = null;   // the owner's mask is a separate target, but keep its state simple
        }
      }
      if (visible.has(l)) {
        const buffered = run.flatten !== undefined;
        const first = buffered && run.drawn[0] === l;
        // A later layer with a blend shader takes its alpha through exalpha with the mask target, which still holds the first
        // layer's picture at the first alpha (a linked layer draws no mask of its own, 0x36520): the texel's alpha is scaled
        // by the first alpha and the blend's opacity is the layer's own (native snapshots: 1 - A for a black `sub`, A = 64, 128;
        // 1 - A x 128/255 at alpha 128).
        const blended = buffered && !first && blendShader(l.blend || 0) !== 0;
        const relative = !buffered ? undefined : blended ? states.get(l).alpha / 255 : groupRelative(states.get(l).alpha / 255, run.first);
        drawOne(l, relative, first && !!run.shader, blended ? run.first : 1, run.edge);
      }
      if (run.layers.at(-1) === l && run.drawn.length) {
        // The band of the panel's frame is drawn into the group at the end of the run (0x37ea0), at the group's opacity
        // (N2-6). Checked on native frames: the group keeps its band whatever the last layer is (alpha 0, SACL). The panel's
        // mask then fades the whole group once.
        const lastAt = placed.get(run.drawn[0]);
        const border = run.owner.border || 0, frame = run.owner.frame || 0;
        if (run.edge) {
          const clip = { ...clipAt(lastAt.clip), border, frame };
          this.drawFrame(clip, 1, true);
          this.fadeGroupEdge(clip);
        }
        if (run.flatten !== undefined) {
          // the group onto the scene
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);
          gl.viewport(0, 0, 1920, 1080);
          this.drawFbo = this.scene.fbo;
          if (run.shader) this.compositeGroup(run.shader, run.first, run.coverage);
          else this.layGroup(this.groupTarget, run.flatten);
          masked = null;
        }
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);
    gl.viewport(0, 0, 1920, 1080);
    gl.disable(gl.BLEND);
    // The split is drawn after the transition (task 11 at priority 60 against the transition's task 12 at priority 50, 0x3bb3c
    // / 0x47d44), so while a FADS runs it goes over both pictures in present() (V15).
    if (!this.fade && !this.noSplit) this.drawSplit(now);
    // The speed lines come after the split: the text window's task draws them (0x391a0 -> 0x87a90(2), priority 80; the two
    // calls from the layer loop, 0x87a90(0) and (1), draw nothing), so the split leaves them alone (a native capture of
    // lines over black with the split full on: the lines as bright as without it). They are in the picture a FADS fades
    // from and in the one it fades to, as here (native frames: the old lines stay and fade while new ones come in). No
    // script has the split and the lines on together.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);
    gl.viewport(0, 0, 1920, 1080);
    this.drawLines(now);
    gl.disable(gl.BLEND);
  }

  drawLines(now) {
    const list = linesSample(this.lines, this.focusLines, now);
    if (!list.length) return;
    const tex = this.uiTexture("EFFECT_PARTS/FocusLine");
    if (!tex) return;
    const gl = this.gl, prog = this.lineProg;
    gl.useProgram(prog.p);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(prog.u.t, 0);
    for (const ln of list) {
      const c = Math.cos(ln.angle), s = Math.sin(ln.angle);
      const x0 = ln.x + c * ln.radius, y0 = ln.y + s * ln.radius;
      const L = ln.length, W = ln.width;
      gl.uniform4f(prog.u.uvr, ln.u / 1920, ln.v / 128, 960 / 1920, 2 / 128);
      // unit square: x along the line, y across it
      gl.uniformMatrix3fv(prog.u.m, false, [L * c, L * s, 0, -W * s, W * c, 0, x0 + W / 2 * s, y0 - W / 2 * c, 1]);
      gl.uniform1f(prog.u.alpha, ln.alpha);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  // The split at no transition (the level as it is, remembered for the next transition's ease). Into the scene.
  drawSplit(now) {
    const s = splitSample(this.split, this.splitTime ? this.splitTime() : now);   // the split's own clock (vm.js frameClock)
    this.splitLastLevel = s && s.alpha > 0 ? s.level : 0;
    if (!s || s.alpha <= 0) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.post.fbo);
    this.applySplit(this.scene.tex, s, s.gain);
    [this.scene, this.post] = [this.post, this.scene];
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);
  }

  // Lays the split over `tex` into the current framebuffer (0x2fc50): gain is the channel gain, (255 + level) / 255.
  applySplit(tex, s, gain) {
    const gl = this.gl, prog = this.splitProg;
    gl.viewport(0, 0, 1920, 1080);
    gl.useProgram(prog.p);
    gl.uniformMatrix3fv(prog.u.m, false, [1920, 0, 0, 0, 1080, 0, 0, 0, 1]);
    gl.uniform4f(prog.u.uvr, 0, 1, 1, -1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(prog.u.t, 0);
    gl.uniform2f(prog.u.d, s.dx / 1920, -s.dy / 1080);   // texture v runs up the screen
    gl.uniform1f(prog.u.gain, gain * gain);
    gl.uniform1f(prog.u.alpha, s.alpha);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // STEC's preset (effects.json, from the engine's table), and SNX2/SNX3 brightness and contrast.
  effectUniforms(view) {
    // the picture's baked colour effect when the layer has one (vm.js bakeOf, N2-15), else its live values
    const l = view.baked || view;
    const gl = this.gl, u = this.layerProg.u;
    const p = (l.effect && this.effects && this.effects[l.effect]) || null;
    const bright = l.bright ?? 1, contrast = l.contrast ?? 1;
    if (!p && bright === 1 && contrast === 1) { gl.uniform1i(u.fx, 0); return; }
    const e = p || {};
    const pick = (a, i, d) => (a && a[i] != null ? a[i] : d);
    const sil = e.mode === 2 || e.mode === 3;
    const colour = e.mode === 2 && l.tint ? l.tint : [1, 1, 1];
    // The engine sets the amount when the preset gives any channel value, or grayscale or a silhouette.
    const amount = e.gamma || e.black || e.white || e.mode === 1 || e.mode === 2 ? 1 : 0;
    gl.uniform1i(u.fx, 1);
    gl.uniform1i(u.fxSil, sil ? 1 : 0);
    gl.uniform3f(u.fxSilColor, colour[0], colour[1], colour[2]);
    gl.uniform1i(u.fxGray, e.mode === 1 || e.mode === 2 ? 1 : 0);
    gl.uniform1f(u.fxAmount, amount);
    gl.uniform3f(u.fxGamma, pick(e.gamma, 0, 1), pick(e.gamma, 1, 1), pick(e.gamma, 2, 1));
    gl.uniform3f(u.fxBlack, pick(e.black, 0, 0), pick(e.black, 1, 0), pick(e.black, 2, 0));
    gl.uniform3f(u.fxWhite, pick(e.white, 0, 255), pick(e.white, 1, 255), pick(e.white, 2, 255));
    const layer = (x) => (x ? [x[0] / 255, x[1] / 255, x[2] / 255, x[3] / 255] : [0, 0, 0, 0]);
    gl.uniform4f(u.fxLayer1, ...layer(e.layer1));
    gl.uniform4f(u.fxLayer2, ...layer(e.layer2));
    gl.uniform2f(u.fxModes, e.layer1 ? e.layer1[4] : 0, e.layer2 ? e.layer2[4] : 0);
    gl.uniform1f(u.fxBright, bright);
    gl.uniform1f(u.fxContrast, contrast);
  }

  // STRA's haze on this layer's record (vm.js op_STRA), unless the layer has film grain (0x362a0 returns at once when
  // record +0x1b0 is set: the STNS path draws it). The texture size is the picture's stored size, as the engine's.
  hazeUniforms(l, src, now) {
    const gl = this.gl, u = this.layerProg.u;
    const h = this.hazes ? this.hazes[l.id] : null;
    const entry = h && this.hazeTable && !(l.grain > 0) ? this.hazeTable[h.n] : null;
    const c = entry ? hazeConstants(h, entry, now, src.nw, src.nh) : null;
    gl.uniform1i(u.hazeOn, c ? 1 : 0);
    if (c) {
      gl.uniform4f(u.hazeX, c.x[0], c.x[1], c.x[2], c.x[3]);
      gl.uniform4f(u.hazeY, c.y[0], c.y[1], c.y[2], c.y[3]);
    }
    return !!c;
  }

  clipUniforms(prog, clip) {
    const gl = this.gl;
    if (!clip) { gl.uniform1i(prog.u.clipOn, 0); return null; }
    const g = clipGeometry(clip);
    gl.uniform1i(prog.u.clipOn, 1);
    gl.uniform4f(prog.u.clip, ...g.outer);
    gl.uniform4f(prog.u.clipInner, ...g.inner);
    gl.uniform1f(prog.u.clipEdge, g.border);
    const solidBand = g.band && g.band.solid;
    gl.uniform1i(prog.u.bandOn, solidBand ? 1 : 0);
    if (solidBand) gl.uniform4f(prog.u.bandInner, ...g.band.inner);
    gl.uniform4f(prog.u.clipCentre, g.centre[0], g.centre[1], Math.cos(g.angle), Math.sin(g.angle));
    // the mask's blob by its width (0x32e30); frame style 7 takes the plateau-shaped _2 one (slot + 12)
    const f = g.border > 0 ? this.uiTexture(`BORDER_PARTS/alphagradation${bandBlob(g.border / 2)}${clip.frame === 7 ? "_2" : ""}`) : null;
    gl.uniform1i(prog.u.featherOn, f ? 1 : 0);
    if (f) {
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, f);
      gl.uniform1i(prog.u.feather, 4);
      gl.activeTexture(gl.TEXTURE0);
    }
    return g;
  }

  // masked: the caller fades the band with the panel's mask afterwards (fadeGroupEdge), so its outer half stays solid here.
  drawFrame(clip, alpha, masked = false) {
    const gl = this.gl;
    const g = clipGeometry(clip);
    if (!g.band || !g.band.sides.some(Boolean)) return;
    const prog = this.frameProg;
    gl.useProgram(prog.p);
    gl.uniformMatrix3fv(prog.u.m, false, [1920, 0, 0, 0, 1080, 0, 0, 0, 1]);
    gl.uniform4f(prog.u.uvr, 0, 0, 1, 1);
    gl.uniform4f(prog.u.outer, ...g.outer);
    gl.uniform4f(prog.u.sides, ...g.band.sides);
    gl.uniform1f(prog.u.edge, g.band.border);
    gl.uniform1i(prog.u.solid, g.band.solid ? 1 : 0);
    gl.uniform4f(prog.u.maskInner, ...g.inner);
    gl.uniform1f(prog.u.maskEdge, masked ? 0 : g.border);
    gl.uniform3f(prog.u.colour, ...g.colour);
    gl.uniform4f(prog.u.clipCentre, g.centre[0], g.centre[1], Math.cos(g.angle), Math.sin(g.angle));
    gl.uniform1f(prog.u.alpha, alpha);
    const size = bandBlob(g.band.border / 2);
    const blob = this.uiTexture(`BORDER_PARTS/alphagradation${size}`), inv = this.uiTexture(`BORDER_PARTS/alphagradation_inv${size}`);
    gl.uniform1i(prog.u.blobOn, blob && inv ? 1 : 0);
    if (blob && inv) {
      gl.activeTexture(gl.TEXTURE6);   // unit 1 holds the layers' backdrop through the frame
      gl.bindTexture(gl.TEXTURE_2D, inv);
      gl.uniform1i(prog.u.inv, 6);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, blob);
      gl.uniform1i(prog.u.blob, 0);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // The panel's mask over the group's finished buffer (bound as the draw target): the group fades as one picture.
  fadeGroupEdge(clip) {
    const gl = this.gl, prog = this.groupEdgeProg;
    gl.useProgram(prog.p);
    gl.uniformMatrix3fv(prog.u.m, false, [1920, 0, 0, 0, 1080, 0, 0, 0, 1]);
    gl.uniform4f(prog.u.uvr, 0, 0, 1, 1);
    this.clipUniforms(prog, clip);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ZERO, gl.SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // A panel group's buffer over the scene, plainly.
  layGroup(source, alpha) {
    const gl = this.gl, prog = this.lineProg;
    gl.useProgram(prog.p);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix3fv(prog.u.m, false, [1920, 0, 0, 0, 1080, 0, 0, 0, 1]);
    gl.uniform4f(prog.u.uvr, 0, 1, 1, -1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source.tex);
    gl.uniform1i(prog.u.t, 0);
    gl.uniform1f(prog.u.alpha, alpha);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.backTex.tex);
    gl.activeTexture(gl.TEXTURE0);
  }

  // A panel group's buffer over the scene with its first layer's blend shader, the one 0xa2c30 / 0x37ea0 keep in 0xae0d30 /
  // 0xae0d38 for the last pass (0xae0d40 is that pass's opacity, the first alpha); see groupCoverage for the buffer's alpha.
  compositeGroup(shader, opacity, coverage, source = this.groupTarget) {
    const gl = this.gl, u = this.layerProg.u;
    gl.useProgram(this.layerProg.p);
    gl.uniformMatrix3fv(u.m, false, [1920, 0, 0, 0, 1080, 0, 0, 0, 1]);
    gl.uniform4f(u.uvr, 0, 1, 1, -1);
    gl.uniform1f(u.alpha, opacity);
    gl.uniform1f(u.coverage, coverage);
    gl.uniform1i(u.picture, 0);
    this.clipUniforms(this.layerProg, null);
    gl.uniform4f(u.tint, 0, 0, 0, 0);
    gl.uniform3f(u.mul, 1, 1, 1);
    gl.uniform1i(u.ownerOn, 0);
    gl.uniform1i(u.fx, 0);
    gl.uniform1i(u.hazeOn, 0);
    gl.uniform1i(u.hazeTwice, 0);
    gl.uniform1i(u.ruleWhole, 0);
    gl.uniform1i(u.maskOn, 0);
    gl.uniform1i(u.grainOn, 0);
    gl.uniform1i(u.mode, shader);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.backTex.tex);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, 1920, 1080);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source.tex);
    gl.uniform1i(u.t, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.BLEND);
  }

  // owner: the texture holding the panel owner's coverage for a linked layer (drawOwnerMask), or null. plain: the
  // picture alone, opaque and unblended, for that mask (no colour, effect, haze, rule, grain or blend shader).
  drawLayer(l, at, now, sx, sy, state = layerState(l, now), owner = null, plain = false, coverage = 1) {
    const gl = this.gl;
    let src = l.ready;
    const rx = Math.round(state.blurX) || 0, ry = Math.round(state.blurY) || 0;
    if ((rx > 0 || ry > 0) && src.tex) src = this.blurred(l.ready, l.image.toUpperCase(), rx, ry);
    const zx = at.zx, zy = at.zy;
    const rot = (at.rot / 100) * Math.PI / 180;
    const w = src.nw * F, h = src.nh * F;
    const uvr = src.flipped ? [0, 1, 1, -1] : [0, 0, 1, 1];
    // sx, sy: SHOK plus the layer's quake and shake (drawLayers)
    const scrX = at.x + sx, scrY = at.y + sy;
    // pivot, in screen pixels at zoom 1, from the centre of the picture
    const [px, py] = at.pivot;
    const c = Math.cos(rot), s = Math.sin(rot);
    const W = w * zx, H = h * zy;
    // corner (0,0) relative to the pivot
    const ox = -W / 2 - px * zx, oy = -H / 2 - py * zy;
    const m = stretchMatrix([W * c, W * s, 0, -H * s, H * c, 0, scrX + ox * c - oy * s, scrY + ox * s + oy * c, 1], at.stretch, scrX, scrY);
    gl.useProgram(this.layerProg.p);
    gl.uniformMatrix3fv(this.layerProg.u.m, false, m);
    gl.uniform4f(this.layerProg.u.uvr, uvr[0], uvr[1], uvr[2], uvr[3]);
    gl.uniform1f(this.layerProg.u.alpha, plain ? 1 : at.alpha);
    gl.uniform1f(this.layerProg.u.coverage, coverage);
    gl.uniform1i(this.layerProg.u.picture, 1);
    this.clipUniforms(this.layerProg, plain ? null : at.clip);
    const tinted = (l.baked || l).tint;
    if (tinted && !plain) gl.uniform4f(this.layerProg.u.tint, tinted[0], tinted[1], tinted[2], 1);
    else gl.uniform4f(this.layerProg.u.tint, 0, 0, 0, 0);
    // the record's colour (+0x1cc, STEC's or a track's) multiplies the picture while the record's preset is not 1
    // (0x36520: 0x3c10 -> 0xb03e0; the record takes the preset at the commit, STEC's colour at once): STEC 1 on a picture
    // already on screen darkens it at once in the game without any silhouette shape (N2-15, checked on a native frame).
    const live = l.tint || l.mul || null;
    const mul = !plain && live && (l.recordPreset ?? l.effect) !== 1 ? live : [1, 1, 1];
    gl.uniform3f(this.layerProg.u.mul, mul[0], mul[1], mul[2]);
    gl.uniform1i(this.layerProg.u.ownerOn, owner ? 1 : 0);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, owner || this.blankTexture());
    gl.uniform1i(this.layerProg.u.ownerMask, 5);
    gl.activeTexture(gl.TEXTURE0);
    if (plain) gl.uniform1i(this.layerProg.u.fx, 0);
    else this.effectUniforms(l);
    const hazed = plain ? (gl.uniform1i(this.layerProg.u.hazeOn, 0), false) : this.hazeUniforms(l, src, now);
    // A hazed layer outside a panel is drawn to a target and composited without STTR's rule (0x36520's haze branch
    // has no +0x10c test); in a panel the rule still applies (0xa7190).
    // A layer with no panel takes the rule path only through a plain draw (0x36520: blend shaders go their own way, and
    // at full alpha it draws as usual), and there the rule picture alone is the coverage: the buffer is composited in
    // white, the layer's alpha entering only as the threshold (0xa6e90: N2-16). In a panel the rule still applies.
    const blendLayer = blendShader(l.blend || 0) !== 0;
    // the picture is whichever rule the engine's one rule slot holds (STTR's, or the last FADS's, or none: vm.js ruleSlot)
    const ruleName = this.ruleSlot === undefined ? l.rule?.name : this.ruleSlot;
    const rule = !plain && l.rule && !(hazed && !at.clip) && (at.clip || !blendLayer) && ruleName ? this.tex.get(ruleName) : null;
    gl.uniform1i(this.layerProg.u.ruleWhole, at.clip ? 0 : 1);
    gl.uniform1i(this.layerProg.u.hazeTwice, !plain && hazed && !at.clip ? 1 : 0);
    if (rule && rule.tex) {
      gl.uniform1i(this.layerProg.u.maskOn, 1);
      gl.uniform1i(this.layerProg.u.maskFlip, l.rule.flip | 0);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, rule.tex);
      gl.uniform1i(this.layerProg.u.mask, 2);
      gl.activeTexture(gl.TEXTURE0);
    } else gl.uniform1i(this.layerProg.u.maskOn, 0);
    const g = !plain && l.grain ? grainSample(l.grain, now) : null;
    const gt = g ? this.uiTexture(`NOISE_PARTS/${g.texture}`) : null;
    if (gt) {
      gl.uniform1i(this.layerProg.u.grainOn, 1);
      gl.uniform4f(this.layerProg.u.grainAt, g.x, g.y, g.sx, g.sy);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, gt);
      gl.uniform1i(this.layerProg.u.grain, 3);
      gl.activeTexture(gl.TEXTURE0);
    } else gl.uniform1i(this.layerProg.u.grainOn, 0);
    const shader = plain ? 0 : blendShader(l.blend || 0);
    if (shader) {
      // needs what is under it: copy the frame so far, and let the shader do the blending
      gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.backTex.tex);
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, 1920, 1080);
    } else {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    gl.uniform1i(this.layerProg.u.mode, shader);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(this.layerProg.u.t, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // A 1 x 1 white texture for samplers with nothing to read (the owner mask when a layer has no owner).
  blankTexture() {
    if (!this.blank) {
      const gl = this.gl;
      this.blank = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.blank);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    }
    return this.blank;
  }

  // The coverage a panel owner gives the layers linked to it: its picture, fully opaque, at its own place (0x32e30's
  // linked branch draws the owner's texture there with a white vertex colour), into this.ownerTarget.
  drawOwnerMask(owner, at, now, sx, sy, state) {
    const gl = this.gl;
    // a blurred owner's texture first: making it rebinds the frame being drawn (`blurred`), a cached one does not
    const rx = Math.round(state?.blurX) || 0, ry = Math.round(state?.blurY) || 0;
    if ((rx > 0 || ry > 0) && owner.ready?.tex) this.blurred(owner.ready, owner.image.toUpperCase(), rx, ry);
    if (!this.ownerTarget) this.ownerTarget = this.target(1920, 1080);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ownerTarget.fbo);
    gl.viewport(0, 0, 1920, 1080);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (owner.ready && owner.ready.tex) this.drawLayer(owner, at, now, sx, sy, state, null, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.drawFbo || this.scene.fbo);
    gl.viewport(0, 0, 1920, 1080);
    return this.ownerTarget.tex;
  }

  // A menu wants the blurred story behind it (on) or not, at real time `real` (the game's clock stands still under
  // menus, so the 12 frames are counted in real time).
  setMenuBlur(on, real = performance.now()) {
    if (!on) { this.menu = null; return; }
    if (!this.menu) this.menu = { start: real, frame: 1, ready: false };
    else this.menu.frame = Math.floor((real - this.menu.start) / (1000 / 60) + 1e-7) + 1;
  }

  // The frozen frame blurred, across and down twice over (0xa0a90), into this.menuB.
  menuGaussian() {
    const gl = this.gl, prog = this.gaussProg;
    if (!this.menuA) { this.menuA = this.target(1920, 1080); this.menuB = this.target(1920, 1080); }
    gl.disable(gl.BLEND);
    gl.useProgram(prog.p);
    gl.uniformMatrix3fv(prog.u.m, false, [1920, 0, 0, 0, 1080, 0, 0, 0, 1]);
    gl.uniform4f(prog.u.uvr, 0, 1, 1, -1);
    gl.uniform1fv(prog.u["w[0]"], GAUSS);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(prog.u.t, 0);
    const pass = (src, dst, dx, dy) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, 1920, 1080);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform2f(prog.u.dir, dx, dy);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    pass(this.scene, this.menuA, GAUSS_STEP / 1920, 0);
    pass(this.menuA, this.menuB, 0, GAUSS_STEP / 1080);
    pass(this.menuB, this.menuA, GAUSS_STEP / 1920, 0);
    pass(this.menuA, this.menuB, 0, GAUSS_STEP / 1080);
  }

  // FADS keeps the last frame drawn before it on screen (native 0x77790 at 0x7ff24: 0xa4560 copies it once, then
  // 0xa46f0(1.0) draws the copy at full while the new screen's pictures load) until the transition starts: the
  // script's changes to live layers between the last frame and the FADS (STCP, STBR, ...) must not show first.
  hold(on = true) { this.held = on; }

  // Keep the picture on screen now, for a crossfade to whatever is drawn next.
  beginFade(ms, ruleTex, now = performance.now()) {
    const gl = this.gl;
    this.held = false;
    // 0x4b740 saves the screen shake, puts it at 0 and redraws the layers for the old picture: the transition starts from a
    // still picture (N2-98). Redrawn from the frame last shown, not the live layers (see drawLayers).
    const shown = this.shown;
    if (shown) {
      const shake = this.shake;
      this.shake = null;
      this.noSplit = true;
      this.drawLayers(shown.layers, shown.now, new Map(shown.layers.map((l) => [l.id, l])));
      this.noSplit = false;
      this.shake = shake;
    }
    const t = this.prev;
    this.prev = this.scene;
    this.scene = t;
    this.fade = { start: now, ms, rule: ruleTex || null };
  }

  // The text window's pictures over the frame, before the display pass (item 116). The game draws the window into its frame (0x391a0)
  // and the last pass (138dd8be) curves the result, so a dark picture behind the window comes out darker than the same veil laid on
  // afterwards: a stored 40 behind the full window shows as 17, where a page element over the canvas gave 21. Drawn only when
  // every picture is loaded (windowReady); until then the page's own element shows them.
  drawWindow() {
    const gl = this.gl, prog = this.windowProg;
    const list = (this.windowPics || []).map((w) => ({ w, tex: this.uiTexture(w.path), e: this.ui.get(w.path) }));
    this.windowReady = list.length > 0 && list.every((i) => i.tex);
    if (!this.windowReady || !list.some((i) => i.w.alpha > 0)) return;
    gl.useProgram(prog.p);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(prog.u.t, 0);
    gl.uniform4f(prog.u.uvr, 0, 0, 1, 1);
    for (const { w, tex, e } of list) {
      if (!(w.alpha > 0)) continue;
      const [x, y, wd, h] = w.full ? [0, 0, 1920, 1080] : [w.x, w.y, e.w, e.h];
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniformMatrix3fv(prog.u.m, false, [wd, 0, 0, 0, h, 0, x + (w.dx || 0), y + (w.dy || 0), 1]);
      gl.uniform1f(prog.u.alpha, Math.min(1, w.alpha));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.disable(gl.BLEND);
  }

  // window: false leaves the text window out (a save's picture has none).
  present(now, window = true) {
    const gl = this.gl;
    // the menu's blur is made once, from the frame frozen when it opened
    if (this.menu && !this.menu.ready) { this.menuGaussian(); this.menu.ready = true; }
    if (!this.displayTarget) this.displayTarget = this.target(1920, 1080);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.displayTarget.fbo);
    gl.viewport(0, 0, 1920, 1080);
    gl.disable(gl.BLEND);
    const full = [1920, 0, 0, 0, 1080, 0, 0, 0, 1];
    if (this.fade) {
      const k = Math.max(0, Math.min(1, (now - this.fade.start) / Math.max(1, this.fade.ms)));
      // While a transition runs the split goes over both pictures, its level easing from the last one drawn (0xafec68)
      // to the new one by 1 - the transition's level (0x2fc50, listing 0x2fdd4-0x2fe20; V15).
      const sp = splitSample(this.split, this.splitTime ? this.splitTime() : now);
      const splitOver = sp && sp.alpha > 0;
      if (splitOver) {
        if (!this.fadeBuffer) this.fadeBuffer = this.target(1920, 1080);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fadeBuffer.fbo);
      }
      gl.useProgram(this.fadeProg.p);
      gl.uniformMatrix3fv(this.fadeProg.u.m, false, full);
      gl.uniform4f(this.fadeProg.u.uvr, 0, 1, 1, -1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.prev.tex);
      gl.uniform1i(this.fadeProg.u.a, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.scene.tex);
      gl.uniform1i(this.fadeProg.u.b, 1);
      gl.uniform1f(this.fadeProg.u.k, k);
      gl.uniform1f(this.fadeProg.u.useRule, this.fade.rule ? 1 : 0);
      if (this.fade.rule) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.fade.rule);
        gl.uniform1i(this.fadeProg.u.rule, 2);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (splitOver) {
        const last = this.splitLastLevel || 0, level = last + k * (sp.level - last);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.displayTarget.fbo);
        this.applySplit(this.fadeBuffer.tex, sp, Math.max(0, 255 + level) / 255);
      }
      if (k >= 1) this.fade = null;
    } else {
      gl.useProgram(this.copyProg.p);
      gl.uniformMatrix3fv(this.copyProg.u.m, false, full);
      gl.uniform4f(this.copyProg.u.uvr, 0, 1, 1, -1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.scene.tex);
      gl.uniform1i(this.copyProg.u.t, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    const k = this.menu ? menuBlurAlpha(this.menu.frame) : 0;
    if (k > 0) {
      // the blurred frame over the story at k (0xa2680)
      const prog = this.lineProg;
      gl.useProgram(prog.p);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniformMatrix3fv(prog.u.m, false, full);
      gl.uniform4f(prog.u.uvr, 0, 1, 1, -1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.menuB.tex);
      gl.uniform1i(prog.u.t, 0);
      gl.uniform1f(prog.u.alpha, k);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
    }
    if (window) this.drawWindow();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, 1920, 1080);
    gl.disable(gl.BLEND);
    gl.useProgram(this.displayProg.p);
    gl.uniformMatrix3fv(this.displayProg.u.m, false, full);
    gl.uniform4f(this.displayProg.u.uvr, 0, 1, 1, -1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.displayTarget.tex);
    gl.uniform1i(this.displayProg.u.t, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
