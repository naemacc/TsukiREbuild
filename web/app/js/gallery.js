// gallery.js - the gallery as the game has it: one screen with the column at the left (CG Gallery, Music Player,
// Flowchart, Movie, Ending List, Title) and the chosen section beside it. Tables come from web/assets/gallery.json
// (tools/build_gallery.py); what is unlocked comes from vm.unlocks. Positions are measured from the game.
import { sprite } from "./ui.js";
import { LAYOUT as END, endingList } from "./endings.js";
import { ButtonState, EASE, GALLERY_OPEN, MenuBgFade, Tween, fadeIn, fadeOut, wheelPixels } from "./uifx.js";
import { cgLists, musicUnlocked } from "./unlocks.js";
import { TOUCH, pinch } from "./touch.js";

const P = "GALLERY_PARTS_JA";
const url = (pack, name) => `/assets/ui/${pack}/${name}.webp`;
const ITEMS = ["cg", "music", "flowchart", "movie", "ending", "title"];
const TITLES = { cg: "cg_title", music: "music_title", movie: "movie_title", ending: "ending_title" };
// Native 0xAF78: a 6-column grid at x 392 + 240c, y 109 + 139r; thumbnails are atlas cells (154 x 87) at 1.5x.
const GRID = { x: 392, y: 109, dx: 240, dy: 139, columns: 6, rows: 6 };
const THUMB = { w: 231, h: 130, atlasW: 5544 * 1.5, atlasH: 4840 * 1.5, cellW: 154 * 1.5, cellH: 88 * 1.5, perRow: 36 };
const MUSIC = { x: 437, top: 154.4, pitch: 59.1, rows: 15, sliderX0: 1401, sliderX1: 1784, posY: 434, volY: 802 };
// The panel's buttons (0x1b7d8: the button list 0x469ac0, ids 0x181-0x186) are 88 x 80 cells of music_controlbtn,
// top-left at these places; button k's art is at x 8 + 96 k, its normal row at y 8 and its selected row at y 96.
// Play, Pause and Repeat when on get a sprite of the row at y 184 over them (+0x90 / +0x98 / +0xa0, z 570, shown by
// 0x1dec4 / 0x1dc40 / 0x1f380 / 0x1c400); a press of Stop, Prev or Next flashes the selected row over the button
// (+0x88, z 560; 0x1e98c, tables 0x34d340 / 0x34d370).
export const CONTROLS = { play: [1432, 576], pause: [1512, 576], stop: [1592, 576], repeat: [1672, 576], prev: [1512, 656], next: [1592, 656] };
const BUTTONS = ["play", "pause", "stop", "repeat", "prev", "next"];   // the panel's +0x3c (0x1e98c cases 0-5)
export const CONTROL_CELL = { w: 88, h: 80, x: 8, dx: 96, rows: [8, 96, 184] };
const SW = 1920, SH = 1080, UNIT = SH / 448;
// How far the lists move for the wheel's own distance (the browser's, in stage pixels): a little under one for one.
export const WHEEL_GAIN = 0.8;

// What belongs to the running game only, kept for this page and not stored: the Music Player's volume (0.6 at
// 0x469c10) and repeat (0xae0370, in .bss), and the section the gallery was left on (*0xae0288, -1 at start: 0x49b0
// keeps the open section's id when the column ends and 0x6124 opens on it, or on the CG Gallery when it is negative; the
// column's Title row closes the section first, so it leaves -1, a Back from the column keeps it, N2-56).
export const session = { volume: 0.6, repeat: false, section: null };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function place(e, x, y, w, h) {
  e.style.left = `${x}px`; e.style.top = `${y}px`;
  if (w !== undefined) e.style.width = `${w}px`;
  if (h !== undefined) e.style.height = `${h}px`;
  return e;
}

// ---- the CG grid's rules (native grid class 0x9578: keys 0x9cbc, scroll 0xa968, build 0xaf78, cascade 0xb318) -------
// Cells at (392 + 240c, 109 + 139r) less the scroll, drawn between y 109 and 1014 (6.5 rows). Left on column 0 hands
// the cursor to the gallery's column (vtable +0x50, 0xaca0); Right stops at column 5 and at the last cell; Up stops at
// row 0; Down stops at the last row, and when the cell below is empty.
export const CG_GRID = { top: 109, bottom: 1014, low: 804, high: 178.5, scrollTime: 1 / 6, cascade: 0.02, fadeTime: 0.5 };
export function cgGridKey(count, sel, key) {
  const c = sel % 6, r = Math.floor(sel / 6), rows = Math.ceil(count / 6);
  if (key === "ArrowLeft") return c === 0 ? { column: true } : { sel: sel - 1 };
  if (key === "ArrowRight") return c < 5 && sel + 1 < count ? { sel: sel + 1 } : null;
  if (key === "ArrowUp") return r > 0 ? { sel: sel - 6 } : null;
  if (key === "ArrowDown") {
    if (r >= rows - 1) return null;
    const to = c + (r + 1) * 6 < count ? r + 1 : r;
    return to === r ? null : { sel: c + to * 6 };
  }
  return null;
}
// Where a move scrolls the grid (0xa968), as the amount scrolled: a row going down past 804 comes to 804 (the last row
// to 873.5, so that it shows whole), a row going up above 178.5 comes to 178.5 (row 0 to the top); null: no scroll.
// The scroller keeps it within 0 and the last row's place (0xaf78 -> 0x276b0, 0x27bd4).
export const cgScrollMax = (rows) => Math.max(0, (rows - 6) * 139 - 69.5);
export function cgScrollTarget(row, prevRow, scroll, rows) {
  const y = 109 + 139 * row - scroll;
  let to = null;
  if (prevRow < row && y > CG_GRID.low) to = row === rows - 1 ? (row - 5) * 139 - 69.5 : (row - 5) * 139;
  else if (prevRow > row && y < CG_GRID.high) to = row === 0 ? 0 : (row - 1) * 139 + 69.5;
  return to === null ? null : Math.min(cgScrollMax(rows), Math.max(0, to));
}
// The lists' scroll bar (the scroll-bar widget 0x276b0, made by the CG grid 0xaf78 and the Music list 0x1a1a4):
// DISP_PARTS_JA scroll_bar whole (16 x 888) top-left at (1847, 105) and the unlit cell of scroll_slider ((48, 24),
// 32 x 288) top-left at x 1839, y 99 + 610 x value / max (0x2788c, every frame); both hidden when the list cannot
// scroll (max 0 or less). The CG grid's max is cgScrollMax and its value the grid's scroll (0xa720 reads it back).
export const SCROLL_BAR = { x: 1847, y: 105, thumbX: 1839, top: 99, travel: 610 };
export const scrollThumbY = (value, max) => SCROLL_BAR.top + (max > 0 ? (Math.min(max, Math.max(0, value)) / max) * SCROLL_BAR.travel : 0);
export function scrollBar(parent) {
  const bar = sprite("DISP_PARTS_JA", "scroll_bar", SCROLL_BAR.x, SCROLL_BAR.y, 16, 888);
  const thumb = sprite("DISP_PARTS_JA", "scroll_slider", SCROLL_BAR.thumbX, SCROLL_BAR.top, 32, 288, 48, 24, "gl-scroll-thumb");
  parent.append(bar, thumb);
  return {
    bar, thumb,
    set(value, max) {
      bar.style.display = thumb.style.display = max > 0 ? "" : "none";
      thumb.style.top = `${scrollThumbY(value, max)}px`;
    },
  };
}
// The grid cursor's light (0x9578 +0x68), at f frames after the cursor was placed (0xa968: a move, the grid opening,
// the focus coming back): its alpha is set to 1 and its program 0x337380 (op 19: alpha to -1 over 30 frames) runs it
// down in a straight line, as the program interpreter 0x1fd48 ramps every property; the sprite draw 0x254bc skips a
// sprite whose alpha is 0 or less, so the light shows for 15 frames.
export const cgCursorLight = (f) => Math.max(0, 1 - 2 * Math.min(30, Math.max(0, f)) / 30);
// When a grid starts (0xb318) every thumbnail fades in from 0 over half a second, quadratic in; the 42 from the first
// row shown on wait (column + row) / 50 s first (table 0x3373a0).
export function cgCascadeDelay(index, scroll) {
  const k = index - Math.floor((0.001 + scroll) / 139) * 6;
  return k >= 0 && k < 42 ? ((k % 6) + Math.floor(k / 6)) * CG_GRID.cascade : 0;
}

// ---- the viewer's rules (native cGalleryCGPhoto: 0xba18, 0xbe84, 0xc368 states, keys 0xc56c) -------------------------
// Left / Right go through every unlocked picture (0x5108), round and round, when there are two or more.
export const viewerStep = (count, k, dir) => (count < 2 ? k : (k + dir + count) % count);
// 0xbe84 keeps the zoom and place when the next picture is of the same entry and has the same size in the table.
export const viewerKeeps = (prev, next) => !!prev && !!next && prev.index === next.index && prev.variant.w === next.variant.w && prev.variant.h === next.variant.h;
// The grid the viewer closes onto (0x4b94 -> 0xd228 -> 0x7e24 -> 0x9384): the last picture's entry. The same entry it
// was opened from gives the same grid; another gives its sub-grid when it has two or more pictures, else the main grid.
export function viewerReturn(lists, opened, last) {
  const e = lists.entries[last.entry];
  const sub = last.entry === opened.entry ? opened.kind === "sub" : e.pictures.length >= 2;
  return sub ? { kind: "sub", entry: last.entry, sel: e.pictures.indexOf(last) } : { kind: "main", entry: last.entry, sel: last.entry };
}

// The music falls at 3.33 a frame from where it is (0x9c9b0): 100 takes half a second.
export function fadeMusicOut(audio) {
  const level = audio.bgm?.lv && audio.ctx ? audio.bgm.lv.at(audio.ctx.currentTime) : 0;
  audio.stopBGM(level * 5);
}
// A replay lowers the menu's background by this much a frame (0x5040 -> 0x49630).
export const REPLAY_MENU_BG = -0.04;

// The help band a gallery guide shows (0x5920, kind 9 for the viewer): 0x604c brings it in over half a second
// (quadratic in, from where its alpha is), holds it 2 s and takes it out over half a second (quadratic out, 0x5ea4);
// it sits (1 - alpha) x 25 units lower (0x5b58).
// The gallery's own band (created by 0x6124 with kind 10) is set with 0x5c4c instead: it comes in the same way and
// stays; shown with another kind it goes out first and comes back in with the new one (to).
export class GuideFx {
  constructor(kind = -1) { this.alpha = 0; this.phase = "off"; this.tw = null; this.hold = 0; this.kind = kind; this.pending = null; }
  get shown() { return this.phase === "in" || this.phase === "hold" || this.phase === "on"; }
  fadeIn(fade) {
    this.tw = new Tween(0, 1, fade, EASE.quad.in);
    this.tw.step(Math.min(1, Math.max(0, this.alpha)) * fade * 60);
    this.alpha = this.tw.value; this.phase = "in";
  }
  show(fade = 0.5, hold = 2) { this.fadeIn(fade); this.hold = hold; this.pending = null; }
  to(kind, fade = 0.5) {
    if (this.shown && kind >= 0 && kind !== this.kind) { this.hide(fade); this.pending = kind; return; }
    if (kind >= 0) this.kind = kind;
    this.pending = null;
    if (!this.shown) this.fadeIn(fade);
    this.hold = Infinity;
    if (this.phase === "hold") this.phase = "on";
  }
  hide(fade = 0.5) {
    this.pending = null;
    if (this.phase === "off" || this.phase === "out") return;
    this.tw = new Tween(1, 0, fade, EASE.quad.out);
    this.tw.step((1 - Math.min(1, Math.max(0, this.alpha))) * fade * 60);
    this.alpha = this.tw.value; this.phase = "out";
  }
  step(dt) {
    if (this.phase === "in" || this.phase === "out") {
      this.alpha = this.tw.step(dt);
      if (this.tw.done && this.phase === "in") this.phase = this.hold === Infinity ? "on" : "hold";
      else if (this.tw.done) {
        this.phase = "off";
        if (this.pending !== null) { this.kind = this.pending; this.pending = null; this.fadeIn(this.tw.d); this.hold = Infinity; }
      }
    } else if (this.phase === "hold") {
      this.hold -= dt / 60;
      if (this.hold <= 0) this.hide();
    }
    return this;
  }
  get offset() { return (1 - this.alpha) * 25 * UNIT; }
}

