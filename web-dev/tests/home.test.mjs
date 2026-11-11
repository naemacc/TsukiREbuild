// The opening page (web/app/js/home.js): it shows for everyone on every visit, its four tabs, where their links lead, and that the game starts from PLAY ONLINE.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { homeDue, TABS, ABOUT, PLAY, NONE, NONE_LINE, GITHUB, APK, DESKTOP } = await import("../../web/app/js/home.js");
const { SECTIONS } = await import("../../web/app/js/welcome.js");
const source = (name) => readFileSync(new URL(`../../web/app/${name}`, import.meta.url), "utf8");
const q = (s) => new URLSearchParams(s);
const blocks = (k) => TABS[k].sections.flatMap((s) => s.blocks);

test("it opens for everyone, on every visit and every address, the local server included", () => {
  for (const host of ["arcueid.date", "tsukirebuild.pages.dev", "localhost", "127.0.0.1"]) {
    for (const s of ["", "mute", "play", "welcome", "home"]) assert.equal(homeDue(q(s), host), true, `${host} ?${s}`);
  }
});

test("only the Android and desktop apps, which are the game itself, and an address for a scene go past it", () => {
  assert.equal(homeDue(q(""), "appassets.androidplatform.net"), false);
  assert.equal(homeDue(q(""), "tsukihime.desktop"), false);
  for (const s of ["script=00_02", "script=89&pc=500", "script=04_00_ARC04_3&label=LBL_008&mute"]) assert.equal(homeDue(q(s), "arcueid.date"), false, s);
});

test("four tabs: ABOUT, GITHUB, DOWNLOAD, PLAY ONLINE, each a page of its own", () => {
  assert.deepEqual(TABS.map((t) => t.plate), ["ABOUT", "GITHUB", "DOWNLOAD", "PLAY ONLINE"]);
  assert.equal(ABOUT, 0);
  assert.equal(PLAY, 3);
  assert.equal(TABS[ABOUT].sections.length, SECTIONS.length, "everything the first-visit page said");
  for (const k of [1, 3]) assert.equal(TABS[k].sections.length, 1, TABS[k].plate);
  assert.deepEqual(TABS[2].sections.map((s) => s.head), ["Download the game", "Windows", "Android", "macOS and Linux"], "what the app is, the two downloads, then how the other two are built");
});

test("GitHub's page links the repository, DOWNLOAD's the four apps, PLAY ONLINE's has the prompt that starts the game", () => {
  const link = (k) => blocks(k).find((b) => b[0] === "link");
  assert.equal(link(1)[2], GITHUB);
  assert.match(GITHUB, /^https:\/\/github\.com\/waifwu\/TsukiREbuild$/);
  assert.equal(link(1)[3], undefined, "a page in a new tab, not a download");
  // Windows and Android end in their own download, saved under the file's name; macOS and Linux have the steps to build the app, and a link to how
  const links = TABS[2].sections.map((s) => s.blocks.filter((b) => b[0] === "link").map((b) => b.slice(2)));
  assert.deepEqual(links, [[], [["/desktop/Tsukihime-win-x64.zip", "Tsukihime-win-x64.zip"]], [["/android/tsukihime.apk", "Tsukihime.apk"]],
    [["https://github.com/waifwu/TsukiREbuild/tree/main/web-dev/desktop"]]]);
  for (const s of TABS[2].sections.slice(1)) {
    assert.equal(s.blocks.at(-1)[0], "link", s.head);
    const rows = s.blocks.find((b) => b[0] === "rows")[1].map((r) => r[0]);
    assert.equal(rows[0], "Needs", s.head);
    assert.equal(rows.length, 4, `${s.head}: what it needs and three steps`);
  }
  for (const s of TABS[2].sections.slice(1, 3)) assert.match(s.blocks.at(-1)[1], / {2}·  \d\.\d GB$/, `${s.head}: the link says the size`);
  const build = JSON.stringify(TABS[2].sections[3].blocks);
  for (const word of ["git clone --depth 1 https://github.com/waifwu/TsukiREbuild", "web-dev/desktop/build.sh mac", "web-dev/desktop/build.sh linux", "Tsukihime-mac-universal.dmg", "Tsukihime-linux-x86_64.AppImage"]) assert.ok(build.includes(word), word);
  assert.equal(DESKTOP.size, "2.9 GB", "the 2,885,339,917-byte zip (2026-11-11)");
  assert.ok(blocks(3).some((b) => b[0] === "press"));
  assert.ok(!blocks(1).some((b) => b[0] === "press") && !blocks(2).some((b) => b[0] === "press"), "only PLAY ONLINE starts the game");
});

test("it opens with no tab chosen and no plate lit, so a stray tap starts nothing; on PLAY ONLINE's page a choice or a click starts the game", () => {
  const home = source("js/home.js"), main = source("js/main.js");
  assert.match(main, /if \(homeDue\(q\)\) await openHome\(ui, \{ started: gameStarted \}\);/);
  assert.match(home, /show\(NONE\);\n    ui\.sel = NONE;/);
  assert.equal(NONE, -1);
  assert.match(NONE_LINE, /ABOUT, GITHUB, DOWNLOAD, or PLAY ONLINE/);
  assert.match(home, /if \(tab === PLAY && !e\.target\.closest\("a"\)\) start\(\);/, "taps start the game only on PLAY ONLINE's page");
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

test("PLAY ONLINE opens on the hardware acceleration notice, with each browser's setting, only where acceleration is off or can't be told to be on", async () => {
  const { TABS, PLAY, GPU_NOTICE, SOFTWARE_GL, HIDDEN_GL } = await import("../../web/app/js/home.js");
  const h = source("js/home.js");
  assert.deepEqual(TABS[PLAY].sections[0].blocks[0], ["gpu"]);
  assert.match(GPU_NOTICE.head, /hardware acceleration/);
  assert.deepEqual(GPU_NOTICE.rows.map((r) => r[0]), ["Chrome", "Edge", "Firefox"]);
  for (const n of ["ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)", "llvmpipe (LLVM 15.0.7, 256 bits)",
    "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)"]) assert.ok(SOFTWARE_GL.test(n), n);
  for (const n of ["", "WebKit WebGL", "Mozilla", "Generic Renderer"]) assert.ok(HIDDEN_GL.test(n) && !SOFTWARE_GL.test(n), n);
  for (const n of ["ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)", "Apple GPU", "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "Adreno (TM) 740"]) assert.ok(!SOFTWARE_GL.test(n) && !HIDDEN_GL.test(n), n);
  assert.match(h, /getContext\("webgl2", \{ failIfMajorPerformanceCaveat: true \}\)/);
  assert.match(h, /s\.blocks\.filter\(\(b\) => b\[0\] !== "gpu" \|\| accel !== "on"\)/, "left out where it is on");
  assert.match(h, /if \(accel === "off"\) box\.append/, "says it is off only where it is");
});
