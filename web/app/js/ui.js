// ui.js - the game's own screens, drawn with its interface art (web/assets/ui). Positions are measured from the game.
import { CHARACTERS } from "./audio.js";
import { DragFlick } from "./flowchart-model.js";
import { allEpisodesDone } from "./endings.js";
import { fillSegment, renderLogPage } from "./textbox.js";
import { LogoDust, LogoShards, MenuCursor, MENU_COLUMN, MENU_FADE, drawTitleParticles, dustColours, MENU_BANDS, MenuBgFade, Sparkles, frameLoop, nextTitleStage, titleVariant,
  CHOICE, ChoiceFx, DialogFx, DIALOG, ButtonState, EASE, TITLE_GLOW_RATE, TITLE_MENU, TITLE_MUSIC, TITLE_WHITE, FIRST_LAUNCH, titleMovieUp, pressPulse, titleLogo, titleLogoAlpha, titleRowAlpha, titleRowTop, px, py,
  SCROLLBAR, ScrollBarFx, BACKLOG, logPages, CONFIG, ConfigScroll, configFollow, configMove, configStep, sliderValue,
  SampleFx, NOTICE, NoticeFx, voiceScrollMax, wheelPixels, hitBoxPixels, STORY_HIT, SYSTEM_HIT } from "./uifx.js";
import { ACTIONS, MENU_KEYS, MOUSE, SLOTS, canBind, keyLabel, keyName } from "./keys.js";
import { chapterNamed, menuChapter } from "./chapters.js";
import { TOUCH, TOUCH_CONTROLS, TOUCH_HINTS, barPlace } from "./touch.js";
const PHASES = {
  // script prefix -> [column, row] in system_phasetitle_ja. The route of each is inferred from the script names.
  "00": [2, 7], "01": [0, 1], "02": [0, 2], "03": [0, 3], "04": [0, 4], "05_00": [2, 8], "05_01": [0, 5],
  "06_00": [0, 6], "06_01": [0, 7], "07_00": [0, 8], "07_01": [0, 9], "08_00": [1, 0], "08_01": [1, 1],
  "09_00": [1, 2], "09_01": [1, 3], "10_00": [1, 4], "10_01": [1, 5], "10_02": [1, 6], "11_00": [1, 7],
  "11_01": [1, 8], "12_00": [1, 9], "12_01": [2, 0], "13_00": [2, 1], "13_01": [2, 2], "14_00": [2, 3],
  "14_01": [2, 4], "15_01A": [2, 5], "15_01B": [2, 6],
};

export function phaseOf(name) {
  const k = name.match(/^(\d\d)_(\d\d[AB]?)/);
  if (!k) return PHASES["00"];
  if (k[1] === "00") return PHASES["00"];
  return PHASES[`${k[1]}_${k[2]}`] || PHASES[k[1]] || PHASES["00"];
}

export const PHASE_NAMES = [
  ["Glass Moon", "Morning of Homecoming I", "Day that Wasn't", "Inversion Impulse", "Infernal River of Blood I", "Distant Sea of Frost", "Vermillion Vestiges I", "Cerulean Stigma", "Eyes of Death Perception I", "Reverse Hatching I"],
  ["Eyes of Death Perception II", "Reverse Hatching II", "L'Arc-en-Ciel I", "Death.", "L'Arc-en-Ciel II", "Scarlet Moon of Crimson I", "Blacked Out Moon", "Epilogue", "Scarlet Moon of Crimson II", "Night of Ill-Omen"],
  ["Vermillion Vestiges II", "The Moon's Surface", "Mirage", "Stone of Eternity", "Moon Princess", "Rainbow in the Night", "Daylight Blue", "Prologue", "Infernal River of Blood II"],
];

const url = (pack, name) => `/assets/ui/${pack}/${name}.webp`;

// A piece of an atlas at a place on the 1920 x 1080 stage.
export function sprite(pack, name, x, y, w, h, sx = 0, sy = 0, cls = "") {
  const d = document.createElement("div");
  d.className = `sp ${cls}`;
  d.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;background-image:url("${url(pack, name)}");background-position:${-sx}px ${-sy}px;`;
  return d;
}

// A button with normal, hover and pressed art side by side in the atlas.
function atlasButton(pack, name, x, y, w, h, cells, row, opts = {}) {
  const b = document.createElement("button");
  b.className = "spbtn";
  b.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;background-image:url("${url(pack, name)}");`;
  const set = (i) => {
    const c = cells[Math.min(i, cells.length - 1)];
    b.style.backgroundPosition = `${-c[0]}px ${-(c[1] ?? row)}px`;
  };
  b.setState = set;
  set(opts.active ? 2 : 0);
  b.active = !!opts.active;
  b.setSelected = (on) => set(b.active ? 2 : on ? 1 : 0);
  if (opts.disabled) { b.disabled = true; b.style.opacity = ".35"; }
  return b;
}

function digits(pack, name, str, x, y) {
  const out = [];
  let px = x;
  for (const c of str) {
    if (c === " ") { px += 24; continue; }
    const i = c === "/" || c === ":" ? 10 : Number(c);
    out.push(sprite(pack, name, px, y, 32, 64, 16 + 32 * i, 0));
    px += c === "/" || c === ":" ? 26 : 28;
  }
  return out;
}

// The story's yes / no (SELS, SELA; native 0x83e50 modes 2 and 3). Buttons: 0 No, 1 Yes; cur -1 while neither is
// selected. Up picks No and Down Yes; Right steps 0 -> 1 (from nothing to No) and wraps 1 -> 0 on a fresh press; Left
// steps 1 -> 0 and, from nothing or No, goes to Yes on a fresh press (a held repeat from nothing goes to No). Returns
// the button to select, "decide" for A, or null.
export function storyDialogKey(cur, key, fresh = true) {
  if (key === "ArrowUp") return 0;
  if (key === "ArrowDown") return 1;
  if (key === "ArrowRight") return cur < 1 ? cur + 1 : fresh ? 0 : 1;
  if (key === "ArrowLeft") return cur < 1 ? (fresh ? 1 : 0) : 0;
  if (key === "Enter" || key === " ") return cur >= 0 ? "decide" : null;
  return null;
}

// The log (ui.backlog): Page Up / Page Down's distance, and how far the wheel turns past the newest line before the log closes.
export const LOG = { page: 760, close: 240 };
// The Controls page (ui.buildControlsPage): its place on the stage, the height of a heading and of a row, the gap between
// sections, and the key buttons' places and size.
export const KEYPAGE = { x: 407, top: 176, w: 1402, head: 46, row: 54, gap: 14, foot: 14, slotX: [1210, 1500], slot: [270, 42] };
// A save row's chapter (ui.savesScreen): the name's size, the least a long one is brought down to, and the room the whole
// title has (from x 359 of the row to short of the row's name at 656).
export const SLOT_TITLE = { size: 26, least: 18, room: 286 };
// The chapter's name in the system menu's header (ui.chapterTitle): the name's size, the least it is brought down to for
// a long one, and the room it has from the header's left end (to where the band on the right begins to show).
export const CHAPTER_TITLE = { size: 70, least: 44, room: 900 };
// The music playing, in the system menu's header (ui.nowPlaying), in stage pixels: left, where the band's light is full
// (system_scenebg, from x 752, is clear at its left end); sceneRight and sceneWidth, the scene name's box (.scene-name);
// note, the left end of the band's own "Note."; gap, kept clear before either; least, the room below which it is left out.
// label: the line above the title, its right end `inset` short of the title's (as "Note." ends 19 px short of the scene name's).
export const NOW_PLAYING = { left: 1010, sceneRight: 1824, sceneWidth: 420, note: 1760, gap: 48, least: 160, label: "Audio Track", inset: 19 };
// The header's own label, "Note." (drawn in system_scenebg at stage x 1762 - 1804): capitals 13 px high standing on y 26,
// the word's ink 43 px wide, strokes 2 px, in near black. A label of the port's beside it is drawn to those measures in a
// stand-in face (noteLabel): the size that gives the capitals' height, the squeeze that gives the word's width, and the
// strokes pared to the label's weight where the face is heavier.
export const NOTE_LABEL = { cap: 13, width: 43, base: 26, stem: 2, word: "Note.", weight: 400, colour: "rgb(26, 30, 32)",
  font: '"Eurostile", "Microgramma", "DIN Alternate", "Bahnschrift", "Inter", system-ui, sans-serif' };
// A word in that lettering, as a small picture drawn at twice its size: { el, width, pad } with the word's right end `pad`
// short of the picture's and its baseline NOTE_LABEL.base down. Null where there is no canvas.
function noteLabel(text) {
  const T = NOTE_LABEL, K = 2, pad = 4;
  try {
    const el = document.createElement("canvas"), probe = el.getContext("2d");
    const ink = (m) => (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || m.width);
    probe.font = `${T.weight} 100px ${T.font}`;
    const size = (T.cap / (probe.measureText("N").actualBoundingBoxAscent || 72)) * 100;
    const face = `${T.weight} ${size}px ${T.font}`;
    probe.font = face;
    const squeeze = Math.max(0.7, Math.min(1.5, T.width / (ink(probe.measureText(T.word)) || T.width)));
    const pare = Math.max(0, Math.min(1.2, ink(probe.measureText("I")) * squeeze - T.stem)) / squeeze;
    const width = Math.ceil(probe.measureText(text).width * squeeze) + 2 * pad, height = T.base + 8;
    el.width = width * K; el.height = height * K;
    el.style.width = `${width}px`; el.style.height = `${height}px`;
    const g = el.getContext("2d");
    g.scale(K, K);
    g.translate(width - pad, T.base);
    g.scale(squeeze, 1);
    g.font = face;
    g.textAlign = "right";
    g.textBaseline = "alphabetic";
    g.fillStyle = T.colour;
    g.fillText(text, 0, 0);
    if (pare > 0.05) {
      g.globalCompositeOperation = "destination-out";
      g.lineJoin = "round";
      g.lineWidth = pare;
      g.strokeText(text, 0, 0);
    }
    return { el, width, pad };
  } catch { return null; }
}
// The quick bar's buttons (ui.buildPanel): their size and place on the stage (the game's panel buttons are 220 x 62 from
// (82, 29), 221 apart; these keep the height and the row, 118 apart), and how far down the pointer brings the bar.
export const QUICK_BAR = { w: 117, h: 62, y: 29, pitch: 118, zone: 40 };
// The panel's button art (MODEPNL_PARTS_JA/mode_panel_btn_ja): eight plates of 220 x 62, 232 apart from (10, 9), in four
// rows 72 apart: off, normal, under the cursor, on or pressed. clean: the plate whose mark is smallest (Auto's), which
// gives the bare plate once the columns of `hole` are filled in from their neighbours; edge: the columns at each end kept
// as they are; ink: where a plate's mark lies (icons, and the two with words), [from, to, the blend's width]; text: the
// words' place and size on the game's own two (Q.SAVE: capitals 23 px high on a baseline at 44, 88 px wide, strokes 2 px:
// `pare` is taken off the outline of the stand-in face to bring it to that) and their colours and glow in each row, for
// the buttons the game has no plate for.
const PANEL_ART = { w: 220, h: 62, x: 10, dx: 232, y: 9, dy: 72, clean: 2, hole: [84, 136], edge: 12,
  ink: { icon: [74, 146, 14], word: [56, 167, 3] }, words: [5, 6],
  text: { size: 32, base: 44, pare: 0.9, sample: "Q.SAVE", width: 88, font: '"PT Sans Narrow", "Ubuntu Condensed", "Arial Narrow", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
    rows: [["rgba(30, 30, 30, .62)", "rgba(0, 0, 0, .5)", 7], ["rgba(242, 246, 248, .95)", "rgba(110, 195, 255, .95)", 9],
      ["rgba(231, 247, 255, .95)", "rgba(150, 228, 255, .95)", 9], ["rgba(237, 255, 255, .78)", "rgba(255, 255, 255, .9)", 6]] } };
// The sheet of the bar's buttons, one column a button and the art's four rows, as a picture's address; null where it
// cannot be made (the art missing, no canvas). A button with a plate in the game (def.art) is that plate cut to the new
// width: the bare plate drawn narrower, its ends kept, and the plate's own middle with its mark laid over it, blended at
// the sides. The others are the bare plate with their word drawn as the game's two words are.
export function quickBarArt(defs, B) {
  return new Promise((done) => {
    if (typeof Image === "undefined") { done(null); return; }
    const img = new Image();
    img.onerror = () => done(null);
    img.onload = () => { try { done(drawQuickBar(img, defs, B)); } catch (e) { console.warn("quick bar:", e.message); done(null); } };
    img.src = url("MODEPNL_PARTS_JA", "mode_panel_btn_ja");
  });
}
function drawQuickBar(img, defs, B) {
  const A = PANEL_ART, W = B.w, H = A.h, N = A.w;
  const src = document.createElement("canvas");
  src.width = img.naturalWidth; src.height = img.naturalHeight;
  const sg = src.getContext("2d", { willReadFrequently: true });
  sg.drawImage(img, 0, 0);
  const sheet = document.createElement("canvas");
  sheet.width = defs.length * W; sheet.height = 4 * H;
  const g = sheet.getContext("2d");
  // a plate as premultiplied values, so that blends do not tint its half-clear pixels
  const plate = (i, row) => {
    const d = sg.getImageData(A.x + A.dx * i, A.y + A.dy * row, N, H).data, out = new Float32Array(d.length);
    for (let k = 0; k < d.length; k += 4) { const a = d[k + 3] / 255; out[k] = d[k] * a; out[k + 1] = d[k + 1] * a; out[k + 2] = d[k + 2] * a; out[k + 3] = d[k + 3]; }
    return out;
  };
  const put = (cell, col, row) => {
    const im = g.createImageData(W, H), d = im.data;
    for (let k = 0; k < d.length; k += 4) {
      const a = cell[k + 3] / 255;
      d[k] = a > 0 ? cell[k] / a : 0; d[k + 1] = a > 0 ? cell[k + 1] / a : 0; d[k + 2] = a > 0 ? cell[k + 2] / a : 0; d[k + 3] = cell[k + 3];
    }
    g.putImageData(im, col * W, row * H);
  };
  const T = A.text;
  g.font = `400 ${T.size}px ${T.font}`;
  const squeeze = Math.max(0.6, Math.min(1.15, T.width / (g.measureText(T.sample).width || T.width)));
  for (let row = 0; row < 4; row++) {
    // the bare plate: the clean one with its mark's columns filled across
    const bare = plate(A.clean, row), [h0, h1] = A.hole;
    for (let y = 0; y < H; y++) for (let c = 0; c < 4; c++) {
      const at = (x) => bare[(y * N + x) * 4 + c];
      const l = (at(h0 - 3) + at(h0 - 2) + at(h0 - 1)) / 3, r = (at(h1 + 1) + at(h1 + 2) + at(h1 + 3)) / 3;
      for (let x = h0; x <= h1; x++) { const t = (x - h0 + 1) / (h1 - h0 + 2); bare[(y * N + x) * 4 + c] = l + (r - l) * t; }
    }
    // ... drawn W wide: its ends as they are, what lies between them brought together
    const back = new Float32Array(W * H * 4), inner = (N - 2 * A.edge) / (W - 2 * A.edge);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let u = x < A.edge ? x : x >= W - A.edge ? N - (W - x) : A.edge + (x - A.edge + 0.5) * inner - 0.5;
      u = Math.max(0, Math.min(N - 1, u));
      const u0 = Math.floor(u), u1 = Math.min(N - 1, u0 + 1), f = u - u0;
      for (let c = 0; c < 4; c++) back[(y * W + x) * 4 + c] = bare[(y * N + u0) * 4 + c] * (1 - f) + bare[(y * N + u1) * 4 + c] * f;
    }
    defs.forEach((d, col) => {
      if (d.art === undefined) { put(back, col, row); return; }
      const own = plate(d.art, row), [lo, hi, ramp] = A.words.includes(d.art) ? A.ink.word : A.ink.icon;
      const off = Math.round((lo + hi) / 2 - W / 2), cell = new Float32Array(back);
      for (let x = 0; x < W; x++) {
        const ox = x + off;
        if (ox < 0 || ox >= N) continue;
        let w = ox < lo ? 1 - (lo - ox) / ramp : ox > hi ? 1 - (ox - hi) / ramp : 1;
        if (w <= 0) continue;
        w = w * w * (3 - 2 * w);
        for (let y = 0; y < H; y++) for (let c = 0; c < 4; c++) {
          const k = (y * W + x) * 4 + c;
          cell[k] = back[k] * (1 - w) + own[(y * N + ox) * 4 + c] * w;
        }
      }
      put(cell, col, row);
    });
    // the words: each drawn apart, its strokes pared to the weight of the game's own (2 px), then laid on its plate with the row's glow
    const [fill, glow, blur] = T.rows[row];
    defs.forEach((d, col) => {
      if (d.art !== undefined) return;
      const word = document.createElement("canvas");
      word.width = W; word.height = H;
      const w = word.getContext("2d"), label = d.label.toUpperCase();
      w.translate(W / 2, T.base);
      w.scale(squeeze, 1);
      w.font = `400 ${T.size}px ${T.font}`;
      w.textAlign = "center";
      w.textBaseline = "alphabetic";
      w.fillStyle = fill;
      w.fillText(label, 0, 0);
      w.globalCompositeOperation = "destination-out";
      w.lineJoin = "round";
      w.lineWidth = T.pare;
      w.strokeText(label, 0, 0);
      g.save();
      g.beginPath();
      g.rect(col * W, row * H, W, H);
      g.clip();
      g.shadowColor = glow;
      g.shadowBlur = blur;
      g.drawImage(word, col * W, row * H);
      g.restore();
    });
  }
  return sheet.toDataURL("image/png");
}
// The mode panel's strip H high, for a touch device's panels (TOUCH.bar): modepanel_window's lower edge as it is, under
// the rest of it stretched.
export function panelBack(H) {
  const B = TOUCH.bar, a = document.createElement("div"), b = document.createElement("div");
  a.className = "tp-a";
  a.style.cssText = `top:0;height:${H - B.edge}px;background-size:1920px ${((H - B.edge) * 96) / B.cut}px;`;
  b.className = "tp-b";
  b.style.cssText = `top:${H - B.edge}px;height:${B.edge}px;background-position:0 ${-B.cut}px;`;
  return [a, b];
}
// The hint bar's entries (ui.helpBar): the keys and the mouse's part for each thing a screen can do.
export const HINTS = {
  Start: ["Enter", "Click START"], Back: ["Esc", "Right click"], Choose: ["Enter", "Click"], Move: ["\u2191 \u2193 \u2190 \u2192"], "Cursor movement": ["\u2191 \u2193 \u2190 \u2192"],
  "Change page": ["Tab"], Scroll: ["Wheel", "Page Up / Down"], "Quick jump": ["Enter", "Click"], "Replay voice": ["V", "Click its mark"],
  Picture: ["\u2190 \u2192", "Click"], Zoom: ["Wheel", "\u2191 \u2193"], Fill: ["Enter"], Reset: ["Home"], "Change key": ["Enter", "Click"],
};
// The system menu background's sparkles, one set for the whole session (menuBackground; 0xb34bc8), drawn on one canvas
// that the newest background takes.
export const menuSparkles = { set: null, star: null, owner: null, canvas: null, render: null };
// The sparkles through WebGL, as the original draws them (0x4bd10 -> 0xa27f0): the texture sampled bilinear without
// mipmaps, colour (1, 1, 1, alpha), normal alpha blending (Sparkles.quads). One context for the session, so menus do not
// add WebGL contexts (the browser drops the oldest past its limit).
class SparkleGL {
  constructor(canvas) {
    this.ok = false;
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) return;
    this.gl = gl;
    const shader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, `#version 300 es
in vec2 pos; in vec2 uv; in float alpha; out vec2 v; out float a;
void main() { v = uv; a = alpha; gl_Position = vec4(pos.x / 960.0 - 1.0, 1.0 - pos.y / 540.0, 0.0, 1.0); }`));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, `#version 300 es
precision mediump float;
in vec2 v; in float a; uniform sampler2D tex; out vec4 o;
void main() { vec4 t = texture(tex, v); o = vec4(t.rgb * t.a * a, t.a * a); }`));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog;
    this.data = new Float32Array(100 * 6 * 5);
    this.vbo = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const at = (name, n, off) => { const l = gl.getAttribLocation(prog, name); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, 20, off); };
    at("pos", 2, 0); at("uv", 2, 8); at("alpha", 1, 16);
    this.tex = null;
    this.ok = true;
  }
  draw(set, img) {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    gl.viewport(0, 0, 1920, 1080);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!img.complete || !img.naturalWidth) return;
    if (!this.tex) {
      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    const { count } = set.quads(this.data);
    if (!count) return;
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, count * 5);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, count);
  }
}
// The session's sparkle canvas and its draw: WebGL, or a 2D canvas where there is none.
function sparkleLayer() {
  if (menuSparkles.canvas) return menuSparkles;
  const make = () => { const c = document.createElement("canvas"); c.className = "fxcanvas"; c.width = 1920; c.height = 1080; return c; };
  let canvas = make(), gl = null;
  try { gl = new SparkleGL(canvas); } catch (e) { console.warn("sparkles:", e.message); gl = null; }
  if (gl?.ok) menuSparkles.render = () => gl.draw(menuSparkles.set, menuSparkles.star);
  else {
    if (gl) canvas = make();
    const ctx = canvas.getContext("2d");
    menuSparkles.render = () => {
      ctx.clearRect(0, 0, 1920, 1080);
      const star = menuSparkles.star;
      if (star.complete && star.naturalWidth) menuSparkles.set.draw(ctx, star);
    };
  }
  menuSparkles.canvas = canvas;
  return menuSparkles;
}

// A button's caption (native 0xae110 sets it, 0xae240 places it, 0xae590 draws it, 0xae840 picks the button): the button
// under the pointer (in the game the selected one too; here only while the pointer is on it) shows the message of its table entry (+0x28: the menu's column 0x591438,
// the config's tabs 0x46b370, the mode panel 0x5918c8) in a small face over DISP_PARTS_JA/mode_help, which starts 20
// units left of the text and runs 46 units past its width; the band shows at 0.7 of the caption's level and the text at
// it, the level rising 0.05 a frame from 0 at each new button. Those three groups' flags (0x120 / 0x320) make every
// place kind 2: below and right of the button's three-quarter point, 6 units further each way (0x34d2e0), moved left
// to end by x 624 units. Config +0x20 turns captions on; nothing in the game sets it, so they are always on.
export const CAPTIONS = { column: [161, 162, 163, 168, 166], tabs: [140, 1, 158, 159], panel: [169, 171, 173, 172, 170, 174, 175, 176],
  size: { column: [74, 29], tab: [64, 29], default: [96, 29], panel: [70, 36] }, rate: 0.05, band: 0.7, right: 624 };
const CAPTION_TEXT = { 1: "Sound Settings", 140: "System Settings", 158: "Display Operating Instructions",
  159: "Change All Settings to \"Recommended Settings\"", 161: "Save", 162: "Load", 163: "Set Environment", 166: "Return to Title",
  168: "Display Flowchart", 169: "Return to Previous Scene", 170: "Jump to Next Scene", 171: "Rewind when Pressing Button",
  172: "Fast Forward when Pressing Button", 173: "Toggle Auto Mode between ON and OFF", 174: "Quick Save", 175: "Quick Load",
  176: "Replay Last Voice" };