// ---- the Music Player's rules (cGalleryMusicList 0x1a7fc, cGalleryMusicPanel 0x1c9fc / 0x1cc68 / 0x1e98c) -----------
// The list: Up / Down move a row, wrapping between the first and the last only on a fresh press; Left gives the cursor
// to the column, Right to the panel.
export function musicListKey(sel, key, fresh, count) {
  if (key === "ArrowUp") return sel > 0 ? { sel: sel - 1 } : fresh ? { sel: count - 1 } : null;
  if (key === "ArrowDown") return sel < count - 1 ? { sel: sel + 1 } : fresh ? { sel: 0 } : null;
  if (key === "ArrowLeft") return { column: true };
  if (key === "ArrowRight") return { panel: true };
  return null;
}
// The panel: play, pause, stop, repeat on the top row, prev and next below. Left from play or prev goes back to the
// list; Up from the bottom row goes to the button above (prev to pause, next to stop); Down goes to the bottom row and
// from it to the volume (0x1ec0c).
export function musicPanelKey(btn, key) {
  if (key === "ArrowLeft") return btn === 0 || btn === 4 ? { list: true } : btn < 4 || btn === 5 ? { btn: btn - 1 } : null;
  if (key === "ArrowRight") return btn < 3 || btn === 4 ? { btn: btn + 1 } : null;
  if (key === "ArrowUp") return btn >= 4 ? { btn: btn - 3 } : null;
  if (key === "ArrowDown") return btn >= 4 ? { volume: true } : { btn: btn < 2 ? 4 : 5 };
  return null;
}
// The volume: 0.01 a press, kept within 0 and 1 (single precision, as the game keeps it); shown as (int)(v x 100).
export const musicVolumeStep = (v, dir) => {
  const x = Math.fround(Math.fround(v) + Math.fround(dir * 0.01));
  return x < 0 ? 0 : Math.min(1, x);
};
export const musicVolumeShown = (v) => Math.trunc(Math.fround(Math.fround(v) * 100));
// When a track without repeat starts to fade (0x1dec4: field 8 / 48 ms, less 1500 when the row's length is 0).
export const musicFadeAt = (t) => Math.trunc(t.loopEnd / 48) - (t.ms === 0 ? 1500 : 0);
export const MUSIC_FADE = 1.5;
// A press flashes Stop, Prev and Next (0x1e98c: buttons 2, 4 and 5; the others hide the flash), for 1/6 s.
export const musicFlashes = (btn) => btn === 2 || btn === 4 || btn === 5;
export const MUSIC_FLASH = 1 / 6;
// The text for the playing track (0x1dec4): the title, then one line per credit, "Singer:" ... "Arrangement:" (SYSMES
// 245-248) and the name, all at scale 1.2 around x 1592; the block starts at 244 - 32 x (lines / 2, cut) and the
// credits 58 below the title, 32 apart.
export function musicCredits(track, labels) {
  const keys = ["singer", "lyrics", "composer", "arrangement"];
  const lines = keys.map((k, i) => (track.credits?.[k] ? `${labels?.[i] ?? ""} ${track.credits[k]}`.trim() : null)).filter(Boolean);
  return { lines, top: 260 - 16 - 32 * Math.floor((lines.length + 1) / 2) };
}
const clock = (ms) => { const s = Math.floor(Math.max(0, ms) / 1000); return `${String(Math.floor(s / 60)).padStart(2, " ")}:${String(s % 60).padStart(2, "0")}`; };

// ---- the movie list's and the ending list's keys (0x183ec; 0xe7a4 / 0xf470 / 0xf5a4 / 0xf6f8) --------------------
// Movies stand in one row: Left from the first gives the cursor to the column, Right stops at the last.
export function movieListKey(count, sel, key) {
  if (key === "ArrowLeft") return sel < 1 ? { column: true } : { sel: sel - 1 };
  if (key === "ArrowRight") return sel < count - 1 ? { sel: sel + 1 } : null;
  return null;
}
// The ending list as the game walks it: row 0 the three endings (columns 0-2), rows 1-3 the bad ends eight a row
// (index = column + 8 row - 8), with the final episode at index 21 (row 3, column 5) once episodes 1-24 are complete.
// seen(row, col) says whether that place can be chosen. Left and Right go along the row to the next one seen, Left past
// the first to the column; Up and Down go to the nearest seen place of the next row that has one (0xf6f8: ties to the
// right; from the endings row columns 0 / 1 / 2 stand over 2 / 5 / 7; into it columns 0-2 / 3-5 / 6-7 stand under
// 0 / 1 / 2, ties to the left; the final is reached from columns 6-7 of row 2, and from it Up goes to column 7).
export function endingKey(seen, final, at, key) {
  const { row, col } = at;
  const width = (r) => (r === 0 ? 3 : r === 3 ? (final ? 6 : 5) : 8);
  if (key === "ArrowLeft") {
    for (let c = col - 1; c >= 0; c--) if (seen(row, c)) return { row, col: c };
    return { column: true };
  }
  if (key === "ArrowRight") {
    for (let c = col + 1; c < width(row); c++) if (seen(row, c)) return { row, col: c };
    return null;
  }
  const dir = key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0;
  if (!dir) return null;
  for (let r = row + dir; r >= 0 && r <= 3; r += dir) {
    const to = endingRowTarget(seen, final, at, r, dir);
    if (to) return to;
  }
  return null;
}
function endingRowTarget(seen, final, { row, col }, r, dir) {
  if (r === 0) {
    const want = col <= 2 ? 0 : col <= 5 ? 1 : 2;
    let best = null, dist = 100;
    for (let c = 0; c < 3; c++) if (seen(0, c) && Math.abs(want - c) < dist) { dist = Math.abs(want - c); best = c; }
    return best === null ? null : { row: 0, col: best };
  }
  const want = row === 0 ? [2, 5, 7][col] : col;
  let best = null, dist = 100;
  for (let c = 0; c < (r === 3 ? 5 : 8); c++) if (seen(r, c) && Math.abs(c - want) <= dist) { dist = Math.abs(c - want); best = c; }
  if (final) {
    if (r === 2 && dir < 0 && row === 3 && col === 5) return { row: 2, col: 7 };
    if (r === 3 && dir > 0 && (col === 6 || col === 7)) return { row: 3, col: 5 };
  }
  return best === null ? null : { row: r, col: best };
}

// The music player's own playback (native 0x19e98, 0x1d314, 0x1dc40, 0x1f380, 0x1c400): a row from its beginning (no
// seeking), at the player's volume through the music curve with no BGM setting (0x9c8f0: ca0(B(v)), audio.js
// playerGain) on each side at the stream share. With repeat it loops between the row's loop points; without, it fades
// out over 1.5 s from musicFadeAt, linear in level (0x9c9b0(v x 100 x 1000/60/1500) a frame), and then stops: nothing
// plays next.
export class Jukebox {
  constructor(audio) {
    this.audio = audio;
    this.state = "stopped";   // "loading", "playing", "paused"
    this.offset = 0;
    this.fade = null;
    this.track = null;
  }
  get volume() { return session.volume; }
  get repeat() { return session.repeat; }
  level() { return musicVolumeShown(session.volume) / 100; }
  gainAt(level) { return this.audio.playerGain(level) * this.audio.streamShare; }
  ready() {
    this.audio.start();
    const ctx = this.audio.ctx;
    if (!ctx) return null;
    if (!this.gain) { this.gain = ctx.createGain(); this.gain.connect(this.audio.master); }
    if (!this.fade) this.gain.gain.value = this.gainAt(this.level());
    return ctx;
  }
  loopPoints() {
    const t = this.track, d = this.buf.duration;
    const a = t.loopStart / 48000, b = Math.min(t.loopEnd / 48000, d);
    return b > a ? [a, b] : [0, d];
  }
  async play(track) {
    this.release();
    this.fade = null;
    this.track = track; this.offset = 0; this.state = "loading"; this.buf = null;
    const ctx = this.ready();
    if (!ctx) { this.state = "stopped"; return; }
    const token = (this.token = {});
    try {
      const buf = await this.audio.buffer(`/assets/bgm/${track.stream}.ogg`);
      if (this.token !== token) return;
      this.buf = buf;
      this.start(0);
    } catch (e) { if (this.token === token) this.state = "stopped"; console.warn(e.message); }
  }
  start(offset) {
    const ctx = this.ready(), s = ctx.createBufferSource();
    s.buffer = this.buf;
    if (session.repeat) { [s.loopStart, s.loopEnd] = this.loopPoints(); s.loop = true; }
    s.connect(this.gain);
    s.start(0, Math.min(offset, this.buf.duration - 0.05));
    this.src = s; this.startedAt = ctx.currentTime - offset; this.state = "playing";
    s.onended = () => { if (this.src === s) this.finish(); };
  }
  position() {
    if (this.state !== "playing" || !this.src) return this.offset;
    let t = this.audio.ctx.currentTime - this.startedAt;
    if (this.src.loop) { const [a, b] = this.loopPoints(); if (t > b) t = a + (t - a) % (b - a); }
    return t;
  }
  // Each frame (0x1d314): the fade starts once the position passes its point, and the track ends with it.
  update() {
    const ctx = this.audio.ctx;
    if (!ctx || !this.track) return;
    if (this.fade) { if (ctx.currentTime >= this.fade.end) this.finish(); return; }
    if (this.state === "playing" && !session.repeat && this.position() * 1000 > musicFadeAt(this.track)) this.startFade();
  }
  startFade() {
    const ctx = this.audio.ctx, g = this.gain.gain, t0 = ctx.currentTime, from = this.level();
    this.fade = { start: t0, end: t0 + MUSIC_FADE };
    g.cancelScheduledValues(t0);
    g.setValueAtTime(this.gainAt(from), t0);
    for (let f = 1; f <= MUSIC_FADE * 60; f++) g.linearRampToValueAtTime(this.gainAt(from * (1 - f / (MUSIC_FADE * 60))), t0 + f / 60);
  }
  // To a place in the row, f of the way to its end (the position bar under the mouse; the game's bar only showed it).
  seek(f) {
    if (!this.buf || !this.track || (this.state !== "playing" && this.state !== "paused")) return;
    const end = Math.min(this.buf.duration, this.track.loopEnd / 48000 || this.buf.duration);
    const t = Math.max(0, Math.min(end - 0.05, f * end));
    if (this.fade) { this.gain.gain.cancelScheduledValues(0); this.gain.gain.value = this.gainAt(this.level()); this.fade = null; }
    if (this.state === "playing") { this.release(); this.start(t); } else this.offset = t;
  }
  pause() { if (this.state === "playing") { this.offset = this.position(); this.release(); this.state = "paused"; } }
  resume() { if (this.state === "paused" && this.buf) this.start(this.offset); }
  toggle() { if (this.state === "playing") this.pause(); else this.resume(); }
  // The end of a track, or Stop (0x1dc40): the panel clears.
  finish() {
    this.token = null; this.release(); this.state = "stopped"; this.offset = 0;
    if (this.fade && this.gain) { this.gain.gain.cancelScheduledValues(0); this.gain.gain.value = this.gainAt(this.level()); }
    this.fade = null;
    if (this.onEnd) this.onEnd();
  }
  stop() { const end = this.onEnd; this.onEnd = null; this.finish(); this.onEnd = end; }
  setRepeat(on) {
    session.repeat = on;
    if (this.state === "playing" && !this.fade) { const t = this.position(); this.release(); this.start(t); }
  }
  setVolume(v) {
    session.volume = Math.max(0, Math.min(1, v));
    if (this.gain && !this.fade && (this.state === "playing" || this.state === "paused")) this.gain.gain.value = this.gainAt(this.level());
  }
  release() { if (this.src) { const s = this.src; this.src = null; try { s.stop(); } catch { /* ended */ } } }
}

