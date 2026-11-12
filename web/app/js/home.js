// home.js - the page the game opens on: five tabs on the game's own panel, ABOUT (what this project is and how it was made, welcome.js), GITHUB (the source),
// DOWNLOAD (the game as an app: Windows and Android to download, macOS and Linux to build), SAVE DATA (the browser's saves to and from the game's own save
// file, savefile.js) and PLAY ONLINE, whose PRESS ANY BUTTON starts the game; that press is also the click a browser wants before it plays sound.
// Built as the quick bar is (ui.js buildPanel), from the game's art: the mode panel's strip with five of its plates relettered, the title's picture under the
// system menu's sky, Config's inner panel, the game's scroll bar and help band, and the title's own prompt.
// It opens on every visit, for everyone, with no tab chosen and no plate lit: the column holds only the game's logo and a line naming the plates, so
// a stray tap starts nothing. Not inside the Android or desktop app (web-dev/android, web-dev/desktop), which is the game itself, nor where the address asks for a scene (?script,
// for tests and the scene links in ABOUT's Extras).
import { sprite, quickBarArt, panelBack } from "./ui.js";
import { TOUCH } from "./touch.js";
import { ButtonState, pressPulse } from "./uifx.js";
import { SECTIONS, TOUCH_INTRO, blockEl } from "./welcome.js";
import { FILE_NAME, NOTE, dropBase, exportSaves, hasProgress, importSaves, keepBase, loadBase, loadedData, readSaves, recordsLine, removeSaves } from "./savefile.js";
import { GAME } from "./gamesave.js";

export const GITHUB = "https://github.com/waifwu/TsukiREbuild";
// The downloads: the whole game as an app that needs no connection (web-dev/android, web-dev/desktop), with the size each system shows for its file.
export const APK = { href: "/android/tsukihime.apk", file: "Tsukihime.apk", size: "2.8 GB" };
export const DESKTOP = { href: "/desktop/Tsukihime-win-x64.zip", file: "Tsukihime-win-x64.zip", size: "2.9 GB" };   // Windows; macOS and Linux are built from the source
const download = (d) => ["link", `${d.file}  ·  ${d.size}`, d.href, d.file];
const PLATE = { w: 220, h: 62, pitch: 221, y: 29 };                       // the game's panel plates, at their size and pitch (ui.js QUICK_BAR)
const FADE = { in: 0.024, out: 0.02, to: 1.2 };                          // Config's fade in, and the title's black as it leaves
const PRESS = { w: 472, h: 88 };                                          // the title's prompt (TITLE_PARTS_JA/press_start), at its size
const ART = ["TITLE_PARTS_JA/title_bg1", "TITLE_PARTS_JA/title_titlelog", "TITLE_PARTS_JA/press_start", "DISP_PARTS_JA/menuBG01_upscale", "DIALOG_PARTS_JA/dialog_BG",
  "CONF_PARTS_JA/config_innerbg", "MODEPNL_PARTS_JA/modepanel_window", "MENU_PARTS_JA/underline"];
const APP_HOSTS = ["appassets.androidplatform.net", "tsukihime.desktop"];   // the apps' own addresses for the page (web-dev/android, web-dev/desktop)

export function homeDue(query, host = globalThis.location?.hostname || "") {
  if (query.has("script")) return false;
  return !APP_HOSTS.includes(host);
}

