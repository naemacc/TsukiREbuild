// The language switch: English (the translation) or Japanese (the original game), web/app/js/lang.js, langsave.js, and the Japanese text's rows
// (web-dev/tools/build_ja.py, web-dev/data/ja_rows.json). The last tests read the generated files when they are there.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const store = (init = {}) => ({ s: { ...init }, getItem(k) { return this.s[k] ?? null; }, setItem(k, v) { this.s[k] = String(v); } });
globalThis.localStorage = store();
const { LANGS, langOf, storedLang, chooseLang, asset, setOwn, has, LANG } = await import("../../web/app/js/lang.js");
const { mapPc, carryPoint, noteLine } = await import("../../web/app/js/langsave.js");
const { ROW, SOFT, parseMarkup, plain } = await import("../../web/app/js/textbox.js");

const ASSETS = new URL("../../web/assets/", import.meta.url);
const read = (rel) => JSON.parse(readFileSync(new URL(rel, ASSETS), "utf8"));
const there = (rel) => existsSync(new URL(rel, ASSETS));

test("the language is English unless Japanese was chosen; the address can name one for a visit", () => {
  assert.deepEqual(LANGS, ["en", "ja"]);
  assert.equal(LANG, "en");
  assert.equal(storedLang(store()), "en");
  assert.equal(storedLang(store({ "tsuki.lang": "ja" })), "ja");
  assert.equal(storedLang(store({ "tsuki.lang": "fr" })), "en");
  assert.equal(langOf("?lang=ja", store()), "ja");
  assert.equal(langOf("?lang=en", store({ "tsuki.lang": "ja" })), "en");
  assert.equal(langOf("?lang=xx&mute", store({ "tsuki.lang": "ja" })), "ja");
  const s = store();
  assert.equal(chooseLang("ja", s), true);       // another language than this page's: it is loaded again
  assert.equal(s.s["tsuki.lang"], "ja");
  assert.equal(chooseLang("en", s), false);
  assert.equal(chooseLang("de", s), false);
  assert.equal(s.s["tsuki.lang"], "en");
});

test("a file Japanese has of its own is asked for under ja/, every other where it always was", () => {
  setOwn([]);
  assert.equal(asset("/assets/ui/TITLE_PARTS_JA/title_bg1.webp"), "/assets/ui/TITLE_PARTS_JA/title_bg1.webp");
  setOwn(["text.json", "scripts/5.json", "ui/CONF_PARTS_JA/system_bg.webp"]);
  assert.equal(has("text.json"), true);
  assert.equal(asset("/assets/text.json"), "/assets/ja/text.json");
  assert.equal(asset("/assets/scripts/5.json"), "/assets/ja/scripts/5.json");
  assert.equal(asset("/assets/scripts/6.json"), "/assets/scripts/6.json");
  assert.equal(asset("/assets/ui/CONF_PARTS_JA/system_bg.webp"), "/assets/ja/ui/CONF_PARTS_JA/system_bg.webp");
  assert.equal(asset("/js/main.js"), "/js/main.js");
  setOwn([]);
});

test("a corrected file is asked for at an address no browser has kept (REVISED)", () => {
  setOwn([]);
  // IMG0316 was corrected after the site served it, so it carries a number; its neighbours do not.
  assert.equal(asset("/assets/img/IMG0316.avif"), "/assets/img/IMG0316.avif?v=2");
  assert.equal(asset("/assets/img/IMG0317.avif"), "/assets/img/IMG0317.avif");
  // the mark follows the file into Japanese's own copy of that path
  setOwn(["img/IMG0316.avif"]);
  assert.equal(asset("/assets/img/IMG0316.avif"), "/assets/ja/img/IMG0316.avif?v=2");
  setOwn([]);
});

test("ROW is a row break on the page, no letter, and nothing in plain text", () => {
  const line = `「あ${ROW}い<漢|かん>${ROW}<字|じ>」`;
  assert.equal(plain(line), "「あい漢字」");
  const parts = parseMarkup(line);
  assert.equal(parts[0].t, `「あ${ROW}い`);
  assert.deepEqual([parts[1].base, parts[1].ruby], ["漢", "かん"]);
  assert.equal(plain(`a${SOFT}b`), "a b");
});

// ---- a save made in the other language ---------------------------------------------------------------------------------------------
// The translation's script and the original's for the same stretch: the original's glued line is the translation's MSAD, its "@k@e" a wait.
const en = { ops: [["PGST", "1"], ["WKAD", "F823", "1"], ["MSG", "$000010@n"], ["WTTM", "4158", "1"], ["MSAD", "$000011"], ["WKAD", "F823", "1"], ["MSG", "$000012"],
  ["ATSV", "1"], ["SELR", "0", "$000020"], ["SELR", "1", "$000021"], ["SELD", "_D000", "1"], ["MSG", "$000013"]] };
