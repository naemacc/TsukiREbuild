// preload.js - what is read before it is asked for. A port addition: the game reads from its own archives, where a browser fetches each file and the
// first use of one would wait for it. Three parts: a queue that reads the most pressing first; the start-up list, begun while the first page (or the logo)
// is up; and the look-ahead, which reads what the script is coming to and gets its movies ready.
// The game waits for none of these: what has not arrived when it is wanted is read then, as before. The one thing it does wait for is the last part,
// a scene's pictures: every picture a script shows is read before the script starts, the story standing still under the game's "Loading" meanwhile.
import { streamOf } from "./audio.js";
import { grainSample } from "./screenfx.js";
import { titleMusic, titleVariant } from "./uifx.js";
import { JA, asset } from "./lang.js";

// What a job is for, most pressing first: the screen that comes next; the story's own screen; the menus over it; the gallery.
export const RANK = { next: 0, story: 1, menus: 2, extras: 3 };
const LANES = 4;          // read at once, of the six connections a browser gives one host: the rest stay free for what the game asks for itself
const LANE_TIME = 30000;  // a read that has not ended by then gives its lane up (it goes on by itself)
const MOVIES = 2;         // movies kept ready at once
// How far ahead of the script the look-ahead reads, in commands (a message is about every 25): pictures and sounds, and movies and the scripts jumped to.
const NEAR = 300, FAR = 2500;
const STRIDE = 24;        // commands the script has to move on before it is read ahead again
const AHEAD = { pictures: 8, voices: 6, sounds: 6, music: 1, movies: MOVIES, jumps: 6 };   // new reads one pass may start
// A scene's pictures (scene): how many files are read at once, the scripts after this one whose pictures are read once this one's are, and the
// waits before a file that did not come is asked for again (one that is not there at all is not asked for twice).
const SCENE = { lanes: 8, next: 3, again: [1000, 2000, 4000] };

