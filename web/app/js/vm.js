// vm.js - runs the game's scripts. Each command changes layers, audio, text or variables; a few wait for something.
import { parseOpts } from "./audio.js";
import { AnimationClock, Motion, START_ONLY, Value, layerState } from "./animation.js";
import { carrySway, makeEffect, rebaseEffect, settleHaze } from "./effects.js";
import { FlowProgress } from "./flowchart-model.js";
import { Unlocks } from "./unlocks.js";
import { allEpisodesDone, inferEndings } from "./endings.js";
import { blurName, pivotOf, sizeClass, wrapRotation } from "./transform.js";
import { splitSample, startLines, startSplit, stopLines, stopSplit } from "./screenfx.js";
import { reflow, wrapContext, choiceText } from "./reflow.js";
import { colourMarks, plain, SOFT } from "./textbox.js";

function num(s) {
  if (s === undefined || s === "") return undefined;
  // The engine reads numbers with strtol (base 10) and its expression tokenizer stops at a "." (0x2d3c -> 0x3160), so
  // a decimal keeps its whole part: STCH's alpha 173.4 is 173 and 0.01 is 0, SSW2's factor 0.5 is 0 (that layer does
  // not sway). Hex (STEC's colours, read by strtol base 0) is kept below.
  const dot = s.indexOf(".");
  if (dot > 0 && /^-?\d+\.\d*$/.test(s)) s = s.slice(0, dot);
  if (/^-?\d+$/.test(s)) return Number(s);
  const m = /^(-?\d+)([-+])(\d+)$/.exec(s);
  if (m) return m[2] === "-" ? Number(m[1]) - Number(m[3]) : Number(m[1]) + Number(m[3]);
  if (/^0x/i.test(s)) return parseInt(s, 16);
  const n = Number(s);
  return Number.isNaN(n) ? undefined : n;
}

// How far back the player can rewind or Quick Jump: the history is a ring of 800 records (0x5a910 wraps at 799; the backlog reads
// the same ring, 0x527a0), and a record is made not only per message but per FADS, per sound command, per ATSV, per choice row,
// per first layer change after the last WTTM / VPLY / MSAD, ... about 3.1 per message (N2-75). The port keeps a point per wait and
// counts the records (VM.ringAdd), dropping points the ring has passed.
const RING = 800;

// The game's read marks (system data +0x667 in the save, *0xae0350 + 0xd): one byte per message block, the highest
// message index read in it. Blocks 0-0xfb3 count; the scripts' blocks run to 0xeba.
const READ_BLOCKS = 0xfb4;

// Placement the original keeps per layer besides its animated values (see transform.js): the SBAS parent, the
// STCH link (whose clip and alpha it shares), the STPV pivot (where its position is drawn), the panel clip with its
// feathered edge width and frame style and STRR rotation, SACL (the clip does not move the layer), the SOXY offset,
// STCH's own scale and STZ4's eighth argument (the zoom after the rotation).
const PLACEMENT = ["parent", "link", "pivot", "clip", "border", "frame", "clipRot", "absolute", "offset", "scale", "stretch", "cut", "base"];

const ruleName = (n) => `RULE_${String(n).padStart(2, "0")}`;
// STCH and SCH2 keep their alpha within 0-255 (0x60840: above 254 is 255, below 0 is 0).
const clampAlpha = (v) => Math.min(255, Math.max(0, v));
// The engine runs the script once a frame up to its next wait (0x802c0 -> 0x77790), and when STCH, SCH2, STCC or STNS
// left layer changes waiting (state +0x7ca) it puts them on screen there and then, with no transition
// (0x5d3a0(0, 0)). These are the commands the port waits at. The window commands CLO2-CLO5 always end the frame too
// (each handler returns through 0x7fef0), so a change staged before one shows at once and a FADS after it fades
// between two equal pictures (28 places, e.g. 04_01_CIEL04_1 ops 1126-1131).
export const WAITS = new Set(["MSG", "MSAD", "WTTM", "VCWT", "STCF", "SELA", "SELS", "SELD", "TOMW", "CLO2", "CLO3", "CLO4", "CLO5"]);
// The commands that end the interpreter's frame (0x77790 returns through 0x7fef0): the waits, and a FADS (0x80254-0x80274).
const FRAME_ENDS = new Set([...WAITS, "FADS"]);
// The speed a frame of skipping runs at (0x40ed0: the toggle's table 0x34e054, and the fast-forward key held all the way, its trigger value 255 x 4 / 15 capped at 64;
// a native run with ZR held passes a 60 s WTTM in about a second). It adds that many frames to a delayed sound's countdown each frame (0x4a5b0 -> 0x9b7f0 -> 0x65e50),
// and a WTTM loses that many (0x81b30).
const SKIP_SPEED = 64;
// What a frame of skipping adds to everything the layer update runs (0x4a5b0 stores speed / 2 + 1 in 0x590e80, which 0x48ac0 hands to 0x3c970, the
// window's 0x38d40 and the transition's level): tweens, motion tracks, quakes, shakes, sways, SHOK, speed lines, the window's fades and FADS. Native
// runs with ZR held (TODO item 110): a mark on a 60 s STCL moves 33 / 4096 of its way a frame, a 3000 ms STGS takes 6 frames, a 3000 ms FADS 8.
const SKIP_STEP = 33;
// The transition's own frame length (0x4b740: the level falls 1 / (ms / 16.666) a step), a hair short of a frame, so a 500 ms change takes 31 steps.
const FADS_FRAME = 16.666;
// FADS's fourth argument (0x60610) closes the text window for the transition (+0x89e, F1103): 1 always; 2 when the
// transition is timed (ms > 1) and no CLO4 / CLO5 fade is running (0xae05a8 is 0); none or -1 only when config +0x63
// is 0, which the engine sets to 1 (0x2c810) and no setting changes. 0 leaves the window.
export function fadeClosesWindow(arg, ms, windowRate = 0) {
  return arg === 1 || (arg === 2 && ms > 1 && !windowRate);
}
// STMA's third argument, the same without a time (0x99620).
export function motionClosesWindow(arg, windowRate = 0) {
  return arg === 1 || (arg === 2 && !windowRate);
}
const WINDOW_VARS = new Set(["F1104", "F1105", "F1106", "F1107", "F1110", "F1111", "F1112", "F1113"]);

function newLayer(id, image) {
  return { id, image, ready: null, promise: null, x: new Value(240), y: new Value(136), zx: new Value(1000), zy: new Value(1000), rot: new Value(0), alpha: new Value(255), z: 0, blend: 0, blurX: 0, blurY: 0, tint: null, mul: null, effect: 0, bright: 1, contrast: 1, rule: null, grain: 0,
    parent: -1, link: -1, pivot: null, clip: null, border: 0, frame: 0, clipRot: 0, absolute: false, offset: null, scale: 1000, stretch: false, cut: false, base: null, motion: null, effects: {} };
}

// Colour: STEC's preset (effect) and colour (tint), SNX2 brightness and SNX3 contrast (1 = unchanged). The engine
// keeps one colour per layer (record +0x1cc): with preset 1 it is the silhouette's (tint here); otherwise the picture
// is multiplied by it (0x36520: 0x3c10 -> 0xb03e0), which only a motion sets (mul here, null for white).
const COLOUR = ["tint", "mul", "effect", "bright", "contrast", "rule", "grain"];

// What 0xa3180 bakes into a layer's picture when it is created: the record's preset, brightness and contrast (and a track
// that is running at the time has written its values there first); the silhouette colour goes with it.
function bakeOf(l, now) {
  const st = l.motion ? l.motion.sample(now, l) : {};
  return { effect: l.effect, tint: l.tint, bright: st.bright ?? l.bright, contrast: st.contrast ?? l.contrast };
}
// Whether two layers show the same picture number: its name with its blur digits (the blurred entry is a picture of its own).
function samePicture(a, b) {
  const name = (l) => blurName(l.image, l.blurX, l.blurY)?.toUpperCase() || null;
  return name(a) !== null && name(a) === name(b);
}

// What a motion wrote stays on the layer: 0x97b80 writes the layer's own record, so the values outlast the track.
// `keepTweens` leaves a property alone while a script tween is still moving it.
function bake(l, values, now, keepTweens = false) {
  for (const [k, v] of Object.entries(values)) {
    if (k === "colour") { if (l.effect === 1) l.tint = v.slice(); else l.mul = v.slice(); continue; }
    if (l[k] instanceof Value) { if (!keepTweens || l[k].done(now)) l[k] = new Value(v); }
    else l[k] = Array.isArray(v) ? v.slice() : v;
  }
}

// STRA's heat haze is kept per layer number, not per picture (see op_STRA): the record on screen (n, its phase start,
// fade-in, fade-out) and next, the per-layer state (+0x1364) each commit copies into it.
const LAYERS = 40;
const newHaze = () => ({ n: 0, start: 0, ramp: 0, stop: 0, left: 0, leftAt: 0, next: 0 });
const rebaseHaze = (h, from, to) => ({ ...h, start: h.start - from + to, leftAt: h.leftAt - from + to });

// A screen effect's start and end times, moved from one clock to another (for saves).
// A split restored from a save point (0x5baf0 -> 0x2e430): on from the start if it was on, no fade-out carried over.
function restoredSplit(saved, current, now) {
  if (!saved || saved.end !== null) return null;
  const alpha = saved.level ? 1 : (splitSample(current, now)?.alpha ?? 0);
  return { kind: "split", start: now, end: null, level: saved.level, preset: saved.preset, alphaFrom: alpha, alphaAt: now };
}

function rebaseTimes(e, from, to) {
  if (!e) return null;
  const r = { ...e, start: e.start - from + to };
  if (e.end !== null && e.end !== undefined) r.end = e.end - from + to;
  if (e.alphaAt !== null && e.alphaAt !== undefined) r.alphaAt = e.alphaAt - from + to;
  return r;
}

function placement(l) {
  return Object.fromEntries([...PLACEMENT, ...COLOUR].map((k) => [k, structuredClone(l[k])]));
}

// STCH and SCH2 args 11-17 and 19: the link, the clip rectangle, its feathered edge width, its frame style and its
// rotation. Blank keeps what is there.
function panelArgs(l, link, cx, cy, cw, ch, border, frame, rot) {
  const n = num(link);
  if (link !== undefined && link !== "") l.link = n ?? -1;
  if ([cx, cy, cw, ch].some((v) => num(v) !== undefined)) {
    const c = l.clip ? l.clip.slice() : [0, 0, 0, 0];
    [cx, cy, cw, ch].forEach((v, i) => { if (num(v) !== undefined) c[i] = num(v); });
    l.clip = c;
  }
  if (num(border) !== undefined) l.border = num(border);
  if (num(frame) !== undefined) l.frame = num(frame);
  if (num(rot) !== undefined) l.clipRot = wrapRotation(num(rot));
}

// The next drawn frame (a timer where there is no window, as in the tests).
// A manual or automatic save marks its record with F1118 (0x50fc0 at 0x51554, 0x52aa0 at 0x52b30: 0x53f00(record + 8, 0x45e, 1)), which a
// load gives back, so "Save Progress?" is not asked again; the quick save (0x52860) copies the checkpoint as it is. Saves made
// before this just load with F1118 as they were (N2-37).
export const markSaved = (vars) => ({ ...vars, F1118: 1 });

const FRAME_MS = 1000 / 60;
const nextFrame = () => new Promise((r) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => r()) : setTimeout(r, 16)));

export class VM {
  constructor({ gfx, audio, text, onChoice, onConfirm, onChoiceCancel, onSkipEnd, onWait, playMovie, toast, onAskSave, onSceneSkip, onLock, onCountdown, popup }) {
    this.gfx = gfx; this.audio = audio; this.text = text; this.onChoice = onChoice; this.onConfirm = onConfirm; this.onWait = onWait; this.playMovie = playMovie; this.toast = toast;
    this.onChoiceCancel = onChoiceCancel; this.onSkipEnd = onSkipEnd;
    this.onAskSave = onAskSave; this.onSceneSkip = onSceneSkip; this.onLock = onLock; this.onCountdown = onCountdown; this.popup = popup;
    this.savePoint = null;    // the checkpoint saves resume at (native 0x527f0 -> 0xf17ff0): ATSV and a message, each on a page's first line only (N2-1)
    this.pageCheckpoint = false;   // the page's first line has come: its first wait becomes the checkpoint
    this.passedHere = false;       // the newest record is of a line that went on without a click, and no later MSG has started
    this.startPoint = null;        // the record of a first line that goes on without a click, while it is the newest record (item 58)
    this.page = 0;            // PGST's page id (state +0x8c4)
    this.locked = false;      // XSTP .. XRSM: the player's controls are off (native task type 1, 0x40b70 / 0x40c60)
    this.keepMusic = false;   // RTM2 / RTMN: the music goes on past the script's end (0x146e64d, read by 0x5f200)
    this.replay = false;      // a scene played from the gallery (native 0xb34af0, tested by IFSC)
    this.replaySource = null; // which gallery section started it: "flowchart" or "ending" (0x50f0 reads *0xae0288 == 2, the flowchart's)
    this.lastVoice = null;    // Replay Voice's target (0xae0790): VPLY and VPL2 write it, only a reset or a restore clears it (N2-79)
    this.recordVoice = null;  // the voice the next MSG's record keeps (0xae08b0): VPLY / VPL2 write it, that MSG or a FADS clears it
    this.msgVoice = null;     // the voice in the record of the current message (+0x35b8), which a restore plays
    this.delayed = new Map(); // sound effect commands waiting out their 068 delay, by channel
    // Text settings (the config's system page; native config +0xe/+0x10, +0x5a/+0x5b, +0x61/+0x62, +0x1e, +0x5e, +0x60)
    this.textSpeed = 35; this.readSpeed = 15;
    this.wholeUnread = false; this.wholeRead = false;
    this.fadeUnread = true; this.fadeRead = true;
    this.fastForwardRead = false; this.skipRead = false; this.skipConfirm = true;
    this.scripts = new Map();
    this.index = null;
    this.lines = null;
    this.vars = {};
    this.globals = {};
    this.flow = new FlowProgress();
    this.unlocks = new Unlocks();
    this.layers = new Map();
    this.pending = new Map();
    this.removed = new Set();
    this.ghosts = new Map();  // the state of layer numbers with no layer on them (stateFor)
    this.staged = false;      // STNS left a change for the next commit (state +0x7ca) without a staged layer
    this.hazes = Array.from({ length: LAYERS }, newHaze);
    this.gfx.hazes = this.hazes;
    this.clock = new AnimationClock();
    // The story's frames as the display counts them: the clock above without fast forward's steps. The RGB split runs on it (0x2f910 takes
    // no step: a FADE 41 under fast forward fades for its 60 frames while the script runs on, native frames).
    this.frameClock = new AnimationClock();
    if (this.gfx) this.gfx.splitTime = () => this.frameNow();
    this.tickers = [];        // waits for the next frame step (tick)
    this.sleepers = new Set();   // the timed waits running (sleep), poked when fast forward starts or stops
    this.ticks = 0;
    this.externalTicks = false;  // main.js steps the frames (tick); without it a timer does
    this.loadHold = 0;        // pictures loading: the game's time stands still (waitImages)
    // The delay slots' clock (0x65e50, run by the mixer 0x9b7f0 from the app's loop every frame in any state): it goes on while a menu or
    // another page is open, where the story's clock stands still; only the port's own holds stop it (pictures loading, a hidden tab).
    this.soundClock = new AnimationClock();
    this.motions = {};
    this.motionStarts = {};
    this.skip = false;        // fast-forward
    this.skipPaced = true;    // fast forward goes one message a frame (false: the smoke test's full speed)
    this.forceSkip = false;   // fast-forward through unread text too
    this.skipToggle = false;  // the skip toggle (0xae0660 bit 1), which the fast-forward key leaves alone
    this.fastForwardHeld = false;   // the fast-forward key is doing the skipping (main.js)
    this.instantModes = null; // what the skip flags were as an instant run took them over (0x802c0 and 0x6ef30 leave 0xae0660 alone, N2-208)
    this.sceneSkip = null;    // a read-scene skip counting down: no frame step runs until it has (0x40ed0 states 1-3, N2-130)
    this.auto = false;
    this.trail = [];          // earlier points of play, for rewinding
    this.choosing = null;     // the choice on screen: where its command is, and its labels
    this.msgPending = false;  // a message is on its way to waiting for the player
    this.restoring = false;
    this.pageEnd = false;
    this.warned = new Set();
    this.running = false;
    this.generation = 0;
    this.pc = 0;
    this.script = null;
    this.scriptIndex = 0;
    this.choices = [];
    this.lastChoice = -1;     // the answer index of the last choice taken (native 0xae0aa0)
    this.instant = false;     // a read scene's instant run (native 0xae0568), see beginInstant
    this.scenePoints = [];    // ATSV's checkpoints for "Return to Previous Scene" (native ring 0xae04a0, 299 at most)
    this.nearScene = 0;       // set to 2 by each of them, one less at each message (0x146e66c)
    this.stopped = false;
    this.waitResolve = null;
    this.lastMessageKey = null;
    this.readBlocks = new Uint8Array(READ_BLOCKS);   // the game's read marks (see zStep)
    this.zCurrent = null;     // the last Z command's block and index (0xae0810 / 0xae0818), packed block x 256 + index
    this.zFrom = null;        // the label a jump went to: its label Z commands run from that one on (loop)
    this.zSkip = -1;          // an op whose label Z commands have run already (a restored choice)
    this.msgRead = false;     // whether the message on screen had been read (0xae08c8; MSAD leaves it)
    this.ring = 0;            // history records made so far (the native ring of 800, see ringAdd)
    this.ringDirty = false;   // F991: a layer record was made and a WTTM, VPLY or MSAD has not closed it yet
    this.ringGate = false;    // 0x146e644: after a message with @n no records are made until the next MSG
  }