const ja = { ops: [["PGST", "1"], ["WKAD", "F823", "1"], ["MSG", "$000010@k@e"], ["WKAD", "F823", "1"], ["MSG", "@x$000011"], ["WKAD", "F823", "1"], ["MSG", "$000012"],
  ["ATSV", "1"], ["SELR", "0", "$000020"], ["SELR", "1", "$000021"], ["SELD", "_D000", "1"], ["MSG", "$000013"]] };
const texts = { $000020: "はい", $000021: "いいえ" };

test("a command is found again by the line nearest to it", () => {
  assert.equal(mapPc(en, ja, 6), 6);          // the same message
  assert.equal(mapPc(en, ja, 8), 8);          // the first choice row, after the scene's point
  assert.equal(mapPc(en, ja, 10), 10);        // the choice itself: no line of its own, the rows before it
  assert.equal(mapPc(en, ja, 4), 4);
  assert.equal(mapPc(ja, en, 3), 3);          // the command after the line before: what follows it differs in the two (a row count, a wait)
});

test("a record waiting at a line runs that line again in the other script", () => {
  // waiting after the translation's MSAD (pc 5): the original shows that line with its glued message
  const a = carryPoint({ script: 3, pc: 5, waiting: true, html: "<span>English</span>", page: ["English"], vars: { F823: 1 } }, en, ja, (t) => texts[t], "ja");
  assert.deepEqual([a.pc, a.msgStart, a.waiting, a.html, a.lang], [4, true, false, "", "ja"]);
  // and back: waiting after the original's glued message (pc 5) is the translation's MSAD
  const b = carryPoint({ script: 3, pc: 5, waiting: true, html: "x", page: ["x"], lang: "ja" }, ja, en, (t) => t, "en");
  assert.deepEqual([b.pc, b.msgStart, b.waiting, b.lang], [4, true, false, "en"]);
  // a message about to run stays one
  const c = carryPoint({ script: 3, pc: 2, msgStart: true, waiting: false, html: "" }, en, ja, (t) => t, "ja");
  assert.deepEqual([c.pc, c.msgStart], [2, true]);
});

test("a choice keeps its place and takes its rows' words from the script", () => {
  const s = { script: 3, pc: 10, choices: [{ value: 0, text: "Yes", locked: false }, { value: 1, text: "No", locked: true }], html: "<span>Q</span>", page: ["Q"] };
  const c = carryPoint(s, en, ja, (t) => texts[t], "ja");
  assert.equal(c.pc, 10);
  assert.deepEqual(c.choices, [{ value: 0, text: "はい", locked: false }, { value: 1, text: "いいえ", locked: true }]);
  assert.equal(c.html, "<span>Q</span>");
});

test("a scene's point keeps its place", () => {
  const c = carryPoint({ script: 3, pc: 8, waiting: false, html: "", page: [] }, en, ja, (t) => t, "ja");
  assert.deepEqual([c.pc, c.msgStart], [8, undefined]);
});

// ---- the generated files -----------------------------------------------------------------------------------------------------------
test("the system and picture tables are the shared ones with Japanese's few entries laid over them, never replaced by them", () => {
  const vm = readFileSync(new URL("../../web/app/js/vm.js", import.meta.url), "utf8");
  const shared = vm.match(/const shared = new Set\((\[[^\]]*\])\);/);
  assert.ok(shared, "vm.js names the tables read from the shared files");
  assert.deepEqual(JSON.parse(shared[1]).sort(), ["images", "system"]);
  assert.match(vm, /if \(has\("images\.json"\)\) Object\.assign\(this\.gfx\.images, await fetch\("\/assets\/ja\/images\.json"\)/);
  assert.match(vm, /Object\.assign\(this\.system, \(await systemOver\) \|\| \{\}\);/);
  if (there("ja/images.json")) {
    const base = read("images.json"), over = read("ja/images.json");
    assert.ok(Object.keys(over).length < Object.keys(base).length / 10, "ja/images.json is an overlay, not a table of its own");
    for (const k of Object.keys(over)) assert.ok(k in base, `${k}: a picture the shared table has`);
  }
});

test("Japanese's help bar has a label for every number its screens name, as English has, each cut whole from its sheet", { skip: !there("ja/system.json") }, () => {
  const en = read("system.json").help, ja = read("ja/system.json").help;
  const wanted = 1 + Math.max(...ja.screens.flat().filter(([kind]) => kind === 1).map(([, id]) => id));
  assert.equal(en.labels.length, wanted);
  assert.equal(ja.labels.length, wanted, "a word cut in two would shift every label after it (ロード, データコピー, 拡大・縮小)");
  assert.deepEqual(ja.labels[8], [84, 42, 149, 71], "ロード is one label");
  assert.deepEqual(ja.labels[24], [255, 186, 370, 216], "拡大・縮小 is one label");
});

