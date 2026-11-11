// home.js - the page the game opens on: four tabs on the game's own panel, ABOUT (what this project is and how it was made, welcome.js), GITHUB (the source),
// ANDROID APP (the offline app) and PLAY ONLINE, whose PRESS ANY BUTTON starts the game; that press is also the click a browser wants before it plays sound.
// Built as the quick bar is (ui.js buildPanel), from the game's art: the mode panel's strip with four of its plates relettered, the title's picture under the
// system menu's sky, Config's inner panel, the game's scroll bar and help band, and the title's own prompt.
// It opens on every visit, for everyone: on ABOUT the first time, on PLAY ONLINE after that. Not inside the Android app (web-dev/android), which is the
// game itself, nor where the address asks for a scene (?script, for tests and the scene links in ABOUT's Extras).
import { sprite, quickBarArt, panelBack } from "./ui.js";
import { TOUCH } from "./touch.js";
import { ButtonState, pressPulse } from "./uifx.js";
import { SECTIONS, TOUCH_INTRO, blockEl } from "./welcome.js";

export const GITHUB = "https://github.com/waifwu/TsukiREbuild";
export const APK = { href: "/android/tsukihime.apk", file: "Tsukihime.apk", size: "2.8 GB" };
const PLATE = { w: 220, h: 62, pitch: 221, y: 29 };                       // the game's panel plates, at their size and pitch (ui.js QUICK_BAR)
const FADE = { in: 0.024, out: 0.02, to: 1.2 };                          // Config's fade in, and the title's black as it leaves
const PRESS = { w: 472, h: 88 };                                          // the title's prompt (TITLE_PARTS_JA/press_start), at its size
const ART = ["TITLE_PARTS_JA/title_bg1", "TITLE_PARTS_JA/title_titlelog", "TITLE_PARTS_JA/press_start", "DISP_PARTS_JA/menuBG01_upscale", "DIALOG_PARTS_JA/dialog_BG",
  "CONF_PARTS_JA/config_innerbg", "MODEPNL_PARTS_JA/modepanel_window", "MENU_PARTS_JA/underline"];
const APP_HOST = "appassets.androidplatform.net";   // the Android app's own address for the page (web-dev/android)

export function homeDue(query, host = globalThis.location?.hostname || "") {
  if (query.has("script")) return false;
  return host !== APP_HOST;
}

// The tabs: a plate, and the sections its page shows, each a heading and blocks as welcome.js draws them, plus ["link", text, address, file name if a
// download] and ["press"], the prompt that starts the game.
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
    ]],
    ["link", "github.com/waifwu/TsukiREbuild", GITHUB],
  ] }] },
  { plate: "ANDROID APP", sections: [{ head: "The Android app", blocks: [
    "The whole game in one app that needs no connection: every picture, voice, song and movie is inside it, and nothing is fetched while you play. It asks for no permissions at all, not even the internet.",
    ["facts", [[APK.size, "the download"], ["Android 8", "or newer"], ["0", "permissions asked for"]]],
    ["h", "Installing it"],
    ["rows", [
      ["1. Download", `${APK.file}, below, on the phone itself. It is large, so Wi-Fi is best.`],
      ["2. Open it", "From the browser's downloads. Android asks whether that browser may install apps: allow it."],
      ["3. Install", "As much space again must be free while it installs. Afterwards the download can be deleted."],
    ]],
    ["h", "Playing"],
    "It plays in landscape, by touch, as this site does on a phone. Android's Back gesture does what the game's own Back button does. Leaving the app makes the automatic save, so you come back to where you were. Saves are kept in the app, apart from this site's.",
    ["link", `${APK.file}  ·  ${APK.size}`, APK.href, APK.file],
  ] }] },
  { plate: "PLAY ONLINE", sections: [{ head: "Play here, in the browser", blocks: [
    "Nothing to install. It runs in Chrome or Firefox, on a computer, a phone or a tablet. Not in Safari, which plays the AV1 movies only on Apple's newest hardware.",
    "The game's files arrive as you play: the first screens load while this page is open, and the rest follow. Saves, settings and progress are kept in this browser; clearing the site's data removes them.",
    ["press"],
  ] }] },
];
export const ABOUT = 0, PLAY = TABS.length - 1;

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