  async init() {
    // The tables are asked for together, and read below in their old order: nothing can start before the last of them is in.
    const asked = Object.fromEntries(["scripts/index", "text", "audio_tables", "images", "effects", "system", "animations", "gallery", "flowchart"]
      .map((n) => [n, fetch(`/assets/${n}.json`)]));
    for (const p of Object.values(asked)) p.catch(() => {});   // each is awaited where it is read
    this.index = await (await asked["scripts/index"]).json();
    this.lines = await (await asked.text).json();
    this.audio.table = await (await asked.audio_tables).json();
    this.movies = this.audio.table.movies || {};
    this.gfx.images = await (await asked.images).json();
    const effects = await asked.effects;
    if (effects.ok) { const e = await effects.json(); this.gfx.effects = e.presets; this.gfx.focusLines = e.focusLines; this.gfx.hazeTable = e.haze || null; }
    else console.warn("Colour effects missing: run web/tools/build_effects.py from the port root");
    const system = await asked.system.catch(() => null);
    if (system?.ok) {
      this.system = await system.json();
      this.audio.seLoops = this.system.seLoops || {};
      this.audio.musicLoops = this.system.musicLoops || {};
      this.text.windows = this.system.windows || null;
      this.audio.voices = this.system.voices || null;
      // the volume curve (0x3355f0) and the sound archive's per-sound volume
      if (this.system.volumeCurve) this.audio.setTables?.(this.system);
      else console.warn("Volume curve missing: run web/tools/build_system.py from the port root");
      // pictures whose pivot is not their centre (transform.js defaultPivot): info[3], info[4]
      for (const [name, [ax, ay]] of Object.entries(this.system.pivots || {})) {
        const info = this.gfx.images[name];
        if (info) this.gfx.images[name] = [info[0], info[1], info[2], ax, ay];
      }
      // and what the cut to whole units loses of each picture's pivot (transform.js pivotOf, `cut`): info[5], info[6]
      for (const [name, [cx, cy]] of Object.entries(this.system.pivotCuts || {})) {
        const info = this.gfx.images[name];
        if (info) this.gfx.images[name] = [info[0], info[1], info[2], info[3] ?? 0.5, info[4] ?? 0.5, cx, cy];
      }
      // A pivot is a fixed point of the picture's table rectangle (+0x34 / +0x38 in 640 x 362 units from its top left), and
      // the picture is drawn at its stored size from there (0xb0710): where the table's size is not the stored size
      // (Z20_L_10_00_N00 1143 x 3138 against 1113 x 3080; checked against a native frame), the fraction of the stored size
      // that reaches the same point is the table's fraction x the table's size / the stored size.
      for (const [name, [tw, th]] of Object.entries(this.system.imageSizes || {})) {
        const info = this.gfx.images[name];
        if (info) {
          info[3] = (info[3] ?? 0.5) * tw / info[0];
          info[4] = (info[4] ?? 0.5) * th / info[1];
        }
      }
    } else console.warn("System tables missing: run web/tools/build_system.py from the port root");
    const animations = await asked.animations;
    if (animations.ok) this.motions = (await animations.json()).tracks;
    else console.warn("Motion tracks missing: run web/tools/build_animations.py from the port root");
    try { this.globals = JSON.parse(localStorage.getItem("tsuki.globals") || "{}"); } catch { this.globals = {}; }
    this.loadRead();
    await this.loadReadBlocks();
    const gallery = await asked.gallery;
    if (gallery.ok) { this.gallery = await gallery.json(); this.unlocks.install(this.gallery); }
    const flow = await asked.flowchart;
    if (flow.ok) {
      const chart = await flow.json();
      if (chart.version === 2) { this.flowChart = chart; this.flow.install(chart, (i) => this.isRead(i)); }
    }
    // Endings reached before the Ciel-sensei episodes ran here (see endings.js).
    if (this.gallery?.endings) inferEndings(this.flow, this.gallery.endings.list, (i) => this.isRead(i));
  }

  // ---- text the player has read --------------------------------------------------------------------------------
  // The game's read state is per message block (readBlocks, zStep); the port also keeps a bit per line it showed,
  // which only the one-time inferences of older progress read (flowchart-model.js install, endings.js).
  async loadReadBlocks() {
    this.readBlocks = new Uint8Array(READ_BLOCKS);
    let stored = null;
    try { stored = localStorage.getItem("tsuki.readBlocks"); } catch { /* none */ }
    if (stored !== null) {
      try {
        const s = atob(stored);
        for (let i = 0; i < s.length && i < READ_BLOCKS; i++) this.readBlocks[i] = s.charCodeAt(i);
      } catch { /* none */ }
      return;
    }
    // A profile from before the marks were kept: every line it showed raises its message's block to that index.
    if (!this.read?.some((b) => b)) return;
    try {
      const map = await (await fetch("/assets/scripts/zlines.json")).json();
      for (const [line, codes] of Object.entries(map)) if (this.isRead(Number(line))) for (const c of codes) this.raiseRead(c);
      this.saveRead();
    } catch (e) { console.warn("read marks not carried over:", e.message); }
  }

  // A block's byte is raised to an index read (blocks past 0xfb3 have none).
  raiseRead(code) {
    const b = code >> 8, i = code & 255;
    if (b > 0xfb3 || i <= this.readBlocks[b]) return false;
    this.readBlocks[b] = i;
    return true;
  }

  // 0x53a60: a message (or label) is read when its block's byte is set and not below its index.
  zRead(code) {
    if (code === null || code === undefined) return false;
    const b = code >> 8, i = code & 255, v = this.readBlocks[b];
    return b <= 0xfb3 && v !== 0 && i <= v;
  }

  // A Z command, a message's ZM or a label's ZZ / ZY (0x77790 case Z, 0x78070): first the one before it becomes read
  // (its block's byte raised to its index, with no test of skipping, so text passed by fast forward is read too; a ZY,
  // index 0, never raises one), then this one is current. 769 block numbers serve in more than one script, so reading
  // one script's messages can make another's read. During a read scene's instant run every Z command decides whether
  // the run goes on: it stops while F998 is set, or at one not read yet with fast forward on "Read" (labels too).
  zStep(code) {
    if (this.zCurrent !== null && this.raiseRead(this.zCurrent)) this.saveReadSoon();
    this.zCurrent = code;
    if (this.instant && (this.getVar("F998") || (this.fastForwardRead && !this.zRead(code)))) this.endInstant();
  }

  saveReadSoon() { if (!this.readTimer) this.readTimer = setTimeout(() => this.saveRead(), 2000); }

  loadRead() {
    this.read = new Uint8Array(Math.ceil(this.lines.length / 8));
    try {
      const s = atob(localStorage.getItem("tsuki.read") || "");
      for (let i = 0; i < s.length && i < this.read.length; i++) this.read[i] = s.charCodeAt(i);
    } catch { /* nothing read yet */ }
  }

  saveRead() {
    clearTimeout(this.readTimer);
    this.readTimer = null;
    try { localStorage.setItem("tsuki.readBlocks", btoa(String.fromCharCode(...this.readBlocks))); } catch { /* not saved */ }
    if (!this.read) return;
    try { localStorage.setItem("tsuki.read", btoa(String.fromCharCode(...this.read))); } catch { /* not saved */ }
  }

  isRead(i) { return (this.read[i >> 3] & (1 << (i & 7))) !== 0; }

  markRead(ids) {
    for (const i of ids) this.read[i >> 3] |= 1 << (i & 7);
    this.saveReadSoon();
  }

  saveGlobals() {
    try { localStorage.setItem("tsuki.globals", JSON.stringify(this.globals)); } catch { /* not saved */ }
  }

  async getScript(i) {
    let p = this.scripts.get(i);
    if (!p) {
      p = fetch(`/assets/scripts/${i}.json`).then((r) => r.json());
      this.scripts.set(i, p);
      p.catch(() => { if (this.scripts.get(i) === p) this.scripts.delete(i); });   // one that failed (read ahead, say) is asked for again when it is wanted
    }
    return p;
  }

  warn(op) {
    if (this.warned.has(op)) return;
    this.warned.add(op);
    console.info("not implemented:", op);
  }

  getVar(k) {
    const n = Number(k);
    if (!Number.isNaN(n) && k !== "") return n;
    if (k[0] === "G") return this.globals[k] || 0;
    if (k[0] === "C") k = this.lineVar(k);
    return this.vars[k] || 0;
  }

  setVar(k, v) {
    if (k[0] === "C") k = this.lineVar(k);
    if (k[0] === "G") { this.globals[k] = v; this.saveGlobals(); } else this.vars[k] = v;
    if (WINDOW_VARS.has(k)) this.applyWindow();
  }

  // Cn is the F variable n past the line counter, F(F823 + n) (0x7a2b0): C847 is the blank rows before the next line
  // (F847 + row, which the text window and the backlog read) and C859 its dimming timer.
  lineVar(k) { return /^C\d+$/.test(k) ? `F${(this.vars.F823 || 0) + Number(k.slice(1))}` : k; }

  // The text window's style and position live in F1105-F1107 (and F1111-F1113 for a second balloon): the state block
  // keeps variable n at +2n, which native 0x391a0 reads as +0x8a2 ... +0x8b2 each frame, with F1104 (+0x8a0: no window
  // picture, "novel" pages) and F1110 (+0x8ac: the note picture).
  applyWindow() {
    const g = (k) => this.getVar(k);
    this.text.setWindow?.({ style: g("F1105"), x: g("F1106"), y: g("F1107"), style2: g("F1111"), x2: g("F1112"), y2: g("F1113") });
    if (!!this.text.intro !== (g("F1104") === 1)) this.text.setIntro?.(g("F1104") === 1);
    this.text.noteOn = g("F1110") >= 1;
  }

  now(real) { return this.clock.now(real); }
  frameNow(real) { return this.frameClock.now(real); }
  // A hold of the port's own (not the game's): the story's clock and the delay slots' stop together.
  holdClocks(reason, on) { this.clock.pause(reason, on); this.frameClock.pause(reason, on); this.soundClock.pause(reason, on); }
  get paused() { return !!this._paused; }
  set paused(on) {
    const was = !!this._paused;
    this._paused = !!on;
    this.clock.pause("menu", !!on);
    this.frameClock.pause("menu", !!on);
    // The auto wait does not run under the system menu, and starts again in full once the window is back. N2-85 had it go on from
    // what was left; a native run says otherwise (TODO item 51): a page's line had waited 148 of its 180 frames when the menu opened,
    // and the game went on 183 frames after the window was whole again (218 after the menu began to close), not 32. The page is set
    // again on the way back (0x813e0) and counts as typed two frames later, which starts the countdown anew (0x81b30).
    if (on && !was) { clearTimeout(this.autoTimer); this.autoUntil = 0; }
    else if (!on && was && this.waitResolve) { this.autoSince = performance.now() + 2 * FRAME_MS; this.armAuto(); }
  }
  get skip() { return !!this._skip; }
  set skip(on) {
    const was = !!this._skip;
    this._skip = !!on;
    // Only the runs that draw nothing put everything at its end; fast forward plays it all at its own speed (item 110).
    if (on && !was && this.fast) this.finishAnimations();
    this.syncSpeed();
  }
  // The runs that pass everything at once: a read scene's instant run, a restore, a test jump, the smoke test.
  get fast() { return this.skip && (this.instant || !!this.skipUntil || !this.skipPaced || this.restoring); }
  // Fast forward as the player sees it (the key held or the toggle): the game's frames go on, each worth 33 (64 to a WTTM and to the mixer).
  get speeding() { return this.skip && !this.fast; }
  get stepFrames() { return this.speeding ? SKIP_STEP : 1; }
  // While fast forward runs the story's clock stands between frames and each frame step moves it 33 frames on (tick), so what a frame
  // shows is what the game's frame shows. The mixer's fades run 64 frames more a frame (0x4a5b0 -> 0x9b7f0(64)).
  syncSpeed() {
    const s = this.speeding;
    this.clock.pause("skip", s);
    this.audio?.setSpeed?.(s ? 1 + SKIP_SPEED : 1);
    for (const p of [...this.sleepers]) p();
  }

  // One frame of the game (0x40ed0 from 0x48ac0), as far as fast forward needs it: the layers' step, then the waits that look at it. main.js
  // calls it once a 60 Hz frame before the text window's frame; where nothing does (the tests) a timer stands in. Nothing moves while a menu or a
  // dialog is up (0x40ed0 returns before the frame step) or pictures load.
  tick() {
    if (this.paused || this.loadHold) return;
    const s = this.speeding;
    this.clock.pause("skip", s);
    if (s) this.clock.advance(SKIP_STEP * FRAME_MS);
    this.ticks++;
    const list = this.tickers;
    this.tickers = [];
    for (const f of list) f();
  }
  onTick(f) {
    this.tickers.push(f);
    if (this.externalTicks || this.tickTimer) return;
    const run = () => {
      this.tickTimer = null;
      this.tick();
      if (this.tickers.length && !this.externalTicks) { this.tickTimer = setTimeout(run, FRAME_MS); this.tickTimer?.unref?.(); }
    };
    this.tickTimer = setTimeout(run, FRAME_MS);
    this.tickTimer?.unref?.();
  }
  // The next frame: a frame step while fast forward runs, a frame's time otherwise. The runs that draw nothing do not wait.
  frame() {
    if (this.fast) return Promise.resolve();
    if (!this.speeding) return this.sleep(FRAME_MS);
    return new Promise((res) => this.onTick(res));
  }
  async frames(n) { for (let i = 0; i < n; i++) await this.frame(); }
  // Fast forward gives a message three frames and an MSAD two (ticksFrom: the frame step count when it was set): the frame it is set, the
  // frame it is typed, the frame the game sees that (0x81b30, 0xab8e0), and the script runs on the one after. Native frames: 20 pages a
  // second, 10 with a FADS a page. The text window's own frames come to the same (TextBox.type with `rush`); this holds where there is none.
  async ticksSince(from, n) {
    const gen = this.generation;
    while (this.speeding && gen === this.generation && this.ticks - from < n) await new Promise((res) => this.onTick(res));
  }

  allLayers() { return new Map([...this.layers, ...this.pending]); }

  finishAnimations() {
    const now = this.now();
    for (const l of this.allLayers().values()) {
      if (l.motion && !l.motion.track.loop) { l.motion.start = now - l.motion.track.duration; l.motion.held = null; }
      for (const k of ["x", "y", "zx", "zy", "rot", "alpha"]) l[k].ms = 0;
      // Effects that would have ended are over; endless ones (a rumbling train, a swaying shot) last until stopped.
      for (const [k, e] of Object.entries(l.effects)) if (e.duration >= 0) delete l.effects[k];
    }
    this.gfx.shake = this.gfx.textShake = null;
  }

  // A new story or a load: no shake (0x57450), no speed lines (0x5f200 ends with 0x86470(0, 0), N2-14), no split (0x3c550 stores 0
  // in the mode, N2-108).
  clearAnimations() {
    this.motionStarts = {};
    this.gfx.shake = this.gfx.textShake = null;
    this.gfx.lines = null;
    this.gfx.split = null;
    for (const h of this.hazes) Object.assign(h, newHaze());   // a new story or a load resets them (0x57450)
    this.ghosts.clear();                                        // and every layer number's state
  }

  // ---- waits ---------------------------------------------------------------------------------------------------
  // A wait of ms on the story's clock. The runs that draw nothing pass it. Under fast forward it is looked at once a frame step, after
  // the clock's 33 frames (tick), as the game looks at its waits once a frame (0x802c0); a WTTM (`wttm`) loses 64 frames a frame instead
  // (0x81b30), so 1000 ms pass in one frame and 5000 in five. A clickable wait also ends when the player clicks or presses advance
  // (WTTM with its second argument 0).
  sleep(ms, clickable = false, wttm = false) {
    if (this.fast || ms <= 0) return Promise.resolve();
    const gen = this.generation;
    return new Promise((res) => {
      let left = ms, last = this.now(), timer = null, queued = false, over = false;
      const self = this;
      function done() {
        if (over) return;
        over = true;
        clearTimeout(timer);
        self.sleepers.delete(poll);
        if (self.clickWait === done) self.clickWait = null;
        res();
      }
      if (clickable) this.clickWait = done;
      function poll() {
        if (over) return;
        if (gen !== self.generation || self.fast) { done(); return; }
        const now = self.now(), speeding = self.speeding;
        left -= (now - last) * (wttm && speeding ? SKIP_SPEED / SKIP_STEP : 1);
        last = now;
        if (left <= 0.5) { done(); return; }
        clearTimeout(timer);
        if (speeding) { if (!queued) { queued = true; self.onTick(() => { queued = false; poll(); }); } }
        else timer = setTimeout(poll, Math.min(50, Math.max(1, left)));
      }
      this.sleepers.add(poll);
      poll();
    });
  }

  // ---- history records (0x5a910), counted so that the rewind trail reaches as far as the native ring (N2-75): a record is made by
  // each FADS, MSG, sound command, ATSV and choice row; by the first layer command after the last close (F991, 0x5f3b0 and the command
  // handlers), which WTTM, VPLY and MSAD close with a record of their own; and by nothing after a message with @n until the next MSG.
  ringAdd() { if (!this.ringGate) this.ring++; }
  ringLayer() { if (!this.ringDirty) { this.ringAdd(); this.ringDirty = true; } }
  ringClose() { if (this.ringDirty) { this.ringAdd(); this.ringDirty = false; } }

  layerFor(id) {
    return this.pending.get(id) || this.layers.get(id);
  }

  // The picture STCH / SCH2 put on a layer: the blurred variant name + _XX_YY when there is a blur (blurName), looked up
  // in the picture table with no fallback (0x60840 at 0x61e08: a missing name gives -1, committed as no picture, N2-11).
  setPicture(l, name, blurX, blurY) {
    const blurred = blurName(name, blurX, blurY);
    const images = this.gfx.images;
    if (images && blurred !== name && !images[String(blurred).toUpperCase()]) {
      l.image = null; l.ready = null; l.promise = null;
      return;
    }
    this.setImage(l, name);
  }

  // A layer's picture starts loading at once; it is on screen only after the next commit.
  setImage(l, name) {
    l.image = name;
    l.ready = null;
    l.promise = this.gfx.load(name).then((e) => { if (l.image === name) l.ready = e; return e; }).catch((e) => { console.warn(e.message); return null; });
  }