// The tabs: a plate, and the sections its page shows, each a heading and blocks as welcome.js draws them, plus ["link", text, address, file name if a
// download], ["data"], what the browser holds now, ["saves"], SAVE DATA's Export, Import and Remove plates, and ["press"], the prompt that starts the game.
export const TABS = [
  { plate: "ABOUT", sections: SECTIONS.map(({ head, blocks }) => ({ head, blocks })) },
  { plate: "GITHUB", sections: [{ head: "The source, on GitHub", blocks: [
    "Everything this was made with is in one repository: the engine rewritten in JavaScript and WebGL2, the tools that turned the game's files into what this page plays, the tests, and the notes on how each part was checked against the game itself.",
    ["rows", [
      ["web/app", "The game: its engine, its interface and its styles."],
      ["web/server.py", "Plays it on your own computer, with nothing to install: python3 web/server.py, then open localhost:8765."],
      ["web-dev/tools", "The conversions from a game dump, and the checks on what they made."],
      ["web-dev/tests", "The automated tests: node --test web-dev/tests/*.test.mjs"],
      ["web-dev/audit", "The map of all 5,984 functions in the game's executable, and what is left to do."],
      ["web-dev/android", "The Android app, and how it is built."],
      ["web-dev/desktop", "The Windows, macOS and Linux app, and how it is built."],
    ]],
    ["link", "github.com/waifwu/TsukiREbuild", GITHUB],
  ] }] },
  { plate: "DOWNLOAD", sections: [
    { head: "Download the game", blocks: [
      "The whole game as an app that needs no connection: every picture, voice, song and movie is inside it, and nothing is fetched while you play. Windows and Android have a download here; for macOS and Linux the same app is built from the source, below.",
      ["facts", [[DESKTOP.size, "Windows"], [APK.size, "Android"], ["0", "connections needed"]]],
      "It is this site's game in a window of its own, opening on the game itself. Saves are kept in the app, apart from this site's, and stay when a newer version replaces it. Leaving the app makes the automatic save, so you come back to where you were.",
    ] },
    { head: "Windows", blocks: [
      ["rows", [
        ["Needs", "Windows 10 or newer, 64-bit."],
        ["1. Download", `${DESKTOP.file}, below.`],
        ["2. Extract", "Right-click the file and choose Extract All, into a folder of its own. There is nothing to install."],
        ["3. Play", "Open Tsukihime.exe in that folder. Windows may say it does not know the publisher: choose More info, then Run anyway."],
      ]],
      download(DESKTOP),
    ] },
    { head: "Android", blocks: [
      ["rows", [
        ["Needs", "Android 8 or newer. It asks for no permissions at all, not even the internet."],
        ["1. Download", `${APK.file}, below, on the phone itself. It is large, so Wi-Fi is best.`],
        ["2. Open it", "From the browser's downloads. Android asks whether that browser may install apps: allow it."],
        ["3. Install", "As much space again must be free while it installs. Afterwards the download can be deleted."],
      ]],
      "It plays in landscape, by touch, as this site does on a phone. Android's Back gesture does what the game's own Back button does.",
      download(APK),
    ] },
    { head: "macOS and Linux", blocks: [
      "There is no download for these yet. The app is the same one, and one command builds it from the source, with the game's files already in the repository.",
      ["rows", [
        ["Needs", "Git, Node.js with npm, and about 20 GB free while it builds. A Mac with macOS 13 or newer for the Mac app; the Linux one is for 64-bit (x86) systems."],
        ["1. Get the source", "git clone --depth 1 https://github.com/waifwu/TsukiREbuild"],
        ["2. Build", "In that folder: web-dev/desktop/build.sh mac, or web-dev/desktop/build.sh linux. The first run fetches Electron."],
        ["3. Play", "The app is in web-dev/desktop/out: Tsukihime-mac-universal.dmg (open it, drag Tsukihime to Applications), or Tsukihime-linux-x86_64.AppImage (chmod +x, then open it)."],
      ]],
      ["link", "How the desktop app is built", `${GITHUB}/tree/main/web-dev/desktop`],
    ] },
  ] },
  { plate: "SAVE DATA", sections: [{ head: "Your save data", blocks: [
    "Saves, settings and progress are kept in this browser: clearing the site's data removes them, and another browser or device starts with none.",
    "Export and Import use the Nintendo Switch game's own save format, the file savedata000: the original game reads what Export writes, and a save from the Switch game can be loaded here.",
    ["data"],
    ["saves"],
    ["rows", [
      ["Export", "Saves this browser's settings and progress as savedata000: the flowchart, the gallery, what has been read."],
      ["Import", "Loads a savedata000 here, in place of what this browser has. It asks first if the game has been played here."],
      ["Remove", "Takes the saves and all progress out of this browser, and the imported file with them. It asks first, and cannot be undone: export first to keep a copy. Settings stay."],
      ["Save slots", "Not yet. The slots in an imported file are kept and go out again with the next Export, but cannot be loaded here, and saves made here are not written into the file."],
    ]],
  ] }] },
  { plate: "PLAY ONLINE", sections: [{ head: "Play here, in the browser", blocks: [
    ["gpu"],
    "Nothing to install. It runs in Chrome or Firefox, on a computer, a phone or a tablet. Not in Safari, which plays the AV1 movies only on Apple's newest hardware.",
    "The game's files arrive as you play: the first screens load while this page is open, and the rest follow. Saves, settings and progress are kept in this browser; clearing the site's data removes them. SAVE DATA saves them as a file.",
    ["press"],
  ] }] },
];
// PLAY ONLINE's notice, first on its page: with the browser drawing on the processor instead of the graphics card the game stutters and its frame rate falls.
// Shown only where hardware acceleration is off or can't be told to be on (glAccel); the line that it is off only where it is. (On a phone or tablet the
// browser has no such setting, so the touch layer leaves it out.)
export const GPU_NOTICE = {
  head: "Stutters or a low frame rate? Turn on hardware acceleration",
  off: "This browser is drawing without your graphics card right now.",
  rows: [
    ["Chrome", "Settings › System › Use graphics acceleration when available, then Relaunch"],
    ["Edge", "Settings › System and performance › Use graphics acceleration when available, then Restart"],
    ["Firefox", "Settings › General › Performance: untick Use recommended performance settings, tick Use hardware acceleration when available, then restart Firefox"],
  ],
};
// The software renderers (Chrome's SwiftShader, Mesa's llvmpipe and softpipe, Windows' Basic Render Driver), and the names a browser gives when it hides its
// renderer's (Safari's and Firefox's when they resist fingerprinting), which tell nothing.
export const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software|basic render/i, HIDDEN_GL = /^\s*(webkit webgl|mozilla|generic renderer)?\s*$/i;
// Whether this browser draws WebGL on the graphics card: "on", "off", or "unsure". Off: WebGL2 is refused when a context may not be slow
// (failIfMajorPerformanceCaveat, which the browsers refuse for software drawing) or there is none at all, or the renderer named is a software one. On: a
// renderer named that is none of those. Unsure: the renderer's name is hidden, or asking failed.
export function glAccel() {
  const lose = (gl) => gl?.getExtension("WEBGL_lose_context")?.loseContext();
  try {
    const gl = document.createElement("canvas").getContext("webgl2", { failIfMajorPerformanceCaveat: true });
    if (!gl) { const any = document.createElement("canvas").getContext("webgl2"); lose(any); return "off"; }
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
    lose(gl);
    return SOFTWARE_GL.test(name) ? "off" : HIDDEN_GL.test(name) ? "unsure" : "on";
  } catch { return "unsure"; }
}
export const ABOUT = 0, PLAY = TABS.length - 1, SAVE = PLAY - 1, NONE = -1;
// Export, Import and Remove, on SAVE DATA's page (savefile.js): three of the panel's plates under the list of what the browser holds now. The file is the
// Nintendo Switch game's own save, savedata000
// (gamesave.js), so a save goes between the game and this page both ways. Import takes such a file in place of what the browser has, asking first in the
// game's Yes / No window when the game has been played in this browser, and loads the page again, back on SAVE DATA. Remove takes the saves and progress
// out of the browser, and the kept file with them, after the same question.
export const SAVE_PLATES = [{ act: "export", plate: "EXPORT SAVES" }, { act: "import", plate: "IMPORT SAVES" }, { act: "remove", plate: "REMOVE DATA" }];
export const SAVE_TEXT = {
  keys: "Keys: E exports, I imports.",
  now: "In this browser now",
  empty: "No save data in this browser yet.",
  nothing: "Nothing to remove: there is no save data in this browser.",
  askRemove: "Remove the save data from this\nbrowser? It cannot be undone.",
  removed: "Removed the save data from this browser.",
  none: "Nothing to export yet: the game has not been played in this browser.",
  exported: (name) => `Saved as ${name}.`,
  ask: "Load this save file here?\nIt replaces what this browser has.",
  loaded: (name) => `Loaded ${name}.`,   // (what it held is in the list above the plates)
};
// The line under the logo before a plate is chosen.
export const NONE_LINE = "An unofficial fan rebuild of the Tsukihime remake. Choose a page above: ABOUT, GITHUB, DOWNLOAD, SAVE DATA, or PLAY ONLINE to start the game.";

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