const pack = (name, list) => list.split(" ").map((n) => `${name}/${n}`);
// The interface's pictures (assets/ui), in the order a player can come to them. The CG grid's sheet is gallery.js's own (preloadGallery).
export const ART = {
  // the title (ui.js titleMenu, with its stage's own still, title_bg1-4) and the notice a later boot shows before it (ui.js notice); not extra_menu_ja,
  // whose GALLERY submenu never shows in this build (uifx.js)
  title: [
    ...pack("TITLE_PARTS_JA", "title_titlelog titlemenu titlemenu_lumi titlemenu__c_type-moon logoparticle_all"),
    "PARTS/caution2_1920x1080",
  ],
  // the first launch's own title (ui.js title: title_bg0 and its prompt) and the two cautions after it (ui.js cautions), which no later boot shows: not
  // read once the prologue has started (a returning player, or a loaded save such as the 100% one)
  firstTitle: pack("TITLE_PARTS_JA", "title_bg0 press_start caution_UpRGB__scale__x1_500000_ caution1_1920x1080"),
  // the text window and its marks, the notices, the choices and the questions
  story: [
    ...pack("DISP_PARTS_JA", "txtwindow01-1920 bf_with_edge68x68_2 lineBreak_a pageBreak_a pageBreak_ciel_a-1920x1080 popup_ja mode_disp mode_ring_1 mode_help tw___________ dialog_win dialog_btn_ja"),
    ...pack("MODEPNL_PARTS_JA", "modepanel_window mode_panel_btn_ja"),
    ...pack("SELECT_PARTS_JA", "altermenu__I____bg altermenu___ altermenu______O altermenu_flash altermenu_lensflare altermenu_underline"),
    ...pack("DIALOG_PARTS_JA", "dialog_BG dialog_win dialog_btn_ja"),
  ],
  // the system menu, the log, Save and Load, Config
  menus: [
    ...pack("DISP_PARTS_JA", "menuBG01_upscale menuBG04_0_upscale menuBG04_1_upscale menuBG04_2_upscale menuBG04_3_upscale menuBG05_0_upscale menuBG05_1_upscale menuBG05_2_upscale menuBG05_3_upscale kirakira bg_backlog scroll_bar scroll_slider help_key help_txt_ja conf_BG"),
    ...pack("MENU_PARTS_JA", "menu_window menu_btn_ja system_titlebg system_scenebg system_phasetitle_ja systemcursor_light systemcursor_line underline"),
    ...pack("SAVE_PARTS_JA", "config_innerbg save_win savetitle saveauto savedate_number savetime_number saveinfobg_arc saveinfobg_ciel saveinfobg_unknown"),
    ...pack("CONF_PARTS_JA", "config_innerbg tab_bg system_bg sound_bg voice_bg conf_name conf_faceicon config_number_ja conf_manual0_ja"),
  ],
  gallery: [
    ...pack("GALLERY_PARTS_JA", "gallerymenu_window gallerymenu_btn gallerycursor_line systemcursor_light underline config_innerbg cg_title cg_cursor music_title music_bgline music_btnbg music_controlbtn music_slider music_soundbg music_soundbtn movie_title movie_cur ending_title ending_btn ending_badend ending_badendbtn ending_icon_Arcueid ending_icon_Ciel_1 ending_icon_Ciel_2 ending_icon_non"),
    ...pack("MENU_PARTS_JA", "flow_bg flow_cur flow_info flow_infobase flow_line_merge flow_phasetitle flow_sam_bg_upper_fullhd flow_sam_bg_middle_fullhd flow_sam_bg_under_fullhd flow_sam_non flow_thumb_all_nx"),
  ],
};
// The pictures the renderer draws itself, read as textures (renderer.js uiTexture): the text window, the feathered panel edges, the speed lines.
const SIZES = ["020", "064", "080", "128", "256", "512"];
export const GL_ART = {
  story: ["DISP_PARTS_JA/txtwindow01-1920"],
  menus: [...SIZES.flatMap((n) => pack("BORDER_PARTS", `alphagradation${n} alphagradation${n}_2 alphagradation_inv${n}`)), "EFFECT_PARTS/FocusLine"],
};
// The faces the screens' words are set in, asked for with them. English: the balloons' SeuratPro (the story's own text is in a system face) and the
// gallery's Inter, with the story's screen. Japanese (style.css html.ja): the original's text face TsukuMin with the story's screen, for its first line;
// with the menus, its balloon face (SeuratProJa: only the Ciel-sensei corners have balloons) and TsukuGo, which sets the Japanese in the notes, the
// flowchart and the gallery. All three hide their words until they are in (font-display: block), and the translation's SeuratPro is not used there.
export const fontsFor = (ja) => (ja ? { story: ['45.6px "TsukuMin"', "16px Inter"], menus: ['45.6px "SeuratProJa"', '24px "TsukuGo"'] }
  : { story: ['40px "SeuratPro"', "16px Inter"], menus: [] });
const SYS_SOUNDS = 9;

export const movieUrl = (name) => asset(`/assets/movie/${name}.mp4`);   // (main.js reads the movies' addresses from here too)
const ruleName = (n) => `RULE_${String(n).padStart(2, "0")}`;
function unload(v) {
  try { v.removeAttribute("src"); v.load(); } catch { /* gone already */ }
}

export class Preloader {
  // page: the document (none outside a browser); Picture: its Image.
  constructor({ vm, gfx, audio, page = globalThis.document, Picture = globalThis.Image, lanes = LANES, fonts = fontsFor(JA) }) {
    Object.assign(this, { vm, gfx, audio, page, Picture, lanes, fonts });
    this.jobs = new Map();     // key -> { rank, n, start, running }: waiting or being read
    this.count = 0;
    this.active = 0;
    this.kept = new Map();     // interface pictures read, held so that the browser keeps them
    this.movies = new Map();   // name -> a <video> reading its file, oldest first
    this.last = null;          // where the look-ahead last read from
    this.asked = [0, 0, 0, 0]; // jobs taken on so far, by the rank they came with
    this.read = [0, 0, 0, 0];  // ... and of them, those that have ended
    this.scans = 0;            // scripts being fetched to be read ahead: their jobs are still to come
    this.sceneRun = 0;         // counts the scenes started: an earlier one's reads of what follows it stop
    this.sceneWait = null;     // the scene being waited for: { all, read } (sceneProgress)
  }