// The caption's place on the stage from the button's top left (x, y) and its size in units: [left, top] of the text's
// anchor, given the text's width in pixels.
export function captionAt(x, y, [w, h], textW) {
  let ax = x + (0.75 * w + 6) * 3;
  const ay = y + (0.75 * h + 6) * (1080 / 448);
  if (ax + textW + 9 > CAPTIONS.right * 3) ax = CAPTIONS.right * 3 - textW - 9;
  return [ax, ay];
}
class Caption {
  // scale: the alpha of the button it belongs to (0xae590 multiplies the caption's level by the button's alpha, the menu's level)
  constructor(scale = () => 1) {
    this.scale = scale;
    this.el = document.createElement("div");
    this.el.className = "caption";
    this.band = document.createElement("div");
    this.band.className = "caption-band";
    this.text = document.createElement("div");
    this.text.className = "caption-text";
    this.el.append(this.band, this.text);
    this.level = 0;
    this.key = null;
    this.stop = null;
  }
  // btn: the button's element, its top left read from its style; size: its units
  show(key, text, btn, size) {
    if (!text || !btn?.isConnected) { this.hide(); return; }
    if (key === this.key && this.el.parentElement === btn.parentElement) return;
    this.key = key;
    this.level = 0;
    btn.parentElement.append(this.el);
    this.text.textContent = text;
    const tw = this.text.offsetWidth || text.length * 10;
    const [ax, ay] = captionAt(parseFloat(btn.style.left) || 0, parseFloat(btn.style.top) || 0, size, tw);
    Object.assign(this.band.style, { left: `${ax - 60}px`, top: `${ay}px`, width: `${tw + 138}px` });
    Object.assign(this.text.style, { left: `${ax + 6}px`, top: `${ay + 7.2}px` });
    this.el.style.display = "block";
    this.draw();
    this.stop ||= frameLoop((dt) => {
      if (!this.el.isConnected || this.key === null) { this.stop(); this.stop = null; return; }
      this.level = Math.min(1, this.level + CAPTIONS.rate * dt);
      this.draw();
    });
  }
  draw() {
    const k = this.scale();
    this.band.style.opacity = String(CAPTIONS.band * this.level * k);
    this.text.style.opacity = String(this.level * k);
  }
  hide() {
    this.key = null;
    this.level = 0;
    this.el.style.display = "none";
  }
}

export class UI {
  constructor(env) {
    Object.assign(this, env);
    this.root = document.getElementById("ui");
    this.items = [];
    this.sel = 0;
    this.backFn = null;
    this.screen = null;
    this.saveKey = "tsuki.saves";
    addEventListener("keydown", (e) => this.key(e), true);
    // Whether the pointer itself moved in the event being handled: a browser also reports a "move" when the page changes
    // under a pointer at rest (a list scrolled by the keys, a screen fading in), and that must not take the cursor.
    this.pointerMoved = false;
    this.pointerAt = [NaN, NaN];
    addEventListener("pointermove", (e) => {
      this.pointerMoved = e.clientX !== this.pointerAt[0] || e.clientY !== this.pointerAt[1];
      this.pointerAt = [e.clientX, e.clientY];
    }, true);
  }

  get open() { return this.screen !== null; }

  // ---- screen plumbing -----------------------------------------------------------------------------------
  // Animations belonging to the screen on show: stopped when it changes.
  animate(fn) { (this.fx ||= []).push(frameLoop(fn)); }
  // fn after n frames of the screen on show (stopped with it); a hidden tab draws no frames, so after the time as well
  after(n, fn) {
    let t = 0, done = false;
    const go = () => { if (!done) { done = true; fn(); } };
    this.animate((dt) => { if (!done && (t += dt) >= n) go(); });
    setTimeout(() => { if (!done && this.fx?.length) go(); }, (n * 1000) / 60 + 400);
  }
  stopFx() { for (const stop of this.fx || []) stop(); this.fx = []; }

  // ---- the windows over everything (the system's questions and notices) ------------------------------------------
  // They have their own updates and layer: 0x49f00 and 0x49750 run every frame whatever the screen does (the task table
  // 0x47bf0 draws notices at priority 110 and dialogs at 120, over every screen), so a window fading out carries on over
  // the screen that follows it (N2-48).
  overlay() { return document.getElementById("sysui"); }
  sysLoop(fn) { return frameLoop(fn); }
  // A screen going away takes the windows still waiting on it with it (not those already fading out).
  cancelSystemWindows() { for (const cancel of [...(this.sysWindows ||= new Set())]) cancel(); }

  // The page a screen left, kept over the next one while a tween (uifx.js) takes it out: the gallery's column and its
  // flowchart cross-fade (native 0x7624). Its copy of the system menu's background and the help band go at once, the
  // new page drawing the same.
  ghost(old, tween) {
    if (!old || !tween) return;
    old.querySelectorAll(".menubg, .fc-help").forEach((e) => e.remove());
    old.style.background = "transparent";
    old.style.pointerEvents = "none";
    this.root.appendChild(old);
    old.style.opacity = String(tween.value);
    this.animate((dt) => {
      if (!old.isConnected) return;
      old.style.opacity = String(tween.step(dt));
      if (tween.done) old.remove();
    });
  }

  // title: "hold" leaves the title running under this screen (Config and Load opened from it, 0x8e200 states 0x20 and 0x21 keep
  // task 0x14 drawing), "resume" makes it the screen again. Any other screen ends it.
  begin(screen, { blur = false, keepPanel = false, title = null } = {}) {
    const live = this.titleLive;
    if (live && title === "hold") {
      Object.assign(live, { fx: this.fx || [], items: this.items, sel: this.sel, keyFn: this.keyFn });
      live.page.style.pointerEvents = "none";
      this.fx = [];
    } else {
      this.stopFx();
      if (title !== "resume") this.dropTitle();
    }
    this.cancelSystemWindows();
    if (!keepPanel) this.closePanel();
    this.screen = screen;
    this.root.textContent = "";
    this.root.style.display = "block";
    this.items = [];
    this.sel = 0;
    this.backFn = null;
    this.backSound = undefined;
    this.keyFn = null;
    this.screenFocus = this.screenClose = this.screenRight = this.columnTook = null;   // the column's hooks belong to the screen that set them
    this.menuBusy = false;      // a fade of the system menu or of the screen beside it is running: no keys, no pointer (N2-30, N2-135)
    this.menuHidden = false;    // the column's cursor goes out whatever has the focus (0x4c370, states 0xe and 0xf)
    this.menuLevel = 1;
    document.getElementById("stage").classList.toggle("menu-blur", blur);
    // the backlog lists the text itself: the page under it is not shown
    document.getElementById("stage").classList.toggle("in-log", screen === "log");
    this.vm.paused = this.vm.running;
    if (live && title === "resume") {
      this.root.appendChild(live.page);
      live.page.style.pointerEvents = "";
      Object.assign(this, { fx: live.fx, items: live.items, sel: live.sel, keyFn: live.keyFn });
      live.fx = null;
      return live.page;
    }
    if (live && title === "hold") this.root.appendChild(live.page);
    const page = document.createElement("div");
    page.className = "page";
    this.root.appendChild(page);
    return page;
  }

  // The title kept under Config or Load, dropped with whatever follows it.
  dropTitle() {
    for (const stop of this.titleLive?.fx || []) stop();
    this.titleLive = null;
  }

  close() {
    this.stopFx();
    this.dropTitle();
    this.cancelSystemWindows();
    this.keyFn = null;
    this.menuBusy = false;
    this.screen = null;
    this.root.style.display = "none";
    this.root.textContent = "";
    document.getElementById("stage").classList.remove("menu-blur", "in-log");
    this.vm.resume();
  }