  async commit() {
    const waits = [];
    for (const l of this.pending.values()) if (l.promise) waits.push(l.promise);
    await this.waitImages(waits);
    const onScreen = new Map(this.layers);
    for (const id of this.removed) {
      if (id === -1) this.layers.clear(); else this.layers.delete(id);
    }
    this.removed.clear();
    // A layer's picture is created (and its colour preset, brightness and contrast baked into it) only when the commit
    // changes the picture number on that layer (0x3c970 at 0x3e4c0-0x3e5e0 -> 0x3ecc0 -> 0xa3180): STEC, SNX2 and SNX3 on
    // a picture already there, or a re-STCH of the same picture with other values, leave it as baked (N2-15).
    for (const [id, l] of this.pending) {
      const old = onScreen.get(id);
      l.baked = old && samePicture(old, l) ? (old.baked || bakeOf(old, this.now())) : bakeOf(l, this.now());
      this.layers.set(id, l);
    }
    this.pending.clear();
    // The commit copies the state to the records (0x5d3a0 -> 0x3c970): at draw the record's preset (+0x244) decides whether
    // the record's colour (+0x1cc, which STEC writes at once) multiplies the picture (0x36520: not for preset 1).
    for (const l of this.layers.values()) l.recordPreset = l.effect;
    // and the depths STCP left waiting reach the draw order (0x32450)
    for (const l of this.layers.values()) if (l.zNext !== undefined) { l.z = l.zNext; delete l.zNext; }
    this.staged = false;
    // Every commit counts each layer's picture as seen (0x5d3a0 calls 0x774f0 for all 40 layer numbers), so a picture
    // put on a layer and replaced before the screen changed (11_00_ARC11_1 op 114) is not.
    for (const l of this.layers.values()) if (l.image) this.unlocks.image(l.image);
    this.commitHazes();
    // 0x5d3a0 ends by putting every layer's zoom at its STZ4 target with no tween (0x31f30(layer, target, target, 0
    // frames)): a zoom still on its way is there at once.
    const now = this.now();
    for (const l of this.layers.values()) {
      if (!l.zx.done(now)) l.zx = new Value(l.zx.b);
      if (!l.zy.done(now)) l.zy = new Value(l.zy.b);
    }
  }

  // The screen stays as it was last drawn while the pictures load (gfx.hold, native 0xa4560 / 0xa46f0): the ops run
  // since then (STCP moving a layer behind another, say) take effect with the transition, not before it.
  // The draw task 0x47dd0 picks the look by type: 2 brings the new screen in through rule n (RULE_nn, mask_top.mzp +
  // n, loaded by 0x60610 / 0x4b4c0) with 0xa48c0; 1 draws nothing (an instant change); 0 and the rest a plain fade
  // of the old frame (0xa46f0, alpha = the level, falling linearly), which never reads the rule, so FADS 0 with a
  // rule (02_00_ARC02_1D) is a crossfade. The scripts use only types 0, 1 and 2; 0x12, 0x14 and 0x44-0x46 have
  // effects of their own that nothing calls.
  async fade(type, ms, rule, closeArg) {
    this.gfx.hold?.(true);
    let timed = false;
    try {
      await this.commitPrepare();
      if (fadeClosesWindow(closeArg, ms, this.text.rate)) this.closeWindowForFade();
      // FADS sets the shared rule picture (0x60610 at 0x60760-0x60794 -> 0x4b4c0): rule n, or none when the rule is 0, before
      // the commit. A layer on an STTR wipe draws through that slot, so an STTR whose picture a rule-0 FADS frees is
      // no wipe at all, plain alpha instead (N2-97, checked on a native frame).
      if (!(rule > 0)) this.gfx.ruleSlot = null;
      else if (type === 2) this.gfx.ruleSlot = ruleName(rule);
      if (this.fast) {
        await this.commit();
        this.firstFadeDone();
        this.gfx.fade = null;
        this.gfx.ruleSlot = null;   // the end of every transition frees the slot (0x48ac0)
        return;
      }
      timed = !!ms && type !== 1;
      if (timed) {
        // A rule (1-49) is a mask picture the new screen comes through (RULE_01..RULE_49).
        let mask = null;
        if (type === 2 && rule > 0) {
          const p = this.gfx.load(ruleName(rule)).catch(() => null);
          await this.waitImages([p]);
          mask = (await p)?.tex || null;
        }
        // The frame of the command still shows the old picture whole; the level takes its first step on the frame after. Under fast
        // forward that frame's step is still to come when the command runs (tick).
        this.gfx.beginFade(ms * FRAME_MS / FADS_FRAME, mask, this.now() + (this.speeding ? SKIP_STEP * FRAME_MS : 0));
      }
      await this.commit();
      this.firstFadeDone();
    } finally {
      this.gfx.hold?.(false);
    }
    // How long the script waits (0x60610 sets wait bit 8; 0x3c970 clears it the frame after the level is down, and the script runs on the frame
    // after that). The level starts at the draw of the command's frame and falls a step a frame from the next one: 1 / (ms / 16.666), 33 times that
    // under fast forward, and an instant change (FADS 1, or no time) one whole step. So a change with no time takes 3 frames, 100 ms 9,
    // 500 ms 33; under fast forward 3, 3 and 3, 1700 ms 6 and 3000 ms 8 (native frames, chains of each, TODO item 110).
    const steps = timed ? Math.max(1, Math.ceil(ms / FADS_FRAME)) : 1;
    await this.sleep((this.stepFrames + steps) * FRAME_MS);
    await this.frame();
    this.gfx.fade = null;
    this.gfx.ruleSlot = null;       // the end of every transition frees the slot (0x48ac0)
  }

  // main.js's white between the title and the story waits on this. Stopping the script ends the wait too, so the white cannot stay up.
  firstFadeDone() {
    const done = this.onFirstFade;
    this.onFirstFade = null;
    done?.();
  }

  async commitPrepare() {
    const waits = [];
    for (const l of this.pending.values()) if (l.promise) waits.push(l.promise);
    await this.waitImages(waits);
  }

  async waitImages(waits) {
    if (!waits.length) return;
    // First-use conversion can take longer than a short motion. Hold game time
    // until the pictures are ready, so its animation is visible from the start.
    const reason = {};
    this.holdClocks(reason, true);
    this.loadHold++;
    try { await Promise.all(waits); } finally { this.loadHold--; this.holdClocks(reason, false); }
  }

  // ---- running --------------------------------------------------------------------------------------------
  async start(scriptIndex, label) {
    this.generation++;
    const gen = this.generation;
    this.trail = [];
    this.savePoint = null;
    this.scenePoints = [];
    this.nearScene = 0;
    this.page = 0;
    this.lastVoice = this.recordVoice = this.msgVoice = null;   // 0x57450
    this.endInstant();
    this.applyWindow();
    await this.enter(scriptIndex, label);
    this.running = true;
    this.loop(gen);
  }

  async enter(i, label) {
    this.script = await this.getScript(i);
    this.scriptIndex = i;
    this.pc = label && this.script.labels[label] !== undefined ? this.script.labels[label] : 0;
    this.zFrom = label || null;
    this.zSkip = -1;
    this.preloadFrom(this.pc);
  }

  resume() {
    this.paused = false;
    if (this.resumeFn) { const r = this.resumeFn; this.resumeFn = null; r(); }
  }

  replayVoice() {
    if (this.lastVoice) this.audio.playVoice(this.lastVoice);
  }

  stop() {
    this.firstFadeDone();
    this.generation++;
    this.pendingVoice = null;
    this.passedHere = false;
    this.skipPaused = null;
    this.sceneSkip = null;
    this.cancelDelayed();
    this.running = false;
    this.restoring = false;
    this.msgPending = false;
    this.choosing = null;
    this.typeResolve = null;
    clearTimeout(this.autoTimer);
    if (this.onChoiceCancel) this.onChoiceCancel();
    if (this.onWait) this.onWait(false);
    this.resume();
    for (const p of [...this.sleepers]) p();
    const waiting = this.tickers;
    this.tickers = [];
    for (const f of waiting) f();
    this.syncSpeed();
    if (this.waitResolve) { const r = this.waitResolve; this.waitResolve = null; r(); }
  }

  // Fetch what comes next, so that first use does not wait on the conversion. With main.js's look-ahead (preload.js ahead) that is the pictures, the
  // sounds, the movies and the scripts jumped to; without it (the tests, the smoke test) the next pictures.
  preloadFrom(pc) {
    if (!this.script) return;
    if (this.ahead) { this.ahead(this.script, pc); return; }
    const ops = this.script.ops;
    let n = 0;
    for (let i = pc; i < ops.length && i < pc + 400 && n < 6; i++) {
      const o = ops[i];
      if ((o[0] === "STCH" || o[0] === "SCH2") && o[2]) {
        const key = o[2].toUpperCase();
        if (!this.gfx.tex.has(key)) { this.gfx.load(o[2]).catch(() => {}); n++; }
      }
    }
  }

  async loop(gen) {
    let count = 0;
    while (gen === this.generation && this.running) {
      const ops = this.script.ops;
      if (this.pc >= ops.length) { this.running = false; console.info("script ended", this.script.name); this.onEnd && this.onEnd(); return; }
      if (this.paused) await new Promise((r) => { this.resumeFn = r; });
      if (gen !== this.generation) return;
      if (this.skipUntil && this.pc >= this.skipUntil) { this.skip = false; this.skipUntil = 0; }
      // The label Z commands just before this op run first: all of them when the script comes to them, from the
      // label a jump named when it jumps there (the interpreter starts at that label's command).
      const zl = this.script.zl?.[this.pc];
      if (zl && this.zSkip !== this.pc) {
        const from = this.zFrom ? zl.findIndex((e) => e[1] === this.zFrom) : 0;
        if (zl.length > Math.max(0, from)) this.ringClose();   // a label's Z command closes the layer changes too (0x78f0c)
        for (let k = Math.max(0, from); k < zl.length; k++) this.zStep(zl[k][0]);
      }
      this.zFrom = null;
      this.zSkip = -1;
      const op = ops[this.pc++];
      const fn = this[`op_${op[0]}`];
      try {
        if (WAITS.has(op[0])) await this.settle();
        if (gen !== this.generation) return;
        if (fn) {
          const r = fn.apply(this, op.slice(1));
          if (r && r.then) await r;
        } else this.warn(op[0]);
      } catch (e) {
        console.error(this.script.name, this.pc - 1, op, e);
      }
      if (gen !== this.generation) return;
      if (this.sceneSkip && FRAME_ENDS.has(op[0])) await this.sceneSkip;   // nothing past this frame's first wait until the read-scene skip has counted down (N2-130)
      if (gen !== this.generation) return;
      if (++count > 2000) { count = 0; await new Promise((r) => setTimeout(r)); }
    }
  }