  // ---- the queue ----------------------------------------------------------------------------------------------
  // One job a key. Asked for again at a lower rank while it waits, it moves up. True if it is new.
  add(rank, key, start) {
    const hit = this.jobs.get(key);
    if (hit) { if (rank < hit.rank) hit.rank = rank; return false; }
    this.jobs.set(key, { rank, key, start, n: this.count++, running: false, as: rank });
    this.asked[rank]++;
    // started after the caller has listed all it wants, so that the order is by rank and not by who asked first
    if (!this.pumping) { this.pumping = true; queueMicrotask(() => { this.pumping = false; this.pump(); }); }
    return true;
  }

  pump() {
    while (this.active < this.lanes) {
      let next = null;
      for (const j of this.jobs.values()) if (!j.running && (!next || j.rank < next.rank || (j.rank === next.rank && j.n < next.n))) next = j;
      if (!next) return;
      next.running = true;
      this.active++;
      let read;
      try { read = Promise.resolve(next.start()); } catch (e) { read = Promise.reject(e); }
      let timer = null;
      const done = () => { clearTimeout(timer); if (!next.running) return; next.running = false; this.active--; this.jobs.delete(next.key); this.read[next.as]++; this.pump(); };
      timer = setTimeout(done, LANE_TIME);
      read.then(done, done);   // a file that is not there is not this module's to report: its user does
    }
  }

  // For the loading screen (main.js): whether everything of rank `upTo` or more pressing has been read, and how far along it is (0 - 1).
  settled(upTo) {
    if (this.pumping || this.scans > 0) return false;
    for (const j of this.jobs.values()) if (j.rank <= upTo) return false;
    return true;
  }
  progress(upTo) {
    let asked = 0, read = 0;
    for (let r = 0; r <= upTo; r++) { asked += this.asked[r]; read += this.read[r]; }
    return asked ? Math.min(1, read / asked) : 1;
  }
  // Whether the movies made ready have enough to start playing.
  moviesReady() {
    for (const v of this.movies.values()) if (!(v.readyState >= 3) && !v.error) return false;
    return true;
  }
  // A script fetched to be read ahead: counted until its commands have been gone through.
  later(script, then) {
    this.scans++;
    return script.then(then).catch(() => {}).finally(() => { this.scans--; });
  }

  // Everything queued has been read (for tests).
  idle() {
    return new Promise((res) => { const look = () => (this.jobs.size || this.pumping ? setTimeout(look, 0) : res()); look(); });
  }

  // ---- what can be read -----------------------------------------------------------------------------------------
  // An interface picture the page draws (sprites and CSS backgrounds): once an Image has read it, the browser uses that copy for every later one.
  art(rank, path) {
    if (!this.Picture || this.kept.has(path)) return false;
    return this.add(rank, `art ${path}`, () => {
      const img = new this.Picture();
      this.kept.set(path, img);
      img.src = asset(`/assets/ui/${path}.webp`);
      return img.decode ? img.decode() : null;
    });
  }

  // An interface picture the renderer draws.
  glArt(rank, path) {
    if (!this.gfx.uiTexture || this.gfx.ui?.has(path)) return false;
    return this.add(rank, `gl ${path}`, () => { this.gfx.uiTexture(path); return this.gfx.ui?.get(path)?.loaded; });
  }

  // One of the game's pictures, as the texture the story draws.
  picture(rank, name) {
    const key = String(name).toUpperCase();
    if (!this.gfx.images?.[key] || this.gfx.tex.has(key)) return false;
    return this.add(rank, `img ${key}`, () => this.gfx.load(key));
  }