// The picture change's wipe (0xca54 / 0xcd58): the screen as it was, captured (0xa4610(1)), is drawn over the new
// picture through rule_26 (to the previous picture) or rule_27 (to the next) as p, the timer at +0x52c, goes from 0 to
// 1 in half a second, linear (30 frames). The sprite's rule draw (0x254bc -> 0xb7160 -> 0xb2f00 -> 0x9fe00,
// 0xa0188-0xa01f8) runs the rule program STTR uses (mode 4) with its own constants: threshold 1 - a / 255 of the colour's
// alpha byte a = (1 - p) x 255, softness 128 x width / 1920 and direction +1 (STTR's 0xa7190 passes the alpha and -1).
// So the capture shows at smoothstep((r - lo) x 255 / 128), lo = (511 x (1 - a / 255) - 192) / 255: it leaves the
// rule's dark parts first and stays at full on its bright ones until the threshold gets there (the transition shader's
// direction, renderer.js FS_FADE). The alpha byte only moves the threshold: in the native frames (PC build, rule_27)
// every part the threshold has not reached is still at 1.000 half way through, not at 1 - p (fit rmse < 0.01 a frame,
// 0.27 with that fade), and the first three frames (x <= 0.125) change nothing.
export function wipeAlpha(r, p) {
  const a = Math.trunc(Math.max(0, 1 - p) * 255), x = 1 - a / 255, s = 128;
  const lo = ((255 + 2 * s) * x - 1.5 * s) / 255;
  const k = Math.min(1, Math.max(0, ((r - lo) * 255) / s));
  return k * k * (3 - 2 * k);
}
// The change, in frames from the key (0xc56c sets state 3): 0xca54 asks for the capture (step 0), waits three frames,
// puts it over everything at full (step 4: sprite type 3 at z 0x2b2, the rule slot 0x1c09 + direction; the band is
// under it), sets the new picture under it (step 5, 0xbe84), waits a frame and starts the timer (step 7); 0xcd58 then
// shows the band again (0x604c) and steps the timer each frame, from the 9th frame, and takes the capture away on the
// frame it is done (the 38th; state 2, keys again). So the old screen stays exactly as it was for the first 8 frames.
export const CHANGE_HOLD = 8, CHANGE_FRAMES = 30;
class Wipe {
  // old: the captured screen; rule: its image, which may still be loading (the capture covers at full until then).
  constructor(box, old, rule) {
    this.canvas = el("canvas", "gl-wipe");
    this.canvas.width = SW; this.canvas.height = SH;
    this.canvas.wipe = this;
    box.append(this.canvas);
    this.ruleImage = rule;
    this.rule = null;
    this.old = old;
    this.out = this.canvas.getContext("2d").createImageData(SW, SH);
    this.n = 0;
    this.drawn = -1;
    void this.ready;   // read the rule now, at the key, if it is in
    this.draw();
  }
  get p() { return Math.min(1, this.n / CHANGE_FRAMES); }
  // the rule's red channel (the rule pictures are red only), once its image is in; one that failed is read as all dark
  get ready() {
    if (this.rule) return true;
    const im = this.ruleImage;
    if (!im?.complete) return false;
    this.rule = new Uint8Array(SW * SH);
    if (im.naturalWidth) {
      try {
        const c = document.createElement("canvas");
        c.width = SW; c.height = SH;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(im, 0, 0, SW, SH);
        const r = g.getImageData(0, 0, SW, SH).data;
        for (let i = 0; i < this.rule.length; i++) this.rule[i] = r[i * 4];
      } catch (e) { console.warn(e.message); }
    }
    return true;
  }
  draw() {
    const p = this.p;
    if (p === this.drawn) return;
    this.drawn = p;
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) lut[v] = Math.round(255 * wipeAlpha(v / 255, p));
    const src = this.old.data, dst = this.out.data, rule = this.rule;
    for (let i = 0, j = 0; i < SW * SH; i++, j += 4) {
      dst[j] = src[j]; dst[j + 1] = src[j + 1]; dst[j + 2] = src[j + 2]; dst[j + 3] = rule ? lut[rule[i]] : 255;
    }
    this.canvas.getContext("2d").putImageData(this.out, 0, 0);
  }
  // frames counted, so the 30th is exactly the end (30 x 1/30 falls short of 1 in doubles; frame times wobble too)
  step(dt) {
    this.n += dt;
    if (this.n > CHANGE_FRAMES - 0.05) this.n = CHANGE_FRAMES;
    if (this.p < 1) this.draw();
    return this.p >= 1;
  }
  remove() { this.canvas.remove(); }
}

// The CG grid's thumbnail sheet is large (5544 x 4840): read and decoded ahead of the gallery (the title asks for it), so
// that the gallery does not open on an empty grid or wait for it.
export function preloadGallery() {
  if (openGallery.atlas || typeof Image === "undefined") return;
  openGallery.atlas = new Image();
  openGallery.atlas.src = url("CG_THUMB_PARTS_JA", "cg_thumb_all");
  openGallery.atlas.decode?.().catch(() => {});
}