test("a save's note is found again by its line, so the save screen shows it in the language in use", () => {
  const ops = [["MSG", "$000010@n"], ["WKAD", "F823", "1"], ["MSG", "$000011^$000012@k@e"], ["ATSV"], ["STCH", "1", "img0001"]];
  assert.equal(noteLine({ pc: 2, waiting: true }, ops), 10);          // waiting after the first line
  assert.equal(noteLine({ pc: 2, msgStart: true }, ops), 12);         // about to run a glued message: its newest piece
  assert.equal(noteLine({ pc: 3, waiting: true }, ops), 12);
  assert.equal(noteLine({ pc: 5 }, ops), 12);                          // a scene's point: the nearest line before it
  assert.equal(noteLine({ pc: 0 }, ops), null);
  const en = [["MSG", "$042770@n"], ["MSAD", "$042771"], ["WKST", "F823", "eq", "0"], ["MSG", "$042772"]];
  assert.equal(noteLine({ pc: 0, msgStart: true }, en), 42771, "the translation's glued piece, which the record's note shows");
  const vm = readFileSync(new URL("../../web/app/js/vm.js", import.meta.url), "utf8"), ui = readFileSync(new URL("../../web/app/js/ui.js", import.meta.url), "utf8");
  assert.match(vm, /async noteIn\(s\) \{\n    if \(!s \|\| \(s\.lang \|\| "en"\) === LANG\) return s\?\.note \|\| "";/);
  assert.match(ui, /if \(\(rec\.lang \|\| "en"\) !== LANG && this\.vm\?\.noteIn\) this\.vm\.noteIn\(rec\)/);
});

test("Japanese has its own text, scripts and tables, listed in ja/index.json", { skip: !there("ja/index.json") }, () => {
  const files = new Set(read("ja/index.json").files);
  for (const f of ["text.json", "system.json", "gallery.json", "flowchart.json", "fonts/TsukuMin.ttf"]) assert.ok(files.has(f), f);
  const ja = read("ja/text.json"), en = read("text.json");
  assert.equal(ja.length, en.length);                         // the same lines, by the same numbers
  assert.equal(ja[0].replaceAll(ROW, ""), "　誰も彼も眠った頃、夜の冷気で瞼を開ける。");
  // a row is 28 cells; a letter the row's rules let hang makes it 29 (a narrow letter is half a cell)
  const cells = (row) => [...row.replace(/<([^|>]*)\|[^>]*>/g, "$1").replace(/\[[a-z]+\d*\]/g, "□").replace(/@[a-z]\d?/g, "")].reduce((n, c) => n + (c.charCodeAt(0) < 0x100 ? 0.5 : 1), 0);
  let rows = 0, over = 0;
  for (const line of ja) for (const part of line.split("^")) { const r = part.split(ROW); if (r.length > 1) for (const row of r.slice(0, -1)) { rows++; if (cells(row) > 29) over++; } }
  assert.ok(rows > 13000, String(rows));
  assert.ok(over <= 6, `${over} rows longer than 29 cells`);   // (a run of dashes is never cut: a few rows carry one past the edge)
  const sys = read("ja/system.json");
  assert.equal(sys.messages["178"], "セーブしますか？");
  assert.equal(read("ja/flowchart.json").groups[0].parts[0].title, "硝子の月");
});

test("every line a Japanese script shows is one the translation's script shows, so a save carries both ways", { skip: !there("ja/index.json") }, () => {
  const names = read("scripts/index.json").names;
  const own = read("ja/index.json").files.filter((f) => /^scripts\/\d+\.json$/.test(f)).map((f) => Number(f.match(/\d+/)[0]));
  assert.ok(own.length > 200 && own.length < names.length, String(own.length));
  const ids = (op) => ((op[0] === "MSG" || op[0] === "MSAD") ? [...(op[1] || "").matchAll(/\$(\d+)/g)].map((m) => Number(m[1])) : []);
  let checked = 0;
  for (const i of own.filter((_, k) => k % 6 === 0)) {
    const a = read(`scripts/${i}.json`), b = read(`ja/scripts/${i}.json`);
    assert.equal(a.name, b.name);
    const shown = new Set(b.ops.flatMap(ids));
    let missing = 0;
    a.ops.forEach((op, at) => {
      const line = ids(op)[0];
      if (line === undefined) return;
      if (!shown.has(line)) { missing++; return; }
      // waiting at the translation's message: the original's message that shows the line, run again
      const there2 = carryPoint({ script: i, pc: at + 1, waiting: true, html: "x", page: ["x"] }, a, b, (t) => t, "ja");
      assert.ok(there2.msgStart && ids(b.ops[there2.pc]).includes(line), `${a.name} line ${line}`);
      // and back: the translation's message for that message's first line
      const back = carryPoint({ ...there2, lang: "ja" }, b, a, (t) => t, "en");
      assert.ok(ids(a.ops[back.pc]).includes(ids(b.ops[there2.pc])[0]), `${a.name} line ${line} back`);
      checked++;
    });
    assert.ok(missing <= 2, `${a.name}: ${missing} lines the original does not show`);
    if (b.rows) for (const [op, texts] of Object.entries(b.rows)) {
      const ids = [...b.ops[Number(op)][1].matchAll(/\$(\d+)/g)];
      assert.equal(ids.length, texts.length, `${b.name} op ${op}`);
    }
  }
  assert.ok(checked > 3000, String(checked));
});