  // A sound, decoded.
  sound(rank, url) {
    if (this.audio.muted || this.audio.buffers.has(url)) return false;
    return this.add(rank, `snd ${url}`, () => this.audio.buffer(url));
  }

  font(rank, spec) {
    if (!this.page?.fonts?.load) return false;
    return this.add(rank, `font ${spec}`, () => this.page.fonts.load(spec));
  }

  // ---- movies ---------------------------------------------------------------------------------------------------
  // A movie is made ready in an element of its own, which reads the file as a browser reads any movie: from its start, as far as it sees fit. main.js puts
  // that element on the page when the movie plays (takeMovie), so it starts from what has been read. The oldest goes when there are more than MOVIES.
  readyMovie(name) {
    const page = this.page;
    if (!page?.createElement || !name || this.movies.has(name)) return false;
    const src = movieUrl(name);
    if (page.getElementById("movie")?.getAttribute("src") === src) return false;   // on screen now
    const v = page.createElement("video");
    v.setAttribute("playsinline", "");
    v.preload = "auto";
    v.src = src;
    this.movies.set(name, v);
    for (const [old, el] of this.movies) {
      if (this.movies.size <= MOVIES) break;
      this.movies.delete(old);
      unload(el);
    }
    return true;
  }

  // The element made ready for a movie, which is the caller's from now on; null if there is none (or its file could not be read).
  takeMovie(name) {
    const v = this.movies.get(name);
    if (!v) return null;
    this.movies.delete(name);
    if (v.error) { unload(v); return null; }
    return v;
  }

  // ---- start-up -------------------------------------------------------------------------------------------------
  // Begun as the first page (or the logo) comes up. firstLaunch: the opening has not played yet, so it is next: its script, its pictures and its movie; else the
  // logo and the title are. stage: the one the title will be at. scene: the page was opened on a scene (?script), with no logo and no title.
  // Then, in order: the story's screen and the story's first commands; the menus; the gallery.
  startup({ firstLaunch = false, stage = 0, scene = false } = {}) {
    const { vm } = this, variant = titleVariant(stage);
    const title = (rank) => { for (const p of [...(firstLaunch ? ART.firstTitle : []), ...ART.title, `TITLE_PARTS_JA/title_bg${variant}`]) this.art(rank, p); };
    for (let n = 0; n < SYS_SOUNDS; n++) this.sound(RANK.next, `/assets/sys/${n}.ogg`);
    if (!scene) {
      // the opening (main.js newGame), whose title after it has no movie; else the logo, then the title with its own
      if (firstLaunch) this.from(vm.index.names.indexOf("00_01"), RANK.next, { movies: 1 });
      else { this.readyMovie("TM_CI"); this.readyMovie(`titlebg${variant}`); title(RANK.next); }
      const music = streamOf(this.audio.table, titleMusic(stage));   // the opening's end starts it too (main.js playMovie)
      if (music) this.sound(RANK.next, `/assets/bgm/${music}.ogg`);
    }
    for (const p of ART.story) this.art(RANK.story, p);
    for (const p of GL_ART.story) this.glArt(RANK.story, p);
    for (const f of this.fonts.story) this.font(RANK.story, f);
    if (!scene) {
      if (firstLaunch) title(RANK.story);
      this.from(vm.index.start, RANK.story, { movies: 0 });   // New Game; its movies wait until the story is there (the look-ahead)
    }
    for (const p of ART.menus) this.art(RANK.menus, p);
    for (const f of this.fonts.menus) this.font(RANK.menus, f);
    // the balloons and the other windows (system.json windows): the page's copy and the renderer's
    const windows = (vm.system?.windows?.styles || []).map((s) => `DISP_PARTS_JA/${s[0]}`);
    for (const p of windows) { this.art(RANK.menus, p); this.glArt(RANK.menus, p); }
    for (const p of GL_ART.menus) this.glArt(RANK.menus, p);
    for (const p of ART.gallery) this.art(RANK.extras, p);
  }

