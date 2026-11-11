// Every font stack ends in a backup that ships with the page (web/app/fonts), after the system fonts it names, so text never falls to a generic face.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";

const app = (name) => new URL(`../../web/app/${name}`, import.meta.url);
const source = (name) => readFileSync(app(name), "utf8");
const BACKUPS = ["Gelasio Bundled", "Arimo Bundled", "PT Sans Narrow Bundled", "Ubuntu Condensed Bundled", "Ubuntu Bundled", "Chorus Bundled", "Pagella Bundled"];

test("each backup is declared with a file that is there, and its licence beside it", () => {
  const css = source("style.css");
  const faces = [...css.matchAll(/@font-face \{ font-family: "([^"]+)"; src: url\("fonts\/([^"]+)"\)/g)].map((m) => [m[1], m[2]]);
  for (const name of BACKUPS) assert.ok(faces.some(([f]) => f === name), `${name} declared`);
  for (const [, file] of faces) {
    assert.ok(existsSync(app(`fonts/${file}`)), file);
    assert.ok(statSync(app(`fonts/${file}`)).size < 120_000, `${file}: Latin only, small`);
  }
  for (const licence of ["Gelasio-OFL.txt", "Arimo-OFL.txt", "PTSansNarrow-OFL.txt", "Ubuntu-UFL.txt", "TeXGyre-GUST-FONT-LICENSE.txt", "Inter-OFL.txt"]) assert.ok(existsSync(app(`fonts/${licence}`)), licence);
});

test("every stack that names a system font ends in a backup before the generic face, after the system fonts it lists", () => {
  const systemFirst = /^(Georgia|Helvetica|"Apple Chancery"|"Hoefler Text"|"PT Sans Narrow"|"Ubuntu Condensed"|"Ubuntu"|"Eurostile")/;
  const stacks = [];
  for (const f of ["style.css", "touch.css"]) {
    for (const m of source(f).matchAll(/(?:font-family:|font:[^;"]*?\d+px(?:\/\d+px)?)\s*([^;}]+)/g)) stacks.push([f, m[1].trim()]);
  }
  for (const f of ["js/ui.js", "js/confart.js", "js/flowchart.js", "js/welcome.js"]) {
    for (const m of source(f).matchAll(/'([^']*(?:Georgia|Helvetica|Chancery|Hoefler|Narrow|Ubuntu|Eurostile)[^']*)'/g)) stacks.push([f, m[1].replace(/^\d+px /, "")]);
  }
  let checked = 0;
  for (const [file, stack] of stacks) {
    if (!systemFirst.test(stack)) continue;
    checked++;
    const names = stack.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
    const backup = names.findIndex((n) => n.endsWith(" Bundled") || n === "Inter");
    assert.ok(backup > 0, `${file}: ${stack} has a backup`);
    assert.ok(!["serif", "sans-serif", "system-ui"].some((g) => names.indexOf(g) >= 0 && names.indexOf(g) < backup), `${file}: ${stack}: the backup comes before the generic face`);
  }
  assert.ok(checked >= 20, `${checked} stacks`);
});

test("the backups are only backups: their names are their own, never an installed font's", () => {
  const css = source("style.css");
  for (const m of css.matchAll(/@font-face \{ font-family: "([^"]+)"; src: url\("fonts\//g)) assert.ok(m[1] === "Inter" || m[1].endsWith(" Bundled"), m[1]);
  assert.match(css, /--story-font: Georgia, "Times New Roman", "Gelasio Bundled", serif;/);
  assert.match(css, /--flow-font: Helvetica, Arial, "Arimo Bundled", sans-serif;/);
});

test("letters drawn on canvases wait for a backup only where the system has none of the stack's fonts", () => {
  const main = source("js/main.js");
  assert.match(main, /const CANVAS_FONTS = \[/);
  for (const b of ['"Gelasio Bundled"', '"PT Sans Narrow Bundled"', '"Arimo Bundled"']) assert.ok(main.includes(b), b);
  assert.match(main, /const wanted = CANVAS_FONTS\.filter\(\(f\) => !f\.system\.some\(installedFont\)\)\.map\(\(f\) => f\.backup\);/);
  assert.ok(main.indexOf("const wanted = CANVAS_FONTS") < main.indexOf("ui.buildPanel();"), "before the plates are drawn");
  assert.match(main, /new Promise\(\(r\) => setTimeout\(r, 3000\)\)/, "never more than 3 s");
});
