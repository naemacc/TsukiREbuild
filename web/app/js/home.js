// home.js - the page the published site opens on: three ways to the game, the source on GitHub, the Android app, and playing here. Built as the
// first-visit page is (welcome.js), from the game's own art: the mode panel's strip with three of its plates relettered, the title's picture under the
// system menu's sky, Config's inner panel, the game's scroll bar and help band. PLAY ONLINE is also the click a browser wants before it plays sound.
// Not shown by the local server or inside the Android app (both play at once), nor where the address asks for a scene or the welcome page;
// /?home opens it anywhere. Once PLAY ONLINE is pressed the address gains ?play, so reloading the game does not come back here.
import { sprite, quickBarArt, panelBack } from "./ui.js";
import { TOUCH } from "./touch.js";
import { ButtonState } from "./uifx.js";

export const GITHUB = "https://github.com/waifwu/TsukiREbuild";
export const APK = { href: "/android/tsukihime.apk", file: "Tsukihime.apk", size: "2.8 GB" };
const PLATE = { w: 220, h: 62, pitch: 221, y: 29 };                       // the game's panel plates, at their size and pitch (ui.js QUICK_BAR)
const TOUCH_STRIP = { pitch: 465, y: 28, height: 150 };                   // one row of the plates at 1.5 (touch.js TOUCH.welcome's pitch)
const FADE = { in: 0.024, out: 0.02, to: 1.2 };                          // as the first-visit page
const ART = ["TITLE_PARTS_JA/title_bg1", "TITLE_PARTS_JA/title_titlelog", "DISP_PARTS_JA/menuBG01_upscale", "DIALOG_PARTS_JA/dialog_BG", "CONF_PARTS_JA/config_innerbg", "MODEPNL_PARTS_JA/modepanel_window", "MENU_PARTS_JA/underline"];
// Hosts that go straight to the game: the local server, and the Android app's own address (web-dev/android).
const PLAYS_AT_ONCE = /^(localhost|127\.0\.0\.1|\[::1\]|appassets\.androidplatform\.net)$/;

export function homeDue(query, host = globalThis.location?.hostname || "") {
  if (query.has("home")) return true;
  if (query.has("play") || query.has("script") || query.has("welcome")) return false;
  return !PLAYS_AT_ONCE.test(host);
}

// The address once PLAY ONLINE has been pressed: ?play added, ?home taken away, anything else kept.
export function playAddress(href) {
  const u = new URL(href);
  u.searchParams.delete("home");
  u.searchParams.set("play", "");
  return u.pathname + "?" + u.searchParams.toString().replace(/=(?=&|$)/g, "") + u.hash;
}

// Each way in: its plate, its heading, what it is, and its link (text, address, and whether the address is a download).
export const CHOICES = [
  { plate: "GITHUB", head: "The source, on GitHub", blocks: [
    "The engine rebuilt in JavaScript and WebGL2, with the tools, the tests, and how each part was checked against the game.",
  ], link: { text: "github.com/waifwu/TsukiREbuild", href: GITHUB } },
  { plate: "ANDROID APP", head: "The Android app", blocks: [
    `The whole game in one app that needs no connection and asks for no permissions. For Android 8 or newer: a ${APK.size} download, with as much again free to install it. Your phone will ask you to allow installing apps from your browser.`,
  ], link: { text: `${APK.file}  ·  ${APK.size}`, href: APK.href, download: APK.file } },
  { plate: "PLAY ONLINE", head: "Play here, in the browser", blocks: [
    "Nothing to install: Chrome or Firefox on a computer, phone or tablet. Not Safari, which plays the AV1 movies only on Apple's newest hardware.",
  ], link: null },
];
const PLAY = CHOICES.length - 1;

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

// Opens a choice's address as a click on a link would: GitHub in a new tab, the app as a download.
function follow(link) {
  const a = Object.assign(document.createElement("a"), { href: link.href, rel: "noopener" });
  if (link.download) a.download = link.download; else a.target = "_blank";
  document.body.append(a);
  a.click();
  a.remove();
}

