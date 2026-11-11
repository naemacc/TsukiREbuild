// The site's opening page (web/app/js/home.js): where it shows, where its three plates lead, and that it comes before the welcome page.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { homeDue, playAddress, CHOICES, GITHUB, APK } = await import("../../web/app/js/home.js");
const source = (name) => readFileSync(new URL(`../../web/app/${name}`, import.meta.url), "utf8");
const q = (s) => new URLSearchParams(s);

test("the opening page shows on the published site, not on the local server or in the Android app", () => {
  assert.equal(homeDue(q(""), "arcueid.date"), true);
  assert.equal(homeDue(q("mute"), "tsukirebuild.pages.dev"), true);
  for (const host of ["localhost", "127.0.0.1", "[::1]", "appassets.androidplatform.net"]) assert.equal(homeDue(q(""), host), false, host);
  assert.equal(homeDue(q("home"), "localhost"), true, "?home opens it anywhere");
  assert.equal(homeDue(q("home"), "appassets.androidplatform.net"), true);
});

test("an address that already asks for the game, a scene or the welcome page goes past it", () => {
  for (const s of ["play", "script=00_02", "script=89&pc=500", "welcome"]) assert.equal(homeDue(q(s), "arcueid.date"), false, s);
});

test("PLAY ONLINE leaves ?play in the address, so a reload goes straight to the game", () => {
  assert.equal(playAddress("https://arcueid.date/"), "/?play");
  assert.equal(playAddress("https://arcueid.date/?home&mute"), "/?mute&play");
  assert.equal(playAddress("https://arcueid.date/?mute#x"), "/?mute&play#x");
  assert.equal(homeDue(new URL("https://arcueid.date" + playAddress("https://arcueid.date/?home")).searchParams, "arcueid.date"), false);
});

test("three plates in the order GitHub, Android app, play here; their links", () => {
  assert.deepEqual(CHOICES.map((c) => c.plate), ["GITHUB", "ANDROID APP", "PLAY ONLINE"]);
  assert.equal(CHOICES[0].link.href, GITHUB);
  assert.match(GITHUB, /^https:\/\/github\.com\/waifwu\/TsukiREbuild$/);
  assert.equal(CHOICES[1].link.href, "/android/tsukihime.apk");
  assert.equal(CHOICES[1].link.download, "Tsukihime.apk");
  assert.equal(APK.size, "2.8 GB", "the size phones show for the 2,800,247,921-byte APK");
  assert.equal(CHOICES[2].link, null, "PLAY ONLINE plays here");
});

test("main.js opens it before the welcome page, after the first screens start loading", () => {
  const main = source("js/main.js");
  assert.match(main, /if \(homeDue\(q\)\) await openHome\(ui\);[^\n]*\n  if \(welcomeDue\(q\)\) await openWelcome\(ui\);/);
  assert.ok(main.indexOf("preload.startup(") < main.indexOf("await openHome(ui)"), "the game loads while the page is read");
});

test("built from the game's art as the welcome page is", () => {
  const home = source("js/home.js");
  for (const art of ["MODEPNL_PARTS_JA/modepanel_window", "CONF_PARTS_JA/config_innerbg", "TITLE_PARTS_JA/title_bg1", "TITLE_PARTS_JA/title_titlelog"]) assert.ok(home.includes(art), art);
  assert.match(home, /quickBarArt\(CHOICES\.map/);
  assert.match(source("touch.css"), /html\.touch \.modepanel\.hm \{ height: 150px;/);
});