// Resolves once the game has been started from PLAY ONLINE and the page has gone.
// started: called within the click or key that starts the game, while the browser still counts it as the player's (main.js asks for full screen there).
export async function openHome(ui, { started = null } = {}) {
  const page = ui.begin("home");
  const black = ui.blackout(page, 1);
  const T = ui.touch ? TOUCH : null, P = T ? { w: T.bar.w, h: T.bar.h } : PLATE;
  const shown = T ? P.w * T.bar.scale : P.w;
  // by touch (TOUCH.home; held upright TOUCH.homeUpright, touch.js place sets html.upright): rows of L.cols plates, each row centred, so three
  // plates over two. With a mouse: the five in one row.
  const upright = () => document.documentElement.classList.contains("upright");
  const rowOf = (L, i) => { const row = Math.floor(i / L.cols), count = Math.min(L.cols, TABS.length - row * L.cols); return [row, count]; };
  const spot = (i) => {
    if (!T) return [Math.round((1920 - (PLATE.pitch * (TABS.length - 1) + shown)) / 2) + i * PLATE.pitch, PLATE.y];
    const L = upright() ? TOUCH.homeUpright : TOUCH.home, [row, count] = rowOf(L, i);
    return [Math.round((L.w - (L.pitch * (count - 1) + shown)) / 2) + (i % L.cols) * L.pitch, L.y + row * L.rowPitch];
  };
  const [sheet, saveSheet] = await Promise.all([quickBarArt(TABS.map((t) => ({ label: t.plate })), P), quickBarArt(SAVE_PLATES.map((t) => ({ label: t.plate })), P),
    ...ART.map((a) => { const i = new Image(); i.src = `/assets/ui/${a}.webp`; return i.decode().catch(() => {}); })]);
  return new Promise((done) => {
    black.remove();
    page.classList.add("hm-page");
    const land = (e) => { e.classList.add("hm-land"); return e; };   // drawn on the game's stage only, not on the upright one
    page.append(land(sprite("TITLE_PARTS_JA", "title_bg1", 0, 0, 1920, 1080)));
    ui.menuBackground(page, { settled: true });
    const dim = sprite("DIALOG_PARTS_JA", "dialog_BG", 0, 0, 1920, 1080);   // the question window's backdrop, to quieten the moon behind the text
    dim.style.opacity = "0.5";
    page.append(land(dim), land(sprite("CONF_PARTS_JA", "config_innerbg", 180, 0, 1560, 1080)));
    // held upright: the same pictures, the title's covering the stage, Config's panel down its length (touch.css html.upright)
    page.append(el("div", "hm-tall hm-tall-bg"), el("div", "hm-tall hm-tall-dim"), el("div", "hm-tall hm-tall-panel"));
    const list = el("div", "logscroll wl-scroll hm-scroll"), inner = el("div", "wl-text hm-text");
    list.append(inner);
    page.append(list);
    const barBox = T ? page.appendChild(el("div", "hm-bar")) : page;
    ui.scrollBar(barBox, list, () => list.scrollHeight > list.clientHeight + 1);
    ui.helpBar(page, ["Choose", "Change page", "Scroll"]);

    const bar = el("div", T ? "modepanel hm" : "modepanel");
    if (T) bar.append(...panelBack(TOUCH.home.height), el("div", "hm-tall hm-tall-strip")); else bar.append(sprite("MODEPNL_PARTS_JA", "modepanel_window", 0, 0, 1920, 96));
    page.append(bar);
    page.append(black);   // over all but the bar, which has a level of its own and slides

    const accel = T ? "on" : glAccel();   // ("on" by touch: the notice is not shown there)
    let tab = -1, shownAt = 0, leaving = false, prompt = null, pulse = { alpha: 0, up: true };
    // ---- Export and Import (savefile.js) ----
    let status = null, said = null;   // the line under the plates, and what it says (kept while the page is drawn again)
    const say = (text, bad = false) => { said = { text, bad }; if (status) { status.textContent = text; status.classList.toggle("bad", bad); } };
    const exportNow = async () => {
      if (leaving) return;
      ui.audio.start();
      ui.sound(1);
      let file = null;
      try { file = exportSaves(localStorage, await loadBase(), (ui.vm || globalThis.vm)?.gallery?.seen || null); } catch { /* storage refused: nothing to export */ }
      if (!file) { say(SAVE_TEXT.none, true); return; }
      const a = el("a"), href = URL.createObjectURL(new Blob([file], { type: "application/octet-stream" }));
      a.href = href; a.download = FILE_NAME;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60000);
      say(SAVE_TEXT.exported(FILE_NAME));
    };
    // The file's parts in the browser's place and the file itself kept, then the page again: everything the game read when it loaded is read anew,
    // and the page comes back here.
    const load = async (sys, bytes) => {
      try { importSaves(sys); } catch (e) { say(e.message, true); return; }
      leaving = true;
      ui.sound(6);
      try { sessionStorage.setItem(NOTE, SAVE_TEXT.loaded(FILE_NAME) + recordsLine(sys)); } catch { /* it opens on its first page */ }
      await keepBase(bytes);
      ui.fadeBlack(black, 1, FADE.out * 2, () => location.reload());
    };
    const picker = el("input");
    picker.type = "file"; picker.hidden = true;   // (the game's file has no extension, so any file may be picked; readSaves tells)
    picker.addEventListener("click", (e) => e.stopPropagation());
    picker.addEventListener("change", async () => {
      const f = picker.files?.[0];
      picker.value = "";   // (the same file can be chosen again)
      if (!f || leaving) return;
      let sys, bytes;
      try {
        bytes = f.size === GAME.size ? new Uint8Array(await f.arrayBuffer()) : null;   // (a file of another size is not read at all)
        sys = readSaves(bytes);
      } catch (e) { say(e.message, true); return; }
      if (leaving) return;
      say("");
      if (!hasProgress()) { load(sys, bytes); return; }
      ui.dialog(SAVE_TEXT.ask, (back) => { back(); load(sys, bytes); }, (back) => { back(); ui.sel = NONE; say(""); }, { startNo: true });
    });
    page.append(picker);
    const importPick = () => { if (leaving) return; ui.audio.start(); ui.sound(1); picker.click(); };
    // Remove: after the question, the saves and progress out of the browser and the kept file with them, then the page again, as after an import.
    const removeNow = async () => {
      if (leaving) return;
      ui.audio.start();
      ui.sound(1);
      if (!hasProgress() && !(await loadBase())) { say(SAVE_TEXT.nothing, true); return; }
      if (leaving) return;
      ui.dialog(SAVE_TEXT.askRemove, async (back) => {
        back();
        try { removeSaves(); } catch (e) { say(e.message, true); return; }
        leaving = true;
        ui.sound(6);
        try { sessionStorage.setItem(NOTE, SAVE_TEXT.removed); } catch { /* it opens on its first page */ }
        await dropBase();
        ui.fadeBlack(black, 1, FADE.out * 2, () => location.reload());
      }, (back) => { back(); ui.sel = NONE; }, { startNo: true });
    };
    const saveActs = { export: exportNow, import: importPick, remove: removeNow };
    // What the browser holds now (savefile.js loadedData): the counts as the game's own screens give them, the saves made here, and the file kept
    // from the last import, which is read from the browser's database a moment after the page is shown.
    const dataBlock = () => {
      const box = el("div", "hm-data");
      const tables = { chart: (ui.vm || globalThis.vm)?.flowChart || null, gallery: (ui.vm || globalThis.vm)?.gallery || null };
      const fill = (base) => {
        let rows = [];
        try { rows = loadedData(localStorage, tables, base); } catch { /* storage refused: nothing to list */ }
        const list = rows.length ? blockEl(["rows", rows]) : el("p", "hm-data-none", SAVE_TEXT.empty);
        if (rows.length) list.classList.add("hm-rows");
        box.replaceChildren(el("h3", "", SAVE_TEXT.now), list);
      };
      fill(null);
      loadBase().then((base) => { if (base && box.isConnected) fill(base); });
      return box;
    };
    const savesBlock = () => {
      const box = el("div", "hm-saves");
      const row = el("div", "hm-save-row");
      for (const [i, s] of SAVE_PLATES.entries()) {
        const b = el("button", "qbtn hm-save-plate", s.plate);
        b.style.cssText = `width:${P.w}px;height:${P.h}px;`;
        const paint = (r) => {
          b.className = `qbtn hm-save-plate r${r}${saveSheet ? " art" : ""}`;
          if (saveSheet) { b.style.backgroundImage = `url("${saveSheet}")`; b.style.backgroundPosition = `${-i * P.w}px ${-r * P.h}px`; }
        };
        paint(1);
        b.addEventListener("pointerenter", (e) => { if (e.pointerType !== "touch") paint(2); });
        b.addEventListener("pointerleave", () => paint(1));
        b.addEventListener("pointerdown", () => paint(3));
        b.addEventListener("pointerup", (e) => paint(e.pointerType === "touch" ? 1 : 2));
        b.addEventListener("pointercancel", () => paint(1));
        b.addEventListener("click", (e) => { e.stopPropagation(); saveActs[s.act](); });
        row.append(b);
      }
      status = el("p", `hm-save-status${said?.bad ? " bad" : ""}`, said?.text ?? "");
      status.setAttribute("role", "status");
      box.append(row);
      if (!T) box.append(el("p", "hm-save-note", SAVE_TEXT.keys));
      box.append(status);
      return box;
    };
    const block = (b) => {
      if (b[0] === "saves") return savesBlock();
      if (b[0] === "data") return dataBlock();
      if (b[0] === "press") {
        prompt = el("button", "hm-press");
        prompt.setAttribute("aria-label", "Press any button to start");
        prompt.style.opacity = "0";
        prompt.addEventListener("click", (e) => { e.stopPropagation(); start(); });
        return prompt;
      }
      if (b[0] === "gpu") {
        const box = el("div", "hm-notice");
        box.append(el("h3", "", GPU_NOTICE.head));
        if (accel === "off") box.append(el("p", "hm-notice-off", GPU_NOTICE.off));
        box.append(blockEl(["rows", GPU_NOTICE.rows]));
        return box;
      }
      if (b[0] === "link") {
        const a = el("a", "hm-link", b[1]);
        a.href = b[2];
        a.rel = "noopener";
        if (b[3]) a.download = b[3]; else a.target = "_blank";
        a.addEventListener("click", (e) => { e.stopPropagation(); ui.audio.start(); ui.sound(1); });
        return a;
      }
      const e = blockEl(b);
      if (b[0] === "facts" && b[1].length === 3) e.classList.add("hm-three");   // (three figures stay in one row, even upright)
      if (b[0] === "rows" && tab !== ABOUT) e.classList.add("hm-rows");   // (names this short need no 500 px column; About keeps the first page's)
      return e;
    };
    // k: a tab, or NONE: what the page opens on, the logo and a line naming the plates
    const show = (k) => {
      tab = k;
      prompt = null;
      status = null;
      pulse = { alpha: 0, up: true };
      if (k === NONE) {
        inner.replaceChildren(el("div", "wl-logo hm-logo"), el("p", "wl-note hm-lead", NONE_LINE));
        inner.style.opacity = "0";
        shownAt = 0;
        list.scrollTop = 0;
        return;
      }
      inner.replaceChildren(...TABS[k].sections.map((s, n) => {
        const part = el("div", "hm-part");
        // (on a touch device the PLAY ONLINE page also says, under its prompt, how the game is played by touch: there are no hints to find by resting a
        // pointer)
        const kept = s.blocks.filter((b) => b[0] !== "gpu" || accel !== "on");
        const blocks = T && k === PLAY ? [...kept, ...TOUCH_INTRO] : kept;
        part.append(el("h2", "", s.head), ...blocks.map(block));
        return part;
      }));
      inner.style.opacity = "0";
      shownAt = 0;
      list.scrollTop = 0;
    };
    // the plates' places, again whenever the window is turned (by touch a row above or below is two arrows away: Left and Right walk all five)
    const place = () => plates.forEach((b, i) => { const [x, top] = spot(i); b.style.left = `${x}px`; b.style.top = `${top}px`; });
    addEventListener("resize", place);
    const leave = () => {
      bar.classList.remove("on");
      ui.fadeBlack(black, FADE.to, FADE.out, () => { removeEventListener("resize", place); ui.close(); done(); });
    };
    // PRESS ANY BUTTON: as the title's, sound 6 and the black, here into the game's title or its opening.
    function start() {
      if (leaving || tab !== PLAY) return;
      leaving = true;
      started?.();         // full screen, now and not before (main.js)
      ui.audio.start();    // the click or key the browser wanted
      ui.sound(6);
      plates[PLAY].st.pressFor(10);
      ui.after(10, leave);
    }
    // On PLAY ONLINE a click anywhere on its page is the button too; a drag that scrolls it is not a click.
    list.addEventListener("click", (e) => { if (tab === PLAY && !e.target.closest("a")) start(); });
    const plates = TABS.map((t, i) => {
      const b = el("button", "qbtn r1", t.plate);   // the word, where the art cannot be made
      b.style.cssText = `left:${spot(i)[0]}px;top:${spot(i)[1]}px;width:${P.w}px;height:${P.h}px;`;
      const lit = el("div", "sp fx-add");
      lit.style.cssText = `left:0;top:0;width:${P.w}px;height:${P.h}px;opacity:0;`;
      b.append(lit);
      b.lit = lit;
      b.st = new ButtonState();
      if (sheet) {
        b.style.backgroundImage = lit.style.backgroundImage = `url("${sheet}")`;
        lit.style.backgroundPosition = `${-i * P.w}px ${-2 * P.h}px`;
      }
      bar.append(b);
      ui.add(b, () => {
        if (leaving) return;
        if (i === PLAY && tab === PLAY) { start(); return; }   // PLAY ONLINE pressed on its own page: the button the prompt asks for
        ui.audio.start();
        ui.sound(1);
        b.st.pressFor(10);
        if (i !== tab) show(i);
      }, { sound: null });
      return b;
    });
    show(NONE);
    ui.sel = NONE;      // no plate lit: the keys' cursor comes in with the first arrow, Tab or pointer
    // (after an import the page comes back on SAVE DATA, saying what was loaded)
    try {
      const note = sessionStorage.getItem(NOTE);
      if (note) { sessionStorage.removeItem(NOTE); said = { text: note, bad: false }; show(SAVE); ui.select(SAVE); }
    } catch { /* its first page */ }

    ui.keyFn = (e) => {
      const k = e.key;
      if (k === "F5" || k === "F11" || k === "F12") return false;
      if (leaving) return true;
      if (k === "ArrowLeft" || k === "ArrowRight") {
        const step = k === "ArrowLeft" ? -1 : 1;
        ui.move(ui.sel === NONE ? (step > 0 ? 0 : TABS.length - 1) : ui.sel + step);   // (from no plate: the first, or the last)
      }
      else if (k === "Enter" || k === " ") { if (!e.repeat) ui.choose(ui.sel); }
      else if (k === "Tab") {
        if (!e.repeat) { const next = tab === NONE ? (e.shiftKey ? TABS.length - 1 : 0) : (tab + (e.shiftKey ? -1 : 1) + TABS.length) % TABS.length; ui.audio.start(); ui.sound(1); show(next); ui.select(next); }
      }
      else if ((k === "e" || k === "E") && tab === SAVE && !e.ctrlKey && !e.metaKey && !e.altKey) { if (!e.repeat) exportNow(); }
      else if ((k === "i" || k === "I") && tab === SAVE && !e.ctrlKey && !e.metaKey && !e.altKey) { if (!e.repeat) importPick(); }
      else if (k === "ArrowUp") list.scrollTop -= 120;
      else if (k === "ArrowDown") list.scrollTop += 120;
      else if (k === "PageUp") list.scrollTop -= 760;
      else if (k === "PageDown") list.scrollTop += 760;
      else if (k === "Home") list.scrollTop = 0;
      else if (k === "End") list.scrollTop = list.scrollHeight;
      return true;
    };

    ui.animate((dt) => {
      plates.forEach((b, i) => {
        b.st.step(dt, i === ui.sel);
        const row = b.st.state === 4 || i === tab ? 3 : i === ui.sel ? 2 : 1;
        if (b.row !== row) {
          b.row = row;
          b.className = `qbtn r${row}${sheet ? " art" : ""}`;
          if (sheet) b.style.backgroundPosition = `${-i * P.w}px ${-row * P.h}px`;
        }
        b.lit.style.opacity = String(sheet ? b.st.flash : 0);
      });
      if (shownAt < 18) { shownAt = Math.min(18, shownAt + dt); inner.style.opacity = String(shownAt / 18); }
      if (prompt && !leaving) { pulse = pressPulse(pulse, dt); prompt.style.opacity = String(pulse.alpha); }
    });
    ui.fadeBlack(black, 0, FADE.in);
    requestAnimationFrame(() => requestAnimationFrame(() => bar.classList.add("on")));
  });
}