// Resolves once PLAY ONLINE has been pressed and the page has gone.
export async function openHome(ui) {
  const page = ui.begin("home");
  const black = ui.blackout(page, 1);
  const T = ui.touch ? TOUCH : null, P = T ? { w: T.bar.w, h: T.bar.h } : PLATE;
  const pitch = T ? TOUCH_STRIP.pitch : PLATE.pitch, shown = T ? P.w * T.bar.scale : P.w;
  const x0 = Math.round((1920 - (pitch * (CHOICES.length - 1) + shown)) / 2), y = T ? TOUCH_STRIP.y : PLATE.y;
  const sheet = await Promise.all([quickBarArt(CHOICES.map((c) => ({ label: c.plate })), P),
    ...ART.map((a) => { const i = new Image(); i.src = `/assets/ui/${a}.webp`; return i.decode().catch(() => {}); })]).then(([s]) => s);
  return new Promise((done) => {
    black.remove();
    page.append(sprite("TITLE_PARTS_JA", "title_bg1", 0, 0, 1920, 1080));
    ui.menuBackground(page, { settled: true });
    const dim = sprite("DIALOG_PARTS_JA", "dialog_BG", 0, 0, 1920, 1080);
    dim.style.opacity = "0.5";
    page.append(dim, sprite("CONF_PARTS_JA", "config_innerbg", 180, 0, 1560, 1080));
    const list = el("div", "logscroll wl-scroll hm-scroll"), inner = el("div", "wl-text hm-text");
    list.append(inner);
    page.append(list);
    const barBox = T ? page.appendChild(el("div", "wl-bar hm-bar")) : page;
    ui.scrollBar(barBox, list, () => list.scrollHeight > list.clientHeight + 1);
    ui.helpBar(page, ["Choose", "Move", "Scroll"]);

    // The reading column: the logo, a line on what this is, then each way in under its heading, in the plates' order.
    const sections = CHOICES.map((c, i) => {
      const s = el("section", "hm-sec");
      s.append(el("h3", "", c.head), ...c.blocks.map((b) => el("p", "", b)));
      if (c.link) {
        const a = el("a", "hm-link", c.link.text);
        a.href = c.link.href;
        a.rel = "noopener";
        if (c.link.download) a.download = c.link.download; else a.target = "_blank";
        a.addEventListener("click", (e) => { e.stopPropagation(); ui.audio.start(); ui.sound(1); });
        s.append(a);
      }
      // (only a pointer that really moved: the browser's own moves, as the column lays out under a still pointer, keep PLAY ONLINE chosen)
      s.addEventListener("pointermove", (e) => {
        if (e.pointerType !== "touch" && (e.movementX || e.movementY) && ui.pointerMoved && ui.sel !== i && !leaving) ui.move(i);
      });
      return s;
    });
    inner.append(el("div", "wl-logo hm-logo"),
      el("p", "wl-note hm-lead", "An unofficial fan rebuild of the Tsukihime remake, not affiliated with TYPE-MOON or Aniplex. Please support the official release."),
      ...sections);

    const bar = el("div", T ? "modepanel hm" : "modepanel");
    if (T) bar.append(...panelBack(TOUCH_STRIP.height)); else bar.append(sprite("MODEPNL_PARTS_JA", "modepanel_window", 0, 0, 1920, 96));
    page.append(bar);
    page.append(black);   // over all but the bar, which has a level of its own and slides

    let leaving = false, shownAt = 0;
    const leave = () => {
      bar.classList.remove("on");
      ui.fadeBlack(black, FADE.to, FADE.out, () => { ui.close(); done(); });
    };
    const play = (b) => {
      if (leaving) return;
      leaving = true;
      ui.audio.start();    // the click or key the browser wanted
      ui.sound(6);
      try { history.replaceState(history.state, "", playAddress(location.href)); } catch { /* the address stays as it was */ }
      b.st.pressFor(10);
      ui.after(10, leave);
    };
    const plates = CHOICES.map((c, i) => {
      const b = el("button", "qbtn r1", c.plate);   // the word, where the art cannot be made
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
        if (i === PLAY) { play(b); return; }
        if (leaving) return;
        ui.audio.start();
        ui.sound(1);
        b.st.pressFor(10);
        sections[i].scrollIntoView?.({ block: "nearest", behavior: "smooth" });
        follow(c.link);
      }, { sound: null });
      return b;
    });
    ui.select(PLAY);    // Enter plays at once

    ui.keyFn = (e) => {
      const k = e.key;
      if (k === "F5" || k === "F11" || k === "F12") return false;
      if (leaving) return true;
      if (k === "ArrowLeft" || k === "ArrowRight") ui.move(ui.sel + (k === "ArrowLeft" ? -1 : 1));
      else if (k === "Enter" || k === " ") { if (!e.repeat) ui.choose(ui.sel); }
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
        const row = b.st.state === 4 ? 3 : i === ui.sel ? 2 : 1;
        if (b.row !== row) {
          b.row = row;
          b.className = `qbtn r${row}${sheet ? " art" : ""}`;
          if (sheet) b.style.backgroundPosition = `${-i * P.w}px ${-row * P.h}px`;
        }
        b.lit.style.opacity = String(sheet ? b.st.flash : 0);
        sections[i].classList.toggle("on", i === ui.sel);
      });
      if (shownAt < 18) { shownAt = Math.min(18, shownAt + dt); inner.style.opacity = String(shownAt / 18); }
    });
    inner.style.opacity = "0";
    ui.fadeBlack(black, 0, FADE.in);
    requestAnimationFrame(() => requestAnimationFrame(() => bar.classList.add("on")));
  });
}