  // ---- flow -----------------------------------------------------------------------------------------------
  op_WKST(k, cmp, v) { this.setVar(k, this.getVar(v)); }
  // C variables are relative to the line counter: Cn is F(F823 + n) (0x7a2b0). C847 after a line holds the blank rows
  // before the next one (0x391a0 reads F847 + i before drawing line i), so WKAD C847 0 (17 places) adds none.
  op_WKAD(k, v) {
    this.setVar(k, this.getVar(k) + this.getVar(v));
    if (k === "C847" && this.getVar(v) > 0) this.text.addBreak(this.getVar(v));   // blank rows in the text
  }
  op_WKOR(k, v) { this.setVar(k, this.getVar(k) | this.getVar(v)); }
  test(a, cmp, b) {
    const x = this.getVar(a), y = this.getVar(b);
    switch (cmp) {
      case "eq": return x === y;
      case "ne": return x !== y;
      case "gt": return x > y;
      case "ge": return x >= y;
      case "lt": return x < y;
      case "le": return x <= y;
      default: return false;
    }
  }
  // Branches go to the label when the condition does not hold: see how `IF__(F026,ne,0,L); ...; L:` is written.
  op_IF__(a, cmp, b, label) { if (!this.test(a, cmp, b)) this.goto(label); }
  op_IFP4(_, label) { this.goto(label); }   // the PlayStation 4 version's block: skip
  op_IFNX() { }                              // the Switch version's block: run
  // IFSC branches unless the scene is being played from the gallery: native 0x47b00 reads the byte 0xb34af0, which
  // only the gallery's scene playback sets (0x48ac0) and loading a save clears (0x47af0).
  op_IFSC(_, label) { if (!this.replay) this.goto(label); }
  // IFUR 1: native 0x79C00 jumps only when 0x926F0(1) finds episodes 1-24 all complete (QA_25's completion check).
  op_IFUR(kind, label) { if (kind === "1" && allEpisodesDone(this.flow)) this.goto(label); }
  goto(label) {
    const at = this.script.labels[label];
    if (at === undefined) { console.warn("no label", label, "in", this.script.name); return; }
    this.pc = at;
    this.zFrom = label;
  }
  op_GOTO(label) { this.goto(label); }
  async op_JUMP(id, label) {
    const i = this.index.jump[id];
    if (i === undefined) { console.warn("jump to unknown", id); return; }
    // The flowchart (native 0x95790): the running script's exit flag (0x92d00: scripts 1-527 by table 0x360ea4, else -1)
    // to the target's entry flag (0x92d30).
    if (this.flowChart) {
      const k = this.scriptIndex, from = k >= 1 && k <= 527 ? this.flowChart.scriptExitFlags[k] ?? -1 : -1;
      this.flow.jump(from, this.flowChart.jumpEntryFlags[id] ?? -1, { getVar: (v) => this.getVar(v), lastChoice: this.lastChoice });
    }
    await this.enter(i, label);
  }
  op_GOTS(v, ...labels) {
    const n = this.getVar(v);
    if (labels[n]) this.goto(labels[n]);
  }
  op_END_() { this.endInstant(); }
  // RTM_ returns to the title (native 0x789C8): nothing after it runs. RTMN does the same after setting the flag that
  // keeps the music playing past the end (0x146e64d: 0x5f200 then leaves the music alone, once); RTM2 only sets it.
  // (After 00_01 the story begins: onEnd does that, as the title's own new-game flow does.)
  op_RTM_() { this.endInstant(); this.pc = this.script.ops.length; }
  op_RTM2() { this.keepMusic = true; }
  op_RTMN() { this.endInstant(); this.keepMusic = true; this.pc = this.script.ops.length; }
  op_RDST(n) { this.flow.start(Number(n)); }
  op_RTST(n) { this.flow.read(Number(n), this.replay); }
  // RDAS(scene): "Read scenes auto skip" (native 0x79b78 -> 0x92580). When it is on, no instant run is going (0xae0568)
  // and the scene was completed before (not during a load's silent run), it sets the input task's state (0x424b0(1)), and
  // readSceneSkip takes over; the commands up to this frame's first wait still run. That is an instant run after 4 frames, or 20
  // after a Yes to "Jump to Next Scene?" (dialog 10) when "Display confirmation" is on: see beginInstant.
  async op_RDAS(n) {
    if (this.replay && this.replaySource === "flowchart") return;   // 0x79b78: passed over in a replay from the gallery's flowchart (0x50f0), so the scene plays (N2-2)
    // 0x79b80-0x79bcc: read-skip on and the scene completed: a popup that has finished coming up is sent on its way (0x3b480) and the
    // command runs again every frame until it has gone (0x3b580), before anything else of RDAS (N2-172)
    if (this.skipRead && this.flow.completed.has(Number(n)) && this.popup) {
      const gen = this.generation;
      for (;;) {
        this.popup.hurry();
        if (!this.popup.busy() || gen !== this.generation) break;
        await nextFrame();
      }
    }
    if (this.instant || this.restoring || !this.skipRead || !this.flow.completed.has(Number(n))) return;
    const run = this.readSceneSkip(this.generation).finally(() => { if (this.sceneSkip === run) this.sceneSkip = null; });
    this.sceneSkip = run;
  }
  // The input task's states 1-3 (0x40ed0 at 0x4102c), during which it returns before the frame step 0x802c0, so no command runs and nothing the
  // script would have played sounds (N2-130). State 1 is a frame of its own, where dialog 10 comes up with "Display confirmation" (state 2 then
  // waits for it; No ends here). State 3 counts the frames, each with the black and the indicator (0x3f110, 0x3b5b0(4); main.js countdownFrame),
  // and the frame after, the run starts (0x53950(1), not while a choice is up -> 0x802c0).
  async readSceneSkip(gen) {
    await nextFrame();
    if (gen !== this.generation) return;
    if (this.skipConfirm) {
      const go = this.onSceneSkip ? await this.onSceneSkip(true) : true;
      if (!go || gen !== this.generation) return;
    }
    for (let v = (this.skipConfirm ? 20 : 4) - 1; v >= 0; v--) {
      await nextFrame();
      if (gen !== this.generation) return;
      this.onCountdown?.(v);
    }
    await nextFrame();
    if (gen === this.generation && !this.choosing) this.beginInstant();
  }
  // The skip toggle waiting at unread text (see message): skip is off for the VM, on for the player.
  pauseSkip() { this.skipPaused = { force: this.forceSkip, held: !!this.fastForwardHeld }; this.skip = false; this.forceSkip = false; }
  resumeSkip() {
    const p = this.skipPaused;
    this.skipPaused = null;
    if (!p) return;
    this.skip = true;
    this.forceSkip = p.force;
  }
  get skipOn() { return this.skip || !!this.skipPaused; }
  // The instant run (0x802c0 with 0xae0568 set): the interpreter runs on within the frame with every wait cleared and
  // FADS passed over (0x77a40), so the screen jumps to where it stops: the next ATSV, SELD, SELS or SELA, the end of a
  // script (RTM_, RTMN, END_) or of a replay (its RDED), XSTP, TOMP, or a message not read yet (with fast forward on
  // "Read", config +0x1e) or while F998 is set. One-shot sound effects are dropped on the way (0x6a340).
  // Everything playing stops as the run starts (0x802c0 at 0x8086c: 0x5ef10(0), N2-74). Its sound commands then only record what they would
  // play (0x649e0, 0x653b0, 0x64fa0, 0x6a340, 0x6ae10, 0x6b310 test 0xae0568: the music's number and volume, each channel's loop; no delay is
  // queued); where the run stops, the recording is put back as a restore puts it (0x5d7e0: audio.restore, so the music and loops start again from
  // their tops) and every layer's tween is at its end (0x328f0 clears the records' tween offsets). TOMP's stop (0x6ef30) does neither, so the movie
  // and what follows it are silent until the script's next sound; the run's records stay (last volumes). The skip toggle and the fast-forward
  // key are not the run's: they are as they were afterwards (N2-208, N2-209).
  beginInstant() {
    if (this.instant || !this.running) return;
    this.instantModes = { skip: this.skip, force: this.forceSkip, paused: this.skipPaused };
    this.skipPaused = null;
    this.instant = true;
    this.skip = true;
    this.forceSkip = true;
    this.recorded = this.audio.snapshot ? this.audio.snapshot() : null;
    this.audio.stopPlaying?.();
    this.onInstant?.(true);
    this.syncSpeed();
    this.advance();
  }
  endInstant(apply = true) {
    if (!this.instant) return;
    this.instant = false;
    const m = this.instantModes;
    this.instantModes = null;
    this.skip = !!m?.skip;
    this.forceSkip = !!m?.force;
    this.skipPaused = m?.paused ?? null;
    this.syncSpeed();
    const recorded = this.recorded;
    this.recorded = null;
    if (apply && recorded) {
      this.audio.restore?.(recorded, { stopVoice: false });
      this.finishTweens();
    } else if (recorded) {
      if (Array.isArray(recorded.last)) this.audio.seLast = recorded.last.slice();
      if (typeof recorded.lastMusic === "number") this.audio.lastMusic = recorded.lastMusic;
    }
    // the run's end takes the page's earlier lines to their dim level at once (0x802c0: F859 + k = -1, N2-83)
    this.text.settleEarlier?.((this.getVar("F823") || 0) - 1);
    this.onInstant?.(false);
  }
  // 0x328f0: every layer at its tweens' targets (motion tracks go on).
  finishTweens() {
    const now = this.now();
    for (const l of [...this.allLayers().values(), ...this.ghosts.values()]) {
      for (const k of ["x", "y", "zx", "zy", "rot", "alpha"]) if (!l[k].done(now)) l[k] = new Value(l[k].b);
    }
  }
  // What the instant run records instead of playing (see beginInstant), in audio.snapshot()'s shape.
  recordMusic(n, opts) {
    const r = this.recorded;
    if (n < 0) { r.bgm = null; return; }
    const vol = Math.min(100, Math.max(0, opts["017"] ?? 100));
    r.bgm = { n, vol: vol / 100, loop: true };
    r.lastMusic = vol;
  }
  recordSE(k, kind, name, opts) {
    const r = this.recorded;
    const at = r.se.findIndex((c) => c.ch === k);
    if (kind === "loop") {
      const keep = {};
      for (const o of ["018", "070"]) if (opts[o] !== undefined) keep[o] = opts[o];
      const c = { ch: k, name, vol: Math.min(100, Math.max(0, opts["017"] ?? 100)) / 100, opts: keep };
      if (at >= 0) r.se[at] = c; else r.se.push(c);
      r.last[k] = opts["017"] ?? 100;
    } else if (kind === "vol") {
      if (at >= 0) r.se[at] = { ...r.se[at], vol: Math.min(100, Math.max(0, opts["017"] ?? 0)) / 100 };
      r.last[k] = Math.min(100, Math.max(0, opts["017"] ?? 0));
    } else {
      // a sound played once, SEFD or SESP: the channel has no loop to put back (0x6a340 / 0x6b310 clear its record)
      if (at >= 0) r.se.splice(at, 1);
      if (kind === "fade") r.last[k] = 0;
      // a sound played once keeps its volume as the channel's last, unless the skip flag (0xae0670) sent it back already (0x6a340)
      if (kind === "once" && !this.instantModes?.skip) r.last[k] = opts["017"] ?? 100;
    }
  }
  // RDED (native 0x79bdc): the scene is completed if it is the current one (0x92440). In a gallery replay (F024) that
  // ends the replay there, by the RTM_ path (0x7f9e8), and the game goes back to the gallery.
  op_RDED(n) { if (this.flow.finish(Number(n)) && this.replay) this.op_RTM_(); }
  // ATSV(flags): a record at the scene's start or before a choice (native 0x778e8 -> 0x5a910): the checkpoint saving and the automatic
  // save resume at takes it only on a page's first line (0x527f0 runs when record +0x35c0 is 0, the record is not type 0xb / 0xc and
  // F823 is at most 1: listing 0x79030-0x79044, 0x7c02c-0x7c040, 0x7a900-0x7a914; N2-1). Later on a page the checkpoint stays on the
  // page's first line, so a save made there resumes at that first line. Also while skipping (only a load's silent run, 0x146e638,
  // passes it); flag 8 makes none.
  op_ATSV(flags) {
    this.endInstant();
    const f = num(flags) || 0;
    if (this.skipUntil || (f & 8)) return;
    this.ringAdd();
    // ATSV(1), just before a choice, is a type 7 record: restoring it (0x5baf0 -> 0x5afc0) sets the flag that shows the next message
    // restored (the line just before it) whole instead of typing it again (0x5cfbc-0x5cfe0).
    if (f === 1 && this.trail.length) this.trail.at(-1).wholeBack = true;
    const point = this.point();
    if (this.onFirstLine()) { this.savePoint = point; this.pageCheckpoint = false; }
    // ...and, without flag 4, the record goes on the ring "Return to Previous Scene" goes back along, whatever the line count and only
    // while no task holds records back (L_79094 / 0x7a964 -> 0x7c174; the ring is 0x7c0dc on).
    if (!(f & 4) && !this.locked) {
      this.scenePoints.push(point);
      if (this.scenePoints.length > 299) this.scenePoints.shift();
      this.nearScene = 2;
    }
  }
  // Whether a record made here may become the checkpoint: a page's first line (F823 at most 1) and no task holding records back
  // (record +0x35c0, set by 0x3f960 for the XSTP .. XRSM task; the movie task's range holds no message or ATSV in the shipped scripts).
  onFirstLine() { return (this.getVar("F823") || 0) <= 1 && !this.locked; }
  // "Return to Previous Scene" (native 0x81a50): at a choice, or within two lines of the last ATSV checkpoint, the one
  // before it (dropping the last); otherwise the last one, the start of what is being read. Null when there is none.
  // The first checkpoint since the story was started or loaded is never one of them: the game's count starts at -1 (0x5a904, 0x82400,
  // 0x8280c), ATSV adds one and stores at that index (0x7c15c-0x7c1ac), and 0x81a50 wants a count of 1, or 2 to go one further back.
  // So the button stays unlit through the first scene and for the first two lines of the second (TODO item 51, native runs: with two
  // ATSVs the button is unlit seven lines into the first scene, lit four lines into the second and goes to that scene's start).
  previousScene(take = true) {
    const n = this.scenePoints.length;
    const back = this.choosing || this.nearScene > 0;
    if (n < (back ? 3 : 2)) return null;
    const i = back ? n - 1 : n;
    if (take) { this.scenePoints.length = i; this.nearScene = 2; }
    return this.scenePoints[i - 1];
  }
  // WTSV (28 chapter openings) is not a command of the Switch interpreter: 0x77790 compares no "TSV" key under 'W'
  // (the only one is ATSV's), so the dispatch reaches 0x77814, which counts the command and goes on to the next one in
  // the same frame (no wait, no commit). 0x7f69c, once taken for it, is WTVT, which no script uses.
  op_WTSV() { }
  // SHAF (all 397 calls without arguments: 0x7a098 -> 0x2e560(0, 0, 0, 0)) resets the window's movement state
  // (0xafeb98 / 0xafeb9c, 0xafec04-0xafec34), which no script starts (SHAK and its kin are not used); MSQK's shake
  // (0x39110, the block at *(0xae05c0)) is not touched. A running SHOK, though, ends here (N2-109).
  op_SHAF() {
    // 0x2e560(0, 0, 0, 0) also ends a running SHOK at once (0xafec1c = 0, so 0x2ef30 zeroes its offsets, N2-109); a delayed
    // SHOK still in its pending slot (0xafec58) is left to start.
    const e = this.gfx.shake;
    if (e) this.gfx.shake = e.delay > 0 && this.now() < e.start + e.delay ? { ...e, prev: null } : null;
  }
  op_STCG(name) { this.unlocks.image(name); }
  // TRPY (trophies): the Switch interpreter has no handler for it (its T commands are TOMP and TOMW only), so the
  // command is passed over, as here.
  op_TRPY() { }
  // STMA(layer, track, close, step) (0x99620): the third argument closes the text window as FADS's fourth does (+0x89e:
  // 1 always, 2 when no CLO4 / CLO5 fade runs; blank or -1 only with config +0x63 at 0, which never happens), before
  // the layer is looked at; the fourth makes the motion advance every `step` frames (0x958e8 keeps it, 0x95938 rounds
  // the track's frame count down to a multiple when it is 2 or more).
  op_STMA(id, trackId, close, step) {
    this.ringLayer();
    if (motionClosesWindow(num(close), this.text.rate)) this.closeWindowForFade();
    const l = this.layerFor(Number(id));
    if (!l) return;
    const now = this.now(), state = layerState(l, now);
    // What the old track last wrote stays on the layer. Only properties it owns are baked: independent script tweens
    // (for example an opacity fade) keep running when motion is changed.
    if (l.motion) bake(l, l.motion.sample(now, l), now);
    l.motion = null;
    const key = Number(trackId);
    if (!key) return;
    const track = this.motions[key];
    if (!track) { this.warn("motion track " + key); return; }
    l.motion = new Motion(key, track, state, now, this.motionStarts[key]);
    l.motion.step = Math.max(0, num(step) || 0);
    // 0x99620 runs the track at time 0 at once (0x97b80(0, layer)). What a track writes only then (START_ONLY, given
    // by no key after time 0) stays on the layer for the script to move: 48 STGS fades, an STCL and an STZ4 act on
    // such layers (e.g. 05_01_CIEL05_4 ops 4813-4817).
    const first = l.motion.sample(now, l);
    bake(l, Object.fromEntries(START_ONLY.filter((k) => k in first).map((k) => [k, first[k]])), now, true);
    if (this.fast && !track.loop) l.motion.start -= track.duration;
  }
  // SGMA(layer, track, key) (0x9a270): the layer's x, y, opacity, rotation and zoom, and its panel when the panel's x
  // is not 0, are written over keyframe `key` of the track (0 when blank; 6 calls give 1) for every later STMA of it.
  op_SGMA(id, trackId, at) {
    this.ringLayer();
    const l = this.layerFor(Number(id));
    if (!l) return;
    const state = layerState(l, this.now());
    const values = Object.fromEntries(["x", "y", "alpha", "rot", "zx", "zy"].map((k) => [k, state[k]]));
    const clip = state.clip || l.clip;
    if (clip && clip[0]) values.clip = clip.slice(0, 4);
    const track = Number(trackId), old = this.motionStarts[track];
    const byKey = old && ("x" in old || "zx" in old) ? { 0: old } : { ...(old || {}) };
    byKey[Math.max(0, num(at) ?? 0)] = values;
    this.motionStarts[track] = byKey;
  }
  op_SPMA(on) { this.ringLayer(); for (const l of this.allLayers().values()) l.motion?.pause(on === "1", this.now()); }
  // PGST: the page id the engine keeps (state +0x8c4); saved with the game.
  op_PGST(n) { this.page = Number(n) || 0; this.onPage && this.onPage(this.page); }

  // ---- choices --------------------------------------------------------------------------------------------
  // SELR(value, text, lock) adds a row to the coming choice, in the order the script reaches them (native 0x78a50 ->
  // 0x7dab8): the row's text is SYSMES 1433 + (row + 1) % 10 ("1.", "2.", ... "0.") followed by the text, the value is
  // what SELD stores when the row is taken (0xae09d8), and a third argument 1 (0xae09e0) keeps the row from being
  // chosen or moved to; it is drawn like the others (only SELR and the selector 0x83e50 read that flag).
  op_SELR(value, id, lock) {
    this.ringAdd();
    // a choice's first row, on a page with text, leaves one blank row before the next line (F847 + F823 + 1 at 0x78a80-0x78a98, N2-78)
    const row = this.getVar("F823") || 0;
    if (!this.choices.length && row >= 1) { const k = `F${847 + row}`; this.vars[k] = (this.vars[k] || 0) + 1; this.text.addBreak?.(1); }
    this.choices.push({ value: num(value) ?? this.choices.length, text: this.textOf(id), locked: num(lock) === 1 });
  }
  // The rows as the choice shows them: a save from before SELR kept its value keeps plain texts, in row order.
  choiceRows() {
    return this.choices.filter((c) => c !== undefined && c !== null).map((c, row) => {
      const r = typeof c === "string" ? { value: row, text: c, locked: false } : c;
      const mark = this.system?.messages?.[String(1433 + ((row + 1) % 10))] ?? `${(row + 1) % 10}.`;
      return { ...r, label: mark + choiceText(r.text) };   // on one row: the patch's breaks go (reflow.js)
    });
  }
  // SELA(_D000): "Save Progress?" (SYSMES 216). Native 0x7f6bc asks only when F1118 is 0 (0x85bf0, 0x92930: selector
  // type 3); Yes opens the save screen and the story goes on once it is closed (0x83e50 states 5-8). Either way the
  // window closes after it (state 4). The answer goes to the variable named after "_D"/"_G".
  async op_SELA(arg) {
    this.endInstant();   // 0x92930 clears the instant run
    this.choices = [];   // a restored question leaves its text here, as for SELS
    // 0x7f6bc asks when F1118 is 0 (0x85bf0); 0x92930 then passes only during a load's silent run (0x5afb0 reads
    // 0x146e638, not the skip toggle), so skipping does not pass it. Test jumps (?pc=) still do.
    if (this.skipUntil || this.getVar("F1118") !== 0 || !this.onAskSave) return;
    const question = this.system?.messages?.["216"] || "Save Progress?";
    this.choosing = { pc: this.pc - 1, list: [question], confirm: true, save: true };
    const yes = await this.onAskSave(question);
    this.choosing = null;
    const m = /^_([DG])(\d{3})/.exec(arg || "");
    if (m) this.setVar(`${m[1] === "D" ? "F" : "G"}${m[2]}`, yes ? 1 : 0);
    this.text.closeNow();
  }
  // SELS: the engine's own yes / no question (native 0x92800 / 0x83B20), "Enter hint corner (No. F027)?", SYSMES
  // 1445 + F027. Yes is 1. QACALL asks it before each Ciel-sensei episode. Saved and rewound like a choice.
  async op_SELS(v) {
    this.endInstant();   // 0x92800 clears the instant run
    const question = this.gallery?.endings?.hint?.[this.getVar("F027")] || "Enter hint corner?";
    this.choices = [];   // a restored question leaves its text here; it is not one of the next choice's options
    this.choosing = { pc: this.pc - 1, list: [question], confirm: true };
    this.remember(true);
    const yes = this.onConfirm ? await this.onConfirm(question) : true;
    this.choosing = null;
    this.lastChoice = yes ? 1 : 0;
    this.setVar(v, yes ? 1 : 0);
  }
  // SELD(var, n): n (1-82) is the choice's row in 0x3594d0; 0x92a60 marks the flowchart lines of all its branches as
  // soon as the choice is shown, so the branches not taken appear in the flowchart too.
  async op_SELD(v, id) {
    this.endInstant();
    if (this.flowChart) this.flow.choice(num(id), this.flowChart.choiceFlags?.[num(id)], this.replay);
    const rows = this.choiceRows();
    this.choices = [];
    this.choosing = { pc: this.pc - 1, list: rows.map(({ value, text, locked }) => ({ value, text, locked })) };
    this.remember(true);
    // SELD's own call of the checkpoint is never reached (0x7f850: its row records are type 0xc, which 0x527f0's test turns away), so a save
    // made at the choice resumes at the page's first line, or at the choice only when an ATSV(1) on the first line took the checkpoint (N2-1).
    for (const r of rows) this.ringAdd();   // a type 0xc record per row (0x7f790)
    this.text.logChoice?.(rows.map((r) => r.label), this.rowSkips());   // the rows' records (0x7f74c)
    const n = await this.onChoice(rows.map(({ label, locked }) => ({ label, locked })));
    this.choosing = null;
    this.lastChoice = n;   // the row taken (0xae0aa0), which the flowchart's special cases read
    this.setVar(v, rows[n]?.value ?? n);
  }

  // ---- text -----------------------------------------------------------------------------------------------
  // A line as the patch has it (a choice's row takes its breaks out when it is shown: choiceRows).
  textOf(s) {
    const m = /\$(\d+)/.exec(s || "");
    return m ? (this.lines[Number(m[1])] ?? "") : (s || "");
  }
  // A story line as the port shows it: without the breaks the English patch's injector put in to wrap its 55-cell
  // rows (reflow.js), which needs where the line started on its row, worked out once per script.
  lineText(id) {
    const t = this.lines?.[id] ?? "";
    if (!t.includes("\n")) return t;
    const s = this.script;
    // The Q&A corners were broken by hand for their balloons, and the game shows those rows as they are: their breaks stay.
    if (/^QA/.test(s?.name || "")) return t;
    if (s && !s.wrap) s.wrap = wrapContext(s, this.lines);
    const c = s?.wrap?.get(id);
    return reflow(t, c?.start ?? 0, c ? c.next : null, id, SOFT);
  }
  op_WNTY(v) { this.pageEnd = v === "1"; }
  // The text window's blank rows before each of its 12 rows (F847 + row), as a record keeps them.
  rowSkips() { return Array.from({ length: 12 }, (_, i) => this.getVar(`F${847 + i}`) || 0); }
  async op_MSG(arg) { await this.message(arg, false); }
  async op_MSAD(arg) { await this.message(arg || "", true); }

