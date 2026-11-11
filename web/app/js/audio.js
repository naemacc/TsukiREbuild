// audio.js - music, sound effects and voices with Web Audio. Files are converted on demand by the local server.
// Script options come as `NNN:value. The native handlers (0x649e0 music, 0x6a340 / 0x66200 sound effects) read:
//   001 fade-in (or fade) time in ms, 017 volume in percent, 011 the old track's fade time (MPLY; 0x9c9b0) or, for
//   MFAD, whether the script waits for the fade (0x64fa0: 0 does not; every MFAD in the scripts passes 0),
//   018 pan 0-127 (64 centre; 0x6a340: (v * 1000 - 64000) >> 6), 049 loop (MPLY, 0 plays once; 0x9c960),
//   068 a delay in ms before the command acts (sound effects; a per-channel frame countdown, 0x66200 / 0x65e50),
//   069 a start offset in samples (MPLY; nn::atk StartInfo offset type 2, 0xee200), 070 the character (1-19) whose
//   voice setting the sound follows (voiced sound effects, SEV_*).
export function parseOpts(args) {
  const o = {};
  for (const a of args) {
    const m = /^`(\d+):(-?\d+)$/.exec(a || "");
    if (m) o[m[1]] = Number(m[2]);
  }
  return o;
}

const STORE = "tsuki.volumes";
// The sound page has three volumes with a mute each (BGM, SE, menu: config +4/+8/+10 and +0x64..0x66), the voice
// switch (+6: 100 or 0) and per character a volume (+0x34 + 2i) and an on/off bit (+0x24). There is no master volume.
// Defaults are the game's (the initial config at 0x46b080, also what the config's reset writes, 0x2c810): BGM 40,
// SE 40, menu 10, every character 50.
// The SE Test's effects (table 0x46b138, 14 names; 0x29140 picks one at random).
export const SE_TEST = ["moon_se02009", "moon_se02010", "moon_se02011", "moon_se02023", "moon_se02035", "moon_se02037",
  "moon_se02052", "moon_se02058", "moon_se02062", "moon_se02091", "moon_se10047", "moon_se02097", "moon_se02103", "moon_se09005"];
export const CHARACTERS = 19;
export const VOLUME_DEFAULTS = { bgm: 0.4, se: 0.4, sys: 0.1, voice: 1, bgmMute: false, seMute: false, sysMute: false,
  chars: Array(CHARACTERS).fill(50), charOn: Array(CHARACTERS).fill(true) };

// Music and voices are 48 kHz streams (the Nintendo Opus headers say so); 069 counts samples of them.
const STREAM_RATE = 48000;
// The scripts' music numbers start at 1: MPLY n plays sound 0x01000000 + n - 1 (0x649e0 -> 0x9c470 -> 0x6f0, table
// 0x333f90), and audio_tables.json lists the streams by sound index from 0.
export function streamOf(table, n) {
  return (table && table.bgm && n >= 1 && table.bgm[n - 1]) || null;
}

// ---- the engine's volume law ----------------------------------------------------------------------------
// Each music and sound effect channel keeps a level L (0-100: the script's 017, moved by fades), and the mixer
// (0x9b7f0, every frame) gives nn::atk an amplitude made from it:
//   music                         ca0(B(L/100 x BGM/100))   (0x9b5d0; the Music Player: ca0(B(its volume)), 0x9c8f0)
//   sound effect                  ca0(L/100 x SE/100)       (type-1 channels, 0x9b690 / 0x9cd40)
//   voiced effect (070), no 001   L/100 x row/100 x voice switch/100, linear, no SE volume (type 2, 0x9caa0 / 0x9cd40)
//   voice                         row/100 x voice switch, linear (0x6e0d0; the switch is the VM's voiceOn)
//   interface sound               menu/100, linear (0xacef0); the second player 0xacfa0: ca0(SE/100)
// ca0 (0xca0) reads the 101-value table at 0x3355f0 (system.json volumeCurve): below 0.0014423 the value itself, else
// with i = trunc(100 v): 0 for i < 1, 1 for i > 98, else T[i] + (100 v - i)(T[i + 1] - T[i]). B is easing type 12
// (0xe1d30 / 0xe1bfc -> 0xff4b8), the quadratic Bezier from 0 to 1 through 0.77: 1.54 v - 0.54 v^2.
// The settings as the mixer reads them (sound bytes *(0xae0350)): SE = (1 - mute) x SE (0x2a9b0); BGM is re-applied the
// frame after any sound setting changes (0x47b40 -> 0x48ac0 -> 0xad090) as floor(floor(256 x (1 - mute) x BGM / 200)
// x 100 / 128), so 40 plays as 39. Movies are not nn::atk sounds: the movie player uses (1 - mute) x BGM / 100 (main.js).
const CURVE_FLOOR = 0.001442310051061213;   // 0x3abd0be5
const LINEAR_TABLE = Array.from({ length: 101 }, (_, i) => i / 100);
export function curveOf(table, v) {
  if (!(v >= CURVE_FLOOR)) return Math.max(0, v || 0);   // a negative volume is silence to nn::atk
  const i = Math.trunc(100 * v);
  if (i < 1) return 0;
  if (i > 98) return 1;
  return table[i] + (100 * v - i) * (table[i + 1] - table[i]);
}
export const bezier = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 2 * t * (1 - t) * 0.7699999809265137 + t * t);
const unit = (v) => (v < 0 ? 0 : Math.min(1, v));
// Every sound of knife1.bfsar (music, effects, voices, interface) has the per-sound volume 96 of 127 (SoundInfo +8;
// 0x106880 divides it by 127), which the movies do not have (system.json soundVolume).
const SOUND_VOLUME = 96;
// The sound system's master (+0x2c, set by 0xec618 from its parameters; 0xee110, 0xeea34 and the other handle calls multiply by it)
// is 127 / 96, so the two cancel. Measured on a native run's mix (NX_AUDIO_DUMP): against the decoded files music, stereo and mono
// effects, voices and interface sounds all come out at 0.98-1.02 of the volume law below with no 96 / 127 in it (N2-25).
const SYSTEM_MASTER = 127 / 96;

// Where nn::atk puts each channel of a sound (MultiVoice 0x12d108 -> pan ratio 0x12a1a8), for a pan q (nn::atk's own
// value: 2p or p, see playSE). Every sound of the archive has the pan curve "sqrt", not scaled to the centre (SoundInfo
// option 1, byte 1 = 0; pointer table 0xad5320 -> 0x3cf91c: T(i) = sqrt(1 - i/256)); a side's share of position x is
// T(i(x)), i(x) = 0 for x < -1, else trunc((min(x, 1) + 1) / 2 x 256 + 0.5). Byte 0 is the pan mode: the effect waves
// have 0, "dual", the streams (music, voices) 1, "balance" (0x10ebfc -> 0x10cfd8 -> voice +0x1f4).
//   wave, dual: channel 0 sits at q - 1, channel 1 at q + 1, each split left / right by T, so a centred stereo wave
//     plays as it is; a mono wave sits at q (0.7071 each side when centred).
//   stream, balance: each channel is a voice of its own (0x122378 gives channel 0 side 1, channel 1 side 2), left at
//     T(i(q)) only or right at T(i(-q)) only (0x12d6e4), so music plays at 0.7071; a mono stream (voices) sits at q.
// The game starts nn::atk in surround mode (0xec618 / 0x112db0 -> 0x1134e0(2, 0)), whose front pair gets these values
// (surround pan 0: T(0) = 1 to the front, nothing to the rear) and no front bypass (SoundSystemParam +0x7e is 0).
const panIndex = (x) => (x < -1 ? 0 : Math.trunc(((Math.min(x, 1) + 1) / 2) * 256 + 0.5));
const panShare = (x) => Math.sqrt(1 - panIndex(x) / 256);
export function panMatrix(stream, channels, q = 0) {
  if (stream) return channels >= 2 ? [[panShare(q), 0], [0, panShare(-q)]] : [[panShare(q), panShare(-q)]];
  if (channels >= 2) return [[panShare(q - 1), panShare(1 - q)], [panShare(q + 1), panShare(-q - 1)]];
  return [[panShare(q), panShare(-q)]];
}

// A channel's level as the mixer moves it: from l0 at time t0 (audio clock, seconds) toward target at `rate` level
// units a frame (0x9b7f0 adds rate x the frames gone by; a rate of 0 or less moves 0.2 a frame), and there it stays.
const FPS = 60;
// The mixer's step: 1 a frame, and 64 more while fast forward runs (0x4a5b0 calls 0x9b7f0(64) on top of the frame's own call), so a
// 3 s music fade is over in three frames of it. Audio.setSpeed changes it.
let mixSpeed = 1;
export class Level {
  constructor(t, level, target = level, rate = 0) { this.t0 = t; this.l0 = level; this.target = target; this.rate = rate; }
  get perSecond() { return (this.rate > 0 ? this.rate : 0.2) * FPS * mixSpeed; }
  at(t) {
    const d = this.target - this.l0, moved = this.perSecond * Math.max(0, t - this.t0);
    return Math.abs(d) - moved <= 1e-9 ? this.target : this.l0 + Math.sign(d) * moved;
  }
  end() { return this.t0 + Math.abs(this.target - this.l0) / this.perSecond; }
  to(t, target, rate) { this.l0 = this.at(t); this.t0 = t; this.target = target; this.rate = rate; }
  jump(t, level) { this.t0 = t; this.l0 = this.target = level; }
}
// 0x9d0b0 (SEVL, and the delayed SEPL's retune): a rate of 1666.67 or more puts the level at the target at once.
const JUMP = 1666.6666259765625;
// The music handlers' rates: 1666.67 / ms a frame takes the level from 100 to 0 (or 0 to 100) in ms milliseconds.
const MUSIC_FADE = 1666.6666259765625;
const MUSIC_CUT = 416.6666564941406;   // 0x9c470: the track replaced without a fade-in, gone within a frame
// The longest fade drawn frame by frame; longer ones are sampled more coarsely.
const MAX_STEPS = 1800;

export class Audio {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.se = new Map();          // channel 0-19 -> the record its handle plays (state 1, or 2 while fading out)
    this.seLast = Array(20).fill(-1);   // 0x146e6cc: each channel's last scripted volume (-1 after a script ends)
    this.seChar = Array(20).fill(0);    // 0x146e690: the 070 of the channel's last SEPL
    this.bgm = null;              // the music handle in use (0x9b590) ...
    this.bgmOld = null;           // ... and the other one, where the track before fades out
    this.bgmState = null;         // the number MPLY compares with (0xac0688), its volume and loop
    this.lastMusic = 0;           // 0x146e650: the last MPLY / MVOL volume, which MFAD and MVOL rates come from
    this.voiceSlots = [{ token: null, node: null }, { token: null, node: null }];   // voice handles 2 and 3 (0x9b570)
    this.voiceHandle = 1;
    this.voice = [];
    this.voicePending = new Set();
    this.voiceOn = true;          // the voice switch (config +6), which voiced effects follow while they play
    this.testRow = -1;            // 0x46f814: the row whose voice Test was pressed last (-1: none)
    this.seLoops = {};
    this.musicLoops = {};
    this.voices = null;   // system.json voices: prefixes, speakers, rowFlags ...
    this.curve = LINEAR_TABLE;    // system.json volumeCurve once the VM has loaded it
    this.soundVolume = SOUND_VOLUME;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { /* defaults */ }
    // The old single "master" slider was the menu volume control: carry it over to the menu group.
    if (saved.sys === undefined && saved.master !== undefined) saved.sys = saved.master;
    delete saved.master;
    this.vol = { ...structuredClone(VOLUME_DEFAULTS), ...saved };
    for (const k of ["chars", "charOn"]) {
      const d = VOLUME_DEFAULTS[k];
      this.vol[k] = Array.from({ length: CHARACTERS }, (_, i) => (Array.isArray(this.vol[k]) && this.vol[k][i] !== undefined ? this.vol[k][i] : d[i]));
    }
    this.table = {};
  }

  // The engine tables system.json carries: the volume curve (0x3355f0) and the archive's per-sound volume.
  setTables({ volumeCurve, soundVolume } = {}) {
    if (Array.isArray(volumeCurve) && volumeCurve.length === 101) this.curve = volumeCurve;
    if (soundVolume > 0) this.soundVolume = soundVolume;
    this.applyVolumes();
  }

  start() {
    if (this.muted) return;
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000, latencyHint: "interactive" });
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.groups = {};
    for (const g of ["bgm", "se", "sys", "voice"]) {
      this.groups[g] = this.ctx.createGain();
      this.groups[g].connect(this.master);
    }
    this.applyVolumes();
  }

  // ---- settings -------------------------------------------------------------------------------------------
  // The bytes the mixer multiplies by (see the volume law above).
  musicByte() {
    const b = this.vol.bgmMute ? 0 : Math.round(this.vol.bgm * 100);
    return Math.min(100, Math.floor((Math.floor((256 * b) / 200) * 100) / 128));
  }
  seByte() { return this.vol.seMute ? 0 : Math.round(this.vol.se * 100); }
  musicGain(level) { return curveOf(this.curve, bezier(unit((level * this.musicByte()) / 10000))); }
  seGain(level) { return curveOf(this.curve, unit((level * this.seByte()) / 10000)); }
  // A type-2 channel (0x9b7f0): its row's volume times the switch, floor(switch x row / 100), linear.
  voicedGain(level, c) {
    const row = c >= 0 && c < CHARACTERS && this.vol.charOn[c] ? this.vol.chars[c] : 0;
    return unit((level * Math.floor(((this.voiceOn === false ? 0 : 100) * row) / 100)) / 10000);
  }
  // The gallery's Music Player (0x9c8f0): its own volume through the music curve, no BGM setting.
  playerGain(v) { return curveOf(this.curve, bezier(unit(v))); }
  // A centred stereo stream's share of each side (balance mode, panMatrix): the Music Player plays its own sources.
  get streamShare() { return panMatrix(true, 2)[0][0]; }
  gainOf(rec, level) {
    if (rec.kind === "music") return this.musicGain(level);
    if (rec.kind === "voiced") return this.voicedGain(level, rec.c);
    return this.seGain(level);
  }

  // The menu group plays at the menu volume, the voice group at its own; music and effects carry their amplitude per
  // sound, so their groups stay at 1. Everything nn::atk plays has the archive's 96 / 127 and the system's 127 / 96.
  groupGain(g) {
    if (g === "bgm" || g === "se") return 1;
    return this.vol[`${g}Mute`] ? 0 : this.vol[g];
  }

  applyVolumes() {
    if (!this.ctx || !this.groups) return;
    if (this.master) this.master.gain.value = (this.soundVolume / 127) * SYSTEM_MASTER;
    for (const g of Object.keys(this.groups)) this.groups[g].gain.value = this.groupGain(g);
    // The mixer re-applies a channel's amplitude as soon as a setting it reads changes (0x9d1c0, snd+0xa, rows).
    for (const rec of this.records()) this.schedule(rec);
    // The config's apply (0x2a9b0, after every change, the reset and on leaving) then looks at the row of the last
    // voice Test: when that row is muted the voices stop (0x9c3b0), and the voice on the handle in use takes that row's
    // volume x the switch (0x9d240), whoever is speaking.
    if (this.testRow >= 0 && this.testRow < CHARACTERS) {
      if (!this.vol.charOn[this.testRow]) this.stopVoice();
      const n = this.voiceSlots[this.voiceHandle]?.node;
      if (n) n.g.gain.value = this.rowLevel(this.testRow);
    }
  }

  // A row's volume as the voice byte holds it (snd+9): floor(row x switch / 100) / 100.
  rowLevel(row) {
    return Math.floor(((this.voiceOn === false ? 0 : 100) * this.vol.chars[row]) / 100) / 100;
  }

  records() { return [this.bgm, this.bgmOld, ...this.se.values()].filter(Boolean); }

  save() { try { localStorage.setItem(STORE, JSON.stringify(this.vol)); } catch { /* not saved */ } }

  setVolume(k, v) {
    this.vol[k] = v;
    this.save();
    this.applyVolumes();
  }

  setCharacter(i, { volume, on } = {}) {
    if (volume !== undefined) this.vol.chars[i] = volume;
    if (on !== undefined) this.vol.charOn[i] = on;
    this.save();
    this.applyVolumes();
  }

  setVoiceSwitch(on) {
    this.voiceOn = on !== false;
    this.applyVolumes();
  }

  resetVolumes() {
    Object.assign(this.vol, structuredClone(VOLUME_DEFAULTS));
    this.save();
    this.applyVolumes();
  }

  // ---- characters ---------------------------------------------------------------------------------------
  // A voice's speaker, from the first three letters of its file (0x2360; unknown letters: speaker 0).
  speakerOf(name) {
    const v = this.voices;
    if (!v || !name) return -1;
    return v.prefixes[String(name).slice(0, 3).toUpperCase()] ?? 0;
  }

  // The sound page row a speaker's voices play at (0x29390: log2 of the speaker's bit, speakers past 23 as 0). The
  // speaker 23 group (M00, M01, M02, M11, M12) is row 18's like speakers 0, 19, 20 and 22.
  rowOf(name) {
    const v = this.voices;
    if (!v) return -1;
    const speaker = this.speakerOf(name);
    if (speaker < 0) return -1;
    const mask = v.speakers[speaker > 23 ? 0 : speaker] >>> 0;
    const c = mask ? 31 - Math.clz32(mask) : -1;
    return c < CHARACTERS ? c : -1;
  }

  // The row whose voice counts as heard (0x29300 leaves the speaker 23 group out): -1 for none.
  characterOf(name) {
    return this.speakerOf(name) === 23 ? -1 : this.rowOf(name);
  }

  // The volume a voice of this row plays at (0x6e0d0: row volume x the voice switch, nothing if the row is off). The
  // voice switch itself is the VM's voiceOn.
  characterGain(c) {
    if (c < 0 || c >= CHARACTERS) return 1;
    return this.vol.charOn[c] ? this.vol.chars[c] / 100 : 0;
  }

  // What decodes a sound: the context, or before the first click or key has made it (start) one that plays nothing, at the same rate, so that sounds
  // read ahead (preload.js) are ready when it is.
  decoder() {
    return this.ctx || (this.spare ||= new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, 1, 48000));
  }

  async buffer(url) {
    let p = this.buffers.get(url);
    if (!p) {
      p = (async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`no audio ${url}`);
        const data = await res.arrayBuffer();
        return this.decoder().decodeAudioData(data);
      })();
      this.buffers.set(url, p);
      p.catch(() => this.buffers.delete(url));
      if (this.buffers.size > 80) this.buffers.delete(this.buffers.keys().next().value);
    }
    return p;
  }

  // A buffer source through its own gain, then placed left / right as nn::atk places it (panMatrix: a stream or a
  // wave, nn::atk pan q), into a group. loop: true, or {start, end} in seconds for a wave with its own loop points.
  node(buf, group, { gain = 1, loop = false, offset = 0, stream = false, pan = 0 } = {}) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = !!loop;
    if (loop && typeof loop === "object") {
      if (loop.start > 0 && loop.start < buf.duration) s.loopStart = loop.start;
      if (loop.end > loop.start && loop.end < buf.duration) s.loopEnd = loop.end;
    }
    const g = ctx.createGain();
    g.gain.value = gain;
    s.connect(g);
    const channels = buf.numberOfChannels || 2;
    const matrix = panMatrix(stream, channels, pan);
    const [[a, b], [c, d] = [0, 0]] = matrix;
    if (channels >= 2 ? a === 1 && d === 1 && b === 0 && c === 0 : false) {
      g.connect(this.groups[group]);   // a centred stereo wave: as it is
    } else if (channels >= 2 ? b === 0 && c === 0 && a === d : a === b) {
      const k = ctx.createGain();      // the same share on both sides: one gain
      k.gain.value = a;
      g.connect(k);
      k.connect(this.groups[group]);
    } else {
      // each channel's share of each side: a splitter, a gain per channel and side, a two-channel merger
      const split = channels >= 2 ? ctx.createChannelSplitter(channels) : null;
      const merge = ctx.createChannelMerger(2);
      if (split) g.connect(split);
      matrix.forEach((sides, ch) => sides.forEach((v, side) => {
        if (!v) return;
        const k = ctx.createGain();
        k.gain.value = v;
        if (split) split.connect(k, ch); else g.connect(k);
        k.connect(merge, 0, side);
      }));
      merge.connect(this.groups[group]);
    }
    s.start(0, offset > 0 && offset < buf.duration ? offset : 0);
    return { s, g, matrix };
  }

  stopNode(n) {
    if (!n || !n.s) return;
    try { n.s.stop(); } catch { /* already stopped */ }
  }

  // ---- channel records ------------------------------------------------------------------------------------
  // Puts a record's amplitude on its gain from now on: the level's path, sampled once a frame, through the law. A
  // record fading out (state 2) is stopped once its level is 0 (0x9b7f0 -> 0xee4e0 / 0xee028). A record whose sound is
  // still being decoded has no node yet (rec.n): its level moves all the same, and begin() puts it on when it starts.
  schedule(rec) {
    if (!rec || !rec.n?.g || !this.ctx) return;
    const t = this.ctx.currentTime, p = rec.n.g.gain, lv = rec.lv;
    p.cancelScheduledValues(t);
    p.setValueAtTime(this.gainOf(rec, lv.at(t)), t);
    const end = lv.end();
    if (end > t) {
      const steps = Math.max(1, Math.min(MAX_STEPS, Math.ceil((end - t) * FPS)));
      for (let i = 1; i <= steps; i++) {
        const ti = t + ((end - t) * i) / steps;
        p.linearRampToValueAtTime(this.gainOf(rec, lv.at(ti)), ti);
      }
    }
    clearTimeout(rec.stopTimer);
    if (rec.state === 2 && lv.target <= 0) {
      const check = () => {
        if (!this.ctx || rec.state !== 2) return;
        const left = rec.lv.end() - this.ctx.currentTime;
        if (rec.lv.target > 0) return;
        if (left <= 0) this.kill(rec);
        else { rec.stopTimer = setTimeout(check, left * 1000 + 20); rec.stopTimer?.unref?.(); }
      };
      rec.stopTimer = setTimeout(check, Math.max(0, end - t) * 1000 + 20);
      rec.stopTimer?.unref?.();   // (node tests: a pending stop does not keep the process up)
    }
  }

  // Fast forward on or off: every level goes on from where it is at the new speed.
  setSpeed(k) {
    if (k === mixSpeed) return;
    const t = this.ctx ? this.ctx.currentTime : 0, recs = this.records();
    for (const rec of recs) rec.lv.to(t, rec.lv.target, rec.lv.rate);
    mixSpeed = k;
    for (const rec of recs) this.schedule(rec);
  }

  // A record's level heads for target at rate (state unchanged); 0x9d0b0's large rates jump.
  retarget(rec, target, rate, { jumps = false } = {}) {
    const t = this.ctx ? this.ctx.currentTime : 0;
    if (jumps && rate >= JUMP) rec.lv.jump(t, target);
    else rec.lv.to(t, target, rate);
    rec.fresh = false;
    this.schedule(rec);
  }

  // State 2: the level falls to 0 at rate, then the sound stops.
  fadeOut(rec, rate) {
    rec.state = 2;
    this.retarget(rec, 0, rate);
  }

  // Stops a record's sound at once (state 0).
  kill(rec) {
    if (!rec) return;
    rec.state = 0;
    clearTimeout(rec.stopTimer);
    this.stopNode(rec.n);
    if (this.bgm === rec) this.bgm = null;
    if (this.bgmOld === rec) this.bgmOld = null;
    for (const [ch, r] of this.se) if (r === rec) this.se.delete(ch);
  }

  // A record's sound starts once its buffer is decoded; a level nothing has changed since the command starts from there.
  begin(rec, buf, group, opts) {
    if (rec.fresh && this.ctx) rec.lv.t0 = this.ctx.currentTime;
    rec.n = this.node(buf, group, { ...opts, gain: 0 });
    this.schedule(rec);
    rec.n.s.onended = () => {
      if (rec.state === 0) return;
      rec.state = 0;
      clearTimeout(rec.stopTimer);
      rec.ended?.();
    };
  }

  // ---- sound effects ----------------------------------------------------------------------------------------
  // A looped wave keeps its own loop region: knife1.bfsar's FWAV loop start and end (system.json seLoops).
  loopOf(name) {
    const l = this.seLoops[String(name).toUpperCase()];
    return l ? { start: l[0] / l[2], end: l[1] / l[2] } : true;
  }

  // SEPL: the immediate path (0x6a340) or a delayed one run from its slot (0x65780).
  async playSE(ch, loop, name, opts, { delayed = false, restart = false } = {}) {
    if (!this.ctx) return;
    const cur = this.se.get(ch);
    const raw = opts["017"];
    // A loop asked for again while it loops on the channel with a last volume above 0 goes on as it is (0x6a340: the
    // same sound, the loop flag 0x146e6f4, 0x146e6cc > 0). The delayed path has no such check: it starts it again, and
    // so does a restore (restart, 0x5d7e0 -> 0x9caa0).
    if (!delayed && !restart && loop && cur && cur.state === 1 && cur.loop && this.seLast[ch] > 0
      && String(cur.name).toUpperCase() === String(name).toUpperCase()) return;
    let vol = Math.min(100, Math.max(0, raw ?? 100));
    let last = raw ?? 100;
    // 070: a voiced effect is silent while the voice switch or its row is off (0x6a340 / 0x65780 zero its volume).
    const c = opts["070"] > 0 ? opts["070"] - 1 : -1;
    this.seChar[ch] = opts["070"] > 0 ? opts["070"] : 0;
    if (c >= 0 && (this.voiceOn === false || !(c < CHARACTERS && this.vol.charOn[c]))) { vol = 0; last = 0; }
    // 001 is a fade-in, 1000 ms longer on a channel still fading out (0x9cfc0 == 2); under 2 ms there is none. The
    // delayed path counts 001 only from 1 (0x65780).
    let fade = 0;
    const f = opts["001"];
    if (f !== undefined && (!delayed || f >= 1)) fade = f + (cur && cur.state === 2 ? 1000 : 0);
    // With no fade-in a voiced effect is a type-2 channel (0x9caa0): row x switch, linear. With one it stays type 1
    // (0x9cbf0): the SE volume and the curve, the row only deciding whether it sounds.
    const voiced = c >= 0 && fade < 2;
    // Pan: p = ((018 x 1000 - 64000) >> 6, toward 0) / 1000, given to nn::atk at the start (0xedd28); only the
    // immediate path's type-1 channels then get 0x9ce60, which sets it to 2p (clamped to +-2). The delayed path and
    // voiced effects keep p. panMatrix places the wave's channels from it.
    let pan = 0;
    if (opts["018"] !== undefined) {
      const p = Math.trunc((opts["018"] * 1000 - 64000) / 64) / 1000;
      pan = !delayed && !voiced ? Math.max(-2, Math.min(2, 2 * p)) : p;
    }
    const t = this.ctx.currentTime;
    const lv = fade < 2 ? new Level(t, vol) : new Level(t, 0, vol, (vol * 1000) / 60 / fade);
    // The delayed path then retunes the fade from the channel's last volume (0x65780 -> 0x9d0b0): |017 - last| x 1000/60
    // / 001, so a repeat of the last volume crawls at 0.2 a frame.
    if (delayed && raw !== undefined) {
      const rate = Math.abs(((vol - this.seLast[ch]) * 1000) / 60 / Math.max(1, fade));
      if (rate >= JUMP) lv.jump(t, vol); else lv.to(t, vol, rate);
    }
    this.seLast[ch] = delayed && raw === undefined ? 100 : last;
    // Starting on the channel's handle stops what it played (0xedd28).
    if (cur) this.kill(cur);
    const keep = {};
    for (const k of ["018", "070"]) if (opts[k] !== undefined) keep[k] = opts[k];
    const rec = { kind: voiced ? "voiced" : "se", c, ch, name, loop, state: 1, lv, fresh: true, opts: keep };
    rec.ended = () => { if (this.se.get(ch) === rec) this.se.delete(ch); };
    this.se.set(ch, rec);
    try {
      const buf = await this.buffer(`/assets/se/${encodeURIComponent(name.toUpperCase())}.ogg`);
      if (this.se.get(ch) !== rec) return;
      this.begin(rec, buf, "se", { loop: loop ? this.loopOf(name) : false, pan });
    } catch (e) { console.warn(e.message); }
  }

  // A sound played once, passed while fast-forwarding (0x6a340 at 0x6ac14-0x6ac38, 0x65780 for a delayed one, both testing 0xae0670):
  // nothing starts, a loop the channel has on record stops, and the channel's last volume and character stay as they were (N2-24).
  dropOneShot(ch) {
    const cur = this.se.get(ch);
    if (cur && cur.loop && cur.state === 1) this.kill(cur);
  }

  // SEVL: the level moves to 017 at |017 - last| x 1000/60/001 a frame (no 001: at once). Immediately (0x6ae10) a
  // voiced channel goes to 0 while its voices are off; from a slot (0x65a60) 001 under 2 counts as 1 and a missing 017
  // does nothing.
  volSE(ch, opts, { delayed = false } = {}) {
    const raw = opts["017"];
    if (delayed && raw === undefined) return;
    let vol = Math.min(100, Math.max(0, raw ?? 0));
    const ms = opts["001"] ?? 0;
    let rate;
    if (delayed) rate = ((vol - this.seLast[ch]) * 1000) / 60 / (ms < 2 ? 1 : ms);
    else {
      const c = this.seChar[ch] - 1;
      if (c >= 0 && (this.voiceOn === false || !(c < CHARACTERS && this.vol.charOn[c]))) vol = 0;
      rate = ms < 1 ? 2000 : ((vol - this.seLast[ch]) * 1000) / 60 / ms;
    }
    this.seLast[ch] = vol;
    const rec = this.se.get(ch);
    if (rec && rec.state !== 0) this.retarget(rec, vol, Math.abs(rate), { jumps: true });
  }

  // SEFD on one channel: under 1 ms it stops at once; else the level falls to 0 over ms from where it is (0x9d020), or,
  // from a slot, at the last volume's rate (0x65a60: also at once when that volume is under 1).
  fadeSE(ch, ms, { delayed = false } = {}) {
    const rec = this.se.get(ch);
    const last = this.seLast[ch];
    this.seLast[ch] = 0;
    if (!rec) return;
    if (!(ms >= 1) || (delayed && last < 1)) { this.kill(rec); return; }
    const from = delayed ? last : rec.lv.at(this.ctx ? this.ctx.currentTime : 0);
    this.fadeOut(rec, (from * 1000) / 60 / ms);
  }

  // SESP, and what stops a channel at once: the sound only (its last volume stays).
  stopSE(ch) {
    if (ch < 0) {
      for (const k of [...this.se.keys()]) this.stopSE(k);
      return;
    }
    this.kill(this.se.get(ch));
  }

  // ---- music ------------------------------------------------------------------------------------------------
  // 069 starts the stream that many samples in; 049 = 0 plays it once.
  async playBGM(n, opts) {
    if (!this.ctx) return;
    // A negative number stops the music at once (0x649e0 -> 0x9c610).
    if (n < 0) { this.stopBGM(0); return; }
    // The music already playing goes on unchanged, its volume too (0x649e0 compares 0x9c460 first). A track played
    // once that has ended keeps its number, so asking for it again does nothing either.
    if (this.bgmState && this.bgmState.n === n) return;
    const name = streamOf(this.table, n);
    if (!name) { console.warn("no music", n); return; }
    const vol = opts["017"] ?? 100;
    const fadeIn = opts["001"] || 0;
    const t = this.ctx.currentTime;
    // The track playing moves to the other handle and fades out there: with a fade-in at 1666.67 / (011 or 001) a
    // frame from its level (0x9c9b0), so it ends after level/100 x that time; without one at 416.67 a frame, within a
    // frame (0x9c470, only from state 1). Whatever was still fading on that handle is cut (0x9c6d0 / 0x9c470).
    const old = this.bgm;
    if (this.bgmOld) this.kill(this.bgmOld);
    this.bgm = null;
    if (old && old.state !== 0) {
      if (fadeIn > 0) this.fadeOut(old, MUSIC_FADE / (opts["011"] || fadeIn));
      else if (old.state === 1) this.fadeOut(old, MUSIC_CUT);
      this.bgmOld = old;
    }
    // The new track starts at 0 and rises at 1666.67 / 001 a frame, so it reaches 017 after 017/100 x 001 (0x9c6d0).
    const lv = fadeIn > 0 ? new Level(t, 0, vol, MUSIC_FADE / fadeIn) : new Level(t, vol);
    const loop = opts["049"] !== 0;
    // (the number is kept as `music`: rec.n is the record's node, set once the stream is decoded)
    const rec = { kind: "music", music: n, loop, state: 1, lv, fresh: true };
    rec.ended = () => { if (this.bgm === rec) this.bgm = null; };   // the number stays in bgmState (0xac0688)
    this.bgm = rec;
    this.bgmState = { n, vol: vol / 100, loop };
    this.lastMusic = vol;
    try {
      const buf = await this.buffer(`/assets/bgm/${name}.ogg`);
      if (this.bgm !== rec) return;
      const offset = opts["069"] > 0 ? (opts["069"] / STREAM_RATE) % buf.duration : 0;
      // A stream loops from its own loop start to its loop end (knife1.bfsar's stream sound info), not from the top.
      const points = this.musicLoops?.[name];
      const region = loop && points ? { start: points[0] / STREAM_RATE, end: points[1] / STREAM_RATE } : loop;
      this.begin(rec, buf, "bgm", { loop: region, offset, stream: true });
    } catch (e) { console.warn(e.message); }
  }

  // MVOL (0x653b0 -> 0x9ca00): toward 017 at |017 - last| x 1000/60/001 a frame (001 under 2 counts as 1); the same
  // volume as the last gives rate 0, which the mixer moves at 0.2 a frame (only felt during a fade-in).
  volBGM(opts) {
    const vol = opts["017"] ?? 0;
    const ms = Math.max(1, opts["001"] || 0);
    const rate = (Math.abs(vol - this.lastMusic) * 1000) / 60 / ms;
    this.lastMusic = vol;
    if (this.bgmState) this.bgmState.vol = vol / 100;
    if (this.bgm && this.bgm.state !== 0) this.retarget(this.bgm, vol, rate);
  }

  // MFAD (0x64fa0): under 1 ms the music stops at once (0x9c610); else it falls at the last MPLY / MVOL volume x
  // 1000/60/001 a frame from where it is (0x9c9b0), exactly 001 when nothing moved it since.
  fadeBGM(ms) {
    this.bgmState = null;
    if (!(ms >= 1)) { this.kill(this.bgm); return; }
    if (this.bgm && this.bgm.state !== 0) this.fadeOut(this.bgm, (this.lastMusic * 1000) / 60 / ms);
  }

  // The interface's own music stop: over ms from the level it is at (0 = at once).
  stopBGM(ms) {
    this.bgmState = null;
    const rec = this.bgm;
    if (!rec) return;
    if (!(ms >= 1)) { this.kill(rec); return; }
    this.fadeOut(rec, (rec.lv.at(this.ctx ? this.ctx.currentTime : 0) * 1000) / 60 / ms);
  }

  // The title's music fade (0x9c9b0): the rate is level units a frame on 0-100, not a time (TITLE_MUSIC in uifx.js).
  fadeBGMRate(rate) {
    this.bgmState = null;
    if (this.bgm) this.fadeOut(this.bgm, rate);
  }

  // ---- interface sounds -------------------------------------------------------------------------------------
  // The interface's own sound n (0 cursor, 1 decide, 2 cancel, 3 a window opening, 4 a choice taken, 6 start; see
  // ANIMATIONS.md). Native 0xacef0 uses four handles in turn, stopping what the next one still plays, at the menu
  // volume (config +10, its own group).
  // group "se": the second player 0xacfa0, the same sounds at ca0(SE / 100) (sound 7 of the chapter-title movies).
  async playSys(n, group = "sys") {
    if (!this.ctx || this.muted) return;
    this.sys ||= [null, null, null, null];
    this.sysNext = ((this.sysNext ?? -1) + 1) & 3;
    const k = this.sysNext;
    this.stopNode(this.sys[k]);
    const token = (this.sys[k] = { pending: true });
    try {
      const buf = await this.buffer(`/assets/sys/${n}.ogg`);
      if (this.sys[k] !== token) return;
      const gain = group === "se" ? curveOf(this.curve, this.seByte() / 100) : 1;
      this.sys[k] = this.node(buf, group, { gain });
    } catch (e) { console.warn(e.message); }
  }

  // Leaving the config (0x2b5c0) stops the SE Test (0x9cf90 on its channel) and what interface handle 4 plays, the
  // voice Test (0x9b740(4)).
  stopTests() {
    this.stopNode(this.test);
    this.test = null;
    if (this.sys?.[0]) { this.stopNode(this.sys[0]); this.sys[0] = null; }
  }

  // The sound page's SE Test (0x29140): one of SE_TEST at random (0xa8f90(0, 13), both ends in), stopping the Test
  // before it. random: a stand-in for Math.random.
  playSeTest(random = Math.random) {
    return this.playTest("se", SE_TEST[Math.min(SE_TEST.length - 1, Math.floor(random() * SE_TEST.length))]);
  }

  // A sample for the sound page's Test buttons: an effect at SE / 100 (0x29140, linear), or a character's voice at its
  // row volume.
  async playTest(kind, name, character = -1) {
    if (!this.ctx) return;
    if (kind === "voice") return this.testVoice(name, character);
    if (!name) return;
    this.stopNode(this.test);
    try {
      const buf = await this.buffer(`/assets/se/${encodeURIComponent(name.toUpperCase())}.ogg`);
      this.test = this.node(buf, "se", { gain: this.seByte() / 100 });
    } catch (e) { console.warn(e.message); }
  }

  // A row's voice Test (0x2b930): with a sample heard, the row becomes the config's test row; if the row is on, what
  // interface handle 4 plays stops and the sample plays there at the row's volume x the voice switch (silent with
  // "Play all voices" off), so the next interface sound landing on handle 4 cuts it (0xacef0); then the config applies
  // (0x2a9b0, see applyVolumes).
  async testVoice(name, row) {
    this.testRow = -1;
    if (!name || !(row >= 0 && row < CHARACTERS)) return;
    this.testRow = row;
    const play = this.vol.charOn[row];
    let token = null;
    if (play) {
      this.sys ||= [null, null, null, null];
      this.stopNode(this.sys[0]);
      token = this.sys[0] = { pending: true };
    }
    this.applyVolumes();
    if (!play) return;
    try {
      const buf = await this.buffer(`/assets/voice/${encodeURIComponent(name)}.ogg`);
      if (this.sys[0] !== token) return;
      this.sys[0] = this.node(buf, "voice", { gain: this.rowLevel(row), stream: true });
    } catch (e) { console.warn(e.message); }
  }

  // ---- voices -----------------------------------------------------------------------------------------------
  // A voice is waited for from the moment it is asked for, not only once it is decoded: a VCWT right after the
  // voice starts must not pass while the file is still loading (native 0x9c400 reports the channel busy from the
  // start). WTSV, which this comment once named too, is no command (vm.js op_WTSV).
  // Voices take handles 2 and 3 in turn (0x9b570): a message's voice stops both first, VPL2 (keep) does not, so a
  // third voice over two still playing cuts the older one.
  playVoice(name, keep) {
    if (!this.ctx) return Promise.resolve();
    // A row switched off plays nothing and stops nothing: every caller tests the speaker's bit before its stop and its play (MSG 0x6e6dc,
    // MSAD, VPL2 0x7a49c, Replay Voice 0x4e7c0), so the voice of the line before plays on to its end (N2-125; native run).
    if (this.voiceOff(name)) return Promise.resolve();
    if (!keep) this.stopVoice();
    this.voiceHandle ^= 1;
    const slot = this.voiceSlots[this.voiceHandle];
    if (slot.node) { this.stopNode(slot.node); this.voice = this.voice.filter((v) => v !== slot.node); slot.node = null; }
    for (const p of this.voicePending) if (p.slot === slot) this.voicePending.delete(p);
    const token = {};
    slot.token = token;
    const row = this.rowOf(name), gain = this.characterGain(row);
    const job = (async () => {
      try {
        const buf = await this.buffer(`/assets/voice/${encodeURIComponent(name)}.ogg`);
        if (slot.token !== token) return;
        const n = this.node(buf, "voice", { gain, stream: true });
        slot.node = n;
        this.voice.push(n);
        n.ended = new Promise((r) => { n.s.onended = r; });
        n.s.addEventListener("ended", () => {
          this.voice = this.voice.filter((v) => v !== n);
          if (slot.node === n) slot.node = null;
        });
      } catch (e) { console.warn(e.message); }
    })();
    const pending = { token, job, slot };
    this.voicePending.add(pending);
    job.finally(() => this.voicePending.delete(pending));
    return job;
  }

  stopVoice() {
    for (const v of this.voice) this.stopNode(v);
    for (const slot of this.voiceSlots) { slot.token = null; slot.node = null; }
    this.voice = [];
    this.voicePending.clear();
  }

  // Only a row switched off plays nothing (0x6e0d0 tests the speaker's bit at 0x6e6c8). A slider at 0 runs the stream at volume 0
  // (0xaa970 -> 0xee6b4 has no volume test), so voice waits and auto mode last its length (N2-116).
  voiceOff(name) {
    const row = this.rowOf(name);
    return this.characterGain(row) <= 0 && !(row >= 0 && row < CHARACTERS && this.vol.charOn[row]);
  }

  // Whether a voice is busy, as the game asks it (0x9c400 -> 0x9b520(-1)): the state of the handle in use, so of the newest voice alone.
  // An older VPL2 voice still playing on the other handle does not count: a VCWT, a line's voice wait and auto mode end with the newest
  // (N2-126; native run: a 0.8 s voice over an 8.6 s one, the wait ends after 0.8 s).
  get voicePlaying() {
    const slot = this.voiceSlots[this.voiceHandle];
    if (slot.node) return true;
    for (const p of this.voicePending) if (p.slot === slot) return true;
    return false;
  }

  // Resolves when the newest voice has started and finished (or was stopped); a voice started meanwhile becomes the one waited for.
  async voiceDone() {
    const over = new Set();   // what was waited for already: its end reaches here before its slot is cleared
    for (;;) {
      const slot = this.voiceSlots[this.voiceHandle];
      const jobs = [...this.voicePending].filter((p) => p.slot === slot && !over.has(p));
      if (jobs.length) { await Promise.all(jobs.map((p) => p.job)); for (const p of jobs) over.add(p); continue; }
      const n = slot.node;
      if (!n || over.has(n)) return;
      await n.ended;
      over.add(n);
    }
  }

  // The end of a script (0x5f200) and the game's stop-all (0x5ef10): every channel stops, the channels' last volumes
  // go back to -1, the music too unless it is kept (RTMN / RTM2).
  // The music stop is of the handle in use only (0x9c650; 0x9c610 in the stop-all): a track still fading out on the other handle after a
  // crossfade goes on falling until the mixer ends it at 0, or until the next track takes that handle (N2-127).
  stopAll({ keepMusic = false } = {}) {
    if (!keepMusic) this.stopBGM(0);
    this.stopSE(-1);
    this.seLast.fill(-1);
    this.seChar.fill(0);
    this.stopVoice();
  }

  // As an instant run starts (0x802c0 at 0x8086c: 0x5ef10(0)): the music at once (0x9c610, its number -1), the voices and all twenty
  // channels stop; what the records hold (last volumes, the music's number for the run's end) is left, so stopAll is not this (N2-74).
  stopPlaying() {
    this.kill(this.bgm);
    this.bgmState = null;
    this.stopSE(-1);
    this.stopVoice();
  }

  snapshot() {
    const se = [];
    for (const [ch, c] of this.se) if (c.loop && c.state === 1) se.push({ ch, name: c.name, vol: c.lv.target / 100, opts: c.opts });
    return { bgm: this.bgmState ? { ...this.bgmState } : null, se, last: this.seLast.slice(), lastMusic: this.lastMusic };
  }

  // The recorded sound back, as 0x5d7e0 puts it (a load, a rewind, the backlog's Quick Jump, Return to Previous Scene,
  // the end of a read scene's instant run): the music with its loop flag on (0x9c960(1)) at the recorded volume, the
  // number playing already (0xac0688, 0x9c470) going on as it is; every recorded loop started again from its top on its
  // channel (0x9caa0 -> 0xedd28 stops what the handle played), every other channel stopped. A load, Quick Jump and
  // Return to Previous Scene stop the music first (0x5ef10 / 0x9c610), so their track starts again from the top
  // (restartMusic); the instant run's end leaves the voice alone (stopVoice false).
  restore(s, { restartMusic = false, stopVoice = true } = {}) {
    if (!s) { this.stopAll(); return; }
    if (stopVoice) this.stopVoice();
    if (restartMusic) { this.kill(this.bgm); this.bgmState = null; }   // the handle in use only (0x9c610, N2-127)
    if (!s.bgm || !this.bgmState || this.bgmState.n !== s.bgm.n) this.stopBGM(0);
    if (s.bgm && this.bgmState?.n === s.bgm.n) {
      this.bgmState.vol = s.bgm.vol;
      if (this.bgm && this.bgm.state !== 0) this.retarget(this.bgm, s.bgm.vol * 100, 100);
    } else if (s.bgm) this.playBGM(s.bgm.n, { "017": s.bgm.vol * 100 });
    const loops = s.se || [];
    for (const [ch] of [...this.se]) if (!loops.some((w) => w.ch === ch)) this.stopSE(ch);
    for (const c of loops) this.playSE(c.ch, true, c.name, { ...(c.opts || {}), "017": c.vol * 100 }, { restart: true });
    if (Array.isArray(s.last) && s.last.length === 20) this.seLast = s.last.slice();
    if (typeof s.lastMusic === "number") this.lastMusic = s.lastMusic;
  }
}