  // A script that may be started next, and what its first commands use.
  from(i, rank, limits = {}) {
    if (!(i >= 0)) return;
    this.later(this.vm.getScript(i), (s) => this.scan(s, 0, 0, { ...AHEAD, ...limits, rank, seen: new Set() }));
  }

  // ---- the look-ahead -------------------------------------------------------------------------------------------
  // Called as the script runs (vm.js preloadFrom: on entering a script and at each message). Not during a test jump or a read scene's instant run, which
  // pass their pictures and sounds by.
  ahead(script, pc) {
    const vm = this.vm;
    if (!script || vm.skipUntil || vm.instant) return;
    const last = this.last;
    if (last && last.script === script && pc >= last.pc && pc - last.pc < STRIDE) return;
    this.last = { script, pc };
    this.scan(script, pc, 0, { ...AHEAD, rank: RANK.story, seen: new Set() });
  }

  // The commands from `from` on, `gone` commands away from where the story is. left: what this pass may still start, its rank, and what it has seen.
  // The commands are read in their written order, branches and all; a JUMP's script is fetched and read on from its label, the distance carried over.
  scan(script, from, gone, left) {
    const ops = script.ops, vm = this.vm;
    for (let i = from; i < ops.length; i++) {
      const d = gone + i - from;
      if (d >= FAR) return;
      const o = ops[i];
      if (o[0] === "TOMP") {
        const name = vm.movies[o[1]] ? vm.movieFor(o[1], script.name) : null;
        if (name && left.movies > 0 && !left.seen.has(name)) { left.seen.add(name); left.movies--; this.readyMovie(name); }
      } else if (o[0] === "JUMP") {
        const t = vm.index.jump[o[1]], key = `${t} ${o[2] || ""}`;
        if (t !== undefined && left.jumps > 0 && !left.seen.has(key)) {
          left.seen.add(key);
          left.jumps--;
          this.later(vm.getScript(t), (s) => this.scan(s, (o[2] && s.labels[o[2]]) || 0, d, left));
        }
      } else if (d < NEAR) this.near(o, left);
    }
  }

  // What one command will ask for.
  near(o, left) {
    const { vm, audio } = this, rank = left.rank;
    switch (o[0]) {
      case "STCH": case "SCH2": case "SPFC": case "SPRD":
        if (o[2] && left.pictures > 0 && this.picture(rank, o[2])) left.pictures--;
        break;
      case "FADS":   // a transition through a rule picture (vm.js fade)
        if (o[1] === "2" && Number(o[3]) > 0) this.picture(rank, ruleName(Number(o[3])));
        break;
      case "STTR":
        if (Number(o[2]) >= 1 && Number(o[2]) <= 49) this.picture(rank, ruleName(Number(o[2])));
        break;
      case "STNS":   // film grain
        if (Number(o[2]) > 0) this.glArt(rank, `NOISE_PARTS/${grainSample(Number(o[2]), 0).texture}`);
        break;
      case "SEPL":
        if (o[3] && left.sounds > 0 && !vm.soundsSkipped && this.sound(rank, `/assets/se/${encodeURIComponent(o[3].toUpperCase())}.ogg`)) left.sounds--;
        break;
      case "MPLY": {
        const name = streamOf(audio.table, Number(o[1]));
        if (name && left.music > 0 && !vm.soundsSkipped && this.sound(rank, `/assets/bgm/${name}.ogg`)) left.music--;
        break;
      }
      case "VPLY": case "VPL2":   // no voice starts while skipping, with the voices off, or for a speaker switched off
        if (o[1] && left.voices > 0 && !vm.skip && vm.voiceOn !== false && !audio.voiceOff?.(o[1]) && this.sound(rank, `/assets/voice/${encodeURIComponent(o[1])}.ogg`)) left.voices--;
        break;
      default:
    }
  }