  // opts.sound: the sound the item plays when chosen (1, decide, unless it says otherwise; null for none).
  // The pointer's rule, the same on every screen: the item under a moving pointer takes the cursor (sound 0) and one
  // click chooses it. A pointer at rest lights nothing (pointerMoved), so a page that scrolls or fades in under it leaves
  // the keys' cursor alone; a touch lights nothing either and chooses with its tap. opts.quiet(): the pointer lights
  // the item without the cursor sound (the column's own row). opts.keysOnly: the keys' item only, its pointer handled by
  // its owner. opts.ready(): the item takes the pointer only while it holds.
  add(el, fn, opts = {}) {
    if (fn) {
      const i = this.items.length;
      const items = this.items;
      this.items.push({ el, fn, ...opts });
      const live = () => this.items === items && (!opts.ready || opts.ready());
      const point = (how) => { this.pointing = true; try { how(); } finally { this.pointing = false; } };
      if (!opts.keysOnly) {
        el.addEventListener("pointermove", (e) => {
          if (e.pointerType === "touch" || !this.pointerMoved || !live()) return;
          if (!(this.sel === i && el.classList.contains("sel"))) point(() => (opts.quiet?.() ? this.select(i) : this.move(i)));
          this.showCaption(items[i]);   // a caption shows only while the pointer is on its button
        });
        el.addEventListener("pointerleave", () => { if (this.captionBox?.key === el) this.captionBox.hide(); });
      }
      // A finger (ui.touch, touch.js): the item lights as it is pressed, and its tap chooses it. opts.twoTap: only an item that
      // was lit before the press began is chosen, a first tap lighting it (the game's own touch rule, kept on touch devices
      // for what is small on a phone and starts something).
      let lit = true;
      if (!opts.keysOnly) el.addEventListener("pointerdown", (e) => {
        if (!this.touch || e.pointerType !== "touch" || !live()) return;
        lit = this.sel === i && el.classList.contains("sel");
        point(() => this.select(i));
      });
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!live() || opts.keysOnly) return;
        point(() => this.select(i));
        if (opts.twoTap && this.touch && !lit) { lit = true; this.sound(0); return; }
        this.choose(i);
      });
    }
    return el;
  }

  // The cursor to item i, with the cursor sound when it moves.
  move(i) {
    if (!this.items.length) return;
    const k = (i + this.items.length) % this.items.length;
    if (k === this.sel && this.items[k].el.classList.contains("sel")) return;
    this.select(k);
    this.sound(0);
  }

  choose(i) {
    const it = this.items[i];
    if (!it) return;
    if (it.sound !== null) this.sound(it.sound ?? 1);
    it.fn();
  }

  back() {
    if (!this.backFn || this.menuBusy) return;
    if (this.backSound !== null) this.sound(this.backSound ?? 2);
    this.backFn();
  }

  select(i) {
    if (!this.items.length) return;
    this.sel = (i + this.items.length) % this.items.length;
    this.items.forEach((it, k) => {
      if (it.el.setSelected) it.el.setSelected(k === this.sel);
      it.el.classList.toggle("sel", k === this.sel);
      if (k === this.sel && it.onSelect) it.onSelect();
    });
    const s = this.items[this.sel].el;
    if (s.scrollIntoView && this.items[this.sel].scroll && !this.pointing) s.scrollIntoView({ block: "nearest" });   // the keys bring a row into view
    if (!this.pointing) this.captionBox?.hide();   // the keys' cursor shows none
  }

  // A caption's text: its SYSMES message from system.json, else the English text.
  captionText(n) { return this.vm.system?.messages?.[String(n)] ?? CAPTION_TEXT[n] ?? ""; }

  // The caption of the item under the pointer, if it has one (Caption above).
  showCaption(it) {
    this.captionBox ||= new Caption(() => this.menuLevel ?? 1);
    if (it?.caption) this.captionBox.show(it.el, it.caption, it.el, it.captionSize);
    else this.captionBox.hide();
  }

  key(e) {
    if (!this.open) return;
    // Full screen is one key on every screen (keys.js), except while the Controls page waits for a key to bind.
    if (!this.binding && this.keys?.action(e) === "fullscreen") {
      if (!e.repeat) this.env.fullscreen?.();
      e.preventDefault(); e.stopPropagation();
      return;
    }
    if (this.keyFn?.(e)) { e.preventDefault(); e.stopPropagation(); return; }
    const k = e.key;
    // the fades read no keys (0x4d8c0 runs 0x4cea0 only in state 3, 0x50fc0 its list only in state 2)
    if (this.menuBusy) { if (k !== "F5" && k !== "F11" && k !== "F12") { e.preventDefault(); e.stopPropagation(); } return; }
    let used = true;
    if (k === "ArrowUp") { if (this.items[this.sel]?.up) this.items[this.sel].up(e); else this.move(this.sel - 1); }
    else if (k === "ArrowDown") { if (this.items[this.sel]?.down) this.items[this.sel].down(e); else this.move(this.sel + 1); }
    else if (k === "ArrowLeft") { if (this.items[this.sel]?.left) this.items[this.sel].left(e); else if (this.horizontal) this.move(this.sel - 1); else used = false; }
    else if (k === "ArrowRight") { if (this.items[this.sel]?.right) this.items[this.sel].right(e); else if (this.horizontal) this.move(this.sel + 1); else used = false; }
    else if (k === "Enter" || k === " ") this.choose(this.sel);
    else if (k === "Escape" || k === "Backspace") this.back();
    else if (k === "Tab") used = true;   // the browser's focus stays where it is
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
    else if (k !== "F5" && k !== "F11" && k !== "F12") e.stopPropagation();
  }

  // The hint bar along the bottom: what the keys and the mouse do on this screen, on the game's translucent band (native
  // 0x4a8f0 drew the controller's buttons there). labels: the screen's entries by name (HINTS above).
  helpBar(page, labels) {
    const bar = document.createElement("div");
    bar.className = "helpbar";
    bar.setAttribute("aria-label", labels.join(", "));
    for (const label of labels) {
      const hint = document.createElement("span");
      hint.className = "hint";
      // on a touch device, what a finger does instead (touch.js TOUCH_HINTS); an entry with nothing to say is left out
      const keys = this.touch ? TOUCH_HINTS[label] : label === "Replay voice" ? [this.keys?.label("voice") || "V", ...HINTS[label].slice(1)] : HINTS[label] || [];
      if (!keys) continue;
      for (const key of keys) hint.append(Object.assign(document.createElement("kbd"), { textContent: key }));
      hint.append(Object.assign(document.createElement("span"), { className: "hint-label", textContent: label }));
      bar.append(hint);
    }
    page.appendChild(bar);
    return bar;
  }

  // ---- title ---------------------------------------------------------------------------------------------
  saves() {
    try { return JSON.parse(localStorage.getItem(this.saveKey) || "{}"); } catch { return {}; }
  }

  autosaves() { return this.env.autosaves ? this.env.autosaves() : []; }

  // The title's stage (global G002), moved on one step as the title is entered from outside (native 0x90180).
  titleStageNow(enter = false) {
    const stored = this.vm.getVar("G002") || 0;
    if (!enter) return stored;
    const next = nextTitleStage(stored, this.vm.flow.started);
    if (next !== stored) this.vm.setVar("G002", next);
    return next;
  }

  // The title opens on its menu, except on the first launch (the boot's flag 0xac0de0 still set, see main.js): after the
  // opening, 0x8d1c0 sets G002 = 0 and G010 = 1 and shows variant 0 with "press any button" (state 9), no movie, music 2.
  // The title is entered from outside it here (start, a story's end, Return to Title, the gallery): Config and Load come
  // back through titleBack. The original fades the title in from black over 83 frames (0.012 a frame, native 0x8e200
  // state 2) and starts its music (music 2; 72 at the last title stage). opts.fromGallery: see titleMenu.
  title(opts = {}) {
    if (!this.env.firstLaunch?.()) {
      this.titleStageNow(true);
      this.titleMenu(opts);
      return;
    }
    this.vm.setVar("G002", 0);
    this.vm.setVar("G010", 1);
    this.env.titleVideo(false);
    this.env.titleMusic?.();
    const page = this.begin("title");
    const { bg: B, press: P } = FIRST_LAUNCH;
    const bg = sprite("TITLE_PARTS_JA", "title_bg0", B.cx - B.w / 2, B.cy - B.h / 2, B.w, B.h);
    bg.style.transform = `scale(${B.scale})`;
    page.append(bg);
    // The logo, the dust and the shards as on the menu's title (nothing of them depends on G010, only the light does).
    const logo = this.titleLogoLayer(page, { lumi: false });
    const prompt = sprite("TITLE_PARTS_JA", "press_start", P.x, P.y, P.w, P.h);
    prompt.style.transformOrigin = "50% 0";
    prompt.style.transform = `scaleY(${P.scaleY})`;
    prompt.style.opacity = "0";
    page.append(prompt);
    page.append(sprite("TITLE_PARTS_JA", "titlemenu__c_type-moon", 868, 1000, 184, 64));
    const black = this.blackout(page, 1);
    let state = "in", settle = FIRST_LAUNCH.settle, pulse = { alpha: 0, up: true };
    this.fadeBlack(black, 0, 0.012, () => { state = "settle"; });
    this.animate((dt) => {
      logo.step(dt, { black: black.level, particles: true });
      if (state === "settle" && (settle -= dt) <= 0) state = "wait";
      else if (state === "wait") {
        pulse = pressPulse(pulse, dt);
        prompt.style.opacity = String(pulse.alpha);
      }
    });
    const go = () => {
      if (state !== "wait") return;
      state = "gone";
      this.pressAny = null;
      // Pressing plays sound 6, starts the music's fade (over 3.33 s, into the cautions) and takes the screen to black
      // (0.02 a frame up to 1.2, state 10) before the two cautions, which end in white and the story (state 0x14).
      this.sound(6);
      this.audio.fadeBGMRate?.(TITLE_MUSIC.pressAny);
      this.fadeBlack(black, 1.2, 0.02, () => this.cautions(() => this.env.startStory()));
    };
    this.pressAny = go;
    page.addEventListener("click", go);
    // any button (0x8e200 state 9 reads every pressed key)
    this.keyFn = (e) => { if (e.key === "F5" || e.key === "F11" || e.key === "F12") return false; if (!e.repeat) go(); return true; };
  }

  // The logo in its three pieces at the level titleLogo keeps, the dust and shards before it, and on the menu the light over
  // it, added (0x8d5d0: blend 0x1e), its top left at (360, 278) on the 960 x 544 screen. step returns the third piece's
  // alpha (0x1536198), which the rows take. At level 0 everything here stands still (0x8d86c-0x8daf8 is skipped), with that
  // alpha left as it was, so the dust, the shards and the light's pulse carry on from where they stopped.
  // over: where the light goes (a touch device draws the logo in a box of its own, and a light added inside a box would add to nothing).
  titleLogoLayer(page, { lumi: withLumi = true, over = page } = {}) {
    const dust = document.createElement("canvas");
    dust.className = "fxcanvas";
    dust.width = 1920; dust.height = 1080;
    page.append(dust);
    const pieces = [[0, 285], [285, 570], [570, 648]].map(([y0, y1]) => {
      const p = sprite("TITLE_PARTS_JA", "title_titlelog", 680, 72 + y0, 560, y1 - y0, 0, y0);
      p.style.opacity = "0";
      page.append(p);
      return p;
    });
    const lumi = withLumi ? sprite("TITLE_PARTS_JA", "titlemenu_lumi", 720, 552, 488, 256, 0, 0, this.touch ? "lumi t-lumi" : "lumi") : null;
    if (lumi) over.append(lumi);
    const ctx = dust.getContext("2d");
    const atlas = new Image();
    atlas.src = url("TITLE_PARTS_JA", "logoparticle_all");
    const motes = new LogoDust(), shards = new LogoShards();
    let colours = null, logo = { level: 0, rising: true }, glow = 0, glowDir = TITLE_GLOW_RATE, third = 0;
    return {
      // A handled direction or a choice completes the logo (0x8e200 state 0x11: 0x900f4, 0x8ef34, 0x8f324).
      snap() { logo = { level: 1, rising: logo.rising }; },
      step(dt, { bgUp = false, black = 0, particles = true } = {}) {
        logo = titleLogo(logo.level, dt, { bgUp, black });
        if (logo.level > 0) {
          third = titleLogoAlpha(logo, 2);
          pieces.forEach((p, k) => { p.style.opacity = String(titleLogoAlpha(logo, k)); });
          if (lumi) {
            glow += glowDir * dt;
            if (glow > 1 || glow < 0) { glowDir = -glowDir; glow = Math.max(0, Math.min(1, glow)); }
            lumi.style.opacity = String(third * glow);
          }
          if (!colours && atlas.complete && atlas.naturalWidth) colours = dustColours(atlas);
          if (particles && colours) drawTitleParticles(ctx, atlas, colours, motes, shards, dt, third);
          else ctx.clearRect(0, 0, 1920, 1080);
        } else {
          for (const p of pieces) p.style.opacity = "0";
          if (lumi) lumi.style.opacity = "0";
          ctx.clearRect(0, 0, 1920, 1080);
        }
        return third;
      },
    };
  }

  // A black layer over a page, and fading it toward a level at a rate a frame; done() when it gets there.
  blackout(page, level) {
    const b = document.createElement("div");
    b.className = "blackout";
    b.style.opacity = String(level);
    b.level = level;
    page.append(b);
    return b;
  }
  // The title's white (0x8d5d0, 0x902f0; TITLE_WHITE): a white layer that fadeBlack moves, and the same again added at half its alpha.
  whiteCover(page, level = 0) {
    const w = this.blackout(page, level);
    w.style.background = "#fff";
    const added = document.createElement("div");
    added.className = "blackout fx-add";
    added.style.background = "#fff";
    w.added = added;
    page.append(added);
    this.drawCover(w);
    return w;
  }
  drawCover(b) {
    const a = Math.min(1, b.level);
    b.style.opacity = String(a);
    // At nothing a cover is not drawn at all (a full-screen layer in a blend mode over the title's movie, for nothing).
    b.style.display = a > 0 ? "" : "none";
    if (b.added) { b.added.style.opacity = String(0.5 * a); b.added.style.display = b.style.display; }
  }
  fadeBlack(b, to, rate, done) {
    const run = b.run = {};   // one level in the original: a new fade takes over from the one before
    this.animate((dt) => {
      if (b.run !== run || b.level === to) return;
      b.level = b.level < to ? Math.min(to, b.level + rate * dt) : Math.max(to, b.level - rate * dt);
      this.drawCover(b);
      if (b.level === to && done) { const d = done; done = null; d(); }
    });
  }

  // opts.fromGallery: back from the gallery. Its return (0x48ac0 mode 4 -> 0 with 10) starts the title again
  // (0x8d2e0) with the system menu's background still up and lowering at 0.02 a frame (0xb34b74 = 0xb34b7c = -0.02),
  // over the title fading in from black, and the cursor on GALLERY (0x1536158, state 0xe).
  titleMenu({ fromGallery = false } = {}) {
    const page = this.begin("titlemenu");
    this.pressAny = null;
    this.env.titleVideo(true);
    this.env.titleMusic?.();
    this.env.preloadGallery?.();   // the gallery's large thumbnail sheet is read while the title is up, not as the gallery opens
    const variant = titleVariant(this.titleStageNow());
    // The variant's still shows until the movie is drawn over it.
    const still = sprite("TITLE_PARTS_JA", `title_bg${variant}`, 0, 0, 1920, 1080, 0, 0, "title-still");
    page.append(still);
    // Native 0x8d5d0 draws, in order: the dust and shards (uifx.js), the logo in its three pieces (0x3529fc: rows
    // 0-285, 285-570, 570-648) at the logo's level (titleLogo in uifx.js), then titlemenu_lumi over it.
    // On a touch device the logo, the rows and the maker's line each go in a box of their own, which touch.css sizes and
    // moves (TOUCH.title): the logo smaller and higher, the rows at twice their size under it, a finger's width apart.
    const boxed = (cls) => (this.touch ? page.appendChild(Object.assign(document.createElement("div"), { className: `tbox ${cls}` })) : page);
    const logo = this.titleLogoLayer(boxed("t-logo"), { lumi: true, over: page });
    boxed("t-copy").append(sprite("TITLE_PARTS_JA", "titlemenu__c_type-moon", 868, 1000, 184, 64));
    const rowBox = boxed("t-rows");
    const start = (fn) => () => { this.env.titleVideo(false); fn(); };
    // The menu's buttons (group 10, table 0x65cbd8): titlemenu cells 296 x 72, normal from x 24, lit from 336, pressed
    // from 648, drawn 1:1 from (272, 298.67 + 23.23 k) of 640 x 448; hit boxes (0, 4)-(98, 25) of the same units.
    // Choosing one holds it pressed for 10 frames (0xae040) before the title moves on, except GALLERY. New Game plays
    // sound 6 and fades to white at 0.01 a frame as the music falls 1.5 a frame (state 0x14, 0x9c9b0(1.5)), then starts
    // the story (START_SCRIPT; no opening or cautions once the prologue has started); the others play 1.
    let white = null;
    let busy = false, pending = null;
    const pressThen = (b, fn) => () => {
      if (busy) return;
      busy = true;
      b.st.pressFor(10);
      pending = { frames: 10, fn };
    };
    const newGame = () => {
      this.audio.fadeBGMRate?.(TITLE_MUSIC.start);
      this.fadeBlack(white, TITLE_WHITE.to, TITLE_WHITE.rate, start(() => { this.close(); this.env.newGame(); }));
    };
    // The system menu's background (0x4b880, task priority 83) is drawn after the title (priority 10): over its
    // buttons and its black. menuBG01 is about a third opaque, so the title shows through it.
    let bgFade = null, bg = null;
    const raiseBg = (fade) => { bgFade = fade; bg = this.menuBackground(page, { fade }); };
    // GALLERY (native 0x8e200 state 0x11 item 5, TITLE_MENU in uifx.js): sound 1, the background up at 0.02 a frame,
    // and the title's black (drawn under it) up at 0.02 a frame to 1.2 before the gallery opens (on the section it was left on):
    // 60 frames, the background's bands meeting as it ends. The game then sits on that screen for its loading frames
    // (GALLERY_OPEN.hold, 0.35 s, checklist G20); the port has nothing to load there (the thumbnail sheet is read while the
    // title is up), so the gallery follows the fade without that stop.
    const black2 = document.createElement("div");
    black2.className = "blackout";
    black2.level = 0; black2.style.opacity = "0";
    const toGallery = () => {
      if (busy) return;
      busy = true;
      if (bgFade) bgFade.set(TITLE_MENU.rate); else raiseBg(new MenuBgFade().set(TITLE_MENU.rate));
      this.fadeBlack(black2, TITLE_MENU.to, TITLE_MENU.rate, start(() => this.env.gallery(undefined, { fromTitle: true })));
    };
    // Continue is a row only while the newest record (slots 0-138 by date, the quick save left out; system data
    // +0x161e) exists, else the menu has four (0x8d2f0). The cursor starts on Continue, else on Load when a manual
    // save exists, else on New Game; on GALLERY when coming back from it.
    const newest = this.newestRecord();
    const rows = [
      ...(newest ? [[376, () => this.continueGame(page)]] : []),
      [24, newGame],
      [112, () => this.savesScreen("load", true)],
      [200, () => this.config("system", true)],
      [288, null],
    ];
    const mainBtns = rows.map(([cy], k) => this.titleButton(page, "titlemenu", titleRowTop(rows.length, k), 296, 72,
      { normal: [24, cy], lit: [336, cy], pressed: [648, cy] }));
    // Input runs in state 0x11, which follows the fade in from black (state 2, 83 frames) and stops with a choice.
    const black = this.blackout(page, 1);
    const ready = () => !busy && black.level === 0;
    // The pointer waits for a row to be fully in: the rows come up after the black has gone, with the logo (titleRowAlpha),
    // and a row still fading in is neither lit nor chosen by the mouse. (The keys act from the end of the black, as in the game.)
    const shown = rows.map(() => 0);
    const toRow = (k) => () => this.move(k);
    mainBtns.forEach((b, k) => {
      const fn = rows[k][1];
      // The pointer lights the row under it and a click chooses it (the game's touch rule, 0x8e200 state 0x11, lit a row on
      // the press and chose it on a release 7-199 frames later).
      const act = fn ? pressThen(b, fn) : toGallery;
      rowBox.append(this.add(b.el, () => { logo.snap(); act(); }, { sound: fn === newGame ? 6 : 1, ready: () => ready() && shown[k] >= 1,
        left: toRow(0), right: toRow(rows.length - 1) }));   // the left and right directions go to the first and the last row
    });
    this.completionBanner(page);
    white = this.whiteCover(page);
    page.append(black2, black);   // drawn last of the title, with the system menu's background (if GALLERY raises it) over them
    this.backFn = null;
    const manual = Object.keys(this.saves()).some((k) => Number(k) >= 0 && Number(k) < 100);
    const first = fromGallery ? rows.length - 1 : newest ? 0 : rows.findIndex(([cy]) => cy === (manual ? 112 : 24));
    this.select(first);
    this.keyFn = (e) => {
      if (e.key === "F5" || e.key === "F11" || e.key === "F12") return false;
      if (!ready()) return true;
      if (e.key.startsWith("Arrow")) logo.snap();
      return false;
    };
    this.fadeBlack(black, 0, 0.012);
    if (fromGallery) raiseBg(new MenuBgFade(1, 1).set(-TITLE_MENU.rate));
    // m (0xae0b78): follows 1 - black upward and never comes down; held and resumed with the rest of the title.
    let menu = 0, movieUp = false;
    const live = this.titleLive = { page, fx: null, cover: null, resume: () => { busy = false; pending = null; } };
    this.animate((dt) => {
      // One black in the original (0x1536184) for the fade in, the fade out and GALLERY's.
      const dark = Math.max(black.level, black2.level);
      movieUp = titleMovieUp(movieUp, document.getElementById("movie"));   // asked for each frame: a movie made ready ahead comes with its own element (main.js movieElement)
      still.style.visibility = movieUp ? "hidden" : "visible";
      const third = logo.step(dt, { bgUp: (!!bgFade && bgFade.level > 0) || (!!live.cover && live.cover.level > 0), black: dark,
        particles: still.style.visibility === "hidden" });   // the movie's own first frames hold the fades up natively (0x1a30)
      menu = Math.max(menu, Math.min(1, 1 - dark));
      mainBtns.forEach((b, i) => {
        shown[i] = titleRowAlpha(third, menu, i, mainBtns.length);
        b.place(0, shown[i]);
        b.el.style.pointerEvents = shown[i] >= 1 ? "" : "none";   // no hand over a row that cannot be clicked yet
      });
      for (const b of mainBtns) b.step(dt);
      // Lowered all the way, the background is gone (0x4b880 draws nothing at 0).
      if (bgFade && bgFade.rate < 0 && bgFade.level === 0) { bg.remove(); bgFade = bg = null; }
      if (pending && (pending.frames -= dt) <= 0) { const fn = pending.fn; pending = null; fn(); }
    });
  }

  // Config or Load is opening over the title: it stays up behind them, the movie held on its frame (0x49630(+rate) ->
  // 0x1b20(1)) and the logo going down with the background rising over it. cover: the background's MenuBgFade.
  holdTitle(cover) {
    if (this.titleLive) this.titleLive.cover = cover;
    this.env.titleHold?.(true);
  }

  // Back from Config or Load: the title is the screen again, the rows and cursor as they were (states 0x20, 0x21 -> 0xf).
  // The logo has gone by now: it comes back over 120 frames from where the background ended, with the dust, shards and light
  // going on from where they stopped (0x8d2f0, the only reset, is not run).
  titleBack() {
    const live = this.titleLive;
    if (!live) { this.title(); return; }
    this.begin("titlemenu", { title: "resume" });
    live.resume();
    live.cover = null;
    this.pressAny = null;
    this.select(this.sel);
  }

  // A title button as the button system draws it (ButtonState): the cell for its state, the lit cell added again at
  // the arrival flash, inside a hit box (0, 4)-(98, 25) of the 640 x 448 units. yTop: its row on that screen.
  titleButton(page, atlas, yTop, w, h, cells) {
    const el = document.createElement("button");
    el.className = "spbtn title-btn";
    const x = px(TITLE_MENU.x), y = py(yTop), hit = [py(4), px(98), py(25)];
    el.style.cssText = `left:${x}px;top:${y + hit[0]}px;width:${hit[1]}px;height:${hit[2] - hit[0]}px;`;
    const img = `url("${url("TITLE_PARTS_JA", atlas)}")`;
    const art = document.createElement("div"), flash = document.createElement("div");
    art.className = "sp"; flash.className = "sp fx-add";
    for (const d of [art, flash]) d.style.cssText = `left:0;top:${-hit[0]}px;width:${w}px;height:${h}px;background-image:${img};`;
    flash.style.backgroundPosition = `${-cells.lit[0]}px ${-cells.lit[1]}px`;
    flash.style.opacity = "0";
    el.append(art, flash);
    const st = new ButtonState();
    const b = {
      el, st, lit: false,
      place(dy, alpha) { el.style.transform = dy ? `translateY(${py(dy)}px)` : ""; el.style.opacity = String(alpha); },
      step(dt) {
        st.step(dt, b.lit);
        const c = st.state === 4 ? cells.pressed : st.state & 1 ? cells.lit : cells.normal;
        art.style.backgroundPosition = `${-c[0]}px ${-c[1]}px`;
        flash.style.opacity = String(st.flash);
        flash.style.display = st.flash > 0 ? "" : "none";
      },
    };
    el.setSelected = (on) => { b.lit = on; };
    b.step(0);
    return b;
  }

  // The newest record of slots 0-138 (manual saves and the automatic ones; native 0x8d2f0 reads the slot written last
  // from the system data), or null.
  newestRecord() {
    const s = this.saves();
    const list = [...Object.entries(s).filter(([k]) => Number(k) >= 0 && Number(k) < 100).map(([, v]) => v), ...this.autosaves()]
      .filter(Boolean).sort((a, b) => (b.when || 0) - (a.when || 0));
    return list[0] || null;
  }

  // Continue (0x8e200 case 0, states 0x1c and 0x1e): "Loading" comes up, held (0x4abd0(1)), and goes as soon as it has
  // finished coming up (0x4ad30 no longer 1, then 0x4acd0); from there the music fades over 1.5 s and the screen goes to
  // black at 0.01 a frame up to 1.2, then the newest record.
  continueGame(page) {
    const rec = this.newestRecord();
    if (!rec) return;
    const loading = this.notify(this.vm.system?.messages?.["184"] || "Loading", { held: true });
    const load = () => { this.env.titleVideo(false); this.close(); this.env.loadSave(rec); };
    this.after(16, () => loading.close());
    loading.then(() => {
      this.audio.fadeBGMRate?.(TITLE_MUSIC.start);
      if (page) this.fadeBlack(this.blackout(page, 0), 1.2, 0.01, load); else load();
    });
  }

  // The completion banner (native 0x90440 / 0x91350): on the title, once episodes 1-24 are all complete (0x926f0(1))
  // and G069 is still 0, G069 becomes 1 and SYSMES 239 shows on a band at (385-940, 480) of the 960 x 540 screen: in over
  // 30 frames, rising 60 units as it does (cubic out), held 300 frames, out over 30.
  completionBanner(page) {
    if (!allEpisodesDone(this.vm.flow) || this.vm.getVar("G069")) return;
    this.vm.setVar("G069", 1);
    const band = document.createElement("div");
    band.className = "completion";
    band.textContent = this.vm.system?.messages?.["239"] || "Congratulations on completion! Please head to the ending list.";
    page.append(band);
    let a = 0, state = 1, held = 0;
    this.animate((dt) => {
      if (state === 1) { a = Math.min(1, a + dt / 30); if (a === 1) state = 2; }
      else if (state === 2) { held += dt; if (held >= 300) state = 3; }
      else if (state === 3) { a = Math.max(0, a - dt / 30); if (a === 0) { state = 0; band.remove(); } }
      const rise = state === 1 ? -((a - 1) ** 3) * 60 : 0;
      band.style.opacity = String(a);
      band.style.transform = `translateY(${2 * rise}px)`;
    });
  }

  // The cautions, as native 0x8e200 states 11-13 show them: each fades in over 50 frames, stays at least 240 frames (a press
  // passes it after that) and at most 720, then fades out over 50. The white comes up over the second as it fades (state 0xd,
  // 0.02 a frame, the two-pass white of 0x902f0), so the story's white (state 0x14) goes on from about 1 and holds 20 frames.
  cautions(done) {
    const page = this.begin("caution");
    const imgs = ["caution_UpRGB__scale__x1_500000_", "caution1_1920x1080"];
    let i = -1, phase = "out", alpha = 0, held = 0, pic = null;
    const white = this.whiteCover(page);
    const next = () => {
      i++;
      pic?.remove();
      if (i >= imgs.length) {
        pic = null;
        this.fadeBlack(white, TITLE_WHITE.to, TITLE_WHITE.rate, () => { this.close(); done(); });
        return;
      }
      pic = sprite("TITLE_PARTS_JA", imgs[i], 0, 0, 1920, 1080);
      pic.style.opacity = "0";
      page.prepend(pic);
      phase = "in"; alpha = 0; held = 0;
    };
    const press = () => { if (phase === "hold" && held >= 240) phase = "out"; };
    page.addEventListener("click", press);
    this.keyFn = (e) => { if (e.key === "F5" || e.key === "F11" || e.key === "F12") return false; if (!e.repeat) press(); return true; };
    next();
    this.animate((dt) => {
      if (!pic) return;
      if (phase === "in") { alpha = Math.min(1, alpha + 0.02 * dt); if (alpha === 1) phase = "hold"; }
      else if (phase === "hold") { held += dt; if (held >= 720) phase = "out"; }
      else if (phase === "out") {
        alpha = Math.max(0, alpha - 0.02 * dt);
        if (i === imgs.length - 1) { white.level = Math.min(TITLE_WHITE.to, white.level + TITLE_WHITE.caution * dt); this.drawCover(white); }
        if (alpha === 0) { next(); return; }
      }
      pic.style.opacity = String(alpha);
    });
  }

  // The start-up notice after the TM_CI movie (native 0xb5650 states 3-7, entry 1 of table 0x3c98fc): parts entry 1
  // fades in at 0.025 a frame over the movie's white, stays up to 480 frames (a press passes it at once), then the
  // background turns black and it fades out at 0.025.
  notice(done) {
    const page = this.begin("notice");
    page.style.background = "#fff";
    const pic = sprite("PARTS", "caution2_1920x1080", 0, 0, 1920, 1080);
    pic.style.opacity = "0";
    page.append(pic);
    let phase = "in", alpha = 0, held = 0;
    const press = () => { if (phase === "hold") { phase = "out"; page.style.background = "#000"; } };
    this.items = [{ el: page, fn: press }];
    page.addEventListener("click", press);
    this.animate((dt) => {
      if (phase === "in") { alpha = Math.min(1, alpha + 0.025 * dt); if (alpha === 1) phase = "hold"; }
      else if (phase === "hold") { held += dt; if (held >= 480) press(); }
      else if (phase === "out") {
        alpha = Math.max(0, alpha - 0.025 * dt);
        if (alpha === 0) { phase = "done"; this.close(); done(); return; }
      }
      pic.style.opacity = String(alpha);
    });
  }

  // ---- system menu: the column at the left, with whichever screen is open beside it -----------------------
  // The header (native 0x4c370): system_titlebg, system_scenebg, the underline at (0, 72), the chapter's cell of
  // system_phasetitle_ja, picked by F023 through table 0x591558 and drawn from (8, 0), and the scene name, SYSMES 395 +
  // F022, in the band at the right (none while F022 is 0). Only the system menu draws it and its column: the title's
  // Config and Load run without them (0x8e200 calls the config's 0x2b460 / 0x2c810 and the save screen itself). Without
  // the exported tables, the chapter by the script's name.
  header(page) {
    page.append(sprite("MENU_PARTS_JA", "system_titlebg", 0, 0, 1920, 392));
    page.append(sprite("MENU_PARTS_JA", "system_scenebg", 752, 0, 1168, 80));
    page.append(sprite("MENU_PARTS_JA", "underline", MENU_COLUMN.underline[0], MENU_COLUMN.underline[1], 1920, 16));
    const T = this.vm.system?.saves;
    const story = this.vm.running || this.vm.restoring;
    const f23 = story ? this.vm.getVar("F023") || 0 : 0, f22 = story ? this.vm.getVar("F022") || 0 : 0;
    const s = document.createElement("div");
    s.className = "scene-name";
    let chapter;
    if (T) {
      chapter = menuChapter(T.phaseCells[f23 >= 0 && f23 < 38 ? f23 : 0]);
      s.textContent = f22 >= 1 ? T.sceneNames[f22] || "" : "";
    } else {
      const [c, r] = phaseOf(this.vm.script ? this.vm.script.name : "00_00");
      chapter = chapterNamed(PHASE_NAMES[c][r]);
      s.textContent = PHASE_NAMES[c][r] || "";
    }
    this.chapterTitle(page, chapter);
    page.append(s);
    this.nowPlaying(page, s);
  }

  // The chapter at the header's left, written out on one line in the look of the game's picture of it (the cells of
  // system_phasetitle_ja, where the translation had to break a long name over two small lines to fit the cell): the day
  // in a large roman figure, the long stroke, the name in a chancery italic, all white. A long name is set smaller, down
  // to CHAPTER_TITLE.least, so that it ends before the header's band.
  chapterTitle(page, chapter) {
    if (!chapter) return;
    const C = CHAPTER_TITLE;
    const box = document.createElement("div");
    box.className = "chapter";
    box.setAttribute("aria-label", chapter.day === null ? chapter.name : `${chapter.day}: ${chapter.name}`);
    if (chapter.day !== null) {
      box.append(Object.assign(document.createElement("span"), { className: "chapter-day", textContent: String(chapter.day) }));
      box.append(Object.assign(document.createElement("span"), { className: "chapter-stroke" }));
    }
    const name = Object.assign(document.createElement("span"), { className: `chapter-name${chapter.struck ? " struck" : ""}`, textContent: chapter.name });
    box.append(name);
    page.append(box);
    // as large as the room allows
    let size = C.size;
    name.style.fontSize = `${size}px`;
    while (size > C.least && (box.offsetWidth || 0) > C.room) { size -= 2; name.style.fontSize = `${size}px`; }
  }

  // The music playing, in the header's band to the left of the scene name: "Audio Track" above the band's line, and under
  // it a turning disc and the track's title (the Music Player's own, gallery.json). The disc is the Music Player's knob, lit, with the plain knob small at its centre,
  // turning as the game's auto ring does. The title is set as the scene name is and ends 48 px short of it (or of the
  // band's "Note." when there is no scene name); it never reaches left of where the band's light begins, a longer title
  // being cut with an ellipsis. Nothing is shown while no music plays.
  nowPlaying(page, sceneEl) {
    const n = this.audio?.bgmState?.n, tracks = this.vm.gallery?.music;
    if (!Number.isInteger(n) || !this.audio.bgm || !tracks) return;
    const track = tracks.find((t) => t.music === n) || tracks.find((t) => t.also?.includes(n));
    if (!track?.title) return;
    const N = NOW_PLAYING;
    // the scene name's own width (its box is 420 wide, set from the right)
    let used = 0;
    if (sceneEl.textContent) {
      const probe = document.createElement("span");
      probe.textContent = sceneEl.textContent;
      sceneEl.textContent = "";
      sceneEl.append(probe);
      used = Math.min(N.sceneWidth, probe.offsetWidth || N.sceneWidth);
    }
    const right = Math.min(N.sceneRight - used, N.note) - N.gap;
    if (right - N.left < N.least) return;   // no room that would not crowd the scene name
    const box = document.createElement("div");
    box.className = "nowplaying";
    box.style.cssText = `left:${N.left}px;width:${right - N.left}px;`;
    box.setAttribute("aria-label", `Music: ${track.title}`);
    const disc = document.createElement("div");
    disc.className = "np-disc";
    const turn = document.createElement("div");
    turn.className = "np-turn";
    turn.append(sprite("GALLERY_PARTS_JA", "music_soundbtn", 0, 0, 80, 88, 160, 0));
    disc.append(turn, sprite("GALLERY_PARTS_JA", "music_soundbtn", -25, -27.5, 80, 88, 0, 0, "np-hole"));
    const title = document.createElement("div");
    title.className = "np-title";
    title.textContent = track.title;
    box.append(disc, title);
    page.append(box);
    // "Audio Track" over it, above the band's line, as "Note." stands over the scene name: its right end set in from the
    // title's by as much, in that label's lettering (noteLabel)
    const label = noteLabel(N.label);
    if (!label) return;
    label.el.className = "np-label";
    label.el.setAttribute("aria-hidden", "true");
    label.el.style.left = `${right - N.inset - label.width + label.pad}px`;
    label.el.style.top = "0px";
    page.append(label.el);
  }

  // The column (0x4c370 draws it, 0x4cea0 runs it; uifx.js MENU_COLUMN): menu_window, the five buttons in their cells,
  // then the cursor's line and light. active: the screen open beside it (its button is on), or null for the menu
  // itself. With a screen open, the screen's own controls have the focus until the cursor comes to the column, and the
  // line and light fade out meanwhile (MenuCursor hidden). Choosing the open screen's own button gives that screen the
  // cursor back (0x4d580 case 10 -> 0x2c810(2), 0x4d340 cases 5 / 6); any other choice closes the screen as its Back
  // does and then opens the next (0x5912ec). A choice acts at once (the state changes in 0x4cea0 and the next screen starts
  // its fade two frames later), the button staying pressed for 10 frames (0xae040) on whichever page draws it next. The
  // screen hands the column its hooks: ui.screenFocus(), ui.screenClose(next), ui.screenRight() and ui.columnTook().
  // Keys on the column (0x4cea0): Up / Down step and repeat, wrapping only on a fresh press; Left goes to the first row and
  // Right to the last, also only on a fresh press (with Save or Load open, Right gives the list the cursor back, 0x50ed0).
  column(page, active) {
    const M = MENU_COLUMN;
    const gap = this.touch ? TOUCH.columnStep - M.step : 0;   // a touch device: the same rows, further apart
    page.append(sprite("MENU_PARTS_JA", "menu_window", M.window[0], M.window[1], 312, 1080));
    // The cursor (native 0x4c370): systemcursor_line's strip (16, 8)-(344, 32), drawn after the buttons, added,
    // anchored at its top centre (flags 0x11) at (66, 56.41 + 31.11 r) of 640 x 448, so its bright row lies along the
    // label's baseline (the strip runs past the 224-px picture; that part is empty); systemcursor_light from its top
    // left at (0, 13.27 + 31.11 r) (tables 0x350508-0x350544), its star where the line starts.
    // The row (0xb359f0) is one for the whole run: 0, Save, at start-up, and changed only by pointing at or tapping a
    // column button or by the keys on the column (0x4cea0). Opening a screen leaves it where it was, and the line and
    // light are drawn at it from the first frame. The fades carry on between screens.
    const line = sprite("MENU_PARTS_JA", "systemcursor_line", px(66) - 164, 0, 328, 24, 16, 8, "cursorline");
    page.append(line);
    const cur = (this.menuCursor ||= new MenuCursor());
    this.menuRow ??= 0;
    // A screen open beside the column closes first; the flowchart and Title go on from the menu alone (state 9 -> 0xe, 0x12, 0x15).
    const leave = (next) => (active && this.screenClose ? this.screenClose(next) : next());
    const toMenu = (next) => leave(() => { if (active) this.system({ back: true }); next(); });
    const rows = [
      ["Save", () => leave(() => this.savesScreen("save"))],
      ["Load", () => leave(() => this.savesScreen("load"))],
      ["Config", () => leave(() => this.config("system"))],
      ["FlowChart", () => this.flowchartFromMenu(toMenu)],
      ["Title", () => this.returnToTitle(toMenu)],
    ];
    // In a gallery replay (F025) Save and Load are refused with sound 2 and drawn in other cells (0x4cfe0 / 0x4d02c,
    // 0x4cb30).
    const refused = (label) => (label === "Save" || label === "Load") && this.vm.replay;
    const cursor = sprite("MENU_PARTS_JA", "systemcursor_light", 0, 0, 528, 240, 0, 0, "cursor");
    page.append(cursor);
    const place = (r) => {
      cursor.style.top = `${py(13.27407 + 31.11111 * r) + gap * r}px`;
      line.style.top = `${py(56.41481 + 31.11111 * r) + gap * r}px`;
    };
    place(this.menuRow);
    const btns = [], first = this.items.length, own = this.items;
    const step = (d) => (e) => {
      let to = this.sel - first + d;
      if (to < 0 || to >= rows.length) { if (e?.repeat) return; to = (to + rows.length) % rows.length; }
      this.move(first + to);
    };
    const jump = (to) => (e) => { if (!e?.repeat && (this.menuRow ?? 0) !== to) this.move(first + to); };
    const keys = { up: step(-1), down: step(1), left: jump(0), right: (e) => (this.screenRight ? this.screenRight(e) : jump(rows.length - 1)(e)) };
    const cellOf = (s, r) => (s === 4 || (s >= 2 && r < 3) ? 2 : s & 1 ? 1 : 0);
    rows.forEach(([label, fn], r) => {
      const cy = M.cellY + M.cellStep * r;
      const b = document.createElement("button");
      b.className = "spbtn menucol";
      b.style.cssText = `left:${M.x}px;top:${M.y + (M.step + gap) * r}px;width:${M.hit[0]}px;height:${M.hit[1]}px;`;
      const art = sprite("MENU_PARTS_JA", "menu_btn_ja", 0, 0, M.cell[0], M.cell[1], M.cellX[0], cy);
      const flash = sprite("MENU_PARTS_JA", "menu_btn_ja", 0, 0, M.cell[0], M.cell[1], M.cellX[1], cy, "fx-add");
      b.append(art, flash);
      b.st = new ButtonState();
      if (this.menuPressed?.row === r && this.menuPressed.left > 0) b.st.pressFor(this.menuPressed.left);
      b.lit = false;
      b.render = () => {
        const x = -M.cellX[cellOf(b.st.state, r)];
        art.style.backgroundPosition = `${x}px ${-cy}px`;
        flash.style.backgroundPosition = `${x}px ${-cy}px`;
        flash.style.opacity = String(b.st.flash * (this.menuLevel ?? 1));
      };
      b.setSelected = (on) => {
        b.lit = on;
        if (on && this.menuRow !== r) {
          this.menuRow = r;
          place(r);
          cur.moved();
        }
      };
      if (refused(label)) { b.style.opacity = ".3"; b.setAttribute("aria-disabled", "true"); }
      b.setAttribute("aria-label", label);
      btns.push(b);
      const choose = () => {
        if (active === label && this.screenFocus) { this.screenFocus(); return; }
        if (this.menuBusy) return;
        b.st.pressFor(10);
        this.menuPressed = { row: r, left: 10 };
        fn();
      };
      const cap = { caption: this.captionText(CAPTIONS.column[r]), captionSize: CAPTIONS.size.column, ...keys,
        onSelect: () => this.columnTook?.(), quiet: () => r === (this.menuRow ?? 0) };
      if (refused(label)) page.append(this.add(b, () => {}, { sound: 2, ...cap }));
      else page.append(this.add(b, choose, cap));
    });
    const last = this.items.length;
    const on = (r) => active === rows[r][0];
    // the screen beside it has the focus while the cursor is not on the column, and during its fades (0x4c370: state 8 / 0xb with
    // 0xb359e8 clear); the menu alone always shows them, except going out to the flowchart (states 0xe, 0xf)
    const hidden = () => this.menuHidden || (active !== null && (this.menuBusy || this.items !== own || !(this.sel >= first && this.sel < last)));
    btns.forEach((b, r) => { b.st.step(0, false, on(r)); b.render(); });
    this.animate((dt) => {
      btns.forEach((b, r) => { b.st.step(dt, b.lit, on(r)); b.render(); });
      if (this.menuPressed && (this.menuPressed.left -= dt) <= 0) this.menuPressed = null;
      const k = this.menuLevel ?? 1;
      if (k > 0) cur.step(dt, hidden());   // 0x4c370 does nothing at level 0
      line.style.opacity = String(cur.line * k);
      line.style.transform = `scaleX(${cur.stretch})`;
      cursor.style.opacity = String(cur.light * k);
    });
  }

  // The system menu's own background (native 0x4b880): menuBG01, the bands closing in from the top and bottom over
  // 60 frames, and sparkles drifting up (0x4bd10). Returns its element. settled: the bands already in place, as on
  // screens opened while it stays up (the gallery: the title's GALLERY raised it, 0x49630(0.02), and only leaving
  // lowers it). fade: a MenuBgFade (uifx.js) to step and draw by, for the title's GALLERY and the gallery's return;
  // without one the level is 1 and the callers fade the whole element.
  menuBackground(page, { settled = false, fade = null } = {}) {
    const bg = document.createElement("div");
    bg.className = "menubg";
    const base = sprite("DISP_PARTS_JA", "menuBG01_upscale", 0, 0, 1920, 1080);
    bg.append(base);
    const bands = MENU_BANDS.map((band) => {
      const [name] = band;
      const el = sprite("DISP_PARTS_JA", name, 0, 0, 0, 0);
      el.dataset.name = name;
      bg.append(el);
      return { band, el };
    });
    // The sparkles are one static set (0xb34bc8, never cleared) that 0x4bd10 draws and moves while a menu background
    // is drawn, so each background carries on the one before: the gallery's goes on with the title's GALLERY's
    // (checklist G20; the port made a new, empty set for each, so the gallery opened on a bare sky). The newest
    // background takes the session's sparkle canvas and moves them; it draws them as they are from its first frame.
    menuSparkles.set ||= new Sparkles();
    if (!menuSparkles.star) { menuSparkles.star = new Image(); menuSparkles.star.src = url("DISP_PARTS_JA", "kirakira"); }
    const layer = sparkleLayer(), canvas = layer.canvas, sparkles = layer.set, owner = {};
    layer.owner = owner;
    bg.append(canvas);
    page.append(bg);
    const dims = { menuBG04_0_upscale: [1920, 396], menuBG04_1_upscale: [1920, 321], menuBG04_2_upscale: [1920, 255],
      menuBG04_3_upscale: [1920, 165], menuBG05_0_upscale: [1920, 311], menuBG05_1_upscale: [1700, 236],
      menuBG05_2_upscale: [1920, 170], menuBG05_3_upscale: [1497, 80] };
    for (const { band, el } of bands) {
      const [w, h] = dims[band[0]];
      el.style.width = `${w}px`; el.style.height = `${h}px`;
    }
    const drawSparkles = () => { if (menuSparkles.owner === owner) menuSparkles.render(); };
    drawSparkles();
    const f = fade || new MenuBgFade(1, settled ? 1 : 0).set(1);
    if (!fade) f.rate = 0;
    const draw = bg.redraw = () => {
      for (const { band, el } of bands) {
        const [w, h] = dims[band[0]];
        const at = f.band(band);
        el.style.left = `${at.x - w / 2}px`;
        el.style.top = `${at.y - h / 2}px`;
        el.style.opacity = String(at.alpha);
      }
      base.style.opacity = String(f.level);
      // The sparkles' alpha is theirs times 0xb34b70 (0x4bd10's vertex colour), taken here as the level.
      if (menuSparkles.owner === owner) canvas.style.opacity = String(f.level);
    };
    draw();
    this.animate((dt) => {
      f.step(dt);
      draw();
      if (menuSparkles.owner === owner) sparkles.step(dt);
      drawSparkles();
    });
    return bg;
  }

  // The pause menu (native 0x4d8c0). Its foreground (header, column, cursor) has a level of its own, each piece drawn at it
  // (0x4c370): up over 18 frames (0x4cba0) and down over 30. The background is the session's one MenuBgFade (0x49630, 0x4b880): its
  // sky and sparkles follow a level of their own at the same rates and its bands their own timer, without the level (N2-132). From
  // level 0 the cursor animation starts again (N2-133). Nothing reads a key or a press until the opening has finished, or once
  // the close has begun (only state 3 runs 0x4cea0, N2-135).
  // back: coming back from one of its screens (Config, Save, Load), under which the menu and its background stayed up (0x4d8c0
  // cases 5, 6 and 10 leave them; 9 and 0xc give the column the cursor again): no fade. flowBack: coming back from the flowchart
  // (state 0x10): the foreground alone returns over 12 frames, the row lighting at the end.
  // open: a column row (0 Save, 1 Load, 2 Config) chosen as soon as the menu is up (the quick bar's and the keys' way in).
  system({ back = false, flowBack = false, open = null } = {}) {
    const fresh = !back && !flowBack;
    const page = this.begin("system", { blur: true });
    if (fresh) {
      this.menuBg = new MenuBgFade(0, 0).set(MENU_FADE.open);
      (this.menuCursor ||= new MenuCursor()).opened();
    }
    const bg = (this.menuBg ||= new MenuBgFade(1, 1));
    this.menuBackground(page, { fade: bg });
    const fg = document.createElement("div");
    fg.className = "menufg";
    page.append(fg);
    // The opening's first step is taken in the frame of the press (0x40ed0 runs 0x4d8c0 at once; the page's first frame has no time in it).
    let level = back || flowBack ? (back ? 1 : 0) : MENU_FADE.open, rate = fresh ? MENU_FADE.open : flowBack ? MENU_FADE.flow : 0, done = null, opening = fresh;
    if (fresh) bg.step(1);
    const stage = document.getElementById("stage");
    const draw = () => {
      this.menuLevel = level;
      fg.style.setProperty("--lv", String(level));
      stage.style.setProperty("--under-menu", String(opening ? 1 - level : 0));   // the text window goes with the menu's rise
    };
    const busy = (on) => { this.menuBusy = on; page.style.pointerEvents = on ? "none" : ""; };
    const to = (r, fn) => { rate = r; done = fn; };
    draw();
    this.header(fg);
    this.column(fg, null);
    busy(!back);
    if (fresh) done = () => {   // 0x4cba0 at level 1: the background's level to 1 and its rate to 0
      opening = false; bg.level = 1; bg.set(0); busy(false);
      if (open !== null && this.items[open]) { this.select(open); this.choose(open); }
    };
    if (flowBack) done = () => { busy(false); this.select(this.menuRow ?? 0); };
    this.animate((dt) => {
      if (!rate) return;
      level = Math.max(0, Math.min(1, level + rate * dt));
      draw();
      if (level === (rate > 0 ? 1 : 0)) { const fn = done; rate = 0; done = null; fn?.(); }
    });
    // The fall of 1/30 a frame, with the background (states 4, 0x12, 0x15). At level 0 the background is off and the story sharp at
    // once (0x4b880 -> 0x2e030(0, 1)), even with the popup of state 0x12 still up.
    const waiting = [];
    let falling = false;
    const fall = (fn) => {
      falling = true;
      busy(true);
      bg.set(-MENU_FADE.close);
      to(-MENU_FADE.close, () => {
        document.getElementById("stage").classList.remove("menu-blur");
        for (const res of waiting.splice(0)) res();
        fn?.();
      });
    };
    this.menuFade = () => { if (!falling) fall(); };
    // Resolves when the menu has gone: the fall of state 0x15 (caption off at once, 0x4c370), unless the popup's wait has run it already.
    this.menuGone = () => new Promise((res) => {
      if (level === 0) { res(); return; }
      this.showCaption(null);
      waiting.push(res);
      if (!falling) fall();
      setTimeout(() => { for (const r of waiting.splice(0)) r(); }, 700);   // a hidden tab draws no frames
    });
    // Out to the flowchart (state 0xe): the foreground alone at 1/12 a frame, no row lit and the column's cursor going out; back the same way (0x10).
    this.menuFlowOut = (fn) => {
      busy(true);
      this.menuHidden = true;
      this.deselect();
      to(-MENU_FADE.flow, fn);
    };
    this.menuFlowIn = () => {
      this.menuHidden = false;
      to(MENU_FADE.flow, () => { busy(false); this.select(this.menuRow ?? 0); });
    };
    // Closing waits for the fade, or half a second and a bit when frames are not being drawn (a hidden tab).
    this.backFn = () => {
      if (falling) return;
      this.showCaption(null);
      fall(() => this.close());
      setTimeout(() => { if (level > 0 && this.screen === "system" && page.isConnected) this.close(); }, 600);
    };
    // The keys go on from the cursor's row. Opening, 0x4cba0 does not move it: no button is lit and no caption shows
    // until a key or the pointer moves the cursor (0x4cea0 lights the row it moves to), and A takes the row as it is.
    // Coming back from a screen (0x4d8c0 case 0xc) lights the row's button again.
    if (back) { this.select(this.menuRow ?? 0); return; }
    this.sel = this.menuRow ?? 0;
    for (const it of this.items) { it.el.setSelected?.(false); it.el.classList.remove("sel"); }
    this.showCaption(null);
  }

  // The wait of state 0x12 (native 0x4d710, from Return to Title with the automatic save written): the screen's picture fades
  // at 1/30 a frame (the menu's, 0x49630), and the next step waits until the popup has gone; A or a tap sends it on its way
  // (0x3b480). Resolves when it has gone (or after its longest life when frames are not being drawn).
  waitForPopup(busy, hurry) {
    this.menuFade?.();
    return new Promise((resolve) => {
      const keys = (e) => { if (e.key === "Enter" || e.key === " ") hurry(); return true; };
      this.keyFn = keys;
      const click = () => hurry();
      addEventListener("click", click, true);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        stop();
        clearTimeout(backstop);
        removeEventListener("click", click, true);
        if (this.keyFn === keys) this.keyFn = null;
        resolve();
      };
      const stop = frameLoop(() => { if (!busy()) finish(); });
      const backstop = setTimeout(finish, 2600);
    });
  }

  // Return to Title (native 0x4cea0 case 4): in normal play (F024 0) it asks nothing: the automatic save is made (with
  // its popup), the menu closes and the story fades to black at 0.02 a frame before the title. Only a gallery replay
  // asks dialog 8, "Return to Title Screen？", starting on Yes. leave: a screen open beside the column closes first (toTitle).
  returnToTitle(leave = (next) => next()) {
    const go = () => this.env.toTitle(true, { fromStory: true, fade: true, leave });
    if (!this.vm.replay) { go(); return; }
    this.dialog(this.message(8, "Return to Title Screen?"), go, null);
  }

  // The menu's FlowChart: a replay begun from the gallery's flowchart asks "End Scene Playback?" (dialog 12, starting
  // on Yes) and goes back to it; otherwise the menu's foreground fades out over 12 frames (state 0xe) and the flowchart opens
  // over the background left up, or, unless scene 1 is on this play's path and the current scene is not a Ciel-sensei episode
  // (533-557, table 0x3374ec; 0x1767c), "Flowchart is not yet available" (SYSMES 1496, cGameFlowchart state 3) shows there and the
  // foreground comes back as it closes (0x10). leave: a screen open beside the column closes first.
  flowchartFromMenu(leave = (next) => next()) {
    if (this.vm.replay && this.env.replayFrom?.() === "flowchart") { this.dialog(this.message(12, "End Scene Playback?"), () => this.env.endReplay(leave), null); return; }
    const f = this.vm.flow, open = f.path.has(1) && !(f.current >= 533 && f.current <= 557);
    leave(() => this.menuFlowOut(() => {
      if (open) { Promise.resolve(this.env.flowchart()).then(() => { if (this.screen === "system") this.menuFlowIn(); }); return; }   // (it could not be built: back to the menu)
      this.notify(this.vm.system?.messages?.["1496"] || "Flowchart is not yet available").then(() => this.menuFlowIn());
    }));
  }

  // A system dialog's question by its number (table 0x3c9340 -> SYSMES), as 0x49710 looks it up.
  message(dialog, fallback) {
    const n = this.vm.system?.dialogs?.[dialog];
    return (n >= 0 && this.vm.system?.messages?.[String(n)]) || fallback;
  }

  // A notice in the system's window (uifx.js NoticeFx, native 0x4abe0 / 0x49750 / 0x48540): "Saving", "Loading", "Flowchart
  // is not yet available"... No backdrop; it stays up to `hold` frames (480), A, B or a click closing it sooner; `held`
  // keeps it up until the caller closes it (the returned promise's close(), 0x4acd0). The screen's keys wait while it is up
  // and come back the moment it starts to close (0xb34b44 goes to 0 with state 3, N2-176). Resolves at that moment too:
  // the callers (0x50fc0 cases 7-9 and 0x13) go on while it fades out.
  // live: a function giving the text afresh each frame (the loading screen's count, main.js).
  notify(text, { hold = NOTICE.hold, held = false, live = null } = {}) {
    const fx = new NoticeFx(hold, held);
    // A notice still up goes as this one comes (0x4abe0: the other slot's state is set to 3, the lock cleared)
    this.noticeFx?.close();
    this.noticeFx = fx;
    const done = new Promise((res) => {
      const box = document.createElement("div");
      box.className = "dialog notice";
      const win = document.createElement("div");
      win.className = "dialog-win";
      win.append(sprite("DIALOG_PARTS_JA", "dialog_win", 0, 0, 824, 416));
      const q = document.createElement("div");
      q.className = "dialog-q";
      q.textContent = text.replace("^", "\n");
      box.append(win, q);
      this.overlay().prepend(box);
      const keep = this.keyFn;
      const keys = (e) => {
        if (e.key === "Enter" || e.key === " " || e.key === "Escape" || e.key === "Backspace") fx.press();
        return true;
      };
      this.keyFn = keys;
      box.addEventListener("click", (e) => { e.stopPropagation(); fx.press(); });
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        box.style.pointerEvents = "none";
        this.sysWindows?.delete(cancel);
        if (this.keyFn === keys) this.keyFn = keep;
        res();
      };
      const set = () => {
        win.style.opacity = String(fx.t);
        win.style.transform = `scale(${fx.scale})`;
        q.style.visibility = fx.t === 1 ? "visible" : "hidden";
        if (live) { const now = live(); if (now !== q.textContent) q.textContent = now; }
      };
      set();
      // (0x49750 also runs in the frame that opened it: frameLoop's first dt of 0 counts as that frame)
      const stop = this.sysLoop((dt) => {
        if (fx.closed) return;
        fx.step(dt || 1);
        set();
        if (!fx.busy) release();
        if (fx.closed) { stop(); box.remove(); }
      });
      const cancel = () => { if (fx.busy) { stop(); box.remove(); release(); } };
      (this.sysWindows ||= new Set()).add(cancel);
    });
    done.close = () => fx.close();
    return done;
  }

  // ---- save and load --------------------------------------------------------------------------------------
  // The list. Saving: the 100 slots in their order, each with its number, used or empty, the cursor starting on the slot
  // just written, else on the lowest empty one. Loading: every record there is, newest first, each named: the slots, the
  // quick save and the automatic saves. (The game's list, 0x50790, had only the slots in use, newest first, and reached
  // the automatic saves, slots 100-138, through Continue alone.) A row under the pointer is lit and a click takes it.
  // An empty slot saves at once with the "Saving" notice; a used one asks "Overwrite?" (dialog 2, starting on No);
  // loading asks "Load?" (dialog 0) and shows "Loading"; nothing to load shows "Data not Found" (0x50fc0).
  // Each row shows its chapter's savetitle cell (table 0x592484 by the save's F023) and its scene name (SYSMES 395 +
  // F022); the panel at the right the chapter's picture (table 0x3506b0 by F023 - 11, else saveinfobg_unknown).
  // opts.onBack: where Back goes instead (SELA's save screen returns to the story). opts.again: the list coming back after a save
  // (state 9): no fade, the cursor on the slot just written.
  // The screen has a level of its own, every piece drawn at it (0x4f240; --a in style.css): up over 42 frames (state 1) and down
  // over 21 (0x1b). The column and header beside it stay at full. Nothing reads a key or a press during either (N2-30). Closing
  // (state 5) empties the list first, so each row's picture and text and the panel go at once and only the empty row windows fade.
  // The list keeps its row while the column has the cursor, lit as it was (0xf1f450, 0x4f240); Left gives the column the cursor in
  // the story's Save and Load (not SELA's, not the title's); Right, or the column's own button, gives it back with the row's
  // flash. Page Up / Page Down move four rows, Home / End go to the first / last.
  savesScreen(mode, fromTitle = false, opts = {}) {
    const saves = this.saves();
    const page = this.begin(mode, { blur: !fromTitle, title: fromTitle ? "hold" : null });
    page.classList.add("savefx");
    let alpha = opts.again ? 1 : 0, state = opts.again ? "open" : "in", then = null;
    const level = () => page.style.setProperty("--a", String(alpha));
    const busy = (on) => { this.menuBusy = on; page.style.pointerEvents = on ? "none" : ""; };
    level();
    busy(state !== "open");
    // In the game the system menu's background stays up under Save and Load (0x4d8c0 cases 5 and 6 leave it; conf_BG,
    // which the port drew, is an empty texture). The title's Load and SELA's save screen raise it themselves, at the
    // screen's own 0.024 a frame (0x50e8c-0x50ebc), and lower it at that rate as they close (0x1b); the title's stops it
    // at the end of the screen's 21-frame close (0x49630(0): the level goes to 0 at once), SELA's leaves it falling.
    const ownBg = fromTitle || !!opts.onBack;
    const bgFade = !ownBg ? (this.menuBg ||= new MenuBgFade(1, 1)) : opts.again ? new MenuBgFade(1, 1) : new MenuBgFade(0, 0).set(CONFIG.rate);
    const bg = this.menuBackground(page, { fade: bgFade });
    if (fromTitle) this.holdTitle(bgFade);
    // the system menu's header and column only in the game (the title runs the save screen without the menu)
    if (!fromTitle) this.header(page);
    // the column under the save screen's backdrop: the menu is draw task 0x11 at priority 84 (0x4ca50), the save screen 0x16 at 100 (0x4ef00)
    const col = document.createElement("div");
    col.className = "colbox";
    page.append(col);
    page.append(sprite("SAVE_PARTS_JA", "config_innerbg", 360, 0, 1560, 1080, 0, 0, "savea"));
    if (!fromTitle) this.column(col, mode === "save" ? "Save" : "Load");
    const columnItems = this.items.length;
    const hasColumn = !fromTitle && !opts.onBack;
    let kept = 0, listHasCursor = true, rows = 0, flashing = true;   // kept: the list's row, whatever has the cursor
    const flashRow = (k) => {
      const f = this.items[columnItems + k]?.el.flash;
      if (f && flashing) { f.classList.remove("go"); void f.offsetWidth; f.classList.add("go"); }
    };
    // Opened by the story's "Save Progress?": only saving, then back to the story.
    if (opts.onBack) for (let k = 0; k < columnItems; k++) { this.items[k].fn = () => {}; this.items[k].sound = null; if (k !== 0) this.items[k].el.style.opacity = ".3"; }
    const T = this.vm.system?.saves;
    const f23 = (rec) => Number(rec?.vars?.F023) || 0;
    const info = document.createElement("div");
    info.className = "saveinfo";
    page.append(info);
    const list = document.createElement("div");
    list.className = "slotlist";
    page.append(list);
    let slotCount = 0;
    this.scrollBar(page, list, () => slotCount > 4);
    // The panel at the right shows a used slot's chapter picture and note, and nothing for an empty one (0x4f240: 0x50790's slot < 139).
    const showInfo = (rec) => {
      info.textContent = "";
      if (!rec) return;
      const k = f23(rec) - 11;
      const kind = T ? (k >= 0 && k < T.infoPictures.length ? T.infoPictures[k] : "saveinfobg_unknown")
        : /ARC/.test(rec.name) ? "saveinfobg_arc" : /CIEL/.test(rec.name) ? "saveinfobg_ciel" : "saveinfobg_unknown";
      info.append(sprite("SAVE_PARTS_JA", kind, 0, 0, 472, 892));
      const n = document.createElement("div");
      n.className = "savenote";
      n.textContent = rec.note || "";
      info.append(n);
    };
    // Up / Down step along the list and repeat, wrapping only on a fresh press (0x50fc0 state 2).
    const stepRow = (d) => (e) => {
      let to = this.sel - columnItems + d;
      if (to < 0 || to >= slotCount) { if (e?.repeat) return; to = (to + slotCount) % slotCount; }
      this.move(columnItems + to);
    };
    const toColumn = () => this.move(this.menuRow ?? 0);
    const closeScreen = (next) => {
      if (state === "out") return;
      state = "out";
      then = next;
      busy(true);
      if (ownBg) bgFade.set(-CONFIG.rate);
      if (fromTitle) this.env.titleHold?.(false);   // 0x519e8: 0x49630(-0.024) -> 0x1b20(0), the title's movie goes on
      page.classList.add("save-out");
      setTimeout(() => { if (state === "out" && then && page.isConnected) { const fn = then; then = null; if (fromTitle) bgFade.level = 0; fn(); } }, 1000);   // a hidden tab draws no frames
    };
    // label: the row's name (a slot's number, "Quick save"); auto: the automatic save's own art instead
    const row = (rec, act, { label = "", auto = false } = {}) => {
      const r = document.createElement("button");
      r.className = "slot";
      const cell = Object.assign(document.createElement("div"), { className: `slotbg ${rec ? "used" : "empty"}` });
      const flash = Object.assign(document.createElement("div"), { className: "slotflash" });
      r.append(cell, flash);
      r.flash = flash;
      const k = rows++;
      let title = null, titleBox = null;
      // The chosen slot's cell, then the same cell added at a flash that falls 0.2 a frame (native 0xf1f460). The row the list keeps
      // stays lit while the column has the cursor.
      r.setSelected = (on) => {
        if (on) kept = k;
        const was = cell.classList.contains("hi");
        const lit = on || (this.sel >= 0 && this.sel < columnItems && k === kept);
        cell.classList.toggle("hi", lit);
        if (on && !was) flashRow(k);
      };
      if (rec) {
        if (rec.thumb) {
          const im = document.createElement("img");
          im.src = rec.thumb; im.alt = "";
          r.append(im);
        }
        const d = new Date(rec.when);
        const p2 = (v) => String(v).padStart(2, "0");
        const date = document.createElement("div");
        date.className = "slotdigits";
        date.append(...digits("SAVE_PARTS_JA", "savedate_number", `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())}`, 0, 0));
        date.append(...digits("SAVE_PARTS_JA", "savetime_number", `${p2(d.getHours())}:${p2(d.getMinutes())}`, 320, 0));
        r.append(date);
        // The chapter, written out on one line in the look of the game's picture of it (savetitle's cells, 256 x 40, picked
        // by F023 as the header's are; the translation had to set the names small, some on two lines, to fit): the day in a
        // large light figure, the stroke, the name in a narrow face, larger than the picture's.
        let chapter;
        if (T) {
          chapter = menuChapter(T.phaseCells[Math.max(0, Math.min(37, f23(rec)))]);
          const scene = document.createElement("div");
          scene.className = "slotscene";
          scene.textContent = T.sceneNames[Number(rec.vars?.F022) || 0] || "";
          r.append(scene);
        } else {
          const [c, rr] = phaseOf(rec.name);
          chapter = chapterNamed(PHASE_NAMES[c][rr]);
        }
        if (chapter) {
          const t = document.createElement("div");
          t.className = "slottitle";
          if (chapter.day !== null) {
            t.append(Object.assign(document.createElement("span"), { className: "slot-day", textContent: String(chapter.day) }));
            t.append(Object.assign(document.createElement("span"), { className: "slot-stroke" }));
          }
          title = Object.assign(document.createElement("span"), { className: `slot-chapter${chapter.struck ? " struck" : ""}${chapter.day === null ? " alone" : ""}`, textContent: chapter.name });
          t.append(title);
          r.append(t);
          titleBox = t;
        }
      } else r.append(Object.assign(document.createElement("div"), { className: "slotempty", textContent: "Empty" }));
      if (auto) r.append(sprite("SAVE_PARTS_JA", "saveauto", 692, 125, 192, 32, 0, 0, "slotauto"));
      else if (label) r.append(Object.assign(document.createElement("div"), { className: "slotlabel", textContent: label }));
      const take = () => {   // the row takes the cursor back from the column
        showInfo(rec);
        if (listHasCursor) return;
        listHasCursor = true;
        flashRow(k);
      };
      list.append(this.add(r, act, { scroll: true, onSelect: take, sound: rec || mode === "save" ? 1 : null,
        up: stepRow(-1), down: stepRow(1), left: hasColumn ? toColumn : undefined }));
      // a long chapter name is set smaller, so that it ends before the row's own name at the right (No. 001, AUTO SAVE)
      if (title) for (let size = SLOT_TITLE.size; size > SLOT_TITLE.least && (titleBox.offsetWidth || 0) > SLOT_TITLE.room; ) title.style.fontSize = `${size -= 1}px`;
    };
    const slotName = (i) => `No. ${String(i + 1).padStart(3, "0")}`;
    const entries = [];   // { rec, kind: "slot" | "quick" | "auto", slot }
    if (mode === "save") for (let i = 0; i < 100; i++) entries.push({ rec: saves[i] || null, kind: "slot", slot: i });
    else {
      for (let i = 0; i < 100; i++) if (saves[i]) entries.push({ rec: saves[i], kind: "slot", slot: i });
      const quick = this.env.quickRecord?.();
      if (quick) entries.push({ rec: quick, kind: "quick" });
      for (const rec of this.autosaves()) if (rec) entries.push({ rec, kind: "auto" });
      entries.sort((a, b) => (b.rec.when || 0) - (a.rec.when || 0));
    }
    slotCount = entries.length;
    const load = (rec) => this.dialog(this.message(0, "Load?"), () => {
      // "Loading" held while the record is read (0x50fc0 case 0x12: 0x4abe0(184, 480) and 0x4abd0(1)); case 0x13 goes on as
      // soon as it has finished coming up (0x4ad30 no longer 1, the 16th frame) and closes it (0x4acd0)
      const loading = this.notify(this.vm.system?.messages?.["184"] || "Loading", { held: true });
      this.after(16, () => loading.close());
      // the screen goes on its 21-frame fade as the notice closes (0x13: 0x4acd0, then states 5 and 0x1b), and the menu with it at the end (result 2)
      // From the title the load goes on as Continue's does (0x8ea94 -> 0x8f2b0): with the screen gone the title stands alone, its logo
      // still down, while the music falls at 1.5 a frame (N2-128) and the picture goes to black at 0.01 a frame up to 1.2.
      const go = () => { this.env.titleVideo(false); this.close(); this.env.loadSave(rec); };
      loading.then(() => closeScreen(() => {
        const live = fromTitle ? this.titleLive : null;
        if (!live) { go(); return; }
        live.cover = { level: 1 };
        page.remove();
        this.audio.fadeBGMRate?.(TITLE_MUSIC.start);
        this.fadeBlack(this.blackout(live.page, 0), 1.2, 0.01, go);
      }));
    }, null);
    for (const { rec, kind, slot: i } of entries) {
      const act = () => {
        if (mode !== "save") { if (rec) load(rec); return; }
        const write = () => {
          const made = this.env.makeSave();
          if (!made) { this.sound(2); return; }   // no checkpoint yet (0xf17ff2)
          saves[i] = made;
          // "Saving" (0x50fc0 case 7 / 0xf: 0x4abe0(183, 1200), held by 0x4abd0(1)) stays at least 30 frames and until the
          // write is done (case 8), then closes with sound 1; the list comes back 40 frames later (case 9). A failed
          // write shows SYSMES 186 instead ("Saving Failed. / Data may be Corrupted.").
          try {
            localStorage.setItem(this.saveKey, JSON.stringify(saves));
            this.env.savedNow?.();
          } catch (e) {
            console.warn(e);
            this.notify(this.vm.system?.messages?.["186"] || "Saving Failed.^Data may be Corrupted.");
            return;
          }
          const saving = this.notify(this.vm.system?.messages?.["183"] || "Saving", { hold: 1200, held: true });
          this.after(30, () => { saving.close(); this.sound(1); });
          saving.then(() => { busy(true); this.after(40, () => this.savesScreen("save", false, { ...opts, again: true, slot: i })); });
        };
        if (rec) this.dialog(this.message(2, "Overwrite?"), write, null, { startNo: true });
        else write();
      };
      row(rec, act, kind === "slot" ? { label: slotName(i) } : kind === "quick" ? { label: "Quick save" } : { auto: true });
    }
    if (!entries.length) {
      const none = document.createElement("div");
      none.className = "slotnone";
      none.textContent = this.vm.system?.messages?.["212"] || "Data not Found";
      list.append(none);
    }
    this.helpBar(page, ["Back", "Choose", "Move", "Scroll"]);
    // The screen's fades (0x50fc0 states 1, 5 and 0x1b), and what follows the close (its result 2 or 3, 0x4d340; a column choice, 0x5912ec).
    this.animate((dt) => {
      if (state === "in") {
        alpha = Math.min(1, alpha + MENU_FADE.saveIn * dt);
        level();
        if (alpha === 1) { state = "open"; busy(false); if (ownBg) { bgFade.level = 1; bgFade.set(0); } }
      } else if (state === "out") {
        alpha = Math.max(0, alpha - MENU_FADE.saveOut * dt);
        level();
        if (alpha === 0 && then) { const fn = then; then = null; if (fromTitle) bgFade.level = 0; fn(); }
      }
    });
    this.backFn = () => closeScreen(opts.onBack ? () => { this.lowerOverStory(bg, bgFade); opts.onBack(); } : (() => (fromTitle ? this.titleBack() : this.system({ back: true }))));
    if (hasColumn) {
      // the column's hooks (0x4d340, 0x50ed0): Right or this screen's own button gives the list the cursor back on the row it kept, with
      // the row's flash; another choice closes the screen first
      const toList = () => { if (entries.length) { this.select(columnItems + kept); this.sound(0); } };
      this.screenFocus = toList;
      this.screenRight = toList;
      this.screenClose = (next) => closeScreen(next);
      this.columnTook = () => { if (entries.length) listHasCursor = false; };
    }
    // Page Up / Page Down move four rows (a screenful), Home / End go to the first / last row.
    this.keyFn = (e) => {
      const on = this.sel - columnItems;
      if (on < 0 || !slotCount) return false;
      const to = e.key === "Home" ? 0 : e.key === "End" ? slotCount - 1 : e.key === "PageUp" ? Math.max(0, on - 4) : e.key === "PageDown" ? Math.min(slotCount - 1, on + 4) : null;
      if (to === null) return false;
      this.move(columnItems + to);
      return true;
    };
    // The cursor's first row: saving, the slot just written (opts.slot), else the lowest empty one; loading, the newest record.
    let start = 0;
    if (mode === "save") start = Math.max(0, opts.slot ?? entries.findIndex((e) => !e.rec));
    flashing = false;
    this.select(entries.length ? columnItems + start : 0);
    flashing = true;
    showInfo(entries[start]?.rec);
    list.scrollTop = Math.max(0, (start - 1) * 226);   // in view, with the row before it above
  }

  // SELA's save screen has closed but its background goes on falling over the story (0x50fc0 state 0x1b leaves 0xb34b74 at
  // -0.024 unless at the title): it moves to the layer of windows, which a screen's close leaves, until it reaches 0.
  lowerOverStory(bg, fade) {
    if (!(fade.level > 0)) return;
    this.overlay().prepend(bg);
    const stop = this.sysLoop((dt) => {
      fade.step(dt);
      bg.redraw();
      if (fade.level === 0) { stop(); bg.remove(); }
    });
  }

  // ---- yes / no -------------------------------------------------------------------------------------------
  // The system's question (native 0x4ad40 / 0x49f00 / 0x4ae90; DialogFx has the timings): it opens with sound 3, the
  // window fading in as it settles from 1.2^2 of its size over a backdrop at 0.75; the question and buttons show once
  // it is open (their first lit button is already steady, its flash having run while it was unseen). Yes plays 1 and holds the
  // pressed button 15 frames, Back plays 2; the next step starts on the frame after the hold (0xb34b54 = 0), and the
  // window fades out by itself over what follows (0x4abe0 / 0x4ad40 open the next window in the other slot).
  // kind "story" is SELS and SELA (native 0x85900 / 0x85e40 draw them, 0x83e50 runs them): in and out at 0.1 a frame, the
  // backdrop at full, the window, question and buttons all fading together, nothing scaled as it opens and the window and
  // question shrinking by 0.05 as it goes (SELA's Yes, opts.saveAsk, keeps its size), no opening sound, no Back; they
  // answer when the fade has finished, as 0x83e50 state 4 ends the wait.
  // no: what No does; without one, No closes the dialog and gives the screen under it its cursor back. Both are called with
  // restore(): gives the screen its keys back.
  // startNo: the cursor starts on No (0x49710's second argument 1). The game's calls: No for Overwrite (2), Cancel
  // Saving (7), Quick Load (9), Jump to Next Scene (10), Return to Previous Scene (11), the backlog's Quick Jump (23),
  // Default (27) and the ending list's episodes (0xea4c); Yes for Load (0, 0x51af4), Return to Title (8, 0x4cea0), End
  // Scene Playback (12) and the flowchart's rewind (26).
  // The buttons follow the pointer's rule (ui.add): the one under the pointer takes the cursor (sound 0) and a click on it
  // answers; a right click is Back. (The game's touch rules, 0x49f00 and 0x85690 / 0x85c20, moved the cursor on a first tap
  // and answered on a second.) The keys work on the cursor. The hit boxes are the tables' (STORY_HIT, SYSTEM_HIT).
  // picture: a save's picture shown under the question (Quick Load, 0x89590; the question moves up to y 160 and the
  // buttons down to 261.5 of 448, the picture framed in black from y 200, about 72 x 52 units wide, 0x4ae90), as the
  // question shows only at t = 1.
  dialog(question, yes, no, { kind = "system", startNo = false, picture = null, saveAsk = false } = {}) {
    if (!this.root.querySelector(".page")) this.begin("dialog");
    const story = kind === "story";
    const prev = { items: this.items, sel: this.sel, backFn: this.backFn, backSound: this.backSound, horizontal: this.horizontal };
    const restore = () => { Object.assign(this, prev); if (prev.sel >= 0) this.select(prev.sel); };
    if (!no) no = (r) => r();
    const box = document.createElement("div");
    box.className = story ? "dialog story" : "dialog";
    const backdrop = sprite("DIALOG_PARTS_JA", "dialog_BG", 0, 0, 1920, 1080);
    const win = document.createElement("div");
    win.className = "dialog-win";
    win.append(sprite("DIALOG_PARTS_JA", "dialog_win", 0, 0, 824, 416));
    const q = document.createElement("div");
    q.className = "dialog-q";
    q.textContent = question;
    box.append(backdrop, win, q);
    let frame = null;
    if (picture) {
      q.style.top = `${437 - py(24)}px`;
      frame = document.createElement("div");
      frame.className = "dialog-pic";
      const im = document.createElement("img");
      im.src = picture; im.alt = "";
      frame.append(im);
      box.append(frame);
    }
    this.overlay().prepend(box);
    this.items = [];
    this.horizontal = true;
    const fx = new DialogFx(story ? "story" : "system");
    const keep = { keyFn: this.keyFn };
    let then = null, acted = false;
    const btns = [];
    // The buttons (native groups 15 and 13, tables 0x590f08 / 0x65bbc0): dialog_btn_ja cells 216 x 56 drawn from the
    // button's corner, normal in the right (white) column, lit in the left at rows 135 / 202, pressed in the right at
    // the same rows. The system's: Yes at (330, 249.01) and No at (252, 249.01) of 640 x 448, lit with the arrival
    // flash, a choice held pressed 10 frames (0xae040). The story's: No at (241, 238.52), Yes at (327, 238.52), no
    // flash (its flags are 0) and no hold. The element is the button's hit box, its art placed inside it.
    const img = `url("${url("DIALOG_PARTS_JA", "dialog_btn_ja")}")`;
    const mk = (isYes, fn) => {
      const cells = isYes ? { normal: [224, 0], lit: [0, 135], pressed: [224, 135] } : { normal: [224, 67], lit: [0, 202], pressed: [224, 202] };
      const at = story ? [isYes ? 327 : 241, 238.5183] : [isYes ? 330 : 252, picture ? 261.4554 : 249.0074];
      const hit = hitBoxPixels(at, story ? STORY_HIT : SYSTEM_HIT);
      const b = document.createElement("button");
      b.className = "spbtn";
      b.style.cssText = `left:${hit.left}px;top:${hit.top}px;width:${hit.right - hit.left}px;height:${hit.bottom - hit.top}px;`;
      const place = `left:${px(at[0]) - hit.left}px;top:${py(at[1]) - hit.top}px;width:216px;height:56px;background-image:${img};`;
      const art = document.createElement("div");
      art.className = "sp";
      art.style.cssText = place;
      const flash = document.createElement("div");
      flash.className = "sp fx-add";
      flash.style.cssText = `${place}background-position:${-cells.lit[0]}px ${-cells.lit[1]}px;opacity:0;`;
      b.append(art, flash);
      b.art = art; b.flash = flash; b.cells = cells; b.st = new ButtonState(); b.on = false;
      b.setSelected = (on) => { b.on = on; };
      // the pointer's rule (ui.add): the button under the pointer is lit, a click answers
      box.append(this.add(b, () => answer(fn === yes, true, b), { sound: 1, ready: () => fx.open }));
      btns.push(b);
    };
    const answer = (isYes, pressed, b) => {
      if (!fx.answerWith(isYes, pressed)) return;
      if (b && !story) b.st.pressFor(10);
      if (saveAsk && isYes) fx.keepSize = true;
      then = isYes ? yes : no;
      this.horizontal = false;
    };
    mk(false, no);
    mk(true, yes);
    box.addEventListener("click", (e) => e.stopPropagation());
    this.backFn = story ? () => {} : () => answer(false, false);
    this.backSound = story ? null : 2;
    // The story's questions (SELS, SELA) start with neither button selected (0x83b20 sets the cursor to -1), so A does
    // nothing until a direction or a press picks one; B is ignored.
    if (story) this.deselect(); else this.select(startNo ? 0 : 1);
    if (!story) this.sound(3);
    const set = (dt) => {
      backdrop.style.opacity = String((story ? 1 : DIALOG.backdrop) * fx.t);
      win.style.opacity = String(fx.t);
      win.style.transform = `scale(${fx.scale})`;
      if (story) {
        q.style.opacity = String(fx.t);
        q.style.transform = `scale(${fx.scale})`;
      } else {
        q.style.visibility = fx.t === 1 ? "visible" : "hidden";
        if (frame) frame.style.visibility = fx.t === 1 ? "visible" : "hidden";
      }
      const shown = story || fx.state === 2 || fx.state === 3;
      for (const b of btns) {
        b.style.visibility = shown ? "visible" : "hidden";
        if (story) b.style.opacity = String(fx.t);
        b.st.step(dt, b.on);
        const c = b.st.state === 4 ? b.cells.pressed : b.st.state & 1 ? b.cells.lit : b.cells.normal;
        b.art.style.backgroundPosition = `${-c[0]}px ${-c[1]}px`;
        b.flash.style.opacity = String(story ? 0 : b.st.flash);
      }
    };
    const keys = (e) => {
      if (!fx.open) return e.key.startsWith("Arrow") || e.key === "Enter" || e.key === " " || e.key === "Escape" || e.key === "Backspace";
      if (!story) return false;
      const to = storyDialogKey(this.items[this.sel]?.el.classList.contains("sel") ? this.sel : -1, e.key, !e.repeat);
      if (to === "decide") { if (this.items[this.sel]?.el.classList.contains("sel")) this.choose(this.sel); }
      else if (to !== null) this.move(to);
      return e.key.startsWith("Arrow") || e.key === "Enter" || e.key === " " || e.key === "Escape" || e.key === "Backspace";
    };
    // The caller's move (the frame after the hold; the story's, when the window has gone): its keys come back and the
    // screen under it goes on while this window fades.
    const act = () => {
      const fn = then;
      then = null;
      acted = true;
      this.sysWindows?.delete(cancel);
      if (this.keyFn === keys) this.keyFn = keep.keyFn;
      this.backSound = 2;
      fn(restore);
    };
    const cancel = () => {
      if (acted) return;
      stop();
      this.sysWindows?.delete(cancel);
      box.remove();
    };
    set(0);
    const stop = this.sysLoop((dt) => {
      fx.step(dt || 1);   // 0x49f00 also runs in the frame that opened it (frameLoop's first dt is 0)
      set(dt || 1);
      if (fx.closed) { stop(); box.remove(); }
      if (then && (story ? fx.closed : fx.acting)) act();
      else if (fx.state === 4) box.style.pointerEvents = "none";
    });
    (this.sysWindows ||= new Set()).add(cancel);
    // Keys go to the dialog only while it is open.
    this.keyFn = keys;
  }

  // No item selected (a question that starts with neither answer picked).
  deselect() {
    this.sel = -1;
    this.captionBox?.hide();
    for (const it of this.items) { it.el.setSelected?.(false); it.el.classList.remove("sel"); }
  }

  // The system's question over whatever is on screen (quick load asks "Quick Load?"): resolves true for Yes.
  // Asked from the mode panel (Quick Load, Jump to Next Scene, Return to Previous Scene) the panel stays down under the window
  // (0x4e170 state 5): No goes back to it, Yes sends it up (state 6 -> 4).
  confirmSystem(question, opts = {}) {
    return new Promise((res) => {
      if (this.open) { this.dialog(question, () => res(true), () => { res(false); }, opts); return; }
      const fromPanel = this.panelOpen;
      this.begin("dialog", { keepPanel: fromPanel });
      this.dialog(question, () => { this.close(); if (fromPanel) this.closePanel(); res(true); }, () => { this.close(); res(false); }, opts);
    });
  }

  // SELA: "Save Progress?" as the story asks it; Yes opens the save screen and resolves once it is closed.
  askSave(question) {
    return new Promise((res) => {
      const done = (yes) => { this.cancelChoice = null; this.close(); res(yes); };
      this.begin("confirm");
      this.dialog(question, () => this.savesScreen("save", false, { onBack: () => done(true) }), () => done(false), { kind: "story", saveAsk: true });
      this.cancelChoice = () => { this.cancelChoice = null; this.close(); };
    });
  }

  // A question the story asks (SELS): the engine's own yes / no window over the scene. A load or a rewind closes it
  // unanswered.
  confirm(question) {
    return new Promise((res) => {
      const answer = (yes) => { this.cancelChoice = null; this.close(); res(yes); };
      this.begin("confirm");
      this.dialog(question, () => answer(true), () => answer(false), { kind: "story" });
      this.cancelChoice = () => { this.cancelChoice = null; this.close(); };
    });
  }

  // ---- config ---------------------------------------------------------------------------------------------
  // The config (native 0x2b680 opens it, 0x2b930 runs it, 0x29bf0 moves its cursor, 0x2aa80 draws it with 0x2d570 /
  // 0x2d980 for its pages and 0x2cab0 for the digits; uifx.js CONFIG, configMove, configStep, sliderValue, SampleFx).
  // A page's widgets stand in rows (0x46cdb0: up to 26 rows of 5, in the cursor's order) under the tabs' row (System,
  // Sound, Controls, Default): minus, slider and plus (kinds 3-5), the on / off and Mute buttons (2), Test (1) and the
  // choices (6-10). Pointing at a widget moves the cursor there with sound 0 (0x29770); only keys scroll the page to it
  // (0x29bf0, the config's go).
  confWidget(body, el, row, col, fn, opts = {}) {
    const C = this.conf, i = this.items.length;
    C.cols[row] = Math.max(C.cols[row] || 0, col + 1);
    (C.grid[row] ||= [])[col] = i;
    body.append(this.add(el, fn, { tap: null, drag: true, ...opts, onSelect: () => { C.cur = { row, col }; C.colOf[row] = col; C.remember?.(); } }));
    return el;
  }

  // A config picture's address: the one made again with its words at one size (confart.js, main.js), else the art as it is.
  confTex(name) { return this.confArt?.[name] || url("CONF_PARTS_JA", name); }

  // A config widget as the engine's button system shows it (0xadca0 registers it from its definition, system.json
  // "config", 0xae840 gives it a state every frame, 0xaeec0 draws it): the cells of its state (0 normal, 1 lit, 2 on,
  // 3 lit and on; the config holds none pressed: its one 0xae040, the tab of a page change, is refused for a tab that is
  // on) at its place plus each cell's offset, the same cells again, added, at the flash that starts at 1 as it lights up
  // (0 -> 1, 2 -> 3) and falls 0.1 a frame, and its definition's hit box as the area the pointer presses (0xae840 tests
  // the pointer against it). x, y: its place (stage pixels). b.isOn: switched on; b.moveTo(x, y) moves it.
  confButton(id, x, y) {
    const def = this.vm.system?.config?.buttons?.[id];
    const b = document.createElement("button");
    b.className = "spbtn confbtn";
    b.lit = false;
    b.isOn = false;
    b.setSelected = (on) => { b.lit = on; };
    if (!def) { b.tick = () => {}; b.moveTo = () => {}; return b; }
    const [hx0, hy0, hx1, hy1] = def.hit;
    const art = document.createElement("div"), flash = document.createElement("div");
    art.className = "sp";
    flash.className = "sp fx-add";
    b.append(art, flash);
    const paint = (d, s) => {
      const c = def.states[s][0], [rx0, ry0, rx1, ry1] = c.rect;
      d.style.cssText = `left:${c.x - hx0}px;top:${c.y - hy0}px;width:${rx1 - rx0}px;height:${ry1 - ry0}px;` +
        `background-image:url("${this.confTex(c.tex)}");background-position:${-rx0}px ${-ry0}px;`;
    };
    b.moveTo = (nx, ny) => { b.style.cssText = `left:${nx + hx0}px;top:${ny + hy0}px;width:${hx1 - hx0}px;height:${hy1 - hy0}px;`; };
    b.moveTo(x, y);
    const st = b.st = new ButtonState();
    let shown = -1;
    b.tick = (dt) => {
      st.step(dt, b.lit, b.isOn);
      if (st.state !== shown) { shown = st.state; paint(art, shown); paint(flash, shown); }
      flash.style.opacity = String(st.flash);
    };
    b.confId = Number(id);
    b.placeY = y;
    b.tick(0);
    this.conf?.buttons.push(b);
    return b;
  }

  // A value in config_number_ja's digits (0x2d420): the units digit's left edge at x, each further digit 24 px to the
  // left, as many as the value has. Returns the setter.
  confDigits(parent, x, y) {
    const box = document.createElement("div");
    box.className = "confdigits";
    parent.append(box);
    let shown = null;
    return (v) => {
      v = Math.max(0, Math.trunc(v));
      if (v === shown) return;
      shown = v;
      box.textContent = "";
      [...String(v)].reverse().forEach((d, k) => box.append(sprite("CONF_PARTS_JA", "config_number_ja", x - k * CONFIG.digitStep, y,
        CONFIG.digit, CONFIG.digit, CONFIG.digit * Number(d), 0)));
    };
  }

  // Minus, slider and plus (kinds 3, 4, 5) of a row, each at its place in the page's grid ([minus, slider, plus]:
  // { id, x, y, col }): minus / plus step configStep(max) at a press and, held (A or the pointer on it), every frame
  // once CONFIG.hold frames have passed (0x2b930; nothing shows them pressed); the slider's knob stands at its place +
  // value / max x 508 px (169.33 units, 0x2aa80) and a press on its hit box holds it: it follows the pointer
  // (sliderValue, whole values) until the press lets go (0x2b930 kind 4, 0x46f818); A held with Left / Right steps it.
  // The value shows in digits on top, the units digit at (dx, dy) (0x2d570 / 0x2d980, drawn after the widgets).
  confSlider(body, top, row, [minusW, knobW, plusW], value, max, set, dx, dy) {
    const C = this.conf, span = CONFIG.track[1] - CONFIG.track[0];
    const knob = this.confButton(knobW.id, knobW.x, knobW.y);
    const digits = this.confDigits(top, dx, dy);
    let v = Math.round(value);
    const show = () => { knob.moveTo(knobW.x + (v / max) * span, knobW.y); digits(v); };
    const apply = (nv) => {
      nv = Math.min(max, Math.max(0, Math.trunc(nv)));
      if (nv !== v) { v = nv; set(v); }
      show();
    };
    const step = (d) => apply(v + d * configStep(max));
    const button = (w, dir) => {
      const b = this.confButton(w.id, w.x, w.y);
      b.step = () => step(dir);
      // a press steps once and starts the hold's counter (0x46f81c = 20)
      b.press = (pointer = false) => { step(dir); C.hold = { button: b, n: CONFIG.hold, pointer }; };
      b.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        // A finger (a touch device): the press may be the start of a drag of the page, so nothing steps yet. The tap steps
        // once (the click below); a finger that stays starts the hold's counter and then steps as a held press does.
        if (this.touch && e.pointerType === "touch") { b.finger = { repeated: false }; C.hold = { button: b, n: CONFIG.hold, pointer: true, finger: b.finger }; return; }
        e.stopPropagation();
        b.press(true);
      });
      b.addEventListener("click", () => { const f = b.finger; b.finger = null; if (f && !f.repeated) step(dir); }, true);
      // the pointer held on another widget is no longer on the cursor's (0x2b930 compares the two)
      b.addEventListener("pointerleave", () => { if (C.hold?.button === b && C.hold.pointer) C.hold = null; });
      return b;
    };
    const minus = button(minusW, -1), plus = button(plusW, 1);
    knob.step = step;
    // (the widgets' layer is the stage's width and starts at its left edge: read from it, the place holds when a touch device draws the screen larger)
    const stage = () => (this.touch ? body : document.getElementById("stage")).getBoundingClientRect();
    const fromPointer = (e) => { const r = stage(); apply(sliderValue(((e.clientX - r.left) * 1920) / (r.width || 1920), max)); };
    // A finger (a touch device) on the knob or the bar: which way it goes decides. Along the bar the knob follows it; up or
    // down, the page scrolls (touchDrag takes the press, or leaves it, by the same measure: e.sliderPress); lifted where it
    // came down, the knob goes there.
    const stageScale = () => document.getElementById("stage").getBoundingClientRect().width / 1920 || 1;
    const toKnob = () => { const i = C.grid[row]?.[knobW.col]; if (i !== undefined && this.sel !== i) this.move(i); };
    let finger = null;
    const fingerDown = (e, el) => {
      if (!this.touch || e.pointerType !== "touch") return false;
      finger = e.sliderPress = { x: e.clientX, y: e.clientY, el, id: e.pointerId, on: false };
      return true;
    };
    const fingerMove = (e) => {
      if (!finger || e.pointerId !== finger.id) return;
      if (!finger.on) {
        const dx = e.clientX - finger.x, dy = e.clientY - finger.y;
        if (Math.hypot(dx, dy) / stageScale() <= 6) return;
        if (Math.abs(dx) <= Math.abs(dy)) { finger = null; return; }
        finger.on = true;
        finger.el.setPointerCapture?.(finger.id);
        toKnob();
      }
      fromPointer(e);
    };
    const fingerUp = (e) => {
      if (!finger || e.pointerId !== finger.id) return;
      if (!finger.on && e.type === "pointerup") { toKnob(); fromPointer(e); }
      finger = null;
    };
    let dragging = false;
    knob.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (fingerDown(e, knob)) return;
      e.stopPropagation();
      dragging = true;
      knob.setPointerCapture?.(e.pointerId);
      fromPointer(e);
    });
    knob.addEventListener("pointermove", (e) => { if (dragging) fromPointer(e); else fingerMove(e); });
    const end = (e) => { dragging = false; fingerUp(e); };
    knob.addEventListener("pointerup", end);
    knob.addEventListener("pointercancel", end);
    for (const [el, kind, w] of [[minus, 3, minusW], [knob, 4, knobW], [plus, 5, plusW]]) {
      el.kind = kind;
      el.addEventListener("click", (e) => e.stopPropagation(), true);
      this.confWidget(body, el, row, w.col, () => {}, { sound: null });
    }
    // The bar itself takes the pointer: a press anywhere along it puts the knob there and holds it, as a press on the
    // knob does. It lies under the row's widgets (configScroll's order: the highest id first).
    const bar = document.createElement("div");
    bar.className = "conftrack";
    bar.confId = 1e6;
    const h = parseFloat(knob.style.height) || 48, pad = (parseFloat(knob.style.width) || 48) / 2;
    bar.style.cssText = `left:${CONFIG.track[0] - pad}px;top:${parseFloat(knob.style.top) || knobW.y}px;width:${span + 2 * pad}px;height:${h}px;`;
    let barDrag = false;
    bar.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (fingerDown(e, bar)) return;
      e.stopPropagation();
      barDrag = true;
      bar.setPointerCapture?.(e.pointerId);
      const i = C.grid[row]?.[knobW.col];
      if (i !== undefined) this.move(i);
      fromPointer(e);
    });
    bar.addEventListener("pointermove", (e) => { if (barDrag) fromPointer(e); else fingerMove(e); });
    const barEnd = (e) => { barDrag = false; fingerUp(e); };
    bar.addEventListener("pointerup", barEnd);
    bar.addEventListener("pointercancel", barEnd);
    bar.addEventListener("click", (e) => e.stopPropagation());
    body.append(bar);
    show();
  }

  // A choice of a group (kinds 6-10), on while it is the group's choice; choosing plays sound 1 (0x29500 then
  // 0xacef0(1)).
  radio(body, row, w, on, set, group) {
    const b = this.confButton(w.id, w.x, w.y);
    b.isOn = !!on;
    b.tick(0);
    this.confWidget(body, b, row, w.col, () => { for (const o of group) o.isOn = o === b; set(); });
    group.push(b);
    return b;
  }

  // An on / off button (kind 2): "Display whole text", "Display confirmation" and Mute; pressing it switches it and
  // plays sound 1 (0x29500(page, id, -1)).
  toggle(body, row, w, on, set, label = "") {
    const b = this.confButton(w.id, w.x, w.y);
    b.isOn = !!on;
    b.tick(0);
    if (label) b.setAttribute("aria-label", label);
    b.setAttribute("aria-pressed", String(b.isOn));
    this.confWidget(body, b, row, w.col, () => { b.isOn = !b.isOn; b.setAttribute("aria-pressed", String(b.isOn)); set(b.isOn); });
    return b;
  }

  // Test (kind 1, or the SE Test, widget 0x55): plays a sample, with no sound of its own.
  testButton(body, row, w, play, label) {
    const b = this.confButton(w.id, w.x, w.y);
    b.setAttribute("aria-label", label);
    this.confWidget(body, b, row, w.col, play, { sound: null });
    return b;
  }

  // A drag on the touch screen (native 0x40c, which the config, the CG grid, the Music list and the flowchart share; a
  // left press is a touch on PC): a press inside region ([x, y, w, h] on the stage, 0x6a0) that is not on a widget
  // (0x2b930 passes "nothing pointed" to 0x40c) and moves past 6 pixels drags; its velocity, in the touch screen's
  // 720-line pixels, is the largest -dy of a frame, multiplied by 0.9 every frame and dropped below 0.5 (DragFlick), so
  // it coasts after the release. Each frame onV(velocity) moves the screen's scroll by it. A drag is no click.
  touchDrag(el, region, onV, { widgets = "button" } = {}) {
    const stage = () => document.getElementById("stage").getBoundingClientRect();
    const scale = () => stage().width / 1920 || 1;
    const flick = new DragFlick();
    let press = null, dragged = false;
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const r = stage(), x = (e.clientX - r.left) / scale(), y = (e.clientY - r.top) / scale();
      const [rx, ry, rw, rh] = region || [0, 0, 1920, 1080];   // (no region: anywhere on the element)
      if (x < rx || x > rx + rw || y < ry || y > ry + rh) return;
      if (widgets && e.target.closest?.(widgets)) return;
      press = { x: e.clientX, y: e.clientY, cur: e.clientY, id: e.pointerId, slider: !!e.sliderPress };
      dragged = false;
    });
    el.addEventListener("pointermove", (e) => {
      if (!press) return;
      press.cur = e.clientY;
      if (!dragged && Math.hypot(e.clientX - press.x, e.clientY - press.y) / scale() > 6) {
        // (a finger that came down on a slider and goes along it is the slider's: confSlider)
        if (press.slider && Math.abs(e.clientX - press.x) > Math.abs(e.clientY - press.y)) { press = null; return; }
        dragged = true; el.setPointerCapture?.(press.id);
      }
    });
    const release = () => { press = null; setTimeout(() => { dragged = false; }); };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("click", (e) => { if (dragged) { e.stopPropagation(); e.preventDefault(); } }, true);
    const touchY = (clientY) => Math.floor(((clientY - stage().top) / scale()) * 720 / 1080);
    this.animate(() => {
      flick.step(press && dragged ? touchY(press.cur) : null, 0);
      if (flick.v) onV(flick.v);
    });
    return flick;
  }

  // The scrolling part of a config page: its pictures and widgets in stage coordinates, cut to CONFIG.clip (x 407-1809,
  // y 165-1023) and moved up by the page's scroll position as it is shown (ConfigScroll, from `at`, at once). Three
  // layers keep the engine's order: the page's pictures, the widgets (higher ids under lower ones: 0xaeec0 draws the
  // group from the last button down), then the digits, faces and names (0x2cab0, after the widgets). The scroll bar
  // shows on the pages that scroll (0x2aa80 fades it out where the range is 0) and goes with the position; a drag over
  // the clip not on a widget moves it by its velocity each frame (0x2b930: 0x6a0(407, 165, 1402, 858), then the
  // position + 0x6c4's value, held in range); so does the wheel, by its own distance (the game has none).
  configScroll(page, max, at = 0) {
    const box = document.createElement("div");
    box.className = "confscroll";
    const inner = document.createElement("div");
    inner.className = "confscroll-inner";
    const [under, widgets, over] = [0, 1, 2].map(() => Object.assign(document.createElement("div"), { className: "conflayer" }));
    inner.append(under, widgets, over);
    box.append(inner);
    page.append(box);
    const scroll = new ConfigScroll(max, at);
    const place = () => { inner.style.top = `${-CONFIG.clip[1] - scroll.shown()}px`; };
    place();
    this.animate((dt) => { scroll.step(dt); place(); });
    const scale = () => document.getElementById("stage").getBoundingClientRect().width / 1920 || 1;
    box.addEventListener("wheel", (e) => { e.preventDefault(); e.stopPropagation(); scroll.set(scroll.target + wheelPixels(e, scale())); }, { passive: false });
    // (a touch device draws the screen larger: the bar goes in a box that keeps its height, and a drag counts wherever the page is)
    const barBox = this.touch ? page.appendChild(Object.assign(document.createElement("div"), { className: "conf-bar" })) : page;
    this.scrollBar(barBox, { frac: () => (scroll.max ? scroll.target / scroll.max : 0), seek: (f) => scroll.set(f * scroll.max) }, () => scroll.max > 0);
    this.touchDrag(box, this.touch ? null : CONFIG.clip, (v) => scroll.set(scroll.target + v), this.touch ? { widgets: null } : {});
    // the widgets in the engine's order once the page is built
    const order = () => { for (const el of [...widgets.children].sort((a, b) => (b.confId ?? 0) - (a.confId ?? 0))) widgets.append(el); };
    return { under, widgets, over, scroll, order };
  }

  // The game's scroll bar beside a list (uifx.js SCROLLBAR / ScrollBarFx), following the list's scroll position while
  // visible() holds; a press on its strip scrolls the list there. list: an element that scrolls, or { frac(), seek(f) }
  // for a position of the screen's own (the backlog's page).
  scrollBar(page, list, visible = () => true) {
    const src = list.frac ? list : {
      frac: () => {
        const max = list.scrollHeight - list.clientHeight;
        return max > 0 ? Math.min(1, Math.max(0, list.scrollTop / max)) : 0;
      },
      seek: (f) => { list.scrollTop = f * Math.max(0, list.scrollHeight - list.clientHeight); },
    };
    const S = SCROLLBAR, [bx0, by0, bx1, by1] = S.barCell, [tx0, ty0, tx1, ty1] = S.thumbCell;
    const bar = sprite("DISP_PARTS_JA", "scroll_bar", px(S.bar[0]), py(S.bar[1]), bx1 - bx0, by1 - by0, bx0, by0, "scrollbar");
    const thumb = sprite("DISP_PARTS_JA", "scroll_slider", px(S.thumbX), py(S.top), tx1 - tx0, ty1 - ty0, tx0, ty0, "scrollbar");
    const strip = document.createElement("div");
    strip.className = "scrollstrip";
    const [sx0, sy0, sx1, sy1] = S.strip;
    strip.style.cssText = `left:${px(sx0)}px;top:${py(sy0)}px;width:${px(sx1 - sx0)}px;height:${py(sy1 - sy0)}px;`;
    page.append(bar, thumb, strip);
    const frac = () => src.frac();
    const fx = new ScrollBarFx(frac());
    let dragging = false;
    const dragTo = (e) => {
      const r = strip.getBoundingClientRect();
      src.seek(Math.min(1, Math.max(0, (e.clientY - r.top) / (r.height || 1))));
      fx.set(frac(), { now: true });
    };
    strip.addEventListener("pointerdown", (e) => {
      if (!visible()) return;
      e.stopPropagation();
      dragging = true;
      strip.setPointerCapture?.(e.pointerId);
      dragTo(e);
    });
    strip.addEventListener("pointermove", (e) => { if (dragging) dragTo(e); });
    const end = () => { dragging = false; };
    strip.addEventListener("pointerup", end);
    strip.addEventListener("pointercancel", end);
    let shown = null;
    const draw = (dt) => {
      const on = !!visible();
      if (on !== shown) { shown = on; for (const e of [bar, thumb, strip]) e.style.display = on ? "" : "none"; }
      fx.set(frac(), { now: dragging });   // the list's position, however it moved (keys, wheel, a drag)
      fx.step(dt);
      thumb.style.top = `${fx.thumbTop()}px`;
    };
    draw(0);
    this.animate(draw);
    return fx;
  }

  // The System page's samples (0x2d570, SampleFx): typed at the text speed set, in the "Text display" style, and started
  // again once the auto mode click wait has passed from the moment ten letters stand whole.
  typingSample(page, top, text, speedOf, fadeOf) {
    const d = document.createElement("div");
    d.className = "confsample";
    d.style.top = `${top}px`;
    const chars = [...text].map((c) => { const s = document.createElement("span"); s.textContent = c; d.append(s); return s; });
    page.append(d);
    const fx = new SampleFx();
    this.animate((dt) => {
      fx.step(dt, speedOf(), this.env.settings.autoClick || 0);
      const fade = fadeOf();
      chars.forEach((c, i) => {
        const f = fx.lo - i;
        c.style.opacity = String(f <= 0 ? 0 : fade ? Math.min(1, f) : 1);
      });
    });
  }

  // tab: "system", "sound" or "controls". The screen and its tabs come in at 0.024 a frame (0x2b770), a tab or L / R
  // changes the page through a cross-fade at 0.05 (0x29f00, 0x2c380), Back (or B) stops the Tests, plays sound 2 and
  // takes the screen out at 0.024 (0x2b5c0, 0x2c500). Under it the system menu's background: in the game it stays up from
  // the menu (0x4d8c0 case 10 leaves it), from the title the config raises it at 0.024 a frame and lowers it as it goes
  // (0x2b680, 0x2c500). Keys: the cursor moves on the page's grid (configMove), Enter presses (minus / plus held repeat;
  // Enter held with Left / Right steps a slider), Tab goes to the page after and Shift + Tab to the one before (the
  // pad's R / L), wrapping round. The pointer lights the widget under it; a click presses it, and a press anywhere on a
  // slider's bar puts the knob there.
  config(tab, fromTitle = false) {
    const TABS = ["system", "sound", "controls"];
    const page = this.begin("config", { blur: !fromTitle, title: fromTitle ? "hold" : null });
    const bgFade = fromTitle ? new MenuBgFade(0, 0).set(CONFIG.rate) : (this.menuBg ||= new MenuBgFade(1, 1));
    const bg = this.menuBackground(page, { fade: bgFade });
    if (fromTitle) this.holdTitle(bgFade);
    // the system menu's header and column only in the game: the title runs the config without the menu (0x8e200 calls
    // 0x2b460 / 0x2c810 itself), so from the title neither is drawn and nothing of the menu can be chosen
    if (!fromTitle) this.header(page);
    // The column goes first: the menu is draw task 0x11 at priority 84 (0x4ca50) and the config task 90 (0x2b010), so the config's
    // backdrop and help bar (0x2aa80) lie over it.
    const col = document.createElement("div");
    col.className = "colbox conf";   // left out on a touch device, where the config takes the screen's width (touch.css)
    page.append(col);
    const fg = document.createElement("div");
    fg.className = "conffg";
    page.append(fg);
    fg.append(sprite("CONF_PARTS_JA", "config_innerbg", CONFIG.innerBg[0], CONFIG.innerBg[1], 1560, 1080));
    if (!fromTitle) this.column(col, "Config");
    const columnItems = this.items.length;
    const C = this.conf = { grid: [], cols: [], colOf: [], cur: { row: 0, col: 0 }, tab: 0, hold: null, held: false, page: TABS.indexOf(tab),
      buttons: [], scroll: null };
    // What the engine keeps between pages and openings (static, for the whole run): each page's scroll position
    // (0xaed368), each page's row and each row's column (0x46cdb8, +0x898), and the tabs' row's one tab (0xaed328). The boot's
    // init 0x2b010 leaves System and Sound on row 0, column 0, Controls on the tabs' row, and that row on the System tab.
    const M = this.confMem ||= { scroll: [0, 0, 0], cur: [{ row: 0, col: 0 }, { row: 0, col: 0 }, { row: -1, col: 0 }], tab: 0 };
    C.remember = () => { M.cur[C.page] = { ...C.cur }; };
    fg.append(sprite("CONF_PARTS_JA", "tab_bg", CONFIG.tabBg[0], CONFIG.tabBg[1], 1416, 72));
    const tabItems = [];
    const tabOn = (k) => k === (C.next ?? C.page);
    // the tabs System, Sound, Controls (buttons 0x33-0x35, on for the page shown) and Reset (0x36) at their places
    const onTab = (r) => () => { C.cur = { row: -1, col: r }; C.tab = r; M.tab = r; M.cur[C.page] = { row: -1, col: r }; };
    TABS.forEach((t, r) => {
      const b = this.confButton(51 + r, CONFIG.tabs[r][0], CONFIG.tabs[r][1]);
      b.refresh = () => { b.isOn = tabOn(r); b.tick(0); };
      b.refresh();
      tabItems.push(this.items.length);
      fg.append(this.add(b, () => changePage(r - C.page), { tap: null, drag: true, sound: null, caption: this.captionText(CAPTIONS.tabs[r]), captionSize: CAPTIONS.size.tab,
        onSelect: onTab(r) }));
    });
    const def = this.confButton(54, CONFIG.tabs[3][0], CONFIG.tabs[3][1]);
    tabItems.push(this.items.length);
    // Default asks dialog 27 (SYSMES 160, its "^" a line break as the window draws it), starting on No, with only the
    // window's sound 3 (0x2bb88 calls 0x49710 and plays nothing itself).
    fg.append(this.add(def, () => this.dialog(this.message(27, "Change All Settings to Default.^Are you sure?").replace("^", "\n"),
      (restoreKeys) => { restoreKeys(); this.env.resetSettings(); build(); restore(); }, null, { startNo: true }), { tap: null, drag: true, sound: null,
      caption: this.captionText(CAPTIONS.tabs[3]), captionSize: CAPTIONS.size.default, onSelect: onTab(3) }));
    const tabButtons = C.buttons.slice();
    const pageBox = document.createElement("div");
    pageBox.className = "confpage";
    fg.append(pageBox);
    let help = null;
    const firstWidget = this.items.length;
    // the page's widgets go after the column's and the tabs' items; a new page takes their place
    let stopPage = null;
    const build = () => {
      this.items.length = firstWidget;
      C.grid = []; C.cols = []; C.colOf = []; C.hold = null;
      C.buttons = tabButtons.slice();
      C.scroll = null;
      pageBox.textContent = "";
      stopPage?.();
      // the page's own animations (samples, scroll bar) stop with it, and with the screen
      const keepFx = this.fx || [];
      this.fx = [];
      this.buildConfigPage(pageBox, TABS[C.page], fromTitle);
      const stops = this.fx;
      this.fx = [...keepFx, ...stops];
      stopPage = () => { for (const st of stops) st(); };
      help?.remove();
      help = document.createElement("div");
      (this.touch ? page : fg).append(help);   // (a touch device draws the screen larger; the band stays as it is)
      this.helpBar(help, C.page === 2 ? ["Back", "Change key", "Cursor movement", "Change page", "Scroll"] : ["Back", "Choose", "Cursor movement", "Change page", "Scroll"]);
      for (const k of tabItems.slice(0, 3)) this.items[k].el.refresh();
    };
    build();
    // The cursor as the page left it (0x2b770 on opening, 0x2c380 on a page change): the page's row and that row's
    // column, else, on the tabs' row, its one tab.
    const restore = () => {
      const cur = M.cur[C.page];
      const i = cur && cur.row >= 0 ? C.grid[cur.row]?.[cur.col] : undefined;
      if (i !== undefined) { C.colOf[cur.row] = cur.col; this.select(i); return; }
      this.select(tabItems[M.tab]);
    };
    // levels: the screen's (0xaed33c: its backdrop, tabs, help bar) and the page's (0xaed338)
    let level = 0, pageLevel = 0, state = "in", next = null, then = null;
    const draw = () => {
      fg.style.opacity = String(level);
      pageBox.style.opacity = String(pageLevel);
      if (this.touch && help) help.style.opacity = String(level);
    };
    draw();
    const changePage = (d) => {
      if (!d || state !== "open") return;
      next = C.next = (((C.page + d) % 3) + 3) % 3;   // 0x29f00 wraps round and turns the tabs over at once
      for (const k of tabItems.slice(0, 3)) this.items[k].el.refresh();
      state = "turn";
      this.sound(1);
    };
    // next: what follows the fade instead of the title or the system menu (a choice on the column, 0x4d580 -> 0x5912ec)
    const leave = (next) => {
      if (state !== "open") return;
      this.audio?.stopTests?.();   // 0x2b5c0: the SE Test (0x9cf90) and interface handle 4 (0x9b740(4))
      this.sound(2);
      state = "out";
      if (fromTitle) { bgFade.set(-CONFIG.rate); this.env.titleHold?.(false); }   // 0x2c558: 0x49630(-0.024) -> 0x1b20(0)
      then = typeof next === "function" ? next : () => (fromTitle ? this.titleBack() : this.system({ back: true }));
      setTimeout(() => { if (state === "out" && page.isConnected && then) { const fn = then; then = null; fn(); } }, 1000);
    };
    this.animate((dt) => {
      if (state === "in") {
        level = Math.min(1, level + CONFIG.rate * dt);
        pageLevel = level;
        // the cursor comes as the fade ends (0x2b770: it runs 0x29770 once the page's level has reached 1)
        if (level === 1) { state = "open"; if (fromTitle) bgFade.set(0); restore(); }
      } else if (state === "turn") {
        pageLevel = Math.max(0, pageLevel - CONFIG.pageRate * dt);
        if (pageLevel === 0) {
          C.page = next;
          C.next = null;
          build();
          restore();
          state = "turnin";
        }
      } else if (state === "turnin") {
        pageLevel = Math.min(1, pageLevel + CONFIG.pageRate * dt);
        if (pageLevel === 1) state = "open";
      } else if (state === "out") {
        level = Math.max(0, level - CONFIG.rate * dt);
        pageLevel = Math.min(pageLevel, level);
        if (level === 0 && then) { const fn = then; then = null; draw(); fn(); return; }
      }
      draw();
      // a minus or plus held (A or the pointer): its counter runs down a frame at a time, then it steps every frame
      // (0x2b930: 0x46f81c below 1 steps, else it counts down)
      const h = C.hold;
      if (h && (h.pointer || C.held)) {
        if (h.n < 1) { h.button.step(); if (h.finger) h.finger.repeated = true; }
        else h.n -= dt;
      }
      // every widget's state and flash (0xae840), and the page's scroll as the engine keeps it
      for (const b of C.buttons) b.tick(dt);
      if (C.scroll) M.scroll[C.page] = C.scroll.target;
    });
    const release = () => { C.hold = null; };
    addEventListener("pointerup", release);
    this.animate(() => { if (!page.isConnected) removeEventListener("pointerup", release); });
    const itemAt = ({ row, col }) => (row === -1 ? tabItems[col] : C.grid[row]?.[col]);
    const go = (to) => {
      if (to === "column") {
        // the system menu's column takes the cursor (state 7), on its row
        release();
        this.move(this.menuRow ?? 0);
        return;
      }
      if (!to) return;
      const i = itemAt(to);
      if (i === undefined) return;
      if (to.row >= 0) C.colOf[to.row] = to.col;
      this.move(i);
      // a move in the page's rows scrolls it to keep the widget in view (0x29bf0's end)
      const el = this.items[i].el;
      if (to.row >= 0 && C.scroll && el.placeY !== undefined) {
        C.scroll.set(configFollow(C.scroll.target, el.placeY, { max: C.scroll.max, voiceKnob: el.voiceKnob }));
      }
    };
    const onColumn = () => this.sel >= 0 && this.sel < columnItems;
    // The first stick (the pad's left stick, or Page Up / Page Down held: the PC build's SUP / SDOWN) scrolls the page
    // by -y / 3 a frame, y from -128 to 128 (0x2b930 with +0x1e not 0), and the directions wait while it is pushed.
    const sticks = new Set();
    let stick = 0;
    const stickKeys = (e) => {
      if (e.key !== "PageUp" && e.key !== "PageDown") return;
      if (e.type === "keydown") sticks.add(e.key); else sticks.delete(e.key);
    };
    addEventListener("keydown", stickKeys, true);
    addEventListener("keyup", stickKeys, true);
    this.animate(() => {
      if (!page.isConnected) { removeEventListener("keydown", stickKeys, true); removeEventListener("keyup", stickKeys, true); return; }
      const pads = globalThis.navigator?.getGamepads?.() || [];
      stick = 0;
      for (const pad of pads) {
        const v = pad && pad.mapping === "standard" ? pad.axes?.[1] ?? 0 : 0;
        if (Math.abs(v) >= 7849 / 32767) stick += Math.trunc(-v * 128);
      }
      if (sticks.has("PageUp")) stick += 128;
      if (sticks.has("PageDown")) stick -= 128;
      stick = Math.max(-128, Math.min(128, stick));
      if (stick && C.scroll && state === "open") C.scroll.set(C.scroll.target - Math.trunc(stick / 3));
    });
    const DIRS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
    this.keyFn = (e) => {
      if (state !== "open") return true;   // keys wait for the fades
      if (e.key === "PageUp" || e.key === "PageDown") return true;
      const k = e.key, dir = DIRS[k];
      if (dir && stick) return true;
      if (k === "Tab") { if (!e.repeat) changePage(e.shiftKey ? -1 : 1); return true; }   // the page after, or with Shift the one before
      if (onColumn()) {
        // on the column: its own keys (0x4cea0), except that Right gives the cursor back to the config
        if (dir === "right") { go(itemAt(C.cur) !== undefined ? C.cur : { row: -1, col: C.tab }); return true; }
        return false;
      }
      const it = this.items[this.sel];
      if (dir) {
        // A held on the slider: Left / Right step it (0x2b930 kind 4 with A held)
        if (C.held && it?.el.kind === 4 && (dir === "left" || dir === "right")) { it.el.step(dir === "left" ? -1 : 1); return true; }
        go(configMove(C.cols, C.cur, dir, { inGame: !fromTitle, colOf: C.colOf, tab: C.tab }));
        return true;
      }
      if (k === "Enter" || k === " ") {
        if (e.repeat) return true;
        C.held = true;
        if (it?.el.kind === 3 || it?.el.kind === 5) { it.el.press(); return true; }
        if (it?.el.kind === 4) return true;
        return false;   // the item's own action (ui.key's choose)
      }
      return false;
    };
    const keyUp = (e) => { if (e.key === "Enter" || e.key === " ") { C.held = false; if (C.hold && !C.hold.pointer) release(); } };
    addEventListener("keyup", keyUp, true);
    this.animate(() => { if (!page.isConnected) removeEventListener("keyup", keyUp, true); });
    this.backFn = () => leave();
    this.backSound = null;
    if (!fromTitle) {
      // the column's hooks (0x4d580): Config gives the page its cursor back (0x2c810(2): 0x29770 to the page's row and
      // column, sound 0); another choice closes the config first (0x2c810(1) -> 0x2b5c0, sound 2), then opens
      this.screenFocus = () => { if (state === "open") { restore(); this.sound(0); } };
      this.screenClose = (next) => leave(next);
    }
  }

  // The page's own widgets (0x2d570 System, 0x2d980 Sound, the Controls picture at (400, 176), 0x2aa80), in the grid's
  // rows (0x46cdb0).
  buildConfigPage(pageBox, tab, fromTitle) {
    const S = this.env.settings, A = this.audio, C = this.conf, M = this.confMem;
    const set = (k) => (v) => this.env.setSetting(k, v);
    const cfg = this.vm.system?.config;
    const n = ["system", "sound", "controls"].indexOf(tab);
    if (n === 2) { if (this.touch) this.buildTouchPage(pageBox); else this.buildControlsPage(pageBox); return; }
    if (!cfg) return;
    // the page's grid: each widget's kind, place and column, by id; each row's slider maximum
    const grid = cfg.pages[n].rows, at = {};
    grid.forEach((r, row) => r.widgets.forEach((w, col) => { at[w.id] = { ...w, row, col }; }));
    const sliderOf = (row) => [3, 4, 5].map((k) => grid[row].widgets.map((w, col) => ({ ...w, col })).find((w) => w.kind === k));
    const rows = n === 1 ? this.voiceRows(fromTitle) : [];
    // (a touch device shows less of the page at a time: what its shorter window hides is added to the range)
    const max = (n === 1 ? voiceScrollMax(rows.length) : cfg.pages[n].scrollMax) + (this.touch ? TOUCH.config.clip - TOUCH.config.height : 0);
    const page = this.configScroll(pageBox, max, M?.scroll[n] ?? 0);
    C.scroll = page.scroll;
    const { under, widgets, over } = page;
    const [bx, by] = CONFIG.pageBg;
    if (n === 0) {
      // system_bg (1432 x 1336); rows 0-11 of page 0's grid (widgets 0x37-0x4d)
      const sheet = sprite("CONF_PARTS_JA", "system_bg", bx, by, 1432, 1336);
      sheet.style.backgroundImage = `url("${this.confTex("system_bg")}")`;
      under.append(sheet);
      // the samples (SYSMES 138 / 139) at (757, 306) and (757, 485), typing in the "Text display" style
      const msg = (k, f) => this.vm.system?.messages?.[String(k)] || f;
      this.typingSample(under, 300, msg(138, "First Message Read"), () => S.textSpeed, () => S.fadeUnread !== false);
      this.typingSample(under, 480, msg(139, "Following Messages"), () => S.readSpeed, () => S.fadeUnread !== false);
      // the sliders' digits (0x2d570: config +0xe, +0x10, +0x5c, +0x1c)
      const [dx, dys] = CONFIG.systemDigits;
      [[S.textSpeed, "textSpeed"], [S.readSpeed, "readSpeed"], [S.autoPage, "autoPage"], [S.autoClick, "autoClick"]].forEach(([v, k], row) => {
        this.confSlider(widgets, over, row, sliderOf(row), v, grid[row].max, set(k), dx, dys[row]);
      });
      this.toggle(widgets, 0, at[57], S.wholeUnread, set("wholeUnread"), "Display whole text (unread)");
      this.toggle(widgets, 1, at[61], S.wholeRead, set("wholeRead"), "Display whole text (read)");
      const g = [];
      this.radio(widgets, 4, at[69], S.skipRead, () => this.env.setSetting("skipRead", true), g);
      this.toggle(widgets, 4, at[71], S.skipConfirm !== false, set("skipConfirm"), "Display confirmation");
      this.radio(widgets, 5, at[70], !S.skipRead, () => this.env.setSetting("skipRead", false), g);
      const ff = [];
      this.radio(widgets, 6, at[72], S.fastForward !== "read", () => this.env.setSetting("fastForward", "full"), ff);
      this.radio(widgets, 7, at[73], S.fastForward === "read", () => this.env.setSetting("fastForward", "read"), ff);
      // "Text display" (config +0x61, widgets 0x4a / 0x4b) and "Read text display" (+0x62, 0x4c / 0x4d: how earlier
      // lines go dim, "Fade out" / "Insta erasure")
      const td = [];
      this.radio(widgets, 8, at[74], S.fadeUnread !== false, () => this.env.setSetting("fadeUnread", true), td);
      this.radio(widgets, 9, at[75], S.fadeUnread === false, () => this.env.setSetting("fadeUnread", false), td);
      const rd = [];
      this.radio(widgets, 10, at[76], S.fadeRead !== false, () => this.env.setSetting("fadeRead", true), rd);
      this.radio(widgets, 11, at[77], S.fadeRead === false, () => this.env.setSetting("fadeRead", false), rd);
    } else {
      under.append(sprite("CONF_PARTS_JA", "sound_bg", bx, by, 1432, 328));
      // BGM, SE and menu volume (rows 0-2), each with Mute (config +4 / +8 / +10, mutes +0x64..0x66); SE has the Test
      // (0x55)
      const [dx, dys] = CONFIG.soundDigits;
      [["bgm", 80], ["se", 84], ["sys", 89]].forEach(([k, mute], row) => {
        this.confSlider(widgets, over, row, sliderOf(row), A.vol[k] * 100, grid[row].max, (v) => A.setVolume(k, v / 100), dx, dys[row]);
        this.toggle(widgets, row, at[mute], A.vol[`${k}Mute`], (on) => A.setVolume(`${k}Mute`, on), "Mute");
      });
      this.testButton(widgets, 1, at[85], () => { A.start(); A.playSeTest(); }, "Test sound effect");
      const V = CONFIG.voice, cell = (name, x, y, [x0, y0, x1, y1]) => sprite("CONF_PARTS_JA", name, x, y, x1 - x0, y1 - y0, x0, y0);
      // voice_bg: its head, a band a character row and its foot (0x2d980)
      under.append(cell("voice_bg", bx, V.head, V.cells.head));
      rows.forEach((r, k) => under.append(cell("voice_bg", bx, V.top + V.step * k, V.cells.row)));
      under.append(cell("voice_bg", bx, V.top + V.step * rows.length, V.cells.foot));
      const g = [], h = [];
      this.radio(widgets, 3, at[91], S.voiceOn, () => this.env.setSetting("voiceOn", true), g);
      this.radio(widgets, 4, at[92], !S.voiceOn, () => this.env.setSetting("voiceOn", false), g);
      this.radio(widgets, 5, at[93], S.voiceStop, () => this.env.setSetting("voiceStop", true), h);
      this.radio(widgets, 6, at[94], !S.voiceStop, () => this.env.setSetting("voiceStop", false), h);
      // The characters whose voices have played (0x29fa0), in grid row 7 + i: listed one under another from the
      // band's top, the face with the name under it, then volume, Mute and Test (0x2d980, 0x2d040).
      let samples = {};
      try { samples = JSON.parse(localStorage.getItem("tsuki.voiceSamples") || "{}"); } catch { /* none */ }
      const v = this.vm.system?.voices;
      rows.forEach(({ i, face, name }, k) => {
        const top = V.top + V.step * k, row = 7 + i;
        const placed = grid[row].widgets.map((w, col) => ({ ...w, col, x: V.widgets[col][0], y: top + V.widgets[col][1] }));
        if (v?.faces[face]) over.append(cell("conf_faceicon", V.face[0], top + V.face[1], v.faces[face]));
        if (v?.names[name]) over.append(cell("conf_name", V.name[0], top + V.name[1], v.names[name]));
        const of = (kind) => placed.find((w) => w.kind === kind);
        this.confSlider(widgets, over, row, [of(3), of(4), of(5)], A.vol.chars[i], grid[row].max, (val) => A.setCharacter(i, { volume: Math.round(val) }),
          V.digits[0], top + V.digits[1]);
        this.toggle(widgets, row, of(2), !A.vol.charOn[i], (on) => A.setCharacter(i, { on: !on }), "Mute");
        this.testButton(widgets, row, of(1), () => { A.start(); A.playTest("voice", samples[i], i); }, "Test voice");
      });
    }
    // a character row's slider counts from its row's line when the cursor brings it into view (0x29bf0)
    for (const b of C.buttons) if (b.confId >= 99 && b.confId <= 189 && (b.confId - 99) % 5 === 0) b.voiceKnob = true;
    page.order();
  }

  // The Controls page: the keyboard map (keys.js) with a button for each key, then the menus' fixed keys and the mouse.
  // (The game's page was a picture of the controller, conf_manual0_ja.) A click or Enter on a key waits for the next
  // key pressed and gives it to that action, taking it from any other; Esc leaves it as it was, Backspace or Delete
  // empties it. "Reset to defaults" puts the game's settings and these keys back.
  buildControlsPage(pageBox) {
    const C = this.conf, M = this.confMem, K = this.keys;
    const L = KEYPAGE, rowsY = L.top + L.head;
    const menuTop = rowsY + ACTIONS.length * L.row + L.gap, fixedRows = Math.max(MENU_KEYS.length, MOUSE.length);
    const height = menuTop + L.head + fixedRows * L.row + L.foot - CONFIG.clip[1];
    const page = this.configScroll(pageBox, Math.max(0, height - CONFIG.clip[3]), M?.scroll[2] ?? 0);
    C.scroll = page.scroll;
    const div = (cls, text, css) => { const d = document.createElement("div"); d.className = cls; if (text !== undefined) d.textContent = text; if (css) d.style.cssText = css; return d; };
    const head = (text, x, y, w) => page.under.append(div("keyhead", text, `left:${x}px;top:${y}px;width:${w}px;height:${L.head}px;line-height:${L.head}px;`));
    const line = (text, x, y, w) => page.under.append(div("keyrow", text, `left:${x}px;top:${y}px;width:${w}px;height:${L.row}px;line-height:${L.row}px;`));
    const cap = (text, x, y) => page.over.append(div("keycap", text, `left:${x}px;top:${y + (L.row - L.slot[1]) / 2}px;height:${L.slot[1]}px;line-height:${L.slot[1]}px;`));
    head("Keyboard", L.x, L.top, L.w);
    page.under.append(div("keynote", "Click a key to change it.  Esc cancels, Backspace clears.", `left:${L.x}px;top:${L.top}px;width:${L.w - 24}px;height:${L.head}px;line-height:${L.head}px;`));
    const slots = [];
    const refresh = () => { for (const s of slots) { const k = K?.keys(s.id)[s.slot]; s.el.textContent = k ? keyLabel(k) : "—"; s.el.classList.toggle("none", !k); } };
    // The next key pressed is the slot's; a press of the mouse anywhere leaves it.
    const bind = (s) => {
      if (!K || this.binding) return;
      const keep = this.keyFn;
      this.binding = true;
      s.el.classList.add("wait");
      s.el.textContent = "Press a key";
      const end = (sound) => {
        this.binding = false;
        this.keyFn = keep;
        s.el.classList.remove("wait");
        removeEventListener("pointerdown", cancel, true);
        refresh();
        if (sound !== undefined) this.sound(sound);
      };
      const cancel = () => end();
      this.keyFn = (e) => {
        const name = keyName(e);
        if (e.repeat) return true;
        if (name === "Escape") end(2);
        else if (name === "Backspace" || name === "Delete") { K.set(s.id, s.slot, null); end(1); }
        else if (canBind(name)) { K.set(s.id, s.slot, name); end(1); }
        return true;
      };
      setTimeout(() => { if (this.binding) addEventListener("pointerdown", cancel, true); });
    };
    ACTIONS.forEach((a, row) => {
      const y = rowsY + row * L.row;
      line(a.label, L.x, y, L.w);
      for (let slot = 0; slot < SLOTS; slot++) {
        const b = document.createElement("button");
        b.className = "keyslot";
        b.style.cssText = `left:${L.slotX[slot]}px;top:${y + (L.row - L.slot[1]) / 2}px;width:${L.slot[0]}px;height:${L.slot[1]}px;`;
        b.setAttribute("aria-label", `${a.label}, key ${slot + 1}`);
        b.setSelected = (on) => b.classList.toggle("sel", on);
        b.placeY = y;
        const s = { id: a.id, slot, el: b };
        slots.push(s);
        this.confWidget(page.widgets, b, row, slot, () => bind(s), { sound: 1 });
      }
    });
    refresh();
    // the keys that are the same on every menu, and the mouse, side by side
    const half = (L.w - L.gap) / 2, x2 = L.x + half + L.gap;
    head("Menus", L.x, menuTop, half);
    head("Mouse", x2, menuTop, half);
    MENU_KEYS.forEach(([label, keys], k) => {
      const y = menuTop + L.head + k * L.row;
      line(label, L.x, y, half);
      cap(keys.map(keyLabel).join(" / "), L.x + 300, y);
    });
    MOUSE.forEach(([label, what], k) => {
      const y = menuTop + L.head + k * L.row;
      line(label, x2, y, half);
      cap(what, x2 + 360, y);
    });
    page.order();
  }

  // The Controls page on a touch device: what a finger does (touch.js TOUCH_CONTROLS), in the rows of the keyboard's page.
  buildTouchPage(pageBox) {
    const C = this.conf, M = this.confMem, L = KEYPAGE, rowsY = L.top + L.head;
    const height = rowsY + TOUCH_CONTROLS.length * L.row + L.foot - CONFIG.clip[1];
    const page = this.configScroll(pageBox, Math.max(0, height - TOUCH.config.height), M?.scroll[2] ?? 0);
    C.scroll = page.scroll;
    const div = (cls, text, css) => { const d = document.createElement("div"); d.className = cls; d.textContent = text; d.style.cssText = css; return d; };
    page.under.append(div("keyhead", "Touch", `left:${L.x}px;top:${L.top}px;width:${L.w}px;height:${L.head}px;line-height:${L.head}px;`));
    TOUCH_CONTROLS.forEach(([label, how], k) => {
      const y = rowsY + k * L.row;
      page.under.append(div("keyrow", label, `left:${L.x}px;top:${y}px;width:${L.w}px;height:${L.row}px;line-height:${L.row}px;`));
      page.over.append(div("keycap", how, `left:${L.x + 520}px;top:${y + (L.row - L.slot[1]) / 2}px;height:${L.slot[1]}px;line-height:${L.slot[1]}px;`));
    });
    page.order();
  }

  // The sound page's character rows (native 0x29fa0): a row is listed once its voice has played (bit 4 of its global);
  // two faces need bit 1 and the names in the hidden set show "????" until a script sets bit 2. Shiki's row (0) depends
  // on where the config is opened. From the title (mode *0xae04e8 = 0) it waits on the story: scene 485 not started,
  // face 18 and "????"; scene 1 not started, face 19; else his own. In the game, on F023 and the script running
  // (*0xae04f0): F023 = 0 hides the row; script 1 (00_00) shows face 19; scripts 2-3 (00_01, 00_02) face 18 and
  // "????"; any other his own face and name.
  voiceRows(fromTitle = true) {
    const v = this.vm.system?.voices;
    if (!v) return [];
    const started = (n) => this.vm.flow.started.has(n);
    const rows = [];
    for (let i = 0; i < Math.min(CHARACTERS, v.rowFlags.length); i++) {
      const flag = this.vm.getVar(`G${String(v.rowFlags[i]).padStart(3, "0")}`);
      if (!(flag & 4)) continue;
      let face = i, name = i;
      if (i === 0 && !fromTitle) {
        if (!this.vm.getVar("F023")) continue;
        const k = this.vm.scriptIndex;
        face = k === 2 || k === 3 ? 18 : k === 1 ? 19 : 0;
        name = k === 2 || k === 3 ? 19 : 0;
      } else if (i === 0) {
        face = !started(485) ? 18 : !started(1) ? 19 : 0;
        name = !started(485) ? 19 : 0;
      } else {
        if ((i === 15 || i === 16) && !(flag & 1)) face = 18;
        if ((v.hiddenNames >> i) & 1 && !(flag & 2)) name = 19;
      }
      rows.push({ i, face, name });
    }
    return rows;
  }

  // ---- log -------------------------------------------------------------------------------------------------
  // The log, for a mouse: every page the text window has shown, the one on screen too, one under another as the window
  // drew them (renderLogPage), oldest at the top, opened at the newest. The wheel, a drag of the scroll bar and Page Up /
  // Page Down scroll it; scrolling down past its end closes it. The line under the pointer is lit, and Up / Down move the
  // same cursor. A click on a line (or Enter) asks Quick Jump (dialog 23, starting on No; sound 1 over the window's 3) and
  // goes back to that line, where the story still keeps that point; a line's note mark, or the Replay voice key, plays
  // its voice again. Esc, a right click or the Log key close it (sound 2).
  // (The game's backlog, 0x28f80, is a page viewer for the pad: one page at a time, starting on the page before the one on
  // screen, with Quick Jump only to a page's first line and no voices. Its veil, fades and sounds are kept: uifx.js BACKLOG.)
  backlog() {
    const T = this.text, pages = logPages(T.history, T.dropped);
    const page = this.begin("log", { blur: false });
    const div = (cls) => Object.assign(document.createElement("div"), { className: cls });
    const veil = div("logveil"), fg = div("logfg"), list = div("logscroll"), inner = div("loglist");
    list.append(inner);
    fg.append(list);
    page.append(veil, fg);
    let recs = [], cur = -1, alpha = 0, state = "in", then = null, nextPage = pages.length - 1;
    const scale = () => document.getElementById("stage").getBoundingClientRect().width / 1920 || 1;
    // The cursor to record k; the keys also bring it into view.
    const mark = (k, { scroll = false, quiet = false } = {}) => {
      if (k === cur || k < 0 || k >= recs.length) return;
      recs[cur]?.el.classList.remove("sel");
      cur = k;
      recs[k].el.classList.add("sel");
      if (!quiet) this.sound(0);
      if (!scroll) return;
      const r = recs[k].el.getBoundingClientRect(), b = list.getBoundingClientRect(), s = scale(), edge = 90 * s;
      if (r.top < b.top + edge) list.scrollTop -= (b.top + edge - r.top) / s;
      else if (r.bottom > b.bottom - edge) list.scrollTop += (r.bottom - (b.bottom - edge)) / s;
    };
    const play = (rec) => { if (rec?.r.voice) { this.audio.start?.(); this.audio.playVoice(rec.r.voice); } };
    const fadeOut = (fn) => {
      state = "out";
      then = fn;
      // a hidden tab draws no frames: go anyway after the fade's time and a bit
      setTimeout(() => { if (then === fn && page.isConnected) { then = null; fn(); } }, 600);
    };
    const leave = () => {
      if (state !== "open") return;
      this.sound(2);
      fadeOut(() => this.close());
    };
    const ask = (rec) => {
      if (state !== "open" || !rec) return;
      const choice = rec.r.kind === "choice";
      if (!this.vm.canJump(rec.r.seq, choice)) return;   // that point is no longer kept (or it is where the story stands)
      this.dialog(this.message(23, "Quick Jump?"), () => fadeOut(() => { this.close(); this.env.jumpBack(rec.r.seq, choice); }), null, { startNo: true });
      this.sound(1);
    };
    // A page goes into the list before it is laid out: the dashes of a run are drawn together by a distance measured for
    // the page's own face (textbox.js setDashJoin), which an element outside the document does not have yet.
    const renderPage = (records) => {
      const box = div("logpage"), made = [];
      inner.prepend(box);
      renderLogPage(box, records, (r) => {
        const el = document.createElement("span");
        el.className = "logrec";
        const rec = { r, el };
        if (this.vm.canJump(r.seq, r.kind === "choice")) el.classList.add("jump");
        if (r.voice && !r.glue) {
          const v = document.createElement("button");
          v.className = "logvoice";
          v.setAttribute("aria-label", "Replay voice");
          v.addEventListener("click", (e) => { e.stopPropagation(); if (state === "open") play(rec); });
          el.append(v);
        }
        el.addEventListener("pointermove", (e) => { if (e.pointerType !== "touch" && this.pointerMoved && state === "open") mark(recs.indexOf(rec)); });
        el.addEventListener("click", (e) => { e.stopPropagation(); if (state === "open") { mark(recs.indexOf(rec), { quiet: true }); ask(rec); } });
        made.push(rec);
        return el;
      });
      return { box, made };
    };
    // Older pages are laid out a few a frame, above what is shown, the view staying where it is. A browser with scroll anchoring keeps it there
    // by itself, and doing so here too moved the list twice the distance, back towards the newest line, under the wheel. It does not anchor at the very top.
    const anchors = !!globalThis.CSS?.supports?.("overflow-anchor", "auto");
    const more = (n) => {
      const before = list.scrollHeight, top = list.scrollTop, batch = [];
      for (let i = 0; i < n && nextPage >= 0; i++, nextPage--) {
        batch.unshift(...renderPage(pages[nextPage]).made);
      }
      if (!batch.length) return;
      recs = [...batch, ...recs];
      if (cur >= 0) cur += batch.length;
      if (!anchors || top <= 0) list.scrollTop += list.scrollHeight - before;
    };
    more(6);
    list.scrollTop = list.scrollHeight;
    this.sound(3);
    this.scrollBar(fg, list, () => list.scrollHeight > list.clientHeight + 1);
    this.helpBar(fg, ["Back", "Quick jump", "Replay voice", "Scroll"]);
    const set = () => { veil.style.opacity = String(BACKLOG.veil * alpha); fg.style.opacity = String(alpha); };
    set();
    this.animate((dt) => {
      if (nextPage >= 0) more(2);
      if (state === "in") { alpha = Math.min(1, alpha + BACKLOG.rate * dt); if (alpha === 1) state = "open"; }
      else if (state === "out") {
        alpha = Math.max(0, alpha - BACKLOG.rate * dt);
        if (alpha === 0 && then) { const fn = then; then = null; set(); fn(); return; }
      }
      set();
    });
    this.backFn = leave;
    this.backSound = null;
    const atEnd = () => list.scrollTop >= list.scrollHeight - list.clientHeight - 2;
    this.keyFn = (e) => {
      if (state !== "open") return true;   // keys wait for the fade (0x28f80 reads them only in state 5)
      const k = e.key;
      if (k === "ArrowUp" || k === "ArrowDown") {
        if (!recs.length) return true;
        mark(cur < 0 ? recs.length - 1 : Math.max(0, Math.min(recs.length - 1, cur + (k === "ArrowUp" ? -1 : 1))), { scroll: true });
      } else if (k === "PageUp") list.scrollTop -= LOG.page;
      else if (k === "PageDown") { if (atEnd() && !e.repeat) leave(); else list.scrollTop += LOG.page; }
      else if (k === "Home" || k === "ArrowLeft") { while (nextPage >= 0) more(8); list.scrollTop = 0; }
      else if (k === "End" || k === "ArrowRight") list.scrollTop = list.scrollHeight;
      else if (k === "Enter" || k === " ") { if (!e.repeat) ask(recs[cur]); }
      else if (this.keys?.action(e) === "voice") { if (!e.repeat) play(recs[cur]); }
      else if (this.keys?.action(e) === "log") { if (!e.repeat) leave(); }
      else return false;
      return true;
    };
    page.addEventListener("click", (e) => e.stopPropagation());
    // The wheel scrolls the list itself; turned on down at its end, it closes the log.
    let past = 0;
    page.addEventListener("wheel", (e) => {
      e.stopPropagation();
      if (state !== "open") return;
      past = e.deltaY > 0 && atEnd() ? past + e.deltaY : 0;
      if (past >= LOG.close) leave();
    }, { passive: true });
    // A finger moves the list itself; pulled on up from the newest line, it closes the log as the wheel does.
    if (this.touch) {
      let from = null;
      list.addEventListener("touchstart", (e) => { from = atEnd() && e.touches.length === 1 ? e.touches[0].clientY : null; }, { passive: true });
      list.addEventListener("touchmove", (e) => {
        if (from === null || state !== "open" || (from - e.touches[0].clientY) / scale() < LOG.close) return;
        from = null;
        leave();
      }, { passive: true });
    }
  }

  // ---- sounds ---------------------------------------------------------------------------------------------
  // The interface's own sounds (native 0xacef0): 0 cursor, 1 decide, 2 cancel, 3 a window opening, 4 a choice taken,
  // 6 start.
  sound(n) { this.audio?.playSys?.(n); }

  // ---- choices --------------------------------------------------------------------------------------------
  // As native 0x84e50 draws them (ChoiceFx in uifx.js has the timings): over a dark vignette, the labels typed out on
  // the text page's own rows from x 88 (640 x 448 units), a blank row below the text; the current row's label glows
  // (added again in cyan), an underline grows under it and a light streak pulses across it. Taking one plays sound 4,
  // and a ring turns and grows out of the row under a flash and a lens flare while everything fades.
  // list: the rows, { label, locked } (SELR's numbered text and third argument). Nothing is selected at first; the keys
  // and the wheel move the cursor as choiceStep describes, the pointer lights the row under it and a click takes it.
  // Resolves with the row taken.
  choices(list) {
    return new Promise((res) => {
      const box = document.getElementById("choices");
      box.textContent = "";
      const P = "SELECT_PARTS_JA";
      const add = (el) => { box.append(el); return el; };
      const bg = add(sprite(P, "altermenu__I____bg", 0, 0, 1929, 1083));
      const { pitch, next, used } = this.text.rows();
      const items = list.map((r) => (typeof r === "string" ? { label: r, locked: false } : r));
      // A blank row after the page's text (0x84e50 adds a row when the page has text). The rows stay on the stage.
      const top = Math.min(next + (used ? pitch : 0), 1080 - 40 - pitch * items.length);
      const labels = items.map((r) => r.label.replace(/@g/g, ""));
      // The rows type at the read text's speed (config +0x10), whatever the page's lines were. N2-80 took the unread speed from the
      // listing (0x84e50 reads slot 1 of the read flags, 0x3b2d0(1), and the one call that writes it, 0x80050, stores 0); native runs
      // say otherwise (TODO item 51): with unread 100 ms and read 250 ms the rows took 250 ms a letter after read lines and after
      // unread ones, and with read at 60 ms they took 60.
      const fx = new ChoiceFx(labels.length, ChoiceFx.perFrame(this.vm.readSpeed), items.map((r) => r.locked));
      const streak = add(sprite(P, "altermenu___", px(CHOICE.streak[0]), 0, 930, 243, 0, 0, "fx-add"));
      const line = add(sprite(P, "altermenu_underline", px(CHOICE.underline[0]), 0, 1455, 48, 0, 0, "fx-add stretch"));
      const rows = labels.map((label, i) => {
        const y = top + i * pitch;
        const row = document.createElement("button");
        row.className = "choice";
        row.style.cssText = `left:${px(CHOICE.labelX)}px;top:${y}px;height:${pitch}px;line-height:${pitch}px;`;
        // a span a letter, with the patch's italic letters drawn as the story draws them; the glow lies over the same letters
        const { chars } = fillSegment(row, label);
        const glow = document.createElement("span");
        glow.className = "choice-glow";
        for (const c of fillSegment(glow, label).chars) c.classList.add("on");
        row.append(glow);
        // A finger (the game's own touch rule, on touch devices): the row lights as it is pressed, and only a row that was lit
        // before the press is taken by its tap. The rows stand 28 px apart on a phone, and a choice is not lightly undone.
        let lit = true;
        row.addEventListener("pointerdown", (e) => {
          if (!this.touch || e.pointerType !== "touch" || fx.state === 2) return;
          lit = fx.cur === i;
          if (!lit && fx.move(i)) this.sound(0);
        });
        row.addEventListener("click", (e) => { e.stopPropagation(); if (this.touch && !lit && fx.state !== 2) { lit = true; return; } press(i); });
        // the row under a moving pointer takes the cursor (a row not yet opened cannot)
        row.addEventListener("pointermove", (e) => { if (e.pointerType !== "touch" && this.pointerMoved && fx.cur !== i && fx.move(i)) this.sound(0); });
        add(row);
        return { row, chars, glow, y, shown: 0 };
      });
      const ring = add(sprite(P, "altermenu______O", 0, 0, 982, 985, 0, 0, "fx-add"));
      const flash = add(sprite(P, "altermenu_flash", 0, 0, 1920, 1080, 0, 0, "fx-add"));
      const flare = add(sprite(P, "altermenu_lensflare", px(CHOICE.flare[0]), 0, 1920, 1920, 0, 0, "fx-add flare-tint"));
      for (const e of [ring, flash, flare]) e.style.opacity = "0";
      const lengths = rows.map((r) => r.chars.length);
      // Enter or a click while the labels type finishes them (state 2); then Enter takes the selected row and a click the
      // row clicked (the game's touch rule picked a row on the first tap and took it on the second).
      const press = (i) => {
        if (fx.state === 2) { fx.finishTyping(); fx.state = 3; return; }
        if (i !== undefined && fx.cur !== i && !fx.move(i)) return;
        if (fx.take()) this.sound(4);
      };
      box.onclick = (e) => { e.stopPropagation(); if (fx.state === 2) press(); };
      const DIRS = { ArrowDown: "down", ArrowUp: "up", ArrowLeft: "left", ArrowRight: "right" };
      const onKey = (e) => {
        if (DIRS[e.key]) fx.key(DIRS[e.key], !e.repeat);
        else if (e.key === "Enter" || e.key === " ") press();
        else return;
        e.preventDefault();
        e.stopPropagation();
      };
      // The wheel moves the cursor too, wrapping round (0x83e50 reads the wheel with the Up / Down keys).
      this.choiceWheel = (dy) => fx.key(dy < 0 ? "up" : "down", true, true);
      const stop = frameLoop((dt) => {
        fx.step(dt, lengths);
        bg.style.opacity = String(fx.alpha);
        rows.forEach((r, i) => {
          const want = fx.letters(i, r.chars.length);
          while (r.shown < want) r.chars[r.shown++].classList.add("on");
          // the labels are whole from the choice's first frame (native frames: a row's first letter at its full level at once);
          // the backdrop is what comes in. Once a row is taken they go with the screen.
          r.row.style.opacity = String(fx.state === 4 ? fx.alpha : 1);
          r.glow.style.opacity = String(fx.glow(i) / Math.max(fx.alpha, 1e-6));
          r.glow.classList.toggle("taken", fx.state === 4);
        });
        // The underline and the streak belong to the selected row; with none selected neither is drawn (0x84e50).
        const sel = rows[fx.cur];
        if (sel) {
          line.style.top = `${sel.y + py(CHOICE.underline[1])}px`;
          line.style.width = `${1455 * (fx.t * 0.9 + 0.1)}px`;
          streak.style.top = `${sel.y + py(CHOICE.streak[1])}px`;
        }
        line.style.opacity = sel ? String(fx.alpha * fx.t * 0.5) : "0";
        streak.style.opacity = sel ? String(fx.alpha * fx.pulse) : "0";
        if (fx.state === 4 && sel) {
          const k = fx.taken();
          ring.style.left = `${px(CHOICE.ring[0]) - 491}px`;
          ring.style.top = `${sel.y + py(CHOICE.ring[1]) - 492.5}px`;
          ring.style.transform = `scale(${k.scale}) rotate(${k.turn * 360}deg)`;
          flare.style.top = `${sel.y + py(CHOICE.flare[1])}px`;
          for (const e of [ring, flash, flare]) e.style.opacity = String(k.alpha);
        }
        if (fx.done) { finish(); res(fx.cur); }
      });
      // A load or a rewind while choosing: the choice goes away and is never answered.
      const finish = () => {
        stop();
        removeEventListener("keydown", onKey, true);
        box.style.display = "none";
        box.onclick = null;
        box.textContent = "";
        this.cancelChoice = null;
        this.choiceWheel = null;
      };
      this.cancelChoice = finish;
      addEventListener("keydown", onKey, true);
      box.style.display = "block";
    });
  }

  // ---- the quick bar, across the top of the story screen ---------------------------------------------------------
  // The game's mode panel (native 0x4e170 / 0x4de10: scene back, message back, auto, skip, scene on, quick save and
  // load, voice), with the log, hiding the text, save, load, config, full screen and the menu after them. Its buttons are
  // the panel's own (quickBarArt above): each plate at its game height, narrower so that fifteen stand where eight
  // did, in the panel's four looks (off, normal, under the cursor, on or pressed) with the arrival flash and the
  // 10-frame press (ButtonState). It comes down while the pointer is at the top of the picture, and any click sends it
  // up again; the Quick bar key (keys.js, Up by default) opens it for the keys, with Left / Right and Enter. A button's
  // caption, shown while the pointer is on it, names its key.
  buildPanel() {
    const E = this.env, vm = this.vm;
    const story = () => vm.running && !vm.choosing;
    const defs = [
      // The game's first and fifth buttons (0x4e170 results 3 and 7, run by 0x40ed0): see main.js.
      { id: "prevScene", art: 0, label: "Prev Scene", tip: "Return to Previous Scene", fn: () => E.previousScene(), can: () => !!vm.previousScene(false) },
      { id: "rewind", art: 1, label: "Rewind", tip: "Previous Message", fn: () => E.rewind(false), can: () => vm.canRewind(false) },
      { id: "auto", art: 2, label: "Auto", tip: "Auto Mode: ON / OFF", fn: () => E.toggleAuto(), on: () => vm.auto },
      { id: "skip", art: 3, label: "Skip", tip: "Skip Read Text: ON / OFF", fn: () => E.toggleSkip(false), can: () => !vm.choosing, on: () => vm.skipToggle },
      // Off in a replay started from the gallery's flowchart (0x4e0c0: button 0xd3 takes flag 2 while 0x50f0 holds, the section id 2 in
      // *0xae0288); a replay from the Ending List keeps it. Quick Save and Quick Load go off in any replay (0x47b10, F025).
      { id: "nextScene", art: 4, label: "Next Scene", tip: "Jump to Next Scene", fn: () => E.nextScene(), can: () => !vm.choosing && !vm.instant && !(vm.replay && vm.replaySource === "flowchart") },
      { id: "quickSave", art: 5, label: "Q.Save", tip: "Quick Save", fn: () => E.quickSave(), can: () => !vm.replay },
      { id: "quickLoad", art: 6, label: "Q.Load", tip: "Quick Load", fn: () => E.quickLoad(), can: () => E.hasQuickSave() && !vm.replay },
      // Always available (0x4e170 case 7 draws it like the others and plays *0xae0790 only when there is one): N2-79.
      { id: "voice", art: 7, label: "Voice", tip: "Replay Last Voice", fn: () => E.replayVoice() },
      { id: "log", label: "Log", tip: "Log", fn: () => E.log(), can: story },
      { id: "hide", label: "Hide", tip: "Hide Text (any click shows it again)", fn: () => { this.closePanel(); E.hideText(); } },
      { id: "save", label: "Save", tip: "Save", fn: () => E.menu(0), can: () => !vm.replay },
      { id: "load", label: "Load", tip: "Load", fn: () => E.menu(1), can: () => !vm.replay },
      { id: "config", label: "Config", tip: "Set Environment", fn: () => E.menu(2) },
      { id: "fullscreen", label: "Full", tip: "Full Screen: ON / OFF", fn: () => E.fullscreen(), on: () => !!document.fullscreenElement },
      { id: "menu", label: "Menu", tip: "System Menu", fn: () => E.menu() },
    ];
    // A touch device's control panel (touch.js TOUCH.bar): the same buttons, the game's plates uncut and larger, in three rows
    // of five on the strip made as high, each with its name under it (there is no pointer to rest on a button for a caption).
    const TB = this.touch ? TOUCH.bar : null;
    const el = document.createElement("div");
    el.className = TB ? "modepanel tp" : "modepanel";
    if (TB) el.append(...panelBack(TB.height)); else el.append(sprite("MODEPNL_PARTS_JA", "modepanel_window", 0, 0, 1920, 96));
    const panel = { el, defs, btns: [], open: false, keyboard: false, sel: -1, hover: -1, hideTimer: null, art: false };
    const B = panel.bar = TB || QUICK_BAR, x0 = Math.round((1920 - (defs.length * B.pitch - (B.pitch - B.w))) / 2);
    defs.forEach((d, i) => {
      const b = document.createElement("button");
      b.className = "qbtn r1";
      b.textContent = d.label;   // until the art is in, and where it cannot be made
      b.setAttribute("aria-label", d.tip);
      const [bx, by] = TB ? barPlace(i, TB) : [x0 + i * B.pitch, B.y];
      b.style.cssText = `left:${bx}px;top:${by}px;width:${B.w}px;height:${B.h}px;`;
      if (TB) b.append(Object.assign(document.createElement("div"), { className: "qname", textContent: TOUCH.names[d.id] || d.tip }));
      // the cell under the cursor again, added, at the arrival flash
      const lit = document.createElement("div");
      lit.className = "sp fx-add";
      lit.style.cssText = `left:0;top:0;width:${B.w}px;height:${B.h}px;opacity:0;`;
      b.append(lit);
      b.lit = lit;
      b.st = new ButtonState();
      b.addEventListener("pointermove", (e) => {
        if (e.pointerType === "touch" || !this.pointerMoved) return;
        panel.hover = i;
        if (panel.sel === i) return;
        if (!d.can || d.can()) this.sound(0);
        panel.sel = i;
      });
      b.addEventListener("pointerleave", () => { if (panel.hover === i) panel.hover = -1; if ((!panel.keyboard || TB) && panel.sel === i) panel.sel = -1; });
      b.addEventListener("pointerdown", (e) => { if (TB && e.pointerType === "touch") panel.sel = i; });   // a finger lights the plate it presses
      b.addEventListener("click", (e) => { e.stopPropagation(); this.pressPanel(i); this.dismissPanel(); });
      el.append(b);
      panel.btns.push(b);
    });
    // The caption of the button under the pointer (Caption), in the bar, so it comes and goes with it.
    panel.caption = new Caption();
    // Between the buttons is still the bar, not the text behind it; a click there sends the bar up like any other.
    el.addEventListener("click", (e) => { e.stopPropagation(); this.dismissPanel(); });
    el.addEventListener("pointerenter", () => clearTimeout(panel.hideTimer));
    el.addEventListener("pointerleave", () => {
      if (panel.keyboard) return;
      clearTimeout(panel.hideTimer);
      panel.hideTimer = setTimeout(() => this.closePanel(), 250);
    });
    document.getElementById("stage").append(el);
    this.panel = panel;
    panel.ready = quickBarArt(defs, B).then((sheet) => {
      if (!sheet) return;
      panel.art = true;
      panel.btns.forEach((b, i) => {
        b.style.backgroundImage = b.lit.style.backgroundImage = `url("${sheet}")`;
        b.lit.style.backgroundPosition = `${-i * B.w}px ${-2 * B.h}px`;
        b.row = null;
      });
      if (panel.open) this.renderPanel();
    });
  }

  get panelOpen() { return !!this.panel && this.panel.open; }

  // The Quick bar key opens it until closed (sound 3, as the game's panel came down). The mouse opens it at the top of the
  // picture, without the sound, for as long as it stays there (not again after a click, until the pointer has left the top).
  openPanel(keyboard = false) {
    if (!this.env.canPanel() || (!keyboard && this.panelHold)) return;
    if (!this.panel) this.buildPanel();
    const p = this.panel;
    clearTimeout(p.hideTimer);
    if (p.open) return;
    if (keyboard) this.sound(3);
    p.open = true;
    p.keyboard = keyboard;
    p.sel = keyboard && !this.touch ? p.defs.findIndex((d) => d.id === "auto") : -1;   // (a finger has no cursor to start on)
    p.hover = -1;
    this.renderPanel();
    p.el.classList.add("on");
  }

  closePanel() {
    const p = this.panel;
    if (!p || !p.open) return;
    clearTimeout(p.hideTimer);
    p.open = false;
    p.sel = p.hover = -1;
    p.caption.hide();
    p.el.classList.remove("on");
  }

  // A click anywhere sends the bar up, and the pointer resting at the top does not bring it straight back.
  dismissPanel() {
    if (!this.panelOpen) return false;
    this.closePanel();
    this.panelHold = true;
    return true;
  }

  modePanel() {
    if (this.panelOpen) this.closePanel();
    else this.openPanel(true);
  }

  // A button plays sound 1 and stays pressed 10 frames (native 0x4e170, 0xae040), or plays 2 when it can do nothing now.
  pressPanel(i) {
    const d = this.panel.defs[i];
    this.audio.start();
    if (!d.can || d.can()) { this.sound(1); this.panel.btns[i].st?.pressFor(10); d.fn(); } else this.sound(2);
    if (this.panelOpen) this.renderPanel();
  }

  // A button's caption: what it does and its key.
  panelTip(d) {
    const key = this.keys?.label(d.id);
    return key ? `${d.tip}  [${key}]` : d.tip;
  }

  renderPanel() {
    const p = this.panel, B = p.bar;
    const tip = p.hover >= 0 && p.defs[p.hover] ? this.panelTip(p.defs[p.hover]) : null;
    if (tip) p.caption.show(`${p.hover}:${tip}`, tip, p.btns[p.hover], [B.w / 3, B.h / (1080 / 448)]);
    else p.caption.hide();
    p.defs.forEach((d, i) => {
      const b = p.btns[i];
      const enabled = !d.can || d.can();
      const row = !enabled ? 0 : b.st?.state === 4 || (d.on && d.on()) ? 3 : p.sel === i ? 2 : 1;
      if (b.row === row) return;
      b.row = row;
      b.className = `qbtn r${row}${p.art ? " art" : ""}`;
      b.setAttribute("aria-disabled", String(!enabled));
      if (p.art) b.style.backgroundPosition = `${-i * B.w}px ${-row * B.h}px`;
    });
  }

  // Every frame while open: what the buttons can do changes as the story moves.
  panelTick() {
    if (!this.panelOpen) { this.panelAt = null; return; }
    // The buttons' own states (ButtonState; native group 14 has the arrival flash): the lit cell added as a button
    // lights up, and a pressed button held 10 frames.
    const now = performance.now(), dt = this.panelAt == null ? 0 : Math.min(30, ((now - this.panelAt) * 60) / 1000);
    this.panelAt = now;
    this.panel.defs.forEach((d, i) => {
      const b = this.panel.btns[i];
      b.st.step(dt, i === this.panel.sel && (!d.can || d.can()));
      b.lit.style.opacity = String(this.panel.art ? b.st.flash : 0);
    });
    if (!this.env.canPanel()) this.closePanel();
    else this.renderPanel();
  }

  // Keys for a bar opened by its key. True if the key was for the bar.
  panelKey(e) {
    const p = this.panel;
    if (!this.panelOpen || !p.keyboard) return false;
    const k = e.key;
    if (k === "ArrowLeft" || k === "ArrowRight") {
      const dir = k === "ArrowLeft" ? -1 : 1, n = p.defs.length;
      let i = p.sel;
      for (let tries = 0; tries < n; tries++) {
        i = (i + dir + n) % n;
        const d = p.defs[i];
        if (!d.can || d.can()) break;
      }
      if (i !== p.sel) this.sound(0);
      p.sel = i;
    } else if (k === "Enter" || k === " ") {
      if (p.sel >= 0) this.pressPanel(p.sel);
    } else if (k === "ArrowUp" || k === "ArrowDown" || k === "Backspace" || k === "Escape" || this.keys?.action(e) === "bar") {
      this.sound(2);
      this.closePanel();
    } else return false;
    return true;
  }
}