// Resolves once the game has been started from PLAY ONLINE and the page has gone. about: open on ABOUT (a first visit) rather than PLAY ONLINE.
// started: called within the click or key that starts the game, while the browser still counts it as the player's (main.js asks for full screen there).
export async function openHome(ui, { about = false, started = null } = {}) {
  const page = ui.begin("home");
  const black = ui.blackout(page, 1);
  const T = ui.touch ? TOUCH : null, P = T ? { w: T.bar.w, h: T.bar.h } : PLATE;
  const pitch = T ? TOUCH.home.pitch : PLATE.pitch, shown = T ? P.w * T.bar.scale : P.w;
  const x0 = Math.round((1920 - (pitch * (TABS.length - 1) + shown)) / 2), y = T ? TOUCH.home.y : PLATE.y;
  const sheet = await Promise.all([quickBarArt(TABS.map((t) => ({ label: t.plate })), P),
    ...ART.map((a) => { const i = new Image(); i.src = `/assets/ui/${a}.webp`; return i.decode().catch(() => {}); })]).then(([s]) => s);
  return new Promise((done) => {
    black.remove();
    page.append(sprite("TITLE_PARTS_JA", "title_bg1", 0, 0, 1920, 1080));
    ui.menuBackground(page, { settled: true });
    const dim = sprite("DIALOG_PARTS_JA", "dialog_BG", 0, 0, 1920, 1080);   // the question window's backdrop, to quieten the moon behind the text
    dim.style.opacity = "0.5";
    page.append(dim, sprite("CONF_PARTS_JA", "config_innerbg", 180, 0, 1560, 1080));
    const list = el("div", "logscroll wl-scroll hm-scroll"), inner = el("div", "wl-text hm-text");
    list.append(inner);
    page.append(list);
    const barBox = T ? page.appendChild(el("div", "hm-bar")) : page;
    ui.scrollBar(barBox, list, () => list.scrollHeight > list.clientHeight + 1);
    ui.helpBar(page, ["Choose", "Change page", "Scroll"]);

    const bar = el("div", T ? "modepanel hm" : "modepanel");
    if (T) bar.append(...panelBack(TOUCH.home.height)); else bar.append(sprite("MODEPNL_PARTS_JA", "modepanel_window", 0, 0, 1920, 96));
    page.append(bar);
    page.append(black);   // over all but the bar, which has a level of its own and slides

    let tab = -1, shownAt = 0, leaving = false, prompt = null, pulse = { alpha: 0, up: true };
    const block = (b) => {
      if (b[0] === "press") {
        prompt = el("button", "hm-press");
        prompt.setAttribute("aria-label", "Press any button to start");
        prompt.style.opacity = "0";
        prompt.addEventListener("click", (e) => { e.stopPropagation(); start(); });
        return prompt;
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
      if (b[0] === "rows" && tab !== ABOUT) e.classList.add("hm-rows");   // (names this short need no 500 px column; About keeps the first page's)
      return e;
    };
    const show = (k) => {
      tab = k;
      prompt = null;
      pulse = { alpha: 0, up: true };
      inner.replaceChildren(...TABS[k].sections.map((s, n) => {
        const part = el("div", "hm-part");
        // (on a touch device the PLAY ONLINE page also says, under its prompt, how the game is played by touch: there are no hints to find by resting a
        // pointer)
        const blocks = T && k === PLAY ? [...s.blocks, ...TOUCH_INTRO] : s.blocks;
        part.append(el("h2", "", s.head), ...blocks.map(block));
        return part;
      }));
      inner.style.opacity = "0";
      shownAt = 0;
      list.scrollTop = 0;
    };
    const leave = () => {
      bar.classList.remove("on");
      ui.fadeBlack(black, FADE.to, FADE.out, () => { ui.close(); done(); });
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
      b.style.cssText = `left:${x0 + i * pitch}px;top:${y}px;width:${P.w}px;height:${P.h}px;`;
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
    show(about ? ABOUT : PLAY);
    ui.select(tab);

    ui.keyFn = (e) => {
      const k = e.key;
      if (k === "F5" || k === "F11" || k === "F12") return false;
      if (leaving) return true;
      if (k === "ArrowLeft" || k === "ArrowRight") ui.move(ui.sel + (k === "ArrowLeft" ? -1 : 1));
      else if (k === "Enter" || k === " ") { if (!e.repeat) ui.choose(ui.sel); }
      else if (k === "Tab") {
        if (!e.repeat) { const next = (tab + (e.shiftKey ? -1 : 1) + TABS.length) % TABS.length; ui.audio.start(); ui.sound(1); show(next); ui.select(next); }
      }
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