  // ---- a scene's pictures ---------------------------------------------------------------------------------------
  // The pictures a script's commands name from `pc` to its end, branches and all: the layers' pictures and the rule pictures of its
  // transitions and wipes. Only those the game has (a name with no picture is no picture: vm.js setPicture).
  scenePictures(script, pc = 0) {
    const out = new Set(), images = this.gfx.images || {}, ops = script.ops;
    const add = (name) => { const key = String(name).toUpperCase(); if (images[key]) out.add(key); };
    for (let i = pc; i < ops.length; i++) {
      const o = ops[i];
      if (o[0] === "STCH" || o[0] === "SCH2" || o[0] === "SPFC" || o[0] === "SPRD") { if (o[2]) add(o[2]); }
      else if (o[0] === "FADS") { if (o[1] === "2" && Number(o[3]) > 0) add(ruleName(Number(o[3]))); }
      else if (o[0] === "STTR") { if (Number(o[2]) >= 1 && Number(o[2]) <= 49) add(ruleName(Number(o[2]))); }
    }
    return out;
  }

  // A few files at a time, each tried again if it did not come. Resolves when every one has come or been given up; `each` is called as each ends.
  readFiles(keys, alive = () => true, each = () => {}) {
    const list = [...keys].filter((k) => !this.gfx.hasFile(k)), wait = this.wait || ((ms) => new Promise((res) => setTimeout(res, ms)));
    let at = 0;
    const lane = async () => {
      while (at < list.length && alive()) {
        const key = list[at++];
        for (let tries = 0; alive(); tries++) {
          try { await this.gfx.file(key, true); break; } catch (e) {
            if (e?.missing || tries >= SCENE.again.length) break;   // its user reports it (vm.js setImage)
            await wait(SCENE.again[tries]);
          }
        }
        each(key);
      }
    };
    return Promise.all(Array.from({ length: Math.min(SCENE.lanes, list.length) }, lane));
  }

  // Called before a script's first command runs (vm.js sceneReady), and where a run that draws nothing ends inside one. Returns null when
  // every picture from there on has been read, else a promise for that. The files are kept as they came (renderer.js file) until the next
  // scene's are asked for, so the story has them whatever becomes of the browser's own copy; its textures are still made as it comes to them
  // (the look-ahead, and vm.js commit), a scene's pictures being far more than a GPU holds at once.
  // Once they are in, the scripts this one jumps to are read the same way, so that the scene after it starts without a wait.
  scene(script, pc = 0) {
    const run = ++this.sceneRun, gfx = this.gfx;
    if (!gfx.file) return null;
    const names = this.scenePictures(script, pc), keep = new Set(names);
    gfx.keepFiles(keep);
    const alive = () => run === this.sceneRun;
    const state = { all: names.size, read: 0 };
    for (const k of names) if (gfx.hasFile(k)) state.read++;
    const after = () => { if (alive()) this.sceneNext(script, pc, keep, alive); };
    if (state.read === state.all) { after(); return null; }
    this.sceneWait = state;
    return this.readFiles(names, alive, () => { state.read++; }).then(() => { if (this.sceneWait === state) this.sceneWait = null; after(); });
  }
  // How far along the scene being waited for is (0 - 1), for the "Loading" window; null when none is.
  sceneProgress() {
    const s = this.sceneWait;
    return s ? (s.all ? Math.min(1, s.read / s.all) : 1) : null;
  }

  // The scripts the scene can go on to (its JUMPs from `pc` on, in their order, the first few), one after another.
  async sceneNext(script, pc, keep, alive) {
    const vm = this.vm, seen = new Set(), ops = script.ops;
    for (let i = pc; i < ops.length && seen.size < SCENE.next && alive(); i++) {
      const o = ops[i], t = o[0] === "JUMP" ? vm.index.jump[o[1]] : undefined, key = `${t} ${o[2] || ""}`;
      if (t === undefined || seen.has(key)) continue;
      seen.add(key);
      let next = null;
      try { next = await vm.getScript(t); } catch { continue; }
      if (!alive()) return;
      const names = this.scenePictures(next, (o[2] && next.labels?.[o[2]]) || 0);
      for (const k of names) keep.add(k);   // (the set keepFiles was given: only a later scene lets these go)
      await this.readFiles(names, alive);
    }
  }
}