  // A message's argument: $id references (each line as lineText gives it, so the story box, the backlog and the save
  // note see the same text), or literal text (TEST_SCRIPT), with control marks: @n goes on at once, @e goes on once the
  // text is typed and its voice has finished, without a click (0x6e0d0), ^ a new line, @cN and @r colours
  // (colourMarks), @x (7 messages) puts the line on the previous row (glue), and a message whose text ends in @k (its
  // copy stops at @e / @n, so "$id@k@e" does) is one the next message continues (keep: the dimming, lineAlpha).
  parseMessage(arg) {
    const s = arg || "";
    const ids = [...s.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    // the colour marks (@cN, @r) stay with the text for colourMarks, which reads them as the text object does, and ^
    // for parseMarkup, which breaks the row there without counting a letter (0xbdc2c)
    const marks = (piece) => piece.replace(/@(?![cr])[a-z]\d?/g, "");
    let raw = "";
    if (ids.length) {
      for (const piece of s.split(/(\$\d+)/)) raw += /^\$\d+$/.test(piece) ? this.lineText(Number(piece.slice(1))) : marks(piece);
    } else raw = marks(s);
    const { text, color, edge } = colourMarks(raw);
    // the copy stops at the first @e or @n (0x6e1dc-0x6e294), so "$id@k@e@n" is an @e and waits for its voice (N2-19)
    const stop = /@([en])/.exec(s)?.[1];
    return { ids, text, color, edge, noWait: stop === "n", noClick: stop === "e", glue: /@x/.test(s), keep: /@k(?:@[en])*$/.test(s) };
  }

  async message(arg, inline) {
    const gen = this.generation;
    this.preloadFrom(this.pc);
    // A first line's own record, as the MSG starts (0x5a910 in 0x6e0d0, copied to the checkpoint at once by 0x527f0): needed when the line
    // will not wait for a click itself (@e, @n, "Display whole text"), where the page's first wait comes with a later command (item 58).
    const firstLine = (this.getVar("F823") || 0) < 2 && !this.locked;
    const start = !inline && firstLine && !this.skipUntil && (/@[en]/.test(arg || "") || this.wholeRead || this.wholeUnread) ? this.messagePoint() : null;
    if (inline) this.ringClose(); else {
      this.passedHere = false;
      // The message's Z command comes first (0x77790 case Z, listing 0x78efc-0x78f48): layer changes since the last such point are
      // closed with a record of their own, as WTTM, VPLY and MSAD close them. N2-75 had missed this one; a native run of 380 pages,
      // each a picture move, a FADS and a line, reached 200 pages back (four records a page) where the port went back all 361 (TODO item 51).
      this.ringClose();
      this.ringGate = false; this.ringAdd();
      // The MSG's record is made as it starts (0x5a910 in 0x6e0d0): its sound state (S39) is what was going on then, delay slots counting;
      // a delayed sound that fires during the typing is still ahead of this point. The voice the record keeps is the one VPLY or VPL2 left
      // (0xae08b0), which the record takes (N2-79, 0x6e7c8) and a FADS before it would have cleared.
      this.msgSound = { audio: this.soundState(), delayed: this.delayedState() };
      this.msgVoice = this.recordVoice;
      this.recordVoice = null;
    }
    // MSG (0x6e0d0) fades a closed or faded window back in over 18 frames and clears the page that ended; MSAD
    // (0x6e950) only clears F1103 and adds to the line on screen
    if (inline) this.text.continueMessage?.(); else this.text.beginMessage();
    const { ids, text, color, edge, noWait, noClick, glue, keep } = this.parseMessage(arg);
    // Whether the message was read: its ZM name's Z command (zStep) marks the message before it, may end an instant
    // run, and leaves this one's block and index for 0x6e0d0 to test (0x53a60, kept in 0xae08c8). MSAD has no Z
    // command and keeps the flag. A script without the names (tests, older builds) goes by the lines' own bits.
    let read, unread;
    const zcode = this.script?.zm ? this.script.zm[this.pc - 1] : undefined;
    if (this.script?.zm && (inline || zcode !== undefined)) {
      if (!inline) { this.zStep(zcode); this.msgRead = this.zRead(zcode); }
      read = this.msgRead;
      unread = !read;
    } else {
      read = ids.length > 0 && ids.every((i) => this.isRead(i));
      unread = ids.some((i) => !this.isRead(i));
      if (!inline) this.msgRead = read;
      // the instant run stops at a line not read yet when fast forward is on "Read", or while F998 is set (case Z)
      if (this.instant && ((this.fastForwardRead && unread) || this.getVar("F998"))) this.endInstant();
    }
    // MSG / MSAD record the checkpoint only on a page's first line (0x6e0d0 with F823 < 2, and no task holding records back): here, at
    // that page's first wait for the player, so a load shows the page from its first line. An MSAD copies the newest record again
    // (0x6e950 makes none of its own), and after an @n MSG that is still the MSG's: nothing makes a record until the next MSG (0x146e644).
    if (firstLine && !(inline && this.ringGate && this.savePoint?.msgStart && this.savePoint === this.startPoint)) this.pageCheckpoint = true;
    if (this.nearScene > 0) this.nearScene--;
    // Skipping (the toggle, or fast forward held) passes text not read yet only with fast forward on "Full". On "Read"
    // (config +0x1e, the default) it stops there as if it were off, but the toggle stays on and skipping goes on by itself
    // at the next read line (0x418b0 clears only the per-frame flag 0xae0670, at 0x41920 / 0x420c8). Passing text in a
    // skip does not count as reading it.
    if (this.skip && unread && this.fastForwardRead && !this.instant && !this.skipUntil && (!this.forceSkip || this.fastForwardHeld)) this.pauseSkip();
    else if (this.skipPaused && !unread) this.resumeSkip();
    // 0xae04c0's flag 4: this message started a voice and (unless @n) waits for it, which the skip or a press may cut (0x802c0)
    this.ownVoice = this.startPendingVoice() && !noWait;
    if (!this.skip) this.markRead(ids);
    // Read and unread text have their own speed (config +0xe / +0x10: 0x6e0d0 -> 0x3b2b0 keeps whether the line was
    // read, which MSAD leaves as it was) and "Display whole text" (+0x5a / +0x5b, taken at a page's first line, F823 < 2:
    // 0x3b3d0 -> 0xafeba8). "Text display" (+0x61) is for all text (0xab710); "Read text display" (+0x62) is how
    // earlier lines go dim, fading ("Fade out") or at once ("Insta erasure", 0x391a0).
    if (!inline) {
      this.text.speed = read ? this.readSpeed : this.textSpeed;
      if ((this.getVar("F823") || 0) < 2 || this.wholePage === undefined) this.wholePage = read ? this.wholeRead : this.wholeUnread;
    }
    this.text.charFade = this.fadeUnread !== false;
    this.text.eraseAtOnce = this.fadeRead === false;
    const whole = !!this.wholePage;
    this.text.setWhole(whole);
    // "Display whole text": a line that does not end the page does not wait for a click (0x6e0d0 with WNTY 0).
    const goOn = noClick || (whole && !this.pageEnd && !noWait);
    this.msgPending = !noWait && !goOn;
    // A first line that goes on without a click: the checkpoint is the MSG's record, so a load runs the line again from its start and
    // then whatever follows it (item 58; native run: the line types again, a FADS after an @n line plays again, then the next line comes).
    if (!inline) this.startPoint = null;
    if (start && (noWait || goOn)) {
      start.noteText = plain(text);
      this.savePoint = this.startPoint = start;
      this.pageCheckpoint = false;
    } else if (inline && text && this.savePoint?.msgStart && this.savePoint === this.startPoint && !this.pageCheckpoint) this.savePoint.noteText = plain(text);   // the record's text is the newest piece (0x6e950: +0x3684)
    const instant = this.fast, rush = this.speeding, setAt = this.ticks;
    if (text) {
      // the backlog's record (0x6e0d0 saves the state at the message: WNTY's page end F799, the blank rows F847-F858)
      this.text.log(text, this.msgVoice, { inline, pageEnd: this.pageEnd, glue: glue && !inline, color, edge, skips: this.rowSkips() });
      let clicked = false;
      const click = this.clickOrSkip(true).then(() => { clicked = true; });
      const typed = this.text.add(text, { color, edge, inline, instant, rush, glue: glue && !inline, k: keep });
      await Promise.race([typed, click]);
      // a click that finishes the typing also takes the page's earlier lines to their dim level (0x81b30)
      await this.endTyping(typed, clicked, gen);
      if (rush) await this.ticksSince(setAt, inline ? 2 : 3);
      if (gen !== this.generation) return;
    } else if (inline) this.text.setKeep?.(keep);
    // a blank MSG still takes its own row: it sets the (empty) text on the line's object at row F823, the earlier lines dim, and the
    // MSAD after it goes on that row (0x6e0d0, 0x6e950; native frame, N2-114)
    else this.text.add("", { glue: glue && !inline, k: keep });
    if (noWait) { if (!inline) this.ringGate = true; return; }
    if (goOn) {
      // The line's record all the same (every MSG makes one, 0x5a910 in 0x6e0d0), for a rewind and Quick Jump: a rewind onto it types the
      // line again and waits for a click there (native run: from the next page a rewind lands on an @e first line, with the wait mark).
      if (!inline && gen === this.generation) { this.remember(); this.trail.at(-1).passed = true; this.passedHere = true; }
      await this.voiceThenOn();
      this.typeResolve = null;
      if (this.pageEnd) this.text.pagePending = true;
      return;
    }
    await this.afterWait();   // the panel stays between pages; only a closed window removes it
    if (gen === this.generation) this.msgPending = false;
  }

  // A line that goes on without a click waits for its voice (flag 4 of 0xae04c0); a click passes that and stops the voice as any input
  // does (0x802c0).
  async voiceThenOn() {
    if (this.skip || !this.ownVoice || !this.audio.voicePlaying) return;
    let clicked = false;
    await Promise.race([this.audio.voiceDone(), this.clickOrSkip(null, true).then(() => { clicked = true; })]);
    if (clicked) this.voiceOnInput();
  }

  // Wait for the player (or auto mode), with the mark at the end of the text.
  async waitAdvance() {
    const gen = this.generation;
    this.remember();
    if (this.pageCheckpoint) { this.pageCheckpoint = false; this.savePoint = { ...this.trail.at(-1) }; }
    // Fast forward (native 0x802c0): each frame the script runs to its next wait, and skipping clears a message's click wait on the frame
    // after the game has seen the line typed, so the frames a message takes are its typing's (message, ticksSince). Skipping switched off
    // meanwhile (the system menu, Backspace, N2-28): the flag is read at the start of that frame, so this message waits after all.
    if (this.skip) return;
    this.onWait && this.onWait(true, this.pageEnd);
    await new Promise((res) => {
      this.waitResolve = res;
      this.autoSince = performance.now();
      this.armAuto();
    });
    if (gen !== this.generation) return;   // stopped or restored: what is on screen now is no longer this wait's
    clearTimeout(this.autoTimer);
    this.onWait && this.onWait(false);
    // The skip that ends the wait cuts this line's own voice (flag 4, 0x804a4-0x804b8); other than that a wait passed by skipping alone stops
    // nothing (0x80734). A press stops it under the setting (0x80670-0x80680).
    if (this.skip) { if (this.ownVoice && this.audio.voicePlaying) this.audio.stopVoice(); }
    else this.voiceOnInput();
  }

  // What a press or the skip does to a playing voice (0x802c0 at 0x804a4-0x804b8, 0x80670-0x80680): it stops under "Voices stop on input"
  // (config +0x2e) unless F1123 is set (09_01_CIEL09_1_1 sets it so a line goes on through the change of scene after it), and always while
  // skipping (0xae0670).
  voiceOnInput() {
    if ((this.voiceStop !== false && !this.getVar("F1123")) || this.skip) this.audio.stopVoice();
  }

  // Each frame the fast-forward key is held (the key's mask against the held bits: 0x802c0 at 0x8081c-0x80848, N2-81), the voice stops,
  // under "Voices stop on input" and with F1123 clear. The game does this before the script runs, so the voice is cut as soon as the key is
  // held, also on a line skipping has stopped at (a line not read yet with fast forward on "Read": its voice starts and is cut again).
  // Not while a menu or a dialog is up (0x40ed0 returns before 0x802c0).
  voiceHeldCut() {
    if (this.fastForwardHeld && !this.paused && this.voiceStop !== false && !this.getVar("F1123")) this.audio.stopVoice();
  }

  // Auto mode's timer for the current wait. The game's countdown starts as the line is typed and runs whether auto mode is on or
  // not (0x81b30 sets 0xae04b0 and counts it down every frame; 0x802c0 only acts on it in auto mode), so switching auto on part way
  // through a wait leaves what is left of it, and on a line that has waited longer the game goes on at once (TODO item 51, native
  // run: L pressed 4.5 s into a page's wait turned the page on that frame). Also called when auto is switched.
  armAuto(left) {
    clearTimeout(this.autoTimer);
    this.autoUntil = 0;
    const res = this.waitResolve;
    if (!this.auto || !res || this.paused) return;
    const whole = this.pageEnd ? this.autoPage || 3000 : this.autoClick || 2200;
    const ms = left ?? Math.max(0, whole - Math.max(0, performance.now() - (this.autoSince ?? performance.now())));
    this.autoUntil = performance.now() + ms;
    this.autoTimer = setTimeout(async () => {
      this.autoUntil = 0;
      await this.audio.voiceDone();
      if (!this.auto || this.waitResolve !== res || this.paused) return;
      this.waitResolve = null;
      res();
    }, ms);
  }

  // Resolves on a click while text is typing (or, with `any`, on any click), without consuming it for the next wait.
  clickOrSkip(_, any = false) {
    return new Promise((res) => { this.typeResolve = res; this.typeAny = any; });
  }

  // A press of advance (not the skip's own way of ending a wait): while skipping it stops the voice whatever the setting or F1123 says (0x80670-0x80680).
  press() {
    if (this.skip && !this.instant && !this.locked) this.audio.stopVoice();
    this.advance();
  }

  // The player clicked or pressed advance. `click` false: fast forward starting, which ends a message's wait but no timed one (0x81b30
  // ends a WTTM early only on a press).
  advance(click = true) {
    if (this.locked) return;
    if (this.typeResolve && (this.text.typing || this.typeAny)) {
      const r = this.typeResolve;
      this.typeResolve = null;
      r();
      return;
    }
    if (this.waitResolve) {
      const r = this.waitResolve;
      this.waitResolve = null;
      r();
    } else if (click && this.clickWait) this.clickWait();
  }

  // The window commands (native table 0x350d02): CLO2 clears the page and hides the window at once (0x7f3dc); CLO3
  // closes it over four frames (0x7f86c); CLO4(ms) fades window and text out over ms (0x7f898); CLO5(ms) opens the
  // window, fading it in over ms (0x7f918). Only CLO2 clears the page itself: the others leave it, but a page that has
  // ended (the script's `WKST F823 eq 0`) goes on the first frame the panel is up (TextBox.clearEndedPage, 0x391a0).
  op_CLO2() { this.text.closeNow(); this.vars.F1103 = 1; return this.frame(); }
  // Each ends the frame (0x7fef0), so the window's draw sees the page counter as it stands: a page the script has just ended (F823 = 0) goes now,
  // before any message that comes without another wait (0x391a0, TextBox.clearEndedPage).
  // The command's own frame (item 110, native frames under fast forward: each of the four shows for one frame before the next command acts).
  op_CLO3() { this.text.closeQuick(); this.text.clearEndedPage?.(true); if (this.text.closed) this.vars.F1103 = 1; return this.frame(); }
  op_CLO4(ms) { this.text.fadeOut(this.fast ? 0 : num(ms) || 0); this.text.clearEndedPage?.(true); return this.frame(); }
  op_CLO5(ms) { this.text.fadeIn(this.fast ? 0 : num(ms) || 0); this.vars.F1103 = 0; this.text.clearEndedPage?.(true); return this.frame(); }
  // The second argument 1 makes the wait uninterruptible; 0 or none lets a click end it (native 0x81B30). The wait is counted in frames,
  // ms x 3 / 50 cut to a whole number and at least one (0x77790's WTTM), which fast forward takes 64 at a time: 1000 ms is one frame, 1067 ms
  // (64 frames) still one, 1084 ms (65) two, 5000 ms five (native frames, item 110).
  async op_WTTM(ms, fixed) {
    this.ringClose();
    const n = num(ms) || 0;
    if (n > 0) await this.sleep(Math.max(1, Math.trunc(n * 3 / 50)) * FRAME_MS, !num(fixed), true);
  }
  // VCWT (native 0x77f9c) waits only while a voice plays (wait bit 2); 0x802c0 clears the wait when the voice ends, on a
  // click or when skipping, and a click stops the voice when "Voices stop on input" is on and F1123 is 0; skipping past it stops the voice
  // whatever those two say (0x804b8 tests 0xae0670).
  async op_VCWT() {
    if (!this.audio.voicePlaying) return;
    if (this.skip) { this.audio.stopVoice(); return; }
    let clicked = false;
    await Promise.race([this.audio.voiceDone(), this.clickOrSkip(null, true).then(() => { clicked = true; })]);
    this.typeResolve = null;
    if (clicked) this.voiceOnInput();
  }

  // ---- layers ---------------------------------------------------------------------------------------------
  // STCH and SCH2 share 0x60840. Its copy branch (listing 0x60bf0-0x60fb8, 0x61190-0x61aa0) runs for both when
  // argument 18 names a layer 0-39: the new layer takes that layer's position, alpha, z, rotation, scale, pivot, SBAS
  // parent, link, SACL, SOXY, the panel's clip, edge, frame and turn, STEC's colour, SNX2 / SNX3, motion, quake /
  // shake / sway, haze, and STZ4's zoom target and flag (the target with no tween: the commit puts it on, 0x5d3a0).
  // Not STTR's rule (both reset it) and not STNS's grain, which stays with the layer number (0x60840 never touches
  // state +0x13b4); the blend becomes normal (0x62088). Then every layer linked to the source, or its SBAS child, is
  // moved over to the new layer.
  sourceLayer(from) {
    const n = num(from);
    return n !== undefined && n >= 0 && n <= 39 ? n : null;
  }
  copyLayer(l, src, now) {
    const state = layerState(src, now);
    Object.assign(l, { z: src.zNext ?? src.z, blurX: src.blurX, blurY: src.blurY }, placement(src));   // the state's depth (op_STCP)
    for (const k of ["x", "y", "rot", "alpha"]) l[k] = Value.restore(src[k].snapshot(now), state[k], now);
    l.zx = new Value(src.zx.b);
    l.zy = new Value(src.zy.b);
    l.stretch = !!src.stretch;
    l.motion = src.motion ? Motion.restore(src.motion.snapshot(now), this.motions, now) : null;
    l.effects = Object.fromEntries(Object.entries(src.effects).map(([k, e]) => [k, { ...e }]));
    // the same number's record goes on with its sway's cycle; another number's record has none yet (effects.js)
    if (src.id === l.id) carrySway(l.effects.oscillation, src.effects.oscillation, now);
  }
  relinkLayers(from, to) {
    for (const m of [...this.layers.values(), ...this.pending.values(), ...this.ghosts.values()]) {
      if (m.id === to) continue;
      if (m.link === from) m.link = to;
      if (m.parent === from) m.parent = to;
    }
    if (this.hazes[to] && this.hazes[from]) this.hazes[to].next = this.hazes[from].next;
  }
  // The layer holding layer number id's state: the one set up this frame, else the one on screen unless STCC has
  // cleared the number since (0x62140 resets the state at once; the port takes the picture off at the commit), else
  // what the number keeps with no picture on it (stateFor). None means the cleared state: x 0, y 0, scale 1000
  // (0x62140, and 0x57450 for every layer at the start).
  slotLayer(id) {
    return (this.removed.has(id) || this.removed.has(-1) ? this.pending.get(id) : this.layerFor(id)) || this.ghosts.get(id) || null;
  }
  // The engine keeps every layer number's state (the block at 0x137006c) whether or not a picture is on it: STCP,
  // STGS, STRT, STZ4, STBR (0x62a40, 0x637a0, 0x62b20, 0x62d20, 0x62490) and SBAS, SOXY and SACL (in the interpreter,
  // 0x7afec on) write it with no picture check, and the next STCH or SCH2 that starts from the number takes it
  // (startLayer): `10_00_ARC10_8_2` clears layer 0 (op 1232), gives it depth 2 (op 1233) and copies it to layer 1
  // (op 1238). The layer the state commands write: the number's layer, else an undrawn one holding its state.
  stateFor(id) {
    const n = Number(id);
    if (!(n >= 0 && n <= 39)) return null;
    let l = this.slotLayer(n);
    if (!l) {
      l = newLayer(n, null);
      l.x = new Value(0);
      l.y = new Value(0);
      this.ghosts.set(n, l);
    }
    return l;
  }
  // SCH2 from a source keeps the source's pivot where it is relative to the picture's own: 0x60840 (listing
  // 0x60cd0-0x60d00) adds the new picture's table pivot less the source picture's, when the new one is in the table.
  // In the new picture's script units (a source on its table pivot, uncut, gives null: the new picture's own).
  movedPivotAt(src, l) {
    if (!src.pivot && !src.cut) return null;
    const images = this.gfx.images || {};
    const info = (x) => (x.image ? images[blurName(x.image, x.blurX, x.blurY).toUpperCase()] || images[x.image.toUpperCase()] : null) || null;
    const a = info(src), b = info(l);
    if (!a || !b) return null;
    const [px, py] = pivotOf(src, a), [ax, ay] = pivotOf({ image: src.image }, a), [bx, by] = pivotOf({ image: l.image }, b);
    return [px - ax + bx, py - ay + by];
  }
  movedPivot(src, l) {
    const p = this.movedPivotAt(src, l);
    if (!p) return src.pivot && !src.cut ? src.pivot.slice() : null;
    const k = sizeClass(l.image);
    return [p[0] / k, p[1] / k];
  }
  // What stays with the layer number through STCH / SCH2: STNS's grain (none once STCC has cleared it, 0x62140).
  slotGrain(id) {
    return this.slotLayer(id)?.grain || 0;
  }
  // What STCH and SCH2 start from, since 0x60840 writes x, y, the scale and the panel only when given (listing
  // 0x61e30-0x61f54): the source's state when argument 18 names a layer (the copy above), else the layer number's own
  // less what the branch without a source starts again (listing 0x60fbc on: SACL, quake / shake / sway, SNX2 / SNX3,
  // STEC's colour, the link and the motion) and STZ4's zoom target (1000) and flag (none), so its SBAS parent, SOXY,
  // panel, position and scale stay; with no layer there, the cleared state. Returns the layer started from.
  startLayer(l, s, now) {
    const base = this.slotLayer(s ?? l.id);
    if (!base) {
      l.x = new Value(0);
      l.y = new Value(0);
      return null;
    }
    this.copyLayer(l, base, now);
    if (s === null) {
      Object.assign(l, { absolute: false, effects: {}, bright: 1, contrast: 1, tint: null, mul: null, effect: 0, link: -1,
        motion: null, zx: new Value(1000), zy: new Value(1000), stretch: false });
    }
    return base;
  }

  // STCH sets what it is given and, for a blank, its defaults: alpha 255, z the layer number x 10 (0x60840 in STCH
  // mode), rotation 0 and the picture's own pivot (0x61ec4); x, y, the scale and the panel arguments left blank keep
  // what it starts from (startLayer).
  op_STCH(id, image, x, y, zoom, alpha, z, _7, anchor, bx, by, link, cx, cy, cw, ch, border, frame, from, crot) {
    id = Number(id);
    this.ringLayer();
    const s = this.sourceLayer(from);
    const grain = this.slotGrain(id);
    const l = newLayer(id, image);
    const started = this.startLayer(l, s, this.now());
    if (num(x) !== undefined) l.x = new Value(num(x));
    if (num(y) !== undefined) l.y = new Value(num(y));
    if (num(zoom) !== undefined) l.scale = num(zoom);   // apart from STZ4's zoom, which multiplies it
    l.alpha = new Value(clampAlpha(num(alpha) ?? 255));   // four STCH give 256 (0x60840 keeps 0-255)
    l.z = num(z) ?? id * 10;   // a blank z is the layer number x 10 (0x60840; SCH2 keeps the source's)
    l.rot = new Value(0);
    l.blend = 0;
    l.rule = null;
    l.grain = grain;
    // The blur starts from the source's _XX_YY digits, for STCH and SCH2 alike (0x60988-0x60ad0, with no mode test);
    // arguments 9 and 10 replace it only if given (N2-99). startLayer copied the source's blur, and a blank STCH with no
    // source has 0.
    l.blurX = num(bx) ?? (s !== null && started ? started.blurX : 0);
    l.blurY = num(by) ?? (s !== null && started ? started.blurY : 0);
    panelArgs(l, link, cx, cy, cw, ch, border, frame, crot);
    // STCH mode gives the picture's own pivot (0x61ec4), cut to whole units without a source (0x62024); with one, the
    // pivot record keeps the copied pivot, cut (listing 0x61820 on), which places the picture (transform.js)
    const moved = s !== null && started ? this.movedPivotAt(started, l) : null;
    l.pivot = null;
    l.cut = s === null;
    l.base = moved ? [Math.trunc(moved[0] * 4 / 3), Math.trunc(moved[1] * 362 / 272)] : null;
    this.setPicture(l, image, l.blurX, l.blurY);
    this.pending.set(id, l);
    this.removed.delete(id);
    this.ghosts.delete(id);
    if (s !== null) this.relinkLayers(s, id);
    this.resetHaze(id);
  }

  // STCH and SCH2 clear the haze on the layer's record at once (0x60840 -> 0x32930 zeroes +0x238 and its phase) but
  // not the layer's state (+0x1364): the haze comes back on the new picture at the commit, from phase 0.
  resetHaze(id) {
    const h = this.hazes[id];
    if (h) { settleHaze(h, this.now()); h.n = 0; }
  }

  // Like STCH, keeping everything left blank, alpha, z and rotation too, from what it starts from (startLayer). The
  // blend is not kept either: 0x60840 ends (0x62088-0x620b8) by setting STBR's state to normal (255) for SCH2 as for
  // STCH, or to F982 when that is 1 or more and the picture is not a solid colour; no script sets F982.
  op_SCH2(id, image, x, y, zoom, alpha, z, _7, anchor, bx, by, link, cx, cy, cw, ch, border, frame, from, crot) {
    id = Number(id);
    this.ringLayer();
    const s = this.sourceLayer(from);
    const grain = this.slotGrain(id);
    const l = newLayer(id, image);
    const kept = this.startLayer(l, s, this.now());
    l.blend = 0;
    l.rule = null;
    l.grain = grain;
    if (num(x) !== undefined) l.x = new Value(num(x));
    if (num(y) !== undefined) l.y = new Value(num(y));
    if (num(zoom) !== undefined) l.scale = num(zoom);
    panelArgs(l, link, cx, cy, cw, ch, border, frame, crot);
    if (num(alpha) !== undefined) l.alpha = new Value(clampAlpha(num(alpha)));
    if (num(z) !== undefined) l.z = num(z);
    if (num(bx) !== undefined) l.blurX = num(bx);
    if (num(by) !== undefined) l.blurY = num(by);
    if (image) this.setPicture(l, image, l.blurX, l.blurY);
    else if (kept) {
      // a blank picture keeps the source's, and its blurred name has to be in the table like any other (N2-11)
      if (kept.image) this.setPicture(l, kept.image, l.blurX, l.blurY);
      else { l.image = kept.image; l.ready = kept.ready; l.promise = kept.promise; }
      if (l.image === kept.image && kept.ready && blurName(kept.image, kept.blurX, kept.blurY) === blurName(l.image, l.blurX, l.blurY)) { l.ready = kept.ready; l.promise = kept.promise; }
    }
    // the pivot: moved with the picture from a source (movedPivot); without one, the new picture's own (0x60840 at
    // 0x62024 sets the table pivot whenever there is no source)
    l.pivot = s !== null && kept ? this.movedPivot(kept, l) : null;
    l.cut = s === null;   // the table pivot cut to whole units (0x62024)
    l.base = null;        // the pivot record is the pivot, cut (transform.js)
    this.pending.set(id, l);
    this.removed.delete(id);
    this.ghosts.delete(id);
    if (s !== null) this.relinkLayers(s, id);
    this.resetHaze(id);
  }

  // STCC also clears the layers' haze state (0x62140: +0x1364), so the commit takes the haze off.
  op_STCC(id) {
    id = Number(id);
    this.ringLayer();
    if (id === -1) {
      this.pending.clear();
      this.removed.add(-1);
      this.ghosts.clear();
      for (const h of this.hazes) h.next = 0;
    } else {
      this.pending.delete(id);
      this.removed.add(id);
      this.ghosts.delete(id);
      if (this.hazes[id]) this.hazes[id].next = 0;
    }
  }

  // STCP(layer, z): a blank z is 0 (0x62a40), which hides the layer. It writes the layer number's state only (+0x234):
  // the draw order is the record's own table (+0x5bec, which 0x3bba0 sorts), and that takes the state at the next commit
  // (0x5d3a0 -> 0x32450), not before. STCP sets no commit flag either, so on a picture already on screen the new depth
  // waits for the next FADS or the next wait with a staged picture (a native frame: a layer given STCP 0 stays up through a
  // 2.4 s WTTM and goes at the FADS after it). `zNext` is that waiting depth; a staged layer or an empty number has only its state.
  op_STCP(id, z) {
    this.ringLayer();
    const l = this.stateFor(id);
    if (!l) return;
    const v = num(z) ?? 0;
    if (this.layers.get(l.id) === l) l.zNext = v; else l.z = v;
  }
  // STBR(layer, n, m) (0x62490): with three or more arguments, a third present and not negative replaces n (listing
  // 0x62564-0x625a0): 13,8,0 draws normally, 18,1,28 adds, 22,19,26 is hardlight_ex. Its low byte is stored, and 0 means
  // normal (the engine's 255).
  op_STBR(id, a, b) {
    this.ringLayer();
    const l = this.stateFor(id ?? 0);
    if (!l) return;
    let n = num(a) ?? 0;
    if (num(b) !== undefined && num(b) >= 0) n = num(b);
    l.blend = n & 255;
  }
  // STEC(layer, preset, colour): one of the engine's 83 colour presets (0x3de0). 1 is a silhouette in the colour
  // given; 0 clears; 2-82 are grayscale, sepia, negative and the time-of-day grades. Other numbers change nothing.
  op_STEC(id, mode, color) {
    this.ringLayer();
    const l = this.stateFor(id);
    if (!l) return;
    const m = num(mode) ?? 0, c = num(color);
    if (m < 0 || m > 82) return;
    l.effect = m;
    // preset 1 takes the colour given, every other preset sets the layer's colour back to white (0x3de0 -> 0x3b30)
    l.tint = m === 1 ? (c !== undefined ? [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255] : [0, 0, 0]) : null;
    l.mul = null;
  }

  // STPV(layer, x, y, rotation): the pivot in the picture, in A-image script units from its top left.
  op_STPV(id, px, py, rot) {
    const l = this.stateFor(id);
    if (!l) return;
    if (num(px) !== undefined || num(py) !== undefined) {
      const p = l.pivot ? l.pivot.slice() : [null, null];
      if (num(px) !== undefined) p[0] = num(px);
      if (num(py) !== undefined) p[1] = num(py);
      l.pivot = p;
      l.base = null;   // its record is the new pivot, cut to whole units (listing 0x64438 on)
    }
    if (num(rot) !== undefined) l.rot = new Value(num(rot));
  }
  // SBAS(child, parent): the child is placed, zoomed and turned in its parent's picture. Blank or -1 unlinks.
  op_SBAS(id, parent) { const l = this.stateFor(id); if (l) l.parent = num(parent) ?? -1; }
  // SACL(layer, on): the layer keeps its own position when it has a panel clip.
  op_SACL(id, on) { const l = this.stateFor(id); if (l) l.absolute = (num(on) || 0) !== 0; }
  // STRR(layer, rotation): turns the layer's panel clip.
  op_STRR(id, rot) { this.ringLayer(); const l = this.layerFor(Number(id)); if (l) l.clipRot = wrapRotation(num(rot) || 0); }
  // SOXY(layer, _, _, x, y): a fixed offset; the engine reads only the last two.
  op_SOXY(id, _a, _b, x, y) { const l = this.stateFor(id); if (l) l.offset = [num(x) || 0, num(y) || 0]; }
  // SNX4 (8,762 calls) is not a command of the Switch interpreter: between NX1 and OXX its 'S' branch knows only NX2
  // and NX3, and anything else goes to 0x77814 (unknown: counted and passed over). The game's only blur is STCH / SCH2
  // args 9-10, which pick the pre-blurred `_XX_YY` texture variants (blurX / blurY here).
  op_SNX4() { }
  // SNX2(layer, n): brightness, n added in 0-255 units; SNX3(layer, n): contrast, n percent (0x4030, 0x4120).
  // Blank gives 0.
  // STTR(layer, rule, flip): the layer's alpha becomes a wipe through rule picture n laid over the screen (state
  // +0x8ec and layer record +0x118: flip << 12 | rule - 1; the draw 0x36520 passes bits 12-14 to 0xa7190, whose
  // shader flips the rule across for 1, up and down for 2, both for 3). The scripts follow it with an alpha tween
  // (STTR 23 26, STGS 23 '' 255 500). -1 or blank removes it. The engine keeps one rule picture, shared with FADS
  // (0x4b4c0); the port keeps one per layer.
  op_STTR(id, rule, flip) {
    const l = this.stateFor(id);
    if (!l) return;
    const n = num(rule);
    if (!(n >= 1 && n <= 49)) { l.rule = null; return; }
    l.rule = { name: ruleName(n), flip: (num(flip) || 0) & 7 };
    this.gfx.load(l.rule.name).catch(() => {});
    this.gfx.ruleSlot = l.rule.name;   // the one rule picture the engine keeps (slot 0x1c09, 0x4b4c0)
  }
  // STNS(layer, n): film grain - the layer shows through moving static (0x648a0 stores n, 0-12; 0x35fc0 draws).
  op_STNS(id, n) {
    this.ringLayer();
    const ids = Number(id) < 0 ? [...this.allLayers().keys()] : [Number(id)];
    for (const i of ids) { const l = Number(id) < 0 ? this.layerFor(i) : this.stateFor(i); if (l) l.grain = Math.max(0, Math.min(12, num(n) || 0)); }
    this.staged = true;   // 0x648a0 sets +0x7ca: the frame ends with a commit (see WAITS)
  }
  // STRA(layer, n, ms): heat haze with entry n (1-557) of the table at 0x352bd4 (effects.json `haze`), drawn by the
  // layer shader as nexl_nxshader_haze draws it (0x362a0; renderer.js). 0x645f0 writes the layer's record on screen
  // (+0x238..+0x240) when the layer has a picture, and always the per-layer state +0x1364 (`next`), which every commit
  // copies into the record (0x5d3a0 -> staged +0x238 -> 0x3c970): no time: n shows at once from phase 0; a time and n:
  // a fade-in of that many frames, n coming at the next commit; a time and 0: a fade-out, which the next commit cuts.
  // Layer -1 is all 40, none is layer 0, 40 and above nothing. The time is read as 16 bits, then ms x 60 / 1000.
  op_STRA(id, n, ms) {
    this.ringLayer();
    const first = num(id) ?? 0;
    if (first + 1 > LAYERS) return;
    const ids = first === -1 ? [...Array(LAYERS).keys()] : [first];
    const v = num(n) || 0, frames = Math.trunc((((num(ms) || 0) << 16) >> 16) * 60 / 1000);
    const now = this.now();
    for (const i of ids) {
      const h = this.hazes[i];
      if (!h) continue;
      h.next = v;
      if (!this.layers.has(i)) continue;
      settleHaze(h, now);
      if (!frames) {
        h.n = v;
        h.start = now;
        if (v) h.ramp = 0; else h.stop = h.left = 0;
        h.leftAt = now;
      } else if (!v) {
        h.stop = h.left = frames;
        h.leftAt = now;
      } else h.ramp = frames;
    }
  }

  // The commit puts each layer's state on its record (0x5d3a0 copies +0x1364 to the staged +0x238, 0x3c970 copies that
  // to the record): a haze that comes on starts its phase there.
  commitHazes(now = this.now()) {
    for (const h of this.hazes) {
      settleHaze(h, now);
      if (h.next >= 1 && !(h.n >= 1)) { h.start = now; h.leftAt = now; }
      h.n = h.next;
    }
  }
  op_SNX2(id, n) { this.ringLayer(); const l = this.stateFor(id); if (l) l.bright = (num(n) || 0) / 255 + 1; }
  op_SNX3(id, n) { this.ringLayer(); const l = this.stateFor(id); if (l) l.contrast = (num(n) || 0) * 0.01 + 1; }

  // The eighth argument (0x62d20 keeps it in state +0x874, blank keeping the last; 0x31f30 puts it on record +0xa2)
  // makes the zoom a stretch along the screen's axes after the layer's rotation (transform.js `stretch`).
  op_STZ4(id, ax, ay, bx, by, ms, ease, axes) {
    this.ringLayer();
    const l = this.stateFor(id);
    if (!l) return;
    const now = this.now();
    const t = this.fast ? 0 : num(ms) || 0;
    l.zx.to(num(ax), num(bx), t, num(ease), now, "last");
    l.zy.to(num(ay), num(by), t, num(ease), now, "last");
    if (num(axes) !== undefined) l.stretch = (num(axes) & 0xff) !== 0;
  }
  // STRT and STGS: a blank end is 0 (three STGS fade a layer out that way: 10_00_ARC10_3_1, 11_00_ARC11_1).
  op_STRT(id, a, b, ms, ease) {
    this.ringLayer();
    const l = this.stateFor(id);
    if (!l) return;
    l.rot.to(num(a), num(b), this.fast ? 0 : num(ms) || 0, num(ease), this.now(), 0);
  }
  op_STGS(id, a, b, ms, ease) {
    this.ringLayer();
    const l = this.stateFor(id);
    if (!l) return;
    const from = num(a) ?? (l.motion?.sample(this.now(), l).alpha);
    l.alpha.to(from, num(b), this.fast ? 0 : num(ms) || 0, num(ease), this.now(), 0);
  }
  // STCL(0, layer, x0, y0, x1, y1, ms, ease): move a layer
  op_STCL(_, id, x0, y0, x1, y1, ms, ease) {
    this.ringLayer();
    const l = this.stateFor(id);
    if (!l) return;
    const now = this.now();
    // 0x625c0 starts by stopping the layer's track (0x958d4(.., 0) on the state and the live record): what it last wrote
    // stays (STMA 0 afterwards leaves x and y alone).
    if (l.motion) { bake(l, l.motion.sample(now, l), now); l.motion = null; }
    const t = this.fast ? 0 : num(ms) || 0;
    l.x.to(num(x0), num(x1), t, num(ease), now);
    l.y.to(num(y0), num(y1), t, num(ease), now);
  }

  // Wait for a layer's animations to end. Fast forward waits too, for tweens that run 33 frames a frame (0x802c0 clears wait bit 5 only when
  // 0x329f0 finds them done): a 3000 ms STGS and its STCF take 6 frames, a 1000 ms one 2 (native frames, item 110).
  async op_STCF(id, mask = "63") {
    if (this.fast) return;
    const layers = Number(id) < 0 ? [...this.allLayers().values()] : [this.layerFor(Number(id))].filter(Boolean);
    const now = this.now(), flags = num(mask) ?? 63;
    let left = 0;
    for (const l of layers) {
      [["x", "y"], ["zx", "zy"], ["rot"], ["alpha"]].forEach((keys, bit) => {
        if (flags & (1 << bit)) for (const k of keys) left = Math.max(left, l[k].end(now));
      });
      if (flags & 32 && l.motion) left = Math.max(left, l.motion.remaining(now));
    }
    // the command ends the frame whatever it finds (wait bit 5 is looked at on the next one): with nothing moving it takes one frame
    // (native frames: an STCF after a zoom the commit had already finished)
    if (left > 0) await this.sleep(left); else await this.frame();
  }

  // The transition's record clears the next MSG's voice (0x607e0: *0xae08b0, N2-79); an instant run passes FADS over before that (0x77a40).
  async op_FADS(type, ms, rule, close) { if (!this.instant) this.recordVoice = null; this.ringAdd(); await this.fade(Number(type), num(ms) || 0, num(rule), num(close)); }
  // FANX does nothing when it runs: 0x77790's 'F' names are ADE, ADS, CCL, CLN, CSP, LNT, LOP and LSP, and an
  // unknown one is passed over (0x77814). Only the look-ahead 0x6f4d0 reads it, as it reads FADS, to fetch the rule
  // picture early. The layers set before it show at the next wait (WAITS) or come in with the next FADS.
  op_FANX() { }

  // The window's text goes at once and its panel stays; the next message fades the window back in (0x6e0d0).
  closeWindowForFade() {
    if (this.text.closeForFade) this.text.closeForFade(); else this.text.closed = true;
    this.vars.F1103 = 1;
  }

  // Layer changes left waiting are put on screen at a wait, with no transition (see WAITS).
  async settle() {
    if (this.pending.size || this.removed.size || this.staged) await this.commit();
  }

  layerEffect(id, kind, args) {
    this.ringLayer();
    // with a layer of -1, layers 0 and 1 count only with a live record, the others also when a picture is staged on them
    // (0x91540 at 0x9178c / 0x917b0 and its loop; N2-102): the card staged on layer 0 or 1 the same frame gets no quake.
    const layers = Number(id) < 0
      ? [...this.allLayers().values()].filter((l) => (l.id <= 1 ? this.layers.has(l.id) : (this.layers.get(l.id)?.z > 0 || this.pending.has(l.id))))
      : [this.layerFor(Number(id))].filter(Boolean);
    const slot = kind === "quake" ? "quake" : "oscillation";
    const now = this.now();
    for (const l of layers) {
      const e = makeEffect(kind, args.map(num), now);
      // each layer's quake draws its own random numbers (0x3c970 calls the random function per layer record)
      if (kind === "quake") e.seed = (e.seed + Math.imul(l.id + 1, 0x9e3779b1)) | 0;
      // In a run that draws nothing a finite effect is already over (and still replaces what was in its slot). Fast forward plays it,
      // 33 frames a frame (0x3c970; native frames: a 2 s quake moves the picture for the two frames it lasts).
      if (this.fast && e.duration >= 0) delete l.effects[slot];
      else l.effects[slot] = e;
    }
  }
  stopEffect(id, slot) {
    this.ringLayer();
    const layers = Number(id) < 0 ? [...this.allLayers().values()] : [this.layerFor(Number(id))].filter(Boolean);
    for (const l of layers) delete l.effects[slot];
  }
  // SHOK(x, y, ms, count, delay): the delay's pending slot keeps a running shake going (effects.js, 0x2ee70 / 0x2ef30).
  // Fast forward plays it at 33 frames a frame (0x2ef30 gets the step): a 6 s shake is seen for eleven frames (native frames, item 110).
  op_SHOK(...args) {
    if (this.fast) return;
    this.gfx.shake = makeEffect("impact", args.map(num), this.now(), this.gfx.shake);
    if (this.speeding && this.gfx.shake) this.gfx.shake.lead = 0;
  }
  op_SHK2(id, ...args) { this.layerEffect(id, "shake", args); }
  op_SQK2(id, ...args) { this.layerEffect(id, "quake", args); }
  op_SQS2(id) { this.stopEffect(id, "quake"); }
  op_SHS2(id) { this.stopEffect(id, "oscillation"); }
  op_SSS2(id) { this.stopEffect(id, "oscillation"); }
  op_SSW2(id, ...args) { this.layerEffect(id, "sway", args); }
  // STQK (QA_14, 3 calls) is not a command of the Switch interpreter either: 0x77790 has no "TQK" key (the quake is
  // SQK2), so the dispatch passes it over (0x77814).
  op_STQK() { }
  op_MSQK(...args) { if (!this.fast) this.gfx.textShake = makeEffect("text", args.map(num), this.now()); }
  op_NOP_() { }
  // FADE(kind, ms, ...): screen colour modes (0x5f420). The scripts use 40 (an RGB split: level, preset) and 41 (off).
  op_FADE(kind, a, b) {
    // the split counts the display's frames, fast forward or not (0x2f910 has no step): frameNow
    const k = num(kind), now = this.frameNow();
    if (k === 40) this.gfx.split = startSplit(num(a) || 0, num(b) || 0, now, this.gfx.split);
    else if (k === 41) this.gfx.split = this.fast ? null : stopSplit(this.gfx.split, now);
    else this.warn("FADE " + kind);
  }
  // FCLN(..., type): speed lines of preset type (4-33); only the last argument is read (0x92120). FCSP(ms) fades them.
  op_FCLN(...args) {
    this.ringLayer();
    const t = num(args[5]);
    this.gfx.lines = t >= 4 && t <= 33 ? startLines(t, this.now()) : null;
    if (t >= 1 && t <= 3) this.warn("FCLN falling notes");
  }
  op_FCSP(ms) { this.ringLayer(); this.gfx.lines = this.fast ? null : stopLines(this.gfx.lines, num(ms) || 0, this.now()); }
  // SPFC(slot, picture, ...) and SPRD(slot, picture, ...) have the engine prepare a processed copy of a picture in one
  // of 30 cache slots, so a later STCH shows it at once; SPRC empties them. Here they load the picture early.
  op_SPFC(_slot, image) { if (image) this.gfx.load(image).catch(() => {}); }
  op_SPRD(_slot, image) { if (image) this.gfx.load(image).catch(() => {}); }
  op_SPRC() { }
  // XSTP .. XRSM: the player's controls are off in between (native task type 1 at slot 1: 0x40b70 turns skip and auto
  // off, masks the input flags 0x71c0, blocks the mode panel and menus and keeps the screen from dimming; XRSM's
  // 0x3f9b0(1, 1) ends the task, whose 0x40c60 undoes it). The staff roll and the end of Ciel's route use it while
  // their lines go on by themselves (@e).
  op_XSTP() { this.endInstant(); this.setLocked(true); }
  op_XRSM() { this.setLocked(false); }
  setLocked(on) {
    if (this.locked === on) return;
    this.locked = on;
    if (this.onLock) this.onLock(on);
  }

  // ---- audio ----------------------------------------------------------------------------------------------
  // Sound effect channels are n % 20; a negative channel is all twenty (0x66200, 0x6b310, SESP).
  channels(ch) {
    const n = Number(ch);
    return ch === "" || ch === undefined || n < 0 ? Array.from({ length: 20 }, (_, i) => i) : [n % 20];
  }
  // 068 holds a sound effect command back on the game clock: ceil(ms x 0.06) frames, at least 1 (native: a
  // per-channel frame countdown, 0x66200 / 0x65e50, not while skipping). Each channel has one slot (0x146ea98, 20
  // bytes a channel) with the command's kind (1 SEPL, 2 SEFD, 3 SEVL) and options until it runs (0x65a60 clears it).
  // A second delayed command first runs the one waiting (0x66200 -> 0x65a60). Commands with no delay leave the slot
  // to itself except: SEPL zeroes the countdown, so its command stays and runs when the next delayed one arrives
  // (0x6a340); SEVL on a slot holding an SEPL only sets that SEPL's volume and does nothing else (0x6ae10); SEFD empties
  // a slot whose SEPL is still counting down (0x6b310). SESP empties the slot.
  soundLater(ch, kind, opts, name, loop) {
    const act = this.soundAct(kind, name, loop);
    for (const k of this.channels(ch)) {
      const old = this.delayed.get(k);
      if (!("068" in opts)) {
        if (kind === 1 && old) { old.cancel(); old.counting = false; }
        if (kind === 3 && old && old.kind === 1) { old.opts["017"] = Math.min(100, Math.max(0, opts["017"] ?? 0)); continue; }
        if (kind === 2 && old && old.kind === 1 && old.counting) { old.cancel(); this.delayed.delete(k); }
        act(k, opts, false);
        continue;
      }
      if (old) { old.cancel(); this.delayed.delete(k); old.run(); }
      const frames = opts["068"] > 0 ? Math.ceil((opts["068"] * 3) / 50) : 1;
      this.queueDelayed(k, { kind, opts, name, loop, left: (frames * 1000) / 60, counting: true });
    }
  }
  // What a delayed sound command does when its time comes (0x65a60), by kind: 1 SEPL, 2 SEFD, 3 SEVL. A sound played once starts nothing while
  // the skip flag is up, on either path (0x6a340, 0x65780: N2-24, N2-124); kinds 2 and 3 act as usual.
  soundAct(kind, name, loop) {
    return (k, o, delayed) => {
      if (kind === 1) {
        if (!loop && this.skip) this.audio.dropOneShot?.(k);
        else this.audio.playSE(k, !!loop, name, o, { delayed });
      } else if (kind === 3) this.audio.volSE(k, o, { delayed });
      else this.audio.fadeSE(k, this.soundsSkipped ? 0 : o["001"] || 0, { delayed });
    };
  }
  // A channel's slot of the delay queue (0x146ea98, 20 bytes a channel), new or put back from a record. `counting` false is a command an
  // SEPL has zeroed the countdown of (0x6a340): it stays until the next delayed one runs it. A countdown stands still through an instant run, which is
  // one frame natively.
  // The countdown runs on the sound clock: a menu, the backlog or a dialog over the story does not hold it (N2-123; native run: a sound
  // delayed 6 s plays on time behind the system menu). Only the rewind stops the game's count (0xae05b8), and a rewind's restore puts the slots back.
  queueDelayed(k, { kind, opts, name, loop, left, counting }) {
    const gen = this.generation, act = this.soundAct(kind, name, loop);
    let timer = null, last = this.soundClock.now();
    const entry = { kind, opts: { ...opts }, name, loop, counting, until: last + left, cancel: () => clearTimeout(timer) };
    entry.run = () => act(k, entry.opts, true);
    const tick = () => {
      if (gen !== this.generation || this.delayed.get(k) !== entry || !entry.counting) return;
      const now = this.soundClock.now(), dt = now - last;
      last = now;
      if (this.instant) entry.until += dt;
      else if (this.skip) entry.until -= dt * SKIP_SPEED;
      const rest = entry.until - now;
      if (rest <= 0) { this.delayed.delete(k); entry.run(); return; }
      timer = setTimeout(tick, Math.min(this.skip ? 16 : 50, Math.max(1, rest)));
    };
    this.delayed.set(k, entry);
    tick();
  }
  cancelDelayed() { for (const e of this.delayed.values()) e.cancel(); this.delayed.clear(); }
  // The delay slots as a record keeps them (0x5a910 -> record +0x3914, 400 bytes), with what each command still has to do: only slots in use.
  delayedState() {
    if (!this.delayed.size) return undefined;
    const now = this.soundClock.now();
    return [...this.delayed].map(([k, e]) => ({ k, kind: e.kind, name: e.name, loop: e.loop, opts: { ...e.opts }, left: e.counting ? Math.max(0, e.until - now) : 0, counting: e.counting }));
  }
  // A restore puts the slots back (0x5baf0): a countdown still running at the point goes on from where it was (S39).
  restoreDelayed(list) { for (const d of list || []) this.queueDelayed(d.k, d); }
  // Sound fades are cut only where the engine records sound without playing it: a read scene's instant run (0xae0568)
  // and a load's silent run (0x146e638), here also test jumps and the smoke test. Fast forward fades in real time
  // (0x64fa0 / 0x6b310 test only those flags).
  get soundsSkipped() { return this.skip && (this.instant || !!this.skipUntil || !this.skipPaced); }
  // A voiced effect (070) is silent while voices are off (audio.js, at the time it plays). A sound played once is passed over while the
  // skip flag is up (soundAct).
  op_SEPL(ch, loop, name, ...rest) {
    this.ringAdd();
    const opts = parseOpts(rest);
    if (this.recorded) { this.recordSE(Number(ch) % 20, loop === "1" ? "loop" : "once", name, opts); return; }
    this.soundLater(Number(ch) % 20, 1, opts, name, loop === "1");
  }
  op_SEVL(ch, ...rest) {
    this.ringAdd();
    if (this.recorded) { this.recordSE(Number(ch) % 20, "vol", null, parseOpts(rest)); return; }
    this.soundLater(Number(ch) % 20, 3, parseOpts(rest));
  }
  op_SEFD(ch, ...rest) {
    this.ringAdd();
    if (this.recorded) { for (const k of this.channels(ch)) this.recordSE(k, "fade"); return; }
    this.soundLater(ch, 2, parseOpts(rest));
  }
  // SESP(n): stops channel n % 20 (-1: all) at once and empties its slot (its last volume stays).
  op_SESP(ch) {
    if (this.recorded) { for (const k of this.channels(ch)) this.recordSE(k, "stop"); }
    for (const k of this.channels(ch)) {
      const e = this.delayed.get(k);
      if (e) { e.cancel(); this.delayed.delete(k); }
      this.audio.stopSE(k);
    }
  }
  op_MPLY(n, ...rest) {
    this.ringAdd();
    this.unlocks.playedMusic(Number(n));
    if (this.recorded) { this.recordMusic(Number(n), parseOpts(rest)); return; }
    this.audio.playBGM(Number(n), parseOpts(rest));
  }
  op_MVOL(...rest) {
    this.ringAdd();
    if (this.recorded) {
      const v = Math.min(100, Math.max(0, parseOpts(rest)["017"] ?? 0));
      if (this.recorded.bgm) this.recorded.bgm.vol = v / 100;
      this.recorded.lastMusic = v;
      return;
    }
    this.audio.volBGM(parseOpts(rest));
  }
  op_MFAD(...rest) {
    this.ringAdd();
    if (this.recorded) { this.recorded.bgm = null; return; }   // 0x64fa0 records the music as stopped
    this.audio.fadeBGM(this.soundsSkipped ? 0 : parseOpts(rest)["001"] || 0);
  }
  // VPLY names the next message's voice (native 0xae04c8, with the character from 0x2360): the MSG or MSAD that follows
  // starts it (0x6e0d0 / 0x6e950), so a wait or transition between them (about 30 places) comes before the voice.
  // The row's "heard" bit and Test sample are set for every voice, also while skipping (0x7a420 calls 0x29300 with no
  // skip test).
  op_VPLY(name) {
    this.ringClose();
    this.lastVoice = name;      // Replay Voice's target (0xae0790), which clicks and later lines leave alone (N2-79)
    this.recordVoice = name;    // and what the next MSG's record keeps (0xae08b0)
    this.pendingVoice = name;   // the MSG starts it unless it is skipped (a skip may stop at that line, see message)
    this.heardVoice(name);
  }
  // The voice VPLY named starts with the message (the previous one stops first).
  startPendingVoice() {
    const name = this.pendingVoice;
    this.pendingVoice = null;
    // a speaker whose row is switched off starts no voice, so the line has none to wait for or to cut (0x6e6dc: flag 4 is not set)
    if (!name || this.skip || this.voiceOn === false || this.audio.voiceOff?.(name)) return false;
    this.audio.playVoice(name, this.keepVoice);
    return true;
  }
  // VPL2 shares VPLY's code (0x78130, 0x7a3ec-0x7a414): the same three voices and the same closing record; then it plays the voice itself
  // on top of what is playing (0x7a450 on) and leaves none pending (0x7a4fc).
  op_VPL2(name) {
    this.ringClose();
    this.lastVoice = name;
    this.recordVoice = name;
    this.pendingVoice = null;
    this.heardVoice(name);
    if (this.skip) return;
    if (this.voiceOn !== false) this.audio.playVoice(name, true);
  }
  // A character's voice row appears on the sound page once one of its lines has played (0x29300 sets bit 4 of the
  // row's global, 0x29fa0 lists rows that have it), and its Test button plays the last one heard.
  heardVoice(name) {
    const v = this.system?.voices;
    const c = this.audio.characterOf(name);
    if (!v || c < 0) return;
    const g = `G${String(v.rowFlags[c]).padStart(3, "0")}`;
    if (!(this.getVar(g) & 4)) this.setVar(g, this.getVar(g) | 4);
    try {
      const samples = JSON.parse(localStorage.getItem("tsuki.voiceSamples") || "{}");
      if (samples[c] !== name) { samples[c] = name; localStorage.setItem("tsuki.voiceSamples", JSON.stringify(samples)); }
    } catch { /* not kept */ }
  }

  // ---- movies ---------------------------------------------------------------------------------------------
  // TOMP n (native 0x6ef30): closes the text window (F1103) and starts movie task n. Whether the movie was seen before
  // (G005, which its end sets) decides if a press may pass it (main.js STORY_MOVIES). The movie counts as seen from its end
  // (main.js playMovie's finish): a page closed during a first showing leaves it unseen, so it is not listed in the gallery,
  // its songs stay locked and its next showing cannot be passed.
  op_TOMP(n) {
    // 0x6ef30 clears 0xae0568 and 0xae0670 (movie 7 aside, which no script plays) without putting the recorded sound back
    this.endInstant(false);
    const name = this.movieFor(n);
    // Seen before: the record is made when a showing ends or is passed, as G005's bit is (0x40a00 -> 0x923c0), not here (N2-171)
    const seen = !!name && this.unlocks.movies.has(name);
    if (name) this.closeWindowForFade();
    this.movie = name ? this.playMovie(name, { story: true, number: Number(n), seen }) : null;
  }
  async op_TOMW() {
    if (this.movie) { await this.movie; this.movie = null; }
  }
  // script: the name of the script that plays it (the look-ahead asks about scripts it has not come to).
  movieFor(n, script = this.script.name) {
    const e = this.movies[n];
    if (!e) { console.warn("no movie for", n); return null; }
    if (typeof e === "string") return e;
    const route = script.includes("CIEL") ? "ciel" : "arc";
    return e[route];
  }

  // ---- saving ---------------------------------------------------------------------------------------------
  // Mid-message, the state saved is the message fully shown and waiting for the player. At a choice, it is the
  // choice's own command with its labels, so that it asks again.
  snapshot() {
    if (this.text.typing) this.text.finish();
    const now = this.now();
    // a save holds the state, so a depth STCP left waiting is the layer's depth after a load (0x5baf0 commits the state)
    const state = (l) => ({ id: l.id, image: l.image, ...layerState(l, now), z: l.zNext ?? l.z, blend: l.blend,
      ...placement(l), motion: l.motion?.snapshot(now),
      tweens: Object.fromEntries(["x", "y", "zx", "zy", "rot", "alpha"].map((k) => [k, l[k].snapshot(now)])),
      effects: Object.fromEntries(Object.entries(l.effects).map(([k, e]) => [k, rebaseEffect(e, now, 0)])) });
    const el = document.getElementById("text");
    return {
      script: this.scriptIndex, pc: this.choosing ? this.choosing.pc : this.pc, vars: { ...this.vars },
      layers: [...this.layers.values()].map(state), pending: [...this.pending.values()].map(state), removed: [...this.removed],
      ghosts: [...this.ghosts.values()].map(state),
      page: this.text.pageParts.slice(), html: el.innerHTML,
      waiting: !this.choosing && (!!this.waitResolve || this.msgPending), pageEnd: this.pageEnd,
      choices: this.choosing ? this.choosing.list.slice() : undefined, voice: this.msgVoice || null, logged: this.text.logged,
      audio: this.soundState(), delayed: this.delayedState(), when: Date.now(), name: this.script.name,
      flow: this.flow.snapshot(),
      win: this.text.state?.(), pageId: this.page, locked: this.locked, keepMusic: this.keepMusic, lastChoice: this.lastChoice,
      // the current Z command (a record's +0x1a / +0x1c, 0x5a910; 0x5baf0 puts it back) and the message's read flag
      zCurrent: this.zCurrent, msgRead: this.msgRead, ring: this.ring,
      motionStarts: structuredClone(this.motionStarts), shake: rebaseEffect(this.gfx.shake, now, 0), textShake: rebaseEffect(this.gfx.textShake, now, 0),
      split: rebaseTimes(this.gfx.split, this.frameNow(), 0), lines: rebaseTimes(this.gfx.lines, now, 0),
      // only the layer numbers with any haze state, by number
      hazes: Object.fromEntries(this.hazes.map((h, i) => [i, h]).filter(([, h]) => h.n || h.next || h.ramp || h.stop || h.left)
        .map(([i, h]) => [i, rebaseHaze(h, now, 0)])),
    };
  }

  // The sound state a record keeps. Inside an instant run nothing plays and the run's own record is the state (beginInstant): a record made
  // there, such as the unread line the run stops at, must hold that and not the silence (found with item 58).
  soundState() { return this.recorded ? structuredClone(this.recorded) : this.audio.snapshot?.(); }

  // ---- rewinding: a point is kept at each wait for the player and at each choice ----------------------------
  remember(choice = false) {
    this.passedHere = false;
    const s = this.snapshot();
    s.waiting = !choice;
    s.choice = choice;
    if (choice) s.voice = null;   // a choice's records keep no voice (0x5a910 writes -1, only MSG writes one)
    else if (this.msgSound) {
      // a message's record has the sound state of its start (see message): sounds a delay fired since are still to come at this point (S39)
      if (this.msgSound.audio !== undefined) s.audio = this.msgSound.audio;
      s.delayed = this.msgSound.delayed;
      this.msgSound = null;
    }
    this.trail.push(s);
    while (this.trail.length && this.ring - (this.trail[0].ring ?? 0) >= RING) this.trail.shift();
  }

  // The record a MSG makes as it starts (0x5a910 in 0x6e0d0), before anything of the message has happened: restoring it runs the message
  // again. Its voice is the one VPLY or VPL2 left for it (0xae08b0).
  messagePoint() {
    const s = this.point();
    s.pc = this.pc - 1;
    s.msgStart = true;
    s.voice = this.recordVoice || null;
    return s;
  }

  // The record an ATSV makes (0x5a910): the state here, neither a wait for the player nor a choice, its voice -1.
  point() {
    const s = this.snapshot();
    s.waiting = false;
    s.choice = false;
    s.voice = null;
    return s;
  }

  // The backlog's Quick Jump (native 0x28d50 restores the chosen record): back to the wait for the player that
  // followed the chosen line, or for a choice's rows the choice itself (0x28d50 restores the record SELR saved before
  // them, type 0xd, so the choice is asked again). -1 when that point is no longer kept.
  jumpTarget(seq, choice = false) {
    const here = this.waitResolve || this.choosing || this.passedHere ? 1 : 0;   // the record the player is at
    for (let i = 0; i < this.trail.length - here; i++) {
      const t = this.trail[i];
      if (choice ? t.choice && t.logged === seq - 1 : (t.logged ?? -1) >= seq) return i;
    }
    return -1;
  }

  canJump(seq, choice = false) { return this.jumpTarget(seq, choice) >= 0; }

  jumpTo(seq, choice = false) {
    const i = this.jumpTarget(seq, choice);
    if (i < 0) return Promise.resolve(false);
    const s = this.trail[i];
    this.trail.length = i;
    // Quick Jump (0x28d50 -> 0x5baf0 with param 2 = 0) runs the message again: typed anew, its voice played (N2-77, S38)
    return this.restore(s, { rewind: true, restartMusic: true, retype: true, voice: true }).then(() => true);
  }

  // The point a rewind lands on, before the one the player is at (0x814c0, listing 0x816e0-0x8173c): the last record that is a message
  // (type 0, so not a choice: 0x3001, N2-4) on a page's first line (its saved F823 below 2, N2-3).
  rewindTarget(toChoice) {
    const here = this.waitResolve || this.choosing || this.passedHere ? 1 : 0;   // the record the player is at
    for (let i = this.trail.length - here - 1; i >= 0; i--) {
      const t = this.trail[i];
      if (toChoice ? t.choice : !t.choice && (t.vars?.F823 || 0) < 2 && !(t.passed && t.locked)) return i;   // a record a task held back is passed over (+0x35c0, 0x816e4)
    }
    return -1;
  }

  canRewind(toChoice = false) { return this.rewindTarget(toChoice) >= 0; }

  // The point is taken off the trail; arriving at it again puts it back.
  rewind(toChoice = false) {
    const i = this.rewindTarget(toChoice);
    if (i < 0) return Promise.resolve();
    const s = this.trail[i];
    this.trail.length = i;
    // the line types out again at the read speed (0x5baf0 with param 2 = 1 at 0x5cfbc-0x5cfe0, N2-84), unless an ATSV(1) record was
    // restored just before it (0xae0928, see op_ATSV)
    return this.restore(s, { rewind: true, retype: !s.wholeBack, readSpeed: true });
  }

  // restartMusic: the load, the backlog's Quick Jump and Return to Previous Scene stop all sound before the restore
  // (0x82330 / 0x81a50 -> 0x5ef10, 0x28d50 -> 0x9c610), so the music starts again from its top; a rewind keeps it.
  async restore(s, { rewind = false, restartMusic = !rewind, retype = !rewind, readSpeed = false, voice = !rewind } = {}) {
    this.stop();
    this.endInstant(false);   // the restore puts the sound back itself
    const gen = this.generation;   // a later restore or stop ends this one
    this.restoring = true;
    this.syncSpeed();
    // A load starts the log again (0x82330 empties the 800 records and their ring), as it does the rewind trail.
    if (!rewind) { this.trail = []; this.scenePoints = []; this.nearScene = 0; this.text.history = []; this.text.dropped = false; this.ring = 0; }
    else {
      // rewinding or Quick Jumping back over an ATSV takes its "Return to Previous Scene" point off the ring (0x5cdf0-0x5ce80, N2-76)
      let popped = false;
      while (this.scenePoints.length && (this.scenePoints.at(-1).ring ?? 0) > (s.ring ?? 0)) { this.scenePoints.pop(); popped = true; }
      if (popped) this.nearScene = 0;
      if (s.ring !== undefined) this.ring = s.ring;
    }
    this.ringDirty = false;
    this.ringGate = false;
    // a sway running on a layer goes on from its cycle (0x5baf0 puts back the command's numbers, not the record's cycle)
    const swaying = new Map([...this.allLayers()].map(([id, l]) => [id, l.effects.oscillation]));
    this.layers.clear();
    this.pending.clear();
    this.removed.clear();
    this.staged = false;
    this.gfx.fade = null;
    this.motionStarts = structuredClone(s.motionStarts || {});
    const now = this.now();
    this.gfx.shake = null;   // a restore ends any shake (0x5baf0 at 0x5cb34: 0x2ea70(-1), the record's shake type being 0)
    this.gfx.textShake = rebaseEffect(s.textShake, 0, now);
    // 0x5baf0 restarts the split (0x2e430(4): counters and the first lap's wobble from the start; alpha 1 when the level is not 0,
    // else it goes on from what it was, rising 1/60 a frame; a split that was fading out is simply off: N2-107) and the
    // speed lines (0x86470(type, 0): their first phase again, off if they were fading: N2-100).
    this.gfx.split = restoredSplit(s.split, this.gfx.split, this.frameNow());
    this.gfx.lines = s.lines && s.lines.end === null ? startLines(s.lines.type, now) : null;
    this.vars = { ...s.vars };
    this.applyWindow();
    this.choices = (s.choices || []).slice();
    // The record's voice comes back as Replay Voice's target and, for a message, its own (0x5baf0 at 0x5bdc4; N2-79). Nothing is left for the next MSG: a rewind clears it and any other restore's MSG takes it up again.
    this.lastVoice = this.msgVoice = s.voice || null;
    this.recordVoice = null;
    // A MSG's own record (messagePoint): the message runs again and takes the voice up itself (not after a rewind, which clears it)
    if (s.msgStart) { this.msgVoice = null; this.recordVoice = s.voice || null; this.pendingVoice = voice ? s.voice || null : null; }
    this.msgSound = null;
    this.text.clear();
    this.text.pageParts = (s.page || []).slice();
    if (s.win && this.text.setState) this.text.setState(s.win); else this.text.setOpen(true, true);
    this.wholePage = readSpeed ? !!this.wholeRead : !!s.win?.whole;   // a rewind takes "Display whole text" from the read setting (0x5cf1c)
    this.page = s.pageId || 0;
    this.keepMusic = !!s.keepMusic;
    this.lastChoice = s.lastChoice ?? -1;
    if (s.zCurrent !== undefined) this.zCurrent = s.zCurrent;
    this.msgRead = !!s.msgRead;
    // The speed an MSAD after this point types at (N2-112): the rewind forces the read speed (0x3b2b0(0, 1) at 0x5cf14); a load or Quick Jump follows
    // the message's read state, which the next MSG run takes from its block (0x6e334).
    this.text.speed = readSpeed || this.zRead(this.zCurrent) ? this.readSpeed : this.textSpeed;
    // A point taken at a choice is at the choice's own op, whose label Z commands ran before it was asked.
    this.zFrom = null;
    this.zSkip = s.choices || s.msgStart ? s.pc : -1;
    this.setLocked(!!s.locked);
    if (!rewind) this.replay = false;
    const el = document.getElementById("text");
    el.innerHTML = s.html || "";
    this.text.adoptPage?.();
    if (rewind) this.text.unlog(s.logged);
    // Every restore ends with the layers' tweens at their targets (0x5d7e0 / 0x814c0 -> 0x328f0 clears the records'
    // tween offsets): a fade or a move that was under way at the point is finished.
    const make = (d) => {
      const l = newLayer(d.id, d.image);
      for (const k of ["x", "y", "zx", "zy", "rot", "alpha"]) l[k] = new Value(d.tweens?.[k] ? d.tweens[k].b : d[k]);
      Object.assign(l, { z: d.z, blend: d.blend, blurX: d.blurX, blurY: d.blurY, tint: d.tint ?? null });
      // Saves from before placement was kept have none of these: the defaults are what those saves showed.
      for (const k of [...PLACEMENT, ...COLOUR]) if (d[k] !== undefined) l[k] = structuredClone(d[k]);
      l.motion = Motion.restore(d.motion, this.motions, now);
      l.effects = Object.fromEntries(Object.entries(d.effects || {}).map(([k, e]) => [k, rebaseEffect(e, 0, now)]));
      carrySway(l.effects.oscillation, swaying.get(d.id), now);
      if (d.image) this.setImage(l, d.image);
      if (l.rule) this.gfx.load(l.rule.name).catch(() => {});
      return l;
    };
    for (const d of s.layers) this.layers.set(d.id, make(d));
    for (const d of s.pending || []) this.pending.set(d.id, make(d));
    for (const id of s.removed || []) this.removed.add(id);
    this.ghosts.clear();
    for (const d of s.ghosts || []) this.ghosts.set(d.id, make(d));
    // Saves from before the haze was drawn kept STRA's number on the layer (`spin`).
    this.hazes.forEach((h, i) => Object.assign(h, newHaze(), s.hazes?.[i] ? rebaseHaze(s.hazes[i], 0, now) : {}));
    if (!s.hazes) for (const d of s.layers) if (d.spin?.n >= 1 && this.hazes[d.id]) Object.assign(this.hazes[d.id], { n: d.spin.n, next: d.spin.n, start: now });
    await this.waitImages([...this.layers.values(), ...this.pending.values()].map((l) => l.promise));
    if (gen !== this.generation) return;
    this.audio.restore(s.audio, { restartMusic });
    this.restoreDelayed(s.delayed);
    // A rewind starts no voice (0x5baf0 with param 2 = 1 clears the pending one, S38); a Quick Jump and a load run the message again, which plays it.
    this.ownVoice = !!(voice && s.voice && this.voiceOn !== false && !s.msgStart);
    if (this.ownVoice) this.audio.playVoice(s.voice);
    const script = await this.getScript(s.script);
    if (gen !== this.generation) return;
    this.script = script;
    this.scriptIndex = s.script;
    this.pc = s.pc;
    this.flow.restore(s.flow);
    // A save from before the flowchart was saved with the game: the scene the save was made in is taken as current.
    if (!s.flow) {
      const entry = script.ops.slice(0, s.pc).findLast((o) => o[0] === "RTST");
      if (entry) { this.flow.read(Number(entry[1])); this.flow.current = Number(entry[1]); }
    }
    this.running = true;
    this.restoring = false;
    this.syncSpeed();
    this.pageEnd = !!s.pageEnd;
    // 0x5baf0 ends by moving the checkpoint (0x5d300-0x5d368), only when the record restored is on a page's first line and no task held it
    // back, so a rewind or Quick Jump onto a later line leaves it where it was (N2-1). A load's record is its save's checkpoint, whichever
    // point an older save holds.
    const { thumb, note, auto, ...point } = s;
    if (!rewind || ((s.vars?.F823 || 0) < 2 && !s.locked)) this.savePoint = point;
    this.pageCheckpoint = false;
    this.startPoint = null;
    if (s.waiting) {
      // saved while waiting for a click: wait for it again before going on. The message's line is typed over first (N2-84, N2-77).
      if (retype) await this.typeAgain(readSpeed || this.zRead(this.zCurrent), gen);
      if (gen !== this.generation) return;
      // The record of a line that went on without a click (passed): its message run again (a load, Quick Jump) goes on as it did; the
      // rewind (the only restore at the read speed) waits there for a click.
      if (s.passed && !readSpeed) this.voiceThenOn().then(() => { if (gen === this.generation) { this.typeResolve = null; this.loop(gen); } });
      else this.afterWait().then(() => { if (gen === this.generation) this.loop(gen); });
    } else this.loop(gen);
  }

  // The current line typed out again, at the read speed or the unread one (0x5baf0: the front at 0, 0x3b2b0), a click finishing it as
  // any typing; earlier lines stay at their dim level. A speed for an MSAD that follows is left as it would be (N2-112).
  async typeAgain(read, gen) {
    this.text.speed = read ? this.readSpeed : this.textSpeed;
    const typed = this.text.retype?.(this.fadeUnread === false);
    if (!typed) return;
    let clicked = false;
    const click = this.clickOrSkip(true).then(() => { clicked = true; });
    await Promise.race([typed, click]);
    if (gen !== this.generation) return;
    this.typeResolve = null;
    await this.endTyping(typed, clicked, gen);
  }

  // A press while a line types shows the rest of it at once, and the line then counts as typed on the next frame, as one typed out
  // does (0x81b30 sets the front to 76800; the wait and its mark start a frame later, TextBox.rush). Skipping, a restore and a text
  // box that is not typing by frames end it here.
  async endTyping(typed, clicked, gen) {
    if (!this.text.typing) return;
    if (clicked && !this.skip && this.text.rush) {
      this.text.rush(true);
      await typed;
      if (gen !== this.generation) return;
    }
    if (this.text.typing) this.text.finish(clicked && !this.skip);
  }

  // After a click at the end of a page the page stays on screen until the next message clears it (0xae0940, read by
  // 0x6e0d0), so a CLO4 that follows fades it out with its text.
  async afterWait() {
    const gen = this.generation;
    await this.waitAdvance();
    if (gen !== this.generation) return;
    // F799 itself stays until the next WNTY: the MSAD after a page's wait still counts as a page end (0x6e950, 0x81b30; N2-110)
    if (this.pageEnd) this.text.pagePending = true;
  }
}
