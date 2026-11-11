// The opening page (web/app/js/home.js): it shows for everyone on every visit, its four tabs, where their links lead, and that the game starts from PLAY ONLINE.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { homeDue, TABS, ABOUT, PLAY, GITHUB, APK } = await import("../../web/app/js/home.js");
const { SECTIONS } = await import("../../web/app/js/welcome.js");
const source = (name) => readFileSync(new URL(`../../web/app/${name}`, import.meta.url), "utf8");
const q = (s) => new URLSearchParams(s);
const blocks = (k) => TABS[k].sections.flatMap((s) => s.blocks);

test("it opens for everyone, on every visit and every address, the local server included", () => {
  for (const host of ["arcueid.date", "tsukirebuild.pages.dev", "localhost", "127.0.0.1"]) {
    for (const s of ["", "mute", "play", "welcome", "home"]) assert.equal(homeDue(q(s), host), true, `${host} ?${s}`);
  }
});

test("only the Android app, which is the game itself, and an address for a scene go past it", () => {
  assert.equal(homeDue(q(""), "appassets.androidplatform.net"), false);
  for (const s of ["script=00_02", "script=89&pc=500", "script=04_00_ARC04_3&label=LBL_008&mute"]) assert.equal(homeDue(q(s), "arcueid.date"), false, s);
});

test("four tabs: ABOUT, GITHUB, ANDROID APP, PLAY ONLINE, each a page of its own", () => {
  assert.deepEqual(TABS.map((t) => t.plate), ["ABOUT", "GITHUB", "ANDROID APP", "PLAY ONLINE"]);
  assert.equal(ABOUT, 0);
  assert.equal(PLAY, 3);
  assert.equal(TABS[ABOUT].sections.length, SECTIONS.length, "everything the first-visit page said");
  for (const k of [1, 2, 3]) assert.equal(TABS[k].sections.length, 1, TABS[k].plate);
});

test("GitHub's page links the repository, the Android app's the download, PLAY ONLINE's has the prompt that starts the game", () => {
  const link = (k) => blocks(k).find((b) => b[0] === "link");
  assert.equal(link(1)[2], GITHUB);
  assert.match(GITHUB, /^https:\/\/github\.com\/waifwu\/TsukiREbuild$/);
  assert.equal(link(1)[3], undefined, "a page in a new tab, not a download");
  assert.deepEqual(link(2).slice(2), ["/android/tsukihime.apk", "Tsukihime.apk"]);
  assert.equal(APK.size, "2.8 GB", "the size phones show for the 2,800,247,921-byte APK");
  assert.ok(blocks(3).some((b) => b[0] === "press"));
  assert.ok(!blocks(1).some((b) => b[0] === "press") && !blocks(2).some((b) => b[0] === "press"), "only PLAY ONLINE starts the game");
});

test("a first visit opens on ABOUT, later ones on PLAY ONLINE; a choice or a click on PLAY ONLINE's page starts the game", () => {
  const home = source("js/home.js"), main = source("js/main.js");
  assert.match(main, /if \(homeDue\(q\)\) await openHome\(ui, \{ about: firstVisit, started: gameStarted \}\);/);
  assert.match(home, /show\(about \? ABOUT : PLAY\);/);
  assert.match(home, /if \(i === PLAY && tab === PLAY\) \{ start\(\); return; \}/);
  assert.match(home, /list\.addEventListener\("click", \(e\) => \{ if \(tab === PLAY && !e\.target\.closest\("a"\)\) start\(\); \}\);/);
  assert.match(home, /if \(leaving \|\| tab !== PLAY\) return;/, "nothing else starts it");
  assert.ok(main.indexOf("preload.startup(") < main.indexOf("await openHome(ui"), "the game loads while the page is open");
});

test("built from the game's art: the panel's strip and plates, Config's panel, the title's picture and its PRESS ANY BUTTON with the title's pulse", () => {
  const home = source("js/home.js");
  for (const art of ["MODEPNL_PARTS_JA/modepanel_window", "CONF_PARTS_JA/config_innerbg", "TITLE_PARTS_JA/title_bg1", "TITLE_PARTS_JA/press_start"]) assert.ok(home.includes(art), art);
  assert.match(home, /quickBarArt\(TABS\.map/);
  assert.match(home, /pulse = pressPulse\(pulse, dt\);/);
  assert.match(source("style.css"), /\.hm-press \{[^}]*TITLE_PARTS_JA\/press_start\.webp/);
});

test("on a phone held upright the opening page has a layout of its own and no rotate screen; that comes only once PLAY ONLINE has started the game", () => {
  const touch = source("js/touch.js"), main = source("js/main.js"), home = source("js/home.js"), css = source("touch.css");
  assert.match(touch, /hold\(h > w && !touch\.upright\?\.\(\)\);/, "no rotate screen while the opening page is up");
  assert.match(touch, /touch\.uprightNow = \(\) => !!touch\.upright\?\.\(\) && win\.innerHeight > win\.innerWidth;/);
  assert.match(touch, /root\.classList\.toggle\("upright", up\);/);
  assert.match(touch, /stage\.style\.width = `\$\{T\.homeUpright\.w\}px`;/, "the stage 1080 wide and as tall as the window");
  assert.match(touch, /stage\.style\.width = stage\.style\.height = "";/, "and the game's own again after");
  assert.match(main, /let homeUp = fullHeld;/);
  assert.match(main, /touch\.upright = \(\) => homeUp;/);
  assert.match(main, /homeUp = false;\n  touch\.reorient\?\.\(\);[^\n]*\n  fitStage\(\);/, "the rotate screen once the page has gone");
  assert.match(home, /T && upright\(\) \? \[ux0 \+ \(i % U\.cols\) \* pitch, y \+ Math\.floor\(i \/ U\.cols\) \* U\.rowPitch\]/, "two rows of two plates");
  assert.match(home, /addEventListener\("resize", place\);/, "laid out again when the phone is turned");
  assert.match(css, /html\.touch\.upright \.hm-scroll \{ left: 40px; top: 262px; width: 1000px; height: calc\(100% - 262px\); \}/);
  assert.match(css, /border-image: url\("\/assets\/ui\/MODEPNL_PARTS_JA\/modepanel_window\.webp"\) 0 40 8 40 fill stretch;/, "the game's strip, its ends kept");
});