// env: toast, flowchart(opts), playMovie(name, opts), endMovie(), titleVideo(on), titleMusic()
// opts.ghost: the flowchart's page when coming back from it, kept over this one as it fades out.
export function openGallery(ui, vm, env, start = session.section || "cg", opts = {}) {
  const data = vm.gallery;
  if (!data) { env.toast("No gallery yet: run web/tools/build_gallery.py", 5000); return; }
  env.titleVideo(false);
  preloadGallery();
  const page = ui.begin("gallery");
  page.classList.add("gl-page");
  // Opened from the title (opts.fromTitle, checklist G20): the native build's loading frames have run some timers on by
  // the gallery's first frame (GALLERY_OPEN), and its second frame is ~0.1 s long, which every timer takes (animate).
  // The page is drawn as built in the frame that builds it, so the built state is that first frame and the first tick
  // (frameLoop's, 0 long) the second.
  const boot = opts.fromTitle ? GALLERY_OPEN : null;
  let booted = false;   // the first section's view takes it
  const animate = (fn) => { let n = 0; ui.animate((dt) => fn(boot && ++n === 1 ? Math.max(dt, boot.second * 60) : dt)); };
  // conf_BG is an empty texture; what shows is the system menu's background (0x4b880, through 0xae0700), which the
  // title's GALLERY raised and which stays up over the title's black while the gallery is open.
  page.style.background = "#000";
  const menuBg = new MenuBgFade(1, 1);
  ui.menuBackground(page, { settled: true, fade: menuBg });
  // The window, the inner panel and the underline are drawn from their top-left corners at (56, 0), (365, 0) and (0, 72):
  // descriptors 0x44e2f8 / 0x44e320 / 0x44e348 (0x6124, N2-58).
  const innerBg = sprite(P, "config_innerbg", 365, 0, 1560, 1080);
  page.append(innerBg);
  const titleArt = el("div", "gl-title");
  const content = el("div", "gl-content");
  const underline = sprite(P, "underline", 0, 72, 1920, 16), menuWindow = sprite(P, "gallerymenu_window", 56, 0, 312, 1080);
  page.append(content, titleArt, underline, menuWindow);
  // The cursor (native 0x82fc, cGalleryCursor 0x5728 / 0x57d0 / 0x585c): gallerycursor_line at (80, 192 + 80 k), its
  // x scale set to 0 and run up by 1 over 12 frames in a straight line (program 0x3372d8, op 12; the interpreter 0x1fd48
  // ramps linearly) each time the cursor moves, and
  // systemcursor_light at (0, 96 + 80 k), its alpha swinging between 1 and 0.4 with quadratic in-out over 1.2 s each
  // way, from 1 again at each move.
  const line = sprite(P, "gallerycursor_line", 80, 0, 304, 56, 0, 0, "gl-cursorline");
  const star = sprite(P, "systemcursor_light", 0, 0, 528, 240);
  const cursorFx = { row: -1, stretch: 1, from: 1, to: 0.4, t: 0 };
  page.append(line, star);

  // The pointer's rule, as ui.add has it: what is under a moving pointer takes the cursor (a pointer at rest, with the page
  // moving under it, and a touch do not).
  const pointed = (target, fn) => target.addEventListener("pointermove", (e) => { if (e.pointerType !== "touch" && ui.pointerMoved !== false) fn(); });
  const stageScale = () => document.getElementById("stage").getBoundingClientRect().width / SW || 1;
  const jukebox = new Jukebox(vm.audio);
  let section = ITEMS.includes(start) && start !== "flowchart" && start !== "title" ? start : "cg";
  let menuSel = ITEMS.indexOf(section), focus = "menu", view = null, overlay = null;
  // The title's music plays on in the gallery (nothing in 0x4210 / 0x42d0 stops it); coming back from a replay
  // (0x47a90) or the flowchart (0x7624, unless to the Music Player) starts it again; it is no restart when it plays.
  if (section !== "music") env.titleMusic?.();

  // The column's rows are buttons (native group 25, table 0x44e438): gallerymenu_btn cells 256 x 96 at (80, 160 + 80 k),
  // normal from x 8 (7 for the first), lit from 272, and the open section's from 536 (the marker 0x6e28 moves to the
  // row, table 0x3372f8). A row lights up with the arrival flash (ButtonState); the rows have no pressed hold.
  const ROW = ui.touch ? TOUCH.galleryStep : 80;   // a touch device: the same rows, further apart
  const labels = ITEMS.map((id, k) => {
    const b = el("button", "gl-item");
    place(b, 80, 160 + ROW * k, 256, 96);
    b.style.backgroundImage = `url("${url(P, "gallerymenu_btn")}")`;
    const flash = el("div", "sp fx-add");
    flash.style.cssText = `left:0;top:0;width:256px;height:96px;background-image:url("${url(P, "gallerymenu_btn")}");background-position:-272px ${-(8 + 104 * k)}px;opacity:0;`;
    b.append(flash);
    b.flash = flash;
    b.st = new ButtonState();
    b.dataset.item = id;
    // the row under the pointer takes the cursor, also back from the section beside it
    pointed(b, () => {
      if (overlay || !ready() || (focus === "menu" && menuSel === k)) return;
      ui.sound(0);
      if (focus !== "menu") { focus = "menu"; view?.focus(false); }
      menuSel = k;
      draw();
    });
    b.addEventListener("click", (e) => { e.stopPropagation(); if (!overlay && ready()) { ui.sound(1); menuSel = k; choose(true); } });
    page.append(b);
    return b;
  });

  // The column's pieces (native 0x6124, set by 0x6bbc through each piece's +0xb8) come in together from 0 to 1 over half
  // a second, eased in (0x6934: 0x26720(tween, 2, 0), 0x26894(0, 1, 0.5)), with the open section's header (0x5c4c) and
  // the section; the column takes no input until they are in (state 1). Leaving for the title they go from 1 to 0,
  // eased out (0x8400 item 5 -> 0x7ac4), and the title starts again only then. A section chosen later waits for the
  // open one to go out first (its +0x30: 1 to 0 over half a second, quadratic out: 0x90e0, 0x19ac4, 0x187ec, 0xeb80;
  // 0x7328 waits for it) and then comes in over its own half second (quadratic in).
  const column = [innerBg, underline, menuWindow, line, ...labels];
  const colFx = fadeIn();
  let leaving = null, secFx = null, switching = null, pulse = 1;
  const ready = () => colFx.done && !leaving && !switching;
  function fade() {
    const a = leaving ? leaving.tw.value : colFx.value, s = a * (switching ? switching.tw.value : secFx ? secFx.value : 1);
    for (const e of column) e.style.opacity = String(a);
    star.style.opacity = String(a * pulse);
    titleArt.style.opacity = String(s);
    // a view that brings its own pieces in (view.ownFade) takes only the going-out on the whole content
    content.style.opacity = String(view?.ownFade ? (leaving ? leaving.tw.value : 1) * (switching ? switching.tw.value : 1) : s);
    page.style.pointerEvents = ready() ? "" : "none";
  }
  // Leaving for the title: the open section goes out with the column (its close, as for the flowchart, stops the Music
  // Player's track without the title's music) and the title starts only then.
  function closeTo(then) {
    if (leaving) return;
    leave();
    leaving = { tw: fadeOut(), then: () => { closeSection(false); then(); } };
  }
  // A replay from the Ending List's Yes (0x5040): the menu's background goes down at 0.04 a frame (0x49630), the music
  // out at 3.33 a frame (0x9c9b0), and the section and the column leave as for the title, the band too (0x826c -> state 8,
  // 0x7ac4). The episode starts only then (N2-57, N2-63).
  function replayOut(then) {
    if (leaving) return;
    menuBg.set(REPLAY_MENU_BG);
    fadeMusicOut(vm.audio);
    closeTo(then);
  }

  function render(dt = 0) {
    labels.forEach((b, k) => {
      b.st.step(dt, focus === "menu" && k === menuSel && !overlay);
      const x = ITEMS[k] === section ? 536 : b.st.state & 1 ? 272 : k === 0 ? 7 : 8;
      b.style.backgroundPosition = `${-x}px ${-(8 + 104 * k)}px`;
      b.flash.style.opacity = String(ITEMS[k] === section ? 0 : b.st.flash);
    });
  }
  animate((dt) => {
    if (leaving) leaving.tw.step(dt); else colFx.step(dt);
    if (switching) {
      switching.tw.step(dt);
      if (switching.tw.done) { const s = switching; switching = null; s.then(); open(s.id, s.enter); }
    } else if (secFx) secFx.step(dt);
    if (view?.step) view.step(dt);
    render(dt);
    cursorFx.stretch = Math.min(1, cursorFx.stretch + dt / 12);
    line.style.transform = `scaleX(${cursorFx.stretch})`;
    cursorFx.t += dt / 60;
    if (cursorFx.t >= 1.2) Object.assign(cursorFx, { from: cursorFx.to, to: cursorFx.from, t: cursorFx.t - 1.2 });
    pulse = cursorFx.from + (cursorFx.to - cursorFx.from) * EASE.quad.inout(Math.min(1, cursorFx.t / 1.2));
    fade();
    if (leaving && leaving.tw.done) { const then = leaving.then; leaving = null; then(); }
  });

  function draw() {
    render();
    line.style.top = `${192 + ROW * menuSel}px`;
    star.style.top = `${96 + ROW * menuSel}px`;
    if (cursorFx.row !== menuSel) Object.assign(cursorFx, { row: menuSel, stretch: 0, from: 1, to: 0.4, t: 0 });
    line.style.visibility = star.style.visibility = focus === "menu" ? "visible" : "hidden";
  }

  function leave() {
    ui.keyFn = null;
  }
  // The open section closes (its +0x30). The Music Player's close (0x19838 state 4) stops its track and, when another
  // section of the column was chosen (0x8400 -> its +0x80, 0x19e5c), starts the title's music again at the BGM volume
  // (0x8e1c0, 0x9c870(100)); not for the flowchart or the title.
  function closeSection(another, id = section) {
    if (view?.close) view.close();
    if (id === "music") { jukebox.stop(); if (another) env.titleMusic?.(); }
  }

  // fadeSection: a section chosen in the column; the first comes in with the column.
  function show(id, enter, fadeSection = true) {
    if (view && fadeSection) {
      const from = section;
      section = id;
      switching = { tw: fadeOut(), id, enter, then: () => closeSection(true, from) };
      focus = "menu"; draw(); fade();
      return;
    }
    open(id, enter, fadeSection);
  }
  function open(id, enter, fadeSection = true) {
    section = id;
    session.section = id;
    titleArt.textContent = "";
    titleArt.append(sprite(P, TITLES[id], 64, 3, 720, 80));
    content.textContent = "";
    view = { cg: cgView, music: musicView, movie: movieView, ending: endingView }[id]();
    focus = enter && view.size() ? "content" : "menu";
    view.focus(focus === "content");
    draw();
    secFx = fadeSection ? fadeIn() : null;
    fade();
  }

  // touch: chosen with the pointer (0x6e28's iVar9, the frame a touch begins).
  function choose(touch = false) {
    const id = ITEMS[menuSel];
    // The Title row moves the section to the closing slot, so 0x49b0 finds none to keep (session.section).
    if (id === "title") { session.section = null; closeTo(() => ui.title({ fromGallery: true })); return; }
    if (id === "flowchart") {
      // Before scene 1 has started there is no flowchart: "Flowchart is not yet available" (0x14cfc(1) -> menu state 7,
      // SYSMES 1496 through 0x4abe0).
      if (!vm.flow.started.has(1)) { ui.notify(vm.system?.messages?.["1496"] || "Flowchart is not yet available"); return; }
      // The column leaves as the flowchart comes in (0x8400 item 2: the column 1 to 0 over half a second, eased out,
      // state 5), and comes back in when the flowchart closes (0x7624). Both run at once: this page goes over the
      // flowchart's as it fades out (ui.ghost).
      closeSection(false);
      leave();
      env.flowchart({ gallery: true, ghost: page, guide: { kind: guide.kind, alpha: guide.alpha }, back: (o) => openGallery(ui, vm, env, section, o) });
      return;
    }
    // The section already open (0x6f34-0x6fe8): nothing closes or is rebuilt. A button press gives it the cursor, when it
    // can take one, and hides the column's line and light; the pointer only plays the sound (N2-60).
    if (id === section) { if (!touch) focusContent(); return; }
    show(id, true);
  }

  // Back (B, Escape, the Back button, a right click) plays sound 2 where it does something: the viewer closes only
  // between its fades; a sub-grid goes back to its entries; a section gives the cursor to the column; the column leaves.
  function back() {
    if (!ready()) return;
    if (overlay) { if (overlay.close()) ui.sound(2); return; }
    ui.sound(2);
    if (focus === "content" && view?.back?.()) return;
    if (focus === "content") { toColumn(); return; }
    closeTo(() => ui.title({ fromGallery: true }));
  }
  function toColumn() { focus = "menu"; menuSel = ITEMS.indexOf(section); view.focus(false); draw(); }

  // ---- CG Gallery (native cGalleryCG 0x8818 / 0x8d08) ----------------------------------------------------------------
  // The main grid lists the entries with an unlocked picture (cGalleryCGMain, 0xb7e0 / 0xb830), each by its first
  // unlocked picture; choosing one with a single picture opens the viewer, with more its sub-grid (cGalleryCGSub,
  // 0xd408 / 0xd468: its unlocked pictures, each with its own thumbnail, in the same grid). Back from a sub-grid builds
  // the main grid again on that entry, at the scroll it had (0xae8c). Every grid starts with the cascade (0xb318).
  function cgView() {
    const lists = cgLists(data.cg, vm);
    // the thumbnails are drawn within y 109 - 1014 (0xaf78 -> 0x1fa60(0, 109, 1920, 905)), and so is the cursor (0x9578):
    // cg_cursor's frame (cell 8, 8, 248 x 144, z 250) with its light in front (cell 264, 8, z 210), both top-left at
    // (384 + 240 c, 103 + 139 r); the light flashes each time the cursor is placed (cgCursorLight).
    const box = place(el("div", "gl-grid"), GRID.x - 16, GRID.y - 14, GRID.dx * GRID.columns + 20, CG_GRID.bottom - GRID.y + 14);
    const clip = el("div", "gl-thumb-clip"), over = el("div", "gl-layer");
    let thumbs = el("div", "gl-layer");
    over.style.pointerEvents = "none";
    clip.append(thumbs, over);
    box.append(clip); content.append(box);
    const cursor = place(el("div", "gl-cursor"), 0, 0, 260, 160);
    const light = sprite(P, "cg_cursor", 8, 8, 248, 144, 264, 8);
    cursor.append(sprite(P, "cg_cursor", 8, 8, 248, 144, 8, 8), light);
    over.append(cursor);
    let lightAt = 0;
    const flashCursor = () => { lightAt = 0; light.style.opacity = String(cgCursorLight(0)); };
    const scroller = scrollBar(content);
    let grid = null, focused = false;
    const mainScroll = { at: 0 };
    // Every grid brings in its own cursor frame, light and scroll bar, also a sub-grid and the rebuild after the viewer:
    // 0 to 1 over half a second, quadratic in, from its first frame (0x9970 starts it, 0x9bdc and 0xa720 apply it, N2-186).
    // The light's alpha is its program's times this. Opened from the title (G20): on the gallery's first frame the
    // cascade's sprite tweens and the cursor light's program are GALLERY_OPEN.cascade on, and this fade
    // GALLERY_OPEN.scrollBar on; the thumbnails take no other fade in. The native frames: the thumbnails at their
    // cascade's alpha while the column is still at 0, a CG section opened again inside the gallery cascading from 0 with
    // nothing else on them.
    let head = boot && !booted ? boot : null;
    booted = true;
    let gridFx = null, retired = null;
    let cells = [];
    const gridLevel = () => { over.style.opacity = scroller.bar.style.opacity = scroller.thumb.style.opacity = String(gridFx.value); };
    // The grid a sub-grid replaces, or a sub-grid going back to the main one (0x8d08: closed, 0xabe8, and kept in +0x60,
    // which holds one, until 0xa4f4 is done): its cursor goes at once, its thumbnails and scroll bar from 1 to 0 over half a
    // second, quadratic out, under the new grid's cascade (N2-64). The viewer's return replaces the old grid outright (0x9384).
    function retire(crossfade) {
      if (retired) { retired.layer.remove(); for (const e of retired.bar) e.remove(); retired = null; }
      if (!crossfade) { thumbs.textContent = ""; return; }
      const layer = thumbs, old = scrollBar(content);
      old.set(grid.scroll.now, cgScrollMax(grid.rows));
      layer.style.pointerEvents = "none";
      thumbs = el("div", "gl-layer");
      clip.append(thumbs, over);
      retired = { layer, bar: [old.bar, old.thumb], tw: fadeOut() };
    }
    // kind "main": cells are entries (lists.entries); "sub": the pictures of lists.entries[entry].
    function build(kind, entry, sel, scroll, crossfade = false) {
      const items = kind === "main" ? lists.entries.map((e) => e.pictures[0]) : lists.entries[entry].pictures;
      retire(crossfade);
      cells = items.map((p, k) => {
        const c = k % GRID.columns, r = Math.floor(k / GRID.columns), cell = p.variant.cell;
        const t = place(el("button", "gl-thumb"), 16 + c * GRID.dx, 14 + r * GRID.dy, THUMB.w, THUMB.h);
        t.style.backgroundImage = `url("${url("CG_THUMB_PARTS_JA", "cg_thumb_all")}")`;
        t.style.backgroundSize = `${THUMB.atlasW}px ${THUMB.atlasH}px`;
        t.style.backgroundPosition = `${-(cell % THUMB.perRow) * THUMB.cellW}px ${-Math.floor(cell / THUMB.perRow) * THUMB.cellH}px`;
        // a flagged picture is drawn mirrored, its thumbnail too (0xaf78 -> vtable +0xc0)
        if (p.variant.flag) t.style.transform = "scaleX(-1)";
        t.style.opacity = "0";
        t.setAttribute("aria-label", `CG ${k + 1}`);
        pointed(t, () => { if (overlay || !ready() || (focus === "content" && grid.sel === k)) return; focusContent(); select(k, grid.sel, false); });
        t.addEventListener("click", (e) => { e.stopPropagation(); if (!overlay && ready()) { focusContent(); select(k); ui.sound(1); pick(k); } });
        thumbs.append(t);
        return t;
      });
      const rows = Math.ceil(items.length / GRID.columns);
      grid = { kind, entry, items, rows, sel: Math.max(0, Math.min(items.length - 1, sel)), scroll: null, cascade: head ? head.cascade : 0 };
      grid.scroll = { now: Math.min(cgScrollMax(rows), Math.max(0, scroll)), tw: null };
      // the cursor's row is shown (0x9384 builds the grid at the saved scroll, the cursor at its cell)
      const r = Math.floor(grid.sel / GRID.columns), y = 109 + 139 * r - grid.scroll.now;
      if (y > CG_GRID.low) grid.scroll.now = cgScrollTarget(r, -1, grid.scroll.now, rows);
      else if (y < CG_GRID.top) grid.scroll.now = cgScrollTarget(r, rows, grid.scroll.now, rows);
      grid.delays = cells.map((_, k) => cgCascadeDelay(k, grid.scroll.now));
      cascadeLevels();
      gridFx = new Tween(0, 1, 0.5, EASE.quad.in);
      if (head) gridFx.step(head.scrollBar * 60);
      gridLevel();
      place(cursor, (grid.sel % GRID.columns) * GRID.dx, r * GRID.dy);
      flashCursor();
      if (head) { lightAt = Math.min(30, head.cascade * 60); light.style.opacity = String(cgCursorLight(lightAt)); head = null; }
      layout();
    }
    function cascadeLevels() {
      cells.forEach((t, k) => { t.style.opacity = String(EASE.quad.in(Math.min(1, Math.max(0, (grid.cascade - grid.delays[k]) / CG_GRID.fadeTime)))); });
    }
    function layout() {
      const y = `translateY(${-grid.scroll.now}px)`;
      thumbs.style.transform = over.style.transform = y;
      cursor.style.display = focused && cells.length ? "block" : "none";
      scroller.set(grid.scroll.now, cgScrollMax(grid.rows));
    }
    // follow: the grid scrolls to show the row (the keys' moves; the pointer's leave the grid where it is)
    function select(k, prev = grid.sel, follow = true) {
      if (!cells.length) return;
      grid.sel = Math.max(0, Math.min(cells.length - 1, k));
      const r = Math.floor(grid.sel / GRID.columns), pr = Math.floor(prev / GRID.columns);
      const to = follow ? cgScrollTarget(r, pr, grid.scroll.tw ? grid.scroll.tw.to : grid.scroll.now, grid.rows) : null;
      if (to !== null) grid.scroll.tw = new Tween(grid.scroll.now, to, CG_GRID.scrollTime, EASE.quad.out);
      place(cursor, (grid.sel % GRID.columns) * GRID.dx, r * GRID.dy);
      flashCursor();
      layout();
    }
    function pick(k) {
      const p = grid.items[k];
      if (!p) return;
      if (grid.kind === "main" && lists.entries[p.entry].pictures.length >= 2) {
        mainScroll.at = grid.scroll.now;
        build("sub", p.entry, 0, 0, true);
        return;
      }
      viewer(lists, p, { kind: grid.kind, entry: p.entry, scroll: grid.scroll.now }, (last, opened) => {
        const to = viewerReturn(lists, opened, last);
        build(to.kind, to.entry, to.sel, to.kind === "sub" ? (last.entry === opened.entry ? opened.scroll : 0) : mainScroll.at);
      });
    }
    // the wheel moves the grid by its own distance (WHEEL_GAIN), Page Up / Page Down four rows
    const scrollBy = (px) => {
      const from = grid.scroll.tw ? grid.scroll.tw.to : grid.scroll.now;
      const to = Math.min(cgScrollMax(grid.rows), Math.max(0, from + px));
      grid.scroll.tw = new Tween(grid.scroll.now, to, CG_GRID.scrollTime, EASE.quad.out);
    };
    box.addEventListener("wheel", (e) => {
      e.stopPropagation();
      if (!overlay) scrollBy(wheelPixels(e, stageScale()) * WHEEL_GAIN);
    }, { passive: true });
    // a drag over (392, 109, 1440 x 905), thumbnails too, moves the grid by its velocity once it is 3 or more (0x9cbc:
    // 0x6a0, 0x40c(1), 0x6c4); a drag is no click on a thumbnail
    ui.touchDrag?.(box, [392, 109, 1440, 905], (v) => {
      if (overlay || Math.abs(v) < 3) return;
      grid.scroll.tw = null;
      grid.scroll.now = Math.min(cgScrollMax(grid.rows), Math.max(0, grid.scroll.now + v));
      layout();
    }, { widgets: null });
    build("main", 0, 0, 0);
    return {
      size: () => cells.length,
      // the band: kind 0 (with Scroll) when the grid's rows scroll, else 10 (0x936c -> the grid's 0xadfc, 0x27b60)
      helpKind: () => (cgScrollMax(grid.rows) > 0 ? 0 : 10),
      focus(on) { if (on && !focused) flashCursor(); focused = on; layout(); },
      ownFade: true,
      step(dt) {
        if (!gridFx.done) { gridFx.step(dt); gridLevel(); }
        if (retired) {
          const v = String(retired.tw.step(dt));
          retired.layer.style.opacity = v;
          for (const e of retired.bar) e.style.opacity = v;
          if (retired.tw.done) { retired.layer.remove(); for (const e of retired.bar) e.remove(); retired = null; }
        }
        if (lightAt < 30) { lightAt += dt; light.style.opacity = String(cgCursorLight(lightAt)); }
        if (grid.scroll.tw) { grid.scroll.now = grid.scroll.tw.step(dt); if (grid.scroll.tw.done) grid.scroll.tw = null; layout(); }
        if (grid.cascade < 1) {
          grid.cascade += dt / 60;
          cascadeLevels();
          if (grid.cascade > CG_GRID.fadeTime + 42 * CG_GRID.cascade) grid.cascade = 1;
        }
      },
      // Back in a sub-grid goes to the main grid on its entry (0x8d08); in the main grid to the column.
      back() {
        if (grid.kind !== "sub") return false;
        const entry = grid.entry;
        build("main", entry, entry, mainScroll.at, true);
        return true;
      },
      page: (dir) => scrollBy(4 * dir * GRID.dy),
      key(k) {
        if (k === "Enter" || k === " ") { ui.sound(1); pick(grid.sel); return true; }
        const to = cgGridKey(cells.length, grid.sel, k);
        if (!to) return k.startsWith("Arrow");
        ui.sound(0);
        if (to.column) toColumn(); else select(to.sel);
        return true;
      },
    };
  }

  // The viewer (cGalleryCGPhoto, 0xba18; per frame 0xc368). It opens over half a second (0xc498: the screen as it was
  // fades out over it, 0 to 1 quadratic in) with its help band (guide kind 9, GuideFx); Left / Right go through every
  // unlocked picture: the screen held 8 frames, then the rule wipe (Wipe, CHANGE_HOLD), the band showing again under
  // it; Back closes it over half a second (0xce60:
  // 1 to 0, quadratic out, the band going too) onto the grid of the last picture's entry. It takes keys only between
  // these (state 2). Each picture names the part to show (x, y, w, h, in pixels of the gallery's 1.5x copy; 0x251a4
  // sets the sprite's source rectangle). It starts fitted to the screen: a picture larger than the screen may be zoomed
  // from that fit up to its own size, a smaller one stays at the fit. Enter toggles between filling the screen and
  // fitting it (the A button); + / - and the wheel zoom (the right stick, 0.008 a frame at full tilt); dragging moves it
  // (the left stick or touch), and the picture never leaves a gap at an edge it overlaps (0xd270); Home puts it
  // back (X). A flagged picture is mirrored (0xbe84 -> 0x1f688, the draw 0x254bc negating the x scale for state bit 8);
  // the next picture keeps the zoom and place when it is of the same entry and the same size (viewerKeeps).
  function viewer(lists, first, opened, onClose) {
    const box = el("div", "gl-viewer");
    const crop = el("div", "gl-crop");
    const img = el("img");
    img.alt = "";
    img.draggable = false;
    crop.append(img);
    box.append(crop);
    page.append(box);
    const band = el("div", "gl-viewer-band");
    box.append(band);
    ui.helpBar(band, ["Back", "Picture", "Zoom", "Fill", "Reset"]);
    const guide = new GuideFx();
    const rules = [26, 27].map((n) => { const i = new Image(); i.src = `/assets/img/RULE_${n}.avif`; return i; });
    let k = first.flat, view = null, shown = null, phase = "open", tw = fadeIn(), wipe = null, hold = 0, loaded = false;
    const held = new Set();
    const onKeyUp = (e) => held.delete(e.key);
    window.addEventListener("keyup", onKeyUp);
    // fit: the starting scale; min / max: the zoom range (native +0x40 / +0x44); cx, cy: the centre on screen.
    const placeView = () => {
      if (!view) return;
      const hw = (view.w * view.scale) / 2, hh = (view.h * view.scale) / 2;
      const clampAxis = (c, half, size) => (2 * half <= size ? Math.min(size - half, Math.max(half, c)) : Math.min(half, Math.max(size - half, c)));
      view.cx = clampAxis(view.cx, hw, SW);
      view.cy = clampAxis(view.cy, hh, SH);
      crop.style.transform = `translate(${view.cx - hw}px, ${view.cy - hh}px) scale(${view.scale})${view.mirror ? ` translateX(${view.w}px) scaleX(-1)` : ""}`;
    };
    const zoomTo = (scale, at = null) => {
      if (!view) return;
      const next = Math.min(view.max, Math.max(view.min, scale));
      if (at) { const f = next / view.scale; view.cx = at[0] + (view.cx - at[0]) * f; view.cy = at[1] + (view.cy - at[1]) * f; }
      view.scale = next;
      placeView();
    };
    const reset = () => { if (!view) return; view.scale = view.fit; view.cx = SW / 2; view.cy = SH / 2; placeView(); };
    const showPicture = (then) => {
      const p = lists.flat[k], v = p.variant, prev = shown, before = view;
      shown = p;
      img.onload = () => {
        if (shown !== p) return;
        const info = vm.gfx?.images?.[v.image.toUpperCase()];
        // the picture's own size in screen pixels: stored size / stored scale, at 1.5 screen pixels a pixel
        const nat = info ? [info[0], info[1]] : [img.naturalWidth, img.naturalHeight];
        const full = [nat[0] * 1.5, nat[1] * 1.5];
        const r = { x: v.x || 0, y: v.y || 0, w: Math.min(v.w, full[0] - (v.x || 0)), h: Math.min(v.h, full[1] - (v.y || 0)) };
        crop.style.width = `${r.w}px`;
        crop.style.height = `${r.h}px`;
        img.style.width = `${full[0]}px`;
        img.style.height = `${full[1]}px`;
        img.style.transform = `translate(${-r.x}px, ${-r.y}px)`;
        const rx = SW / r.w, ry = SH / r.h;
        let min = 1, max = 1;
        if (rx < 1 || ry < 1) min = Math.min(rx, ry);
        else if (rx > 1 && ry > 1) min = max = Math.min(rx, ry);
        if (ui.touch) max = Math.max(max, min * TOUCH.viewerZoom);   // on a phone the picture's own size is not much larger than the fit: fingers may go on
        view = { w: r.w, h: r.h, fit: min, min, max, scale: min, cx: SW / 2, cy: SH / 2, fill: Math.min(max, Math.max(rx, ry)), mirror: !!v.flag, r, full };
        if (viewerKeeps(prev, p) && before) Object.assign(view, { scale: before.scale, cx: before.cx, cy: before.cy });
        placeView();
        if (then) then();
      };
      img.onerror = () => { if (shown === p && then) then(); };
      img.src = `/assets/img/${v.image}.avif`;
    };
    // The picture as it is now, for the wipe: the backdrop and the picture as placed. The hint band is not in it: it lies
    // over the wipe and stands still through a change (the game's capture, 0xa4610, took the band too, and its new band
    // slid in under the old one's picture, which read as the hints shaking).
    const capture = () => {
      const c = document.createElement("canvas");
      c.width = SW; c.height = SH;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.fillStyle = getComputedStyle(box).backgroundColor || "#000";
      g.fillRect(0, 0, SW, SH);
      if (view && img.complete && img.naturalWidth) {
        const sx = img.naturalWidth / view.full[0], sy = img.naturalHeight / view.full[1];
        const w = view.w * view.scale, h = view.h * view.scale;
        g.save();
        g.imageSmoothingQuality = "high";   // as the page scales the picture, so the cover matches it
        g.translate(view.cx - w / 2, view.cy - h / 2);
        if (view.mirror) { g.translate(w, 0); g.scale(-1, 1); }
        g.drawImage(img, view.r.x * sx, view.r.y * sy, view.r.w * sx, view.r.h * sy, 0, 0, w, h);
        g.restore();
      }
      return g.getImageData(0, 0, SW, SH);
    };
    // A change (CHANGE_HOLD): the old screen goes over everything at once, the band too, and stays at full for 8 frames
    // while the new picture is set under it; the wipe starts on the 9th frame, or on the frame after the new picture
    // and the rule have loaded if that is later (the original loads at once), and the band comes in again under it.
    const change = (dir) => {
      const next = viewerStep(lists.flat.length, k, dir);
      if (next === k) return false;
      wipe = new Wipe(box, capture(), rules[dir < 0 ? 0 : 1]);
      k = next;
      phase = "change"; hold = 0; loaded = false;
      showPicture(() => { loaded = true; });
      return true;
    };
    const close = () => {
      if (phase === "close") return;
      phase = "close"; tw = fadeOut(); guide.hide();
      if (wipe) { wipe.remove(); wipe = null; }
      onClose(lists.flat[k], opened);
    };
    // Fingers (a touch device): two on the picture zoom it about the point between them (touch.js pinch); one moves a picture
    // that has been made larger, and across one that has not it is a swipe, on to the next picture (leftwards) or back to the one before.
    const fingers = new Map(), SWIPE = 150;
    let drag = null, moved = false, pinched = null;
    box.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      const r = box.getBoundingClientRect(), k2 = SW / r.width;
      if (e.pointerType === "touch") {
        fingers.set(e.pointerId, [e.clientX, e.clientY]);
        if (fingers.size === 2 && view) { const [a, b] = [...fingers.values()]; pinched = { a: [...a], b: [...b], scale: view.scale }; moved = true; drag = null; return; }
        if (fingers.size > 2) return;
      }
      drag = { x: e.clientX, y: e.clientY, k: k2, x0: e.clientX, swipe: e.pointerType === "touch" && !!view && view.scale <= view.fit * 1.001 };
      moved = false;
      box.setPointerCapture?.(e.pointerId);
    });
    box.addEventListener("pointermove", (e) => {
      if (fingers.has(e.pointerId)) fingers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinched) {
        if (fingers.size < 2 || !view || phase !== "idle") return;
        const [a, b] = [...fingers.values()], r = box.getBoundingClientRect(), k2 = SW / r.width, z = pinch(pinched.a, pinched.b, a, b);
        zoomTo(pinched.scale * z.ratio, [(z.at[0] - r.left) * k2, (z.at[1] - r.top) * k2]);
        return;
      }
      if (!drag || !view || phase !== "idle") return;
      const dx = (e.clientX - drag.x) * drag.k, dy = (e.clientY - drag.y) * drag.k;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.swipe) return;
      view.cx += dx; view.cy += dy;
      placeView();
    });
    const lift = (e) => {
      fingers.delete(e.pointerId);
      if (pinched) { if (!fingers.size) pinched = null; drag = null; return; }
      if (drag && ui.touch && e.type === "pointerup" && e.pointerType === "touch" && view && phase === "idle") {
        const dx = (e.clientX - drag.x0) * drag.k;
        if (drag.swipe && Math.abs(dx) > SWIPE && change(dx < 0 ? 1 : -1)) ui.sound(0);
      }
      drag = null;
    };
    box.addEventListener("pointerup", lift);
    box.addEventListener("pointercancel", lift);
    box.addEventListener("wheel", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!view || phase !== "idle") return;
      const r = box.getBoundingClientRect(), k2 = SW / r.width;
      zoomTo(view.scale * Math.pow(1.0015, -e.deltaY), [(e.clientX - r.left) * k2, (e.clientY - r.top) * k2]);
    }, { passive: false });
    // a click goes on to the next picture, as a swipe does (0xc56c: the touch flag 0x10)
    box.addEventListener("click", (e) => { e.stopPropagation(); if (!moved && phase === "idle" && change(1)) ui.sound(0); });
    overlay = {
      // the gallery's band goes as the viewer opens (0x4dfc -> 0x82d0) and comes back as it starts to close (0x9384)
      get hidesGuide() { return phase !== "close"; },
      close() { if (phase !== "idle") return false; close(); return true; },
      key(key, e) {
        if (e?.type === "keydown") held.add(key);
        if (phase !== "idle") return true;
        if (key === "ArrowLeft" || key === "ArrowRight") {
          // not while Up / Down is held, nor with fewer than two pictures (0xc56c)
          if (!held.has("ArrowUp") && !held.has("ArrowDown") && change(key === "ArrowLeft" ? -1 : 1)) ui.sound(0);
        } else if (key === "Enter" || key === " ") {
          // the A button: fill the screen, or back to the fit when already filling it (0xc56c)
          if (view) { ui.sound(0); zoomTo(Math.abs(view.scale - view.fill) < 1e-6 ? view.fit : view.fill); }
        } else if (key === "ArrowUp" || key === "+" || key === "=" || key === "PageUp") { if (view) zoomTo(view.scale * 1.1); }
        else if (key === "ArrowDown" || key === "-" || key === "PageDown") { if (view) zoomTo(view.scale / 1.1); }
        else if (key === "Home") { ui.sound(0); reset(); }
        else return false;
        return true;
      },
      step(dt) {
        // 0xcd58 shows the band before 0xc368 steps it, in the wipe's first frame
        let run = 0;
        if (phase === "change") {
          hold += dt;
          // (half a frame of slack: a display's frame times wobble around 1)
          // the band stays as it is for another two seconds, or comes in again if it had gone
          if (hold > CHANGE_HOLD + 0.5 && loaded && wipe.ready) { phase = "wipe"; if (guide.phase === "hold") guide.hold = 2; else if (guide.phase !== "in") guide.show(); run = Math.min(dt, hold - CHANGE_HOLD); }
        } else if (phase === "wipe") run = dt;
        if (run && wipe.step(run)) { wipe.remove(); wipe = null; phase = "idle"; }
        guide.step(dt);
        band.style.opacity = String(guide.alpha);
        band.style.transform = `translateY(${guide.offset}px)`;
        if (phase === "open" || phase === "close") {
          box.style.opacity = String(tw.step(dt));
          if (tw.done && phase === "open") phase = "idle";
          if (tw.done && phase === "close") {
            window.removeEventListener("keyup", onKeyUp);
            box.remove(); overlay = null;
          }
        }
      },
    };
    box.style.opacity = "0";
    guide.show();
    showPicture();
  }

  // ---- Music Player (cGalleryMusic 0x19518 / 0x19838: the list 0x1a7fc and the panel 0x1c9fc) --------------------------
  // Opening it marks the music playing heard (0x19518: 0x9c460, the number 0xac0688 keeps, -> 0x64f60 sets its bit
  // 0xc80 + n, as MPLY does), so the title's music 2 lists rows 0 and 7, then cuts it within a frame (0x19838 state 0:
  // 0x9c9b0 at 3333 a frame). Every track is listed, SYSMES 244 until it has been heard. Its playback is the Jukebox's;
  // closing the section stops it (closeSection).
  function musicView() {
    // (a touch device: the list's rows further apart, ten to the screen, so a finger finds one)
    const ML = ui.touch ? { ...MUSIC, ...TOUCH.music } : MUSIC;
    const playing = vm.audio.bgmState?.n;
    if (Number.isInteger(playing)) vm.unlocks.playedMusic(playing);
    vm.audio.stopBGM(0);
    const tracks = data.music;
    const text = data.musicText || { locked: "？？？", labels: ["Singer:", "Lyrics:", "Composer:", "Arrangement:"] };
    const unlocked = (t) => musicUnlocked(t, vm);
    // the list's background (0x1a058: music_soundbg top-left at (392, 106)) and its rows (0x1a1a4) are drawn within
    // y 109 - 1014 (0x1fa60(0, 109, 1920, 905))
    const list = place(el("div", "gl-music-list"), 392, 109, 960, 905);
    list.append(sprite(P, "music_soundbg", 0, -3, 960, 1736));
    const rows = el("div", "gl-music-rows");
    list.append(rows);
    content.append(list);
    let sel = 0, scroll = 0, area = "list", btn = 0, lastBtn = 0, row = -1;
    const rowEls = tracks.map((t, k) => {
      const r = el("button", "gl-track", unlocked(t) ? t.title : text.locked);
      place(r, MUSIC.x - 392, MUSIC.top - 109 + k * ML.pitch - ML.pitch / 2, 900, ML.pitch);
      if (ui.touch) r.style.lineHeight = `${ML.pitch}px`;
      rows.append(r);
      // (a touch device sets the titles larger, touch.css; one too long for its row at that size is brought down until it fits)
      if (ui.touch) for (let size = TOUCH.music.font; size > TOUCH.music.least && r.scrollWidth > r.clientWidth; ) r.style.fontSize = `${--size}px`;
      r.append(sprite(P, "music_bgline", 409 - MUSIC.x, ML.pitch / 2 + 12, 926, 16));
      pointed(r, () => {
        if (!ready() || (focused && area === "list" && sel === k)) return;
        focusContent(); area = "list"; rows.classList.add("focused"); select(k, false);
      });
      r.addEventListener("click", (e) => { e.stopPropagation(); if (ready()) { focusContent(); area = "list"; select(k); chooseRow(k); } });
      rows.append(r);
      return r;
    });
    // its scroll bar (0x1a1a4 -> 0x276b0, max 4720: the 80 rows past the first 15, 59 apart)
    const scroller = scrollBar(content);
    scroller.thumb.style.transition = "top .12s ease-out";   // with the rows (this port's stand-in for 0x1b2f0)

    // The panel at the right: the playing track's text (0x1dec4), its time and position (shown only: there is no
    // seeking), the buttons and the volume.
    content.append(sprite(P, "music_btnbg", 1368, 103, 448, 896));
    const now = place(el("div", "gl-now"), 1368, 0, 448, 520);
    const time = place(el("div", "gl-time"), 1490, 500, 200, 40);
    const vol = place(el("div", "gl-volume"), 1500, 878, 98, 40);
    content.append(now, time, vol);
    const slider = (y) => {
      const track = place(el("div", "gl-slider"), MUSIC.sliderX0 - 8, y - 22, MUSIC.sliderX1 - MUSIC.sliderX0 + 16, 44);
      track.append(sprite(P, "music_slider", 0, 10, 400, 24));
      const knob = el("div", "gl-knob");
      knob.style.backgroundImage = `url("${url(P, "music_soundbtn")}")`;
      content.append(track, knob);
      return { track, knob, y };
    };
    const pos = slider(MUSIC.posY), volume = slider(MUSIC.volY);

    const setKnob = (s, f, hot) => {
      place(s.knob, MUSIC.sliderX0 + f * (MUSIC.sliderX1 - MUSIC.sliderX0) - 43, s.y - 43, 80, 88);
      s.knob.style.backgroundPosition = `${hot ? -80 : 0}px 0px`;
    };
    const fraction = (s, e) => {
      const r = s.track.getBoundingClientRect(), k = r.width / (MUSIC.sliderX1 - MUSIC.sliderX0 + 16);
      return Math.max(0, Math.min(1, (e.clientX - r.left - 8 * k) / (r.width - 16 * k)));
    };
    // both bars take the pointer: a press or a drag along the volume sets it (touch, 0x1e7d4), and along the position
    // moves the track there (the game's position bar only showed it)
    const drags = (s, set) => s.track.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation(); s.track.setPointerCapture?.(e.pointerId); s.held = true; set(fraction(s, e));
      const move = (m) => set(fraction(s, m));
      const up = () => { s.held = false; s.track.removeEventListener("pointermove", move); s.track.removeEventListener("pointerup", up); s.track.removeEventListener("pointercancel", up); };
      s.track.addEventListener("pointermove", move); s.track.addEventListener("pointerup", up); s.track.addEventListener("pointercancel", up);
    });
    drags(volume, (f) => jukebox.setVolume(f));
    drags(pos, (f) => jukebox.seek(f));
    for (const s of [pos, volume]) s.track.addEventListener("click", (e) => e.stopPropagation());

    const buttons = {};
    const cell = (k, row) => `${-(CONTROL_CELL.x + CONTROL_CELL.dx * k)}px ${-CONTROL_CELL.rows[row]}px`;
    // (a touch device: the buttons larger and further apart on the same panel, TOUCH.musicControls and touch.css)
    const CT = ui.touch ? TOUCH.musicControls : CONTROLS;
    for (const [name, [x, y]] of Object.entries(CT)) {
      const k = BUTTONS.indexOf(name);
      const b = el("button", "gl-control");
      b.setAttribute("aria-label", name);
      b.style.backgroundImage = `url("${url(P, "music_controlbtn")}")`;
      place(b, x, y, CONTROL_CELL.w, CONTROL_CELL.h);
      const on = el("div", "sp gl-control-on");
      on.style.cssText = `left:0;top:0;width:${CONTROL_CELL.w}px;height:${CONTROL_CELL.h}px;background-image:url("${url(P, "music_controlbtn")}");background-position:${cell(k, 2)};visibility:hidden;`;
      b.append(on);
      b.addEventListener("mouseenter", () => { b.hover = true; });
      b.addEventListener("mouseleave", () => { b.hover = false; });
      b.addEventListener("click", (e) => { e.stopPropagation(); if (ready()) { focusContent(); area = "panel"; btn = k; press(btn); } });
      content.append(b);
      buttons[name] = { b, k, on };
    }
    // the flash (0x1e98c): the pressed button's selected row, alpha 1 to 0 over 1/6 s (0x21a20 channel 8, quadratic in)
    const flash = el("div", "sp gl-control-flash");
    flash.style.cssText = `width:${CONTROL_CELL.w}px;height:${CONTROL_CELL.h}px;background-image:url("${url(P, "music_controlbtn")}");visibility:hidden;`;
    content.append(flash);
    let flashTw = null;

    // row: the panel's +0x44, the row chosen last (-1 after a row not heard), which Prev / Next start from.
    const active = () => jukebox.state !== "stopped";
    const play = (k) => { row = k; jukebox.play(tracks[k]); };
    // A row chosen in the list (0x1dab8): the row playing (or paused) stops, as does a row not yet heard; another plays
    // from its beginning.
    function chooseRow(k) {
      if (active() && row === k) { jukebox.stop(); return; }
      if (!unlocked(tracks[k])) { jukebox.stop(); row = -1; return; }
      play(k);
    }
    // A panel button (0x1e98c): Play plays the list's row from its beginning, whatever plays (a row not heard: nothing);
    // Pause pauses or goes on; Stop stops; Repeat turns repeat on or off; Prev / Next play the row before / after the
    // one chosen last that has been heard, round and round.
    function press(b) {
      const name = BUTTONS[b];
      if (musicFlashes(b)) {
        const [x, y] = CT[name];
        place(flash, x, y);
        flash.style.backgroundPosition = cell(b, 1);
        flash.style.opacity = "1";
        flash.style.visibility = "visible";
        flashTw = new Tween(1, 0, MUSIC_FLASH, EASE.quad.in);
      } else { flash.style.visibility = "hidden"; flashTw = null; }
      if (name === "play") { row = sel; if (unlocked(tracks[sel])) jukebox.play(tracks[sel]); }
      else if (name === "pause") jukebox.toggle();
      else if (name === "stop") jukebox.stop();
      else if (name === "repeat") jukebox.setRepeat(!session.repeat);
      else {
        const dir = name === "next" ? 1 : -1, from = row;
        for (let i = 1; i < tracks.length; i++) {
          const r = (((from + dir * i) % tracks.length) + tracks.length) % tracks.length;
          if (r === from) break;
          if (unlocked(tracks[r])) { play(r); return; }
        }
      }
    }
    // follow: the list scrolls to show the row (the keys' moves; the pointer's leave the list where it is)
    function select(k, follow = true) {
      sel = Math.max(0, Math.min(tracks.length - 1, k));
      if (follow && sel < scroll) scroll = sel;
      if (follow && sel >= scroll + ML.rows) scroll = sel - ML.rows + 1;
      rows.style.transform = `translateY(${-scroll * ML.pitch}px)`;
      rowEls.forEach((r, i) => r.classList.toggle("sel", i === sel));
      scroller.set(scroll, tracks.length - ML.rows);
    }
    // the wheel moves the list by its own distance (WHEEL_GAIN), Page Up / Page Down a screenful
    const scrollRows = (n) => {
      scroll = Math.max(0, Math.min(tracks.length - ML.rows, scroll + n));
      rows.style.transform = `translateY(${-scroll * ML.pitch}px)`;
      scroller.set(scroll, tracks.length - ML.rows);
    };
    list.addEventListener("wheel", (e) => { e.stopPropagation(); scrollRows((wheelPixels(e, stageScale()) * WHEEL_GAIN) / MUSIC.pitch); }, { passive: true });
    // a drag over (408, 109, 926 x 905) moves the list by its velocity once it is 3 or more (0x1a7fc: 0x6a0, 0x40c(1),
    // 0x6c4 -> 0x27bd4); rows can rest part way
    ui.touchDrag?.(list, [408, 109, 926, 905], (v) => {
      if (Math.abs(v) < 3) return;
      scroll = Math.max(0, Math.min(tracks.length - ML.rows, scroll + v / ML.pitch));
      rows.style.transform = `translateY(${-scroll * ML.pitch}px)`;
      scroller.set(scroll, tracks.length - ML.rows);
    }, { widgets: null });

    let shownTrack = null;
    function nowPlaying() {
      const t = active() ? jukebox.track : null;
      if (t === shownTrack) return;
      shownTrack = t;
      now.textContent = "";
      if (!t) return;
      const { lines, top } = musicCredits(t, text.labels);
      const title = place(el("div", "gl-now-title", t.title), 0, top, 448);
      now.append(title);
      const below = top + title.offsetHeight + 58;
      lines.forEach((s, i) => now.append(place(el("div", "gl-now-by", s), 0, below + 32 * i, 448)));
    }
    let alive = true;
    function tick() {
      if (!alive || !list.isConnected) return;
      jukebox.update();
      const t = jukebox.position() * 1000, end = jukebox.track ? Math.trunc(jukebox.track.loopEnd / 48) : 0;
      setKnob(pos, active() && end ? Math.min(1, t / end) : 0, !!pos.held);
      setKnob(volume, session.volume, area === "volume" || !!volume.held);
      time.textContent = active() ? clock(t) : clock(0);
      vol.textContent = String(musicVolumeShown(session.volume)).padStart(3, " ");
      nowPlaying();
      for (const [name, { b, k, on }] of Object.entries(buttons)) {
        const isOn = (name === "play" && jukebox.state === "playing") || (name === "pause" && jukebox.state === "paused") || (name === "repeat" && session.repeat);
        const lit = b.hover || (focused && area === "panel" && BUTTONS[btn] === name);
        b.style.backgroundPosition = cell(k, lit ? 1 : 0);
        on.style.visibility = isOn ? "visible" : "hidden";
      }
      requestAnimationFrame(tick);
    }
    let focused = false;
    select(0);
    tick();
    return {
      size: () => tracks.length,
      // the band: the list's kind 0 (with Scroll, 0x1b1cc / 0x1c9fc), the panel's and the volume's 10 (0x1d5ec)
      helpKind: () => (area === "list" ? 0 : 10),
      focus(on) { focused = on; if (on) area = "list"; rows.classList.toggle("focused", on && area === "list"); },
      close() { alive = false; },
      page: (dir) => scrollRows(dir * (ML.rows - 1)),
      step(dt) {
        if (!flashTw) return;
        flash.style.opacity = String(flashTw.step(dt));
        if (flashTw.done) { flashTw = null; flash.style.visibility = "hidden"; }
      },
      key(k, e) {
        const fresh = !e?.repeat;
        if (area === "list") {
          if (k === "Enter" || k === " ") { chooseRow(sel); return true; }
          const to = musicListKey(sel, k, fresh, tracks.length);
          if (!to) return k.startsWith("Arrow");
          ui.sound(0);
          if (to.column) toColumn();
          else if (to.panel) { area = "panel"; btn = lastBtn; rows.classList.remove("focused"); }
          else select(to.sel);
          return true;
        }
        if (area === "panel") {
          if (k === "Enter" || k === " ") { press(btn); return true; }
          const to = musicPanelKey(btn, k);
          if (!to) return k.startsWith("Arrow");
          ui.sound(0);
          if (to.list) { area = "list"; rows.classList.add("focused"); }
          else if (to.volume) { lastBtn = btn; area = "volume"; }
          else btn = to.btn;
          return true;
        }
        // the volume (0x1cc68): Left / Right 0.01 (no sound); Up back to the button it came from
        if (k === "ArrowLeft" || k === "ArrowRight") { jukebox.setVolume(musicVolumeStep(session.volume, k === "ArrowLeft" ? -1 : 1)); return true; }
        if (k === "ArrowUp") { ui.sound(0); area = "panel"; btn = lastBtn; return true; }
        return k.startsWith("Arrow");
      },
    };
  }

  // ---- Movie (cGalleryMovie 0x17cd0; list 0x17dd0, keys 0x183ec, player 0x18b0c-0x19280) ------------------------------
  // In the game's order: the prologue, always there; op1_arc and op2_ciel once seen (G005 bits 0 and 1, which their story
  // movie's end sets, 0x40a00; the port also counts a movie recorded as watched before). Each with its movie_cur art
  // (normal, selected, pressed). Choosing one plays it at once (A: 0x4f28 and sound 1; the confirmation of state 3,
  // dialog 25, is never entered in this build): the music playing is kept (0x9c460) and fades out at 3.33 a frame while
  // a cover comes in over half a second (0x18d60: quadratic out, white for op1_arc, black otherwise); the movie plays
  // (a press stops it; the prologue starts music 2 at 360 s, 0x19040); then the cover, black, goes out over half a
  // second (0x19280, quadratic out) and the kept music starts again at volume 100.
  function movieView() {
    const g005 = vm.getVar ? vm.getVar("G005") || 0 : 0;
    const table = data.movieList || data.movies.map((name, row) => ({ name, row, number: 0, bit: null }));
    const movies = table.filter((m) => m.bit === null ? true : ((g005 >> m.bit) & 1) || vm.unlocks.movies.has(m.name));
    // movie_cur's cells: the lit and pressed ones start 3 px further left than 259 apart, their frames' glow being wider: cut
    // from 256 and 512 the picture stands where the normal cell has it (with 259 and 515 it jumped 3 px under the pointer)
    const COLS = [0, 256, 512], ROWS = [0, 155, 307];
    let sel = 0;
    const cells = movies.map((m, k) => {
      const c = k % GRID.columns, r = Math.floor(k / GRID.columns);
      const b = place(el("button", "gl-movie"), GRID.x + c * GRID.dx - 16, GRID.y + r * GRID.dy - 13, 259, 155);
      b.style.backgroundImage = `url("${url(P, "movie_cur")}")`;
      b.setAttribute("aria-label", m.name);
      pointed(b, () => { if (overlay || !ready() || (focused && sel === k)) return; focusContent(); select(k); });
      b.addEventListener("click", (e) => { e.stopPropagation(); if (!overlay && ready()) { focusContent(); select(k); ui.sound(1); playMovie(m); } });
      content.append(b);
      return b;
    });
    let focused = false;
    function select(k) {
      sel = Math.max(0, Math.min(movies.length - 1, k));
      cells.forEach((b, i) => {
        b.style.backgroundPosition = `${-COLS[focused && i === sel ? 1 : 0]}px ${-ROWS[movies[i].row]}px`;
      });
    }
    function playMovie(m) {
      const b = cells[sel];
      b.style.backgroundPosition = `${-COLS[2]}px ${-ROWS[m.row]}px`;
      const audio = vm.audio, kept = audio.bgmState ? audio.bgmState.n : null;
      fadeMusicOut(audio);
      const cover = el("div", "gl-movie-cover");
      cover.style.background = m.name === "op1_arc" ? "#fff" : "#000";
      cover.style.opacity = "0";
      page.append(cover);
      const catcher = el("div", "gl-movie-catcher");
      let tw = new Tween(0, 1, 0.5, EASE.quad.out), phase = "in";
      const end = () => { if (phase === "play") env.endMovie(); };
      catcher.addEventListener("click", (e) => { e.stopPropagation(); end(); });
      overlay = { hidesGuide: true, close: end, key(k) { if (k === "Enter" || k === " ") end(); return true; }, step(dt) {
        if (phase !== "in" && phase !== "out") return;
        cover.style.opacity = String(tw.step(dt));
        if (!tw.done) return;
        if (phase === "in") {
          phase = "play";
          page.style.visibility = "hidden";
          ui.root.append(catcher);
          env.playMovie(m.name, { gallery: true, number: m.number, music: m.number === 4 ? { at: 360, n: 2 } : null }).then(() => {
            catcher.remove();
            if (!page.isConnected) return;
            page.style.visibility = "";
            cover.style.background = "#000";
            phase = "out"; tw = new Tween(1, 0, 0.5, EASE.quad.out);
          });
        } else {
          phase = "done"; cover.remove(); overlay = null;
          if (kept !== null && kept !== undefined) audio.playBGM(kept, {});
          if (page.isConnected) select(sel);
        }
      } };
    }
    select(0);
    return {
      size: () => movies.length,
      focus(on) { focused = on; select(sel); },
      key(k) {
        if (k === "Enter" || k === " ") { if (movies[sel]) { ui.sound(1); playMovie(movies[sel]); } return true; }
        const to = movieListKey(movies.length, sel, k);
        if (!to) return k.startsWith("Arrow");
        ui.sound(0);
        if (to.column) toColumn(); else select(to.sel);
        return true;
      },
    };
  }

  // ---- Ending List: the three endings and the bad ends, each seen once its Ciel-sensei episode has begun ----------------
  // Laid out as native 0xDAF8 / 0xDDA4 (see endings.js). A seen entry asks to play its episode, then plays it. The keys
  // walk the game's rows (endingKey).
  function endingView() {
    const table = data.endings?.list;
    if (!table) { env.toast("Ending list missing: run web/tools/build_gallery.py", 5000); return { size: () => 0, focus() {}, key: () => false }; }
    const list = endingList(table, vm.flow);
    const items = [];   // what can be chosen: { entry, el, face, w, row, col }
    const caption = el("div", "gl-ending-caption");
    const button = (entry, x, y, size, art, w, h, row, col) => {
      const b = place(el("button", "gl-ending-btn"), x, y, size, size);
      const face = sprite(P, art, (size - w) / 2, (size - h) / 2, w, h, 0, 0, "gl-ending-face");
      b.append(face);
      b.setAttribute("aria-label", entry.title);
      const k = items.length;
      items.push({ entry, el: b, face, w, row, col });
      pointed(b, () => { if (overlay || !ready() || (focused && sel === k)) return; focusContent(); select(k); });
      b.addEventListener("click", (e) => { e.stopPropagation(); if (!overlay && ready()) { focusContent(); select(k); ui.sound(1); ask(entry); } });
      return b;
    };
    const ICONS = ["ending_icon_Arcueid", "ending_icon_Ciel_1", "ending_icon_Ciel_2"];
    for (const e of list.main) {
      const x = END.main.x + END.main.dx * e.slot;
      content.append(sprite(P, e.seen ? ICONS[e.slot] : "ending_icon_non", x, END.main.y, END.main.w, END.main.h));
    }
    for (const e of list.bad) {
      const x = END.bad.x + END.bad.dx * e.column, y = END.bad.y + END.bad.dy * e.row;
      content.append(sprite(P, "ending_badend", x, y, END.bad.w, END.bad.h, END.bad.dx * e.column + 8, END.bad.dy * e.row + (e.seen ? END.bad.seenY : END.bad.lockedY)));
    }
    // Buttons after the art, in the native order: the endings, the bad ends, then the final episode.
    for (const e of list.main) if (e.seen) content.append(button(e, END.main.button.x + END.main.dx * e.slot, END.main.button.y, END.main.button.size, "ending_btn", 368 / 3, 128, 0, e.slot));
    for (const e of list.bad) if (e.seen) content.append(button(e, END.bad.x + END.bad.dx * e.column, END.bad.y + END.bad.dy * e.row, END.bad.button, "ending_badendbtn", 296 / 3, 104, e.row + 1, e.column));
    const final = !!list.final?.offered;
    if (final) content.append(button(list.final, END.final.x, END.final.y, END.final.size, "ending_btn", 368 / 3, 128, 3, 5));
    content.append(caption);
    const at = (row, col) => items.findIndex((it) => it.row === row && it.col === col);
    const seen = (row, col) => at(row, col) >= 0;
    let sel = 0, focused = false;
    function select(k) {
      if (!items.length) return;
      sel = Math.max(0, Math.min(items.length - 1, k));
      items.forEach((it, i) => { it.face.style.backgroundPositionX = `${-(focused && i === sel ? it.w : 0)}px`; });
      caption.textContent = focused ? items[sel].entry.title : "";
    }
    function ask(entry) {
      const it = items[sel];
      it.face.style.backgroundPositionX = `${-2 * it.w}px`;
      const keys = ui.keyFn, backFn = ui.backFn;
      let box = null;
      const done = (play) => {
        if (box) box.remove();
        overlay = null;
        ui.keyFn = keys; ui.backFn = backFn; ui.items = []; ui.horizontal = false;
        if (play) replayOut(() => env.playEpisode(entry)); else select(sel);
      };
      overlay = { close: () => done(false), key: () => false };
      ui.keyFn = null;
      // the entry's dialog (table 0x3374ec), starting on No (0xea4c: 0x49710(n, 1))
      ui.dialog(entry.prompt, () => done(true), () => done(false), { startNo: true });
      box = [...page.querySelectorAll(".dialog")].at(-1);
    }
    select(0);
    return {
      size: () => items.length,
      focus(on) { focused = on; select(sel); },
      key(k) {
        if (k === "Enter" || k === " ") { if (items[sel]) { ui.sound(1); ask(items[sel].entry); } return true; }
        const it = items[sel];
        if (!it) return k.startsWith("Arrow");
        const to = endingKey(seen, final, { row: it.row, col: it.col }, k);
        if (!to) return k.startsWith("Arrow");
        ui.sound(0);
        if (to.column) toColumn(); else select(at(to.row, to.col));
        return true;
      },
    };
  }

  function focusContent() {
    if (focus === "content" || !view || !view.size()) return;
    focus = "content"; view.focus(true); draw();
  }

  // Keys: the column moves up and down; Choose enters a section; Back leaves it, then the gallery. Each section plays
  // its own sounds (native 0xacef0): 0 the cursor, 1 a choice, 2 back.
  ui.keyFn = (e) => {
    const k = e.key;
    if (k === "F5" || k === "F11" || k === "F12") return false;
    if (!ready()) return true;
    if (overlay) {
      if (k === "Escape" || k === "Backspace") back(); else overlay.key(k, e);
      return true;
    }
    if (k === "Escape" || k === "Backspace") { back(); return true; }
    if (k === "PageUp" || k === "PageDown") { view?.page?.(k === "PageUp" ? -1 : 1); return true; }
    if (focus === "content" && view && view.key(k, e)) return true;
    if (focus === "menu") {
      if (k === "ArrowUp") { ui.sound(0); menuSel = (menuSel + ITEMS.length - 1) % ITEMS.length; draw(); }
      else if (k === "ArrowDown") { ui.sound(0); menuSel = (menuSel + 1) % ITEMS.length; draw(); }
      else if (k === "Enter" || k === " ") { ui.sound(1); choose(); }
      else if (k === "ArrowRight") focusContent();
    }
    return true;
  };
  ui.backFn = back;
  ui.backSound = null;   // back() plays it
  animate((dt) => { if (overlay?.step) overlay.step(dt); });

  // The gallery's help band, its guide (0x6124: kind 10, sliding; drawn by 0x4a8f0 as ui.helpBar draws it). It comes in
  // with the column (0x6934) on the column's kind 10 (Back, Choose, Move); a section with the cursor gets its own (its
  // +0x88 through 0x74f0 / 0x82bc: the CG grid 0, with Scroll, when its rows scroll, else 10; the Music Player's list 0,
  // its panel 10; Movie and the Ending List 10), the column 10 again; it goes while the viewer or a movie plays (0x82d0
  // from 0x4dfc / 0x4f28; back with 0x9384 / 0x4c8c) and as the gallery leaves for the title (0x7ac4). The flowchart is a
  // section too (0x7f38 index 2): the guide takes its kind (0x7624 -> 0x5c4c, 0x123f4); flowchart.js carries it on from
  // this guide's kind and alpha (opts.guide), as ui.ghost drops this band.
  const HELP = { 0: ["Back", "Choose", "Move", "Scroll"], 10: ["Back", "Choose", "Move"] };
  const band = el("div", "fc-help gl-guide");
  page.append(band);
  const guide = new GuideFx(10);
  let bandKind = null, wantKind = null;
  const bandStep = (dt) => {
    const want = leaving || overlay?.hidesGuide ? -1 : focus === "content" && view?.helpKind ? view.helpKind() : 10;
    if (want !== wantKind) { wantKind = want; if (want < 0) guide.hide(); else guide.to(want); }
    guide.step(dt);
    if (guide.kind !== bandKind) { bandKind = guide.kind; band.textContent = ""; ui.helpBar(band, HELP[bandKind] || HELP[10], bandKind); }
    band.style.opacity = String(guide.alpha);
    band.style.transform = `translateY(${guide.offset}px)`;
  };
  animate(bandStep);

  show(section, false, false);
  // Opened from the title, the band is GALLERY_OPEN.scrollBar into its fade on the first frame, as the scroll bar is
  // (the native frames: both full by the 11th frame, the column only by the 26th; G20).
  if (boot) bandStep(boot.scrollBar * 60);
  ui.ghost(opts.ghost, fadeOut());
}
