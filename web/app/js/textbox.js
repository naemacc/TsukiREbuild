// textbox.js - dialogue shown a line at a time over the picture, on a full page that clears when the page ends.
const el = () => document.getElementById("text");
const panel = () => document.getElementById("panel");
// Italics: U+E000 plus the ASCII code (the game font's slanted letters at U+E021-E07E). Written as escapes: the raw
// private-use characters had been lost from this file, leaving the ranges empty, so italics showed as missing glyphs.
// Mirrored letters: U+E080 or U+E100 plus the ASCII code, a line seen in a mirror, stored back to front; the game font
// draws each letter flipped. The port draws the ASCII letter in the story font, flipped (.ch.mirror), in the same order.
const unitalic = (s) => s.replace(/[\uE020-\uE07E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xE000));
// The archaic serif italic (U+E180 plus the ASCII code) has a calligraphic face of its own (.archaic), apart from the
// ordinary italics; the upside-down letters (U+E280
// plus it, in reading order; the game font flips each top to bottom: b shows as p) are its letters flipped (.ch.flip).
// The kind of a character and its ASCII letter: "i" italic, "a" archaic, "m" mirrored, "mi" mirrored italic, "u"
// upside down, "s" the exponent, "" as it is. The banks are the patch's own (Tsukihime-Translation
// tools/add_font_effects.py, 128 code points each from U+E000): 0 italic (a 0.3 rad slant), 1 mirrored, 2 mirrored and
// italic, 3 the fancy face, 4 single custom glyphs, 5 upside down. The story's mirrored lines are all in bank 2.
function letterOf(ch) {
  const c = ch.charCodeAt(0);
  if (c >= 0xE020 && c <= 0xE07E) return ["i", String.fromCharCode(c - 0xE000)];
  if (c >= 0xE0A0 && c <= 0xE0FE) return ["m", String.fromCharCode(c - 0xE080)];
  if (c >= 0xE120 && c <= 0xE17E) return ["mi", String.fromCharCode(c - 0xE100)];
  if (c >= 0xE1A0 && c <= 0xE1FE) return ["a", String.fromCharCode(c - 0xE180)];
  if (c >= 0xE2A0 && c <= 0xE2FE) return ["u", String.fromCharCode(c - 0xE280)];
  if (c === 0xE200) return ["s", "\u221235"];   // the game font's raised "-35" ("10^-35 m"), drawn as a superscript
  return ["", ch];
}

// Inline graphic tags. Native 0xa7ed8 looks a tag up in the 39 names at 0xac06c0 and 0xa7f30 swaps it for a
// character of the game font (table 0xac07f8). [ber00] and [zap00] become placeholders that the text renderer covers
// with a strip of DISP_PARTS_JA/bf_with_edge68x68_2: a run of n tags takes the strip n cells long (rows 0-20 are the
// "ber" noise bars for runs of 1-21, rows 21-28 the "zap" scribbles for runs of 1-8; cells are 68 x 68).
export const GLYPH_ROWS = { ber: [0, 21], zap: [21, 8] };
// A line break of the patch's that reflow.js took out (a space on screen). The game's text keeps the raw line feed there, a code
// point below 0x20 that the typing does not count (0xbd990-0xbd9a0), so the port's space is no letter either (N2-122).
export const SOFT = "\uE3FF";
const GLYPH_TAG = /^\[(ber|zap)\d\d\]/;

// The translation spaces its ruby out for the engine's monospaced ruby, which set the letters too close together and
// too far right (Tsukihime-Translation Editing_Guidelines.md: a space after every letter, a real space as two, spaces
// added at the end to move it left). The port's ruby is proportional and centred, so that is undone: "p r e y  " is
// "prey", "T h e  s t a r s   t w i n k l e" is "The stars twinkle". Ruby that is not spaced out stays as it is.
export function unspaceRuby(r) { return rubyLetters(r).text; }
// The same, with where each letter kept sat in the reading as written (`at`) and the reading's length there (`len`, its padding
// included): the game types the reading as written, spaces and padding too, across its base (0xc0684), so a letter comes in when
// the front has covered at / len of the base (TODO item 51: "w o r l d   " over "place" has its "d" at 8 of 12, not 4 of 5).
export function rubyLetters(r) {
  const raw = [...r], len = raw.length;
  const s = r.replace(/\s+$/, "");
  if (!/^\S( +\S)+$/.test(s) || /\S\S/.test(s)) return { text: s, at: [...s].map((_, k) => k), len };
  let text = "";
  const at = [];
  const cut = [...s];
  for (let k = 0; k < cut.length; k++) {
    if (cut[k] !== " ") { text += cut[k]; at.push(k); continue; }
    let e = k;
    while (cut[e + 1] === " ") e++;
    if (e > k) { text += " "; at.push(k); }   // a gap of two or more is a real space
    k = e;
  }
  return { text, at, len };
}

// Runs of two or more dashes, U+2015, U+2014 or U+2500 in any mix (0xbdc2c: 0x3c99aa, 0x3c99ae, 0x3c99b2), are one solid line
// in the game: code 0xd, the count, one dash glyph, code 6 (the translation writes "―――" for lead-ins and cut-off
// speech and "――" for dashes, Editing_Guidelines.md; 89 runs of U+2014 too, N2-119). Host fonts leave a gap between them. A
// run is one element (.dashrun, one text node, its dashes all U+2015), so its shadow is painted once under the whole line
// rather than each dash's shadow over the end of the dash before it, and its dashes are drawn closer by the gap plus a
// little (a solid overlap, so no anti-aliased seam shows): the font's advance less the dash's ink, measured on a canvas
// for the element's font and kept as --dash-join (and --dash-end, which gives the run's last dash its advance back).
// A run of two or more U+25A0 (0x3c99bc) is likewise one glyph stretched over the run, the censored words' bar (N2-22):
// .blockrun, BLOCK_CELL em a square (47 px on the game's 40 px face, measured on a native frame: 141 px for three).
// Each run is one letter for the typing (0xbd990-0xbd9a0 counts the one glyph, N2-118).
const dashGaps = new Map();
export const BLOCK_CELL = 47 / 40;
export function dashJoin(m) {
  const ink = (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || m.width);
  return Math.max(0, m.width - ink) + Math.max(2, 0.12 * ink);
}
export function setDashJoin(node) {
  if (typeof document === "undefined" || !node) return;
  // the font only changes with the element's class, so measure again only then
  if (node.dataset.dashFor === node.className && node.style.getPropertyValue("--dash-join")) return;
  node.dataset.dashFor = node.className;
  const cs = getComputedStyle(node);
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  let v = dashGaps.get(font);
  if (v === undefined) {
    const g = document.createElement("canvas").getContext("2d");
    g.font = font;
    v = dashJoin(g.measureText("―")).toFixed(2);
    dashGaps.set(font, v);
  }
  node.style.setProperty("--dash-join", `-${v}px`);
  node.style.setProperty("--dash-end", `${v}px`);
}
const RUN = /([―—─]{2,}|■{2,})/;
// The text split into plain pieces and runs of two or more dashes or blocks.
export function dashRuns(text) {
  return text.split(RUN).filter((s) => s);
}
export const isRun = (piece) => RUN.test(piece) && piece.length === piece.match(RUN)[0].length;
// A run's element: one line of dashes, or the block bar.
export function runElement(piece, cls = "") {
  const s = document.createElement("span");
  if (piece[0] === "■") {
    s.className = `${cls}blockrun`;
    s.style.width = `${piece.length * BLOCK_CELL}em`;
  } else {
    s.className = `${cls}dashrun`;
    s.textContent = "―".repeat(piece.length);
  }
  return s;
}
// Plain text with its dash and block runs joined (the backlog).
export function appendJoined(parent, text) {
  for (const piece of dashRuns(text)) {
    parent.appendChild(isRun(piece) ? runElement(piece) : document.createTextNode(piece));
  }
}

// The colour marks of a message, as the text object reads them (native 0xbdc2c): @c1-@c5 are the colours of the table
// at 0x3c99d2 (#text .color1-5), @c6-@c9 the outlined face with a red, dark grey, black or white outline (0x34dcb0,
// .edge6-9), and @r goes back to the message's own colour. 0xa7f60 picks how they apply: when a colour mark comes after
// visible text (spaces, U+3000 and other marks are not), or @r after a colour mark, each colour runs from its mark to
// the next (0xc3c24 colours letter by letter); otherwise the last colour mark colours the whole message. Returns the text
// with the marks that change colour part way, as @c1-@c5 and @c0 for the message's own colour, the whole message's
// colour, and the outline (6-9, or 0).
export function colourMarks(s) {
  let byLetter = false, seen = false, last = 0;
  for (let i = 0; i < s.length && !byLetter; i++) {
    const c = s[i];
    if (c === "@") {
      const m = s[++i];
      if (m === "c") {
        const d = s[++i] || "";
        if (d >= "1" && d <= "5") { last = Number(d); byLetter = seen; }
      } else if (m === "r" && last) byLetter = true;
    } else if (c !== " " && c !== "　" && c !== SOFT) seen = true;
  }
  let text = "", color = 0, edge = 0;
  for (let i = 0; i < s.length; i++) {
    const m = s[i] === "@" ? s[i + 1] : "";
    if (m === "c") {
      const d = s[i + 2] || "";
      i += 2;
      if (d >= "6" && d <= "9") edge = Number(d);
      else if (d >= "1" && d <= "5") { if (byLetter) text += `@c${d}`; else color = Number(d); }
      else if (byLetter) text += "@c0";
    } else if (m === "r") {
      i += 1;
      if (byLetter) text += "@c0";
    } else text += s[i];
  }
  return { text, color, edge };
}

// Markup of a line of the game's text: <base|ruby>, @g (the rest of the text in the game's second face, which the patch made
// italic: ASCII letters slanted 0.31, N2-20), [name00] (inline marks), and the colour
// runs colourMarks leaves in a message (@c0-@c5: the parts after it carry `col`, 0 being the message's own colour).
// The translation writes italics as U+E000 plus the ASCII code of each letter ({t, i}) and mirrored letters as U+E100
// (or U+E080) plus it ({t, m}, in the stored order), the archaic serif as italics, upside-down letters ({t, u}) and
// the one exponent (U+E200) as superscript digits: all in the story font, none from the game font, whose glyphs
// overlap in the port's layout.
export function parseMarkup(s) {
  const out = [];
  let i = 0;
  let buf = "";
  let col = 0;
  let lf = 0;
  let gface = false;   // @g: code 0x14 once, 0x15 at the end of the text (0xbdc2c), so to the end of this text
  const tint = (p) => (col ? { ...p, col } : p);
  const flush = () => { if (buf) { out.push(tint({ t: buf })); buf = ""; } };
  while (i < s.length) {
    const c = s[i];
    if (c === "@" && s[i + 1] === "c" && s[i + 2] >= "0" && s[i + 2] <= "5") {
      flush();
      col = Number(s[i + 2]);
      i += 3;
      continue;
    }
    if (c === "<") {
      const end = s.indexOf(">", i);
      const bar = s.indexOf("|", i);
      if (end > 0 && bar > i && bar < end) {
        flush();
        out.push(tint({ base: s.slice(i + 1, bar), ruby: s.slice(bar + 1, end) }));
        i = end + 1;
        continue;
      }
    }
    if (c === "[") {
      const g = GLYPH_TAG.exec(s.slice(i));
      if (g) {
        // a run of the same tag is one strip
        let n = 0;
        while (s.startsWith(g[0], i)) { n++; i += g[0].length; }
        const [, max] = GLYPH_ROWS[g[1]];
        flush();
        for (let left = n; left > 0; left -= max) out.push(tint({ glyph: g[1], n: Math.min(max, left) }));
        continue;
      }
      const end = s.indexOf("]", i);
      if (end > 0 && /^\[[a-z]{2,6}\d{0,3}\]$/.test(s.slice(i, end + 1))) {
        // other tags are characters of the game font that host fonts do not have
        buf += "―";
        i = end + 1;
        continue;
      }
    }
    // @t: the two parts of the line type side by side (native 0xbdc2c keeps its letter index, 0xc0684 types from it).
    // That index counts the patch's raw line breaks before the mark, which are no letters on screen: `lf`.
    if (c === "@" && s[i + 1] === "t") { flush(); out.push({ split: true, lf }); i += 2; continue; }
    if (c === "@" && s[i + 1] === "g") { flush(); gface = true; i += 2; continue; }
    if (c === "@" && s[i + 1] === "k") { i += 2; continue; }
    // ^ is the game's own line break (0xbdc2c emits code 10 for it, counting no letter); a raw line break, the patch's
    // %{n} and its injector's wraps, goes through as a character (counted, laid out as code 10, typed as nothing)
    if (c === "\n" || c === SOFT) lf++;
    buf += c === "^" ? "\n" : c;
    i++;
  }
  flush();
  const res = [];
  for (const p of out) {
    if (p.glyph || p.split) { res.push(p); continue; }
    if (p.t === undefined) {
      if (gface) p.g = true;
      // ruby written in italic letters (the cicada's "chiiiirp") stays italic
      p.rubyItalic = /[-]/.test(p.ruby) && !/[^-\s]/.test(p.ruby);
      p.base = unitalic(p.base);
      const reading = rubyLetters(unitalic(p.ruby));
      p.ruby = reading.text;
      p.rubyAt = reading.at;
      p.rubyLen = reading.len;
      res.push(p);
      continue;
    }
    let run = "", kind = "";
    const tinted = (q) => (p.col ? { ...q, col: p.col } : q);
    const push = () => {
      if (run) res.push(tinted(kind === "m" || kind === "mi" ? { t: run, i: false, m: true, it: kind === "mi" || gface } : kind === "u" ? { t: run, i: false, u: true }
        : kind === "s" ? { t: run, i: false, s: true } : kind === "a" ? { t: run, i: false, a: true } : { t: run, i: kind === "i" || gface }));
      run = "";
    };
    for (const ch of p.t) {
      let [k, letter] = letterOf(ch);
      // a mirrored or archaic line's spaces belong to it (a mirrored one then reverses as a whole)
      if (ch === " " && (kind === "m" || kind === "mi" || kind === "a")) k = kind;
      if (k !== kind) { push(); kind = k; }
      run += letter;
    }
    push();
  }
  return res;
}

// Plain text (the backlog, measuring): a mirrored run reads the right way round there.
export function plain(s) {
  const sup = { "\u2212": "\u207B", 3: "\u00B3", 5: "\u2075" };
  return parseMarkup(s).map((p) => p.split ? "" : p.glyph ? "―".repeat(p.n) : p.m ? [...p.t].reverse().join("")
    : p.s ? [...p.t].map((c) => sup[c] ?? c).join("") : p.t ?? p.base).join("").replaceAll(SOFT, " ");
}

// ---- the window's rates (native 0x38d40 each frame) -------------------------------------------------------------
// Every story start runs 0x2e170(0x80) (0x40d70, 0x40e4c, the reset 0x82980; nothing else writes 0x572b50): the panel
// opens and closes at 16.667 / 128 = 0.1302 a frame, 7.7 frames. The 0.06 in the image is only the value before the
// first story starts. CLO3's quick close is exactly twice it (0.26041666).
export const WINDOW_RATE = (1000 / 60) / 128;
export const FAST_CLOSE_RATE = 0.26041666;

// ---- typing (native 0x81b30 moves the front, 0xc0684 draws the letters) ----------------------------------------------
// The front moves 16.667 / speed letters a frame (0x3b2d0: speed is config +0xe, or +0x10 for read text; 768 at speed
// 0). Letter i is drawn at min(front - i, 1), so each letter fades in over exactly one letter interval and the next
// starts as it becomes whole; with "Insta display" (config +0x61, flag 0x400000 -> object flag 0x20, 0xab710) a letter
// shows whole as soon as the front passes it. 0x3b330's longer value only sets a trailing front nothing draws with.
// The letters are every character the line prints, spaces too; line breaks are none. Measured on the native build
// (2026-11-07, text speed 250 ms, frames every 5 presents): "I walk to school a little slower than usual." took 44
// letter intervals, its 8 spaces included, and in "...the grounds, it's\nalmost seven o'clock." the "a" after the raw
// break came one interval after the "s" before it.
export function charFadeMs(speed) { return speed > 0 ? speed : 0; }
export const lettersPerFrame = (speed) => (speed > 0 ? (1000 / 60) / speed : 768);
// The front after dt frames. The game keeps it in single precision and adds 16.666668 / speed once a frame (0x81b30, 0x3b2d0), so
// whole frames are added the same way here: at 250 ms a letter fifteen steps come to exactly 1, which is not yet past letter 1, and
// the second letter shows on the sixteenth frame (native frames, TODO item 51). A fraction of a frame is added as it is.
// `base`: the letters the line had before this part. The game's front is one number for the whole line, so an MSAD's part goes on from
// the old count + 1 and its steps are rounded at that size: the port keeps the part's own front, rounded as the line's would be (item
// 146: at 50 ms a letter the third added letter comes on the third frame; a front counted from 1 brought it on the fourth).
const FRAME_MS = Math.fround(16.666668);
export function advanceFront(front, dt, speed, base = 0) {
  if (!(speed > 0)) return 768;
  if (front >= 768) return front;
  const n = Math.round(dt);
  if (n >= 1 && Math.abs(dt - n) < 1e-6) {
    const step = Math.fround(FRAME_MS / speed);
    let x = Math.fround(base + front);
    for (let i = 0; i < n && x - base < 768; i++) x = Math.fround(x + step);
    return x - base;
  }
  return front + dt * lettersPerFrame(speed);
}
// Where a line's typing ends: one letter past its last (native frames at 100 and 250 ms a letter, both text displays: the wait
// mark, or the next line of an @e line, comes a letter interval after the last letter began plus the one it takes itself), or the
// @t mark of a line typed in two parts (0xc0684 takes the front to the end there).
export const typingEnd = (n, t = 0) => (t > 0 && t < n ? t : n + 1);
// A line with @t (three lines) types its two parts side by side (0xc0684, listing 0xc0840-0xc09d0). t is the parser's
// letter index at the mark (0xbdc2c +0x18d90), which also counts the patch's raw line breaks; n is the letters drawn
// and L the larger of n - t and t. Letters below t are drawn at min(front - i (n - t) / L, 1), the rest at
// min(front - (i - t) t / L, 1), and the line is done once the front reaches t (the front is then set to n): the
// shorter part keeps the usual pace and the longer one is spread over the same time. Where a raw break comes before the
// mark (23613, 36678) t is one past the second part's first letter, which then comes in with the first part, last.
export function letterAlpha(front, i, n, t = 0, insta = false) {
  let f = front - i;
  if (t > 0 && t < n) {
    const L = Math.max(n - t, t);
    f = i < t ? front - (i * (n - t)) / L : front - ((i - t) * t) / L;
  }
  if (!(f > 0)) return 0;
  return insta ? 1 : Math.min(f, 1);
}
export const typedAt = (n, t = 0) => (t > 0 && t < n ? t : n);

// ---- earlier lines of the page (native 0x391a0) ---------------------------------------------------------------------
// Each earlier line has a timer (F859 + j, which the scripts clear with the page) that counts frames while the window is
// fully shown (F1103 0 and fade 1); the line fades from 255 to 100/255 over T = speed x 1.2 frames, the speed of the line
// after it while that one is current, then stays there (timer -1). A click that finishes the typing sets every earlier
// timer to -1 (0x81b30's memset), so they go dim at once.
export const DIM_TARGET = 100;
export function dimAlpha(timer, T, target = DIM_TARGET) {
  if (timer < 0) return target / 255;
  if (timer === 0) return 1;
  return T > 0 ? 1 - ((255 - target) * timer) / T / 255 : target / 255;
}
// Line j's alpha among the page's lines (the last is the current line): an earlier line that ends in @k takes the
// state of the line that continues it, bright while that is the current line; a second balloon (F1111 >= 3) keeps
// every line at 255.
export function lineAlpha(lines, j, target = DIM_TARGET) {
  const last = lines.length - 1;
  if (j >= last) return 1;
  let m = j;
  if (lines[j].k) {
    if (j === last - 1) return 1;
    m = j + 1;
    while (m < last && lines[m].k) m++;
    if (m >= last) return 1;
  }
  return dimAlpha(lines[m].timer, lines[m].T, target);
}

// The F1110 note (0x391a0's end): while F1110 is 1, a full-screen picture (DISP_PARTS_JA slot 121, texture 69, the
// "Correct spelling: bide" caption of QA_20) comes in at 1/36 a frame once 3,500 ms have passed, and goes the same way
// when F1110 is 0; it is drawn over the window, also while the window is closed.
export const NOTE = { name: "tw___________", delay: 3500, rate: 1 / 36 };

// A line's element on the page: its colour, outline, and whether it goes on the row before (@x).
function newSegment(color = 0, edge = 0, glued = false) {
  const seg = document.createElement("span");
  seg.className = "seg" + (color ? ` color${color}` : "") + (edge ? ` edge${edge}` : "") + (glued ? " glued" : "");
  return seg;
}

// Fills a line's element with its markup, a span a letter (.ch, shown once typed: .on). Returns the letters in typing
// order and the @t mark's letter index (see letterAlpha).
export function fillSegment(seg, markup) {
  const parts = parseMarkup(markup);
  const chars = [];
  const ruby = [];   // the readings, for the typing: {from, to (base letters), letters (the annotation's spans)}
  let t = 0;
  // flip "mirror" / "flip": each letter flipped on its own (left to right / top to bottom), in the order given (words
  // kept whole, so a line does not break inside one: the flipped letters are inline blocks).
  const addChars = (parent, text, flip = "") => {
    let word = null;
    // a run of dashes or blocks is one element and one letter of the typing (0xbdc2c, 0xbd990: N2-118)
    if (!flip && RUN.test(text)) {
      for (const piece of dashRuns(text)) {
        if (isRun(piece)) {
          const s = runElement(piece, "ch ");
          parent.appendChild(s);
          chars.push(s);
        } else addChars(parent, piece);
      }
      return;
    }
    const letters = [...text];
    for (let n = 0; n < letters.length; n++) {
      const ch = letters[n];
      if (ch === "\n") {
        parent.appendChild(document.createTextNode(ch));
        word = null;
        continue;
      }
      // a break the port took out (reflow.js) is a space on screen and no letter of the typing (N2-122)
      if (ch === SOFT) {
        parent.appendChild(document.createTextNode(" "));
        word = null;
        continue;
      }
      // a space is a letter the front passes like any other (it takes its interval), outside a flipped word; a pair of spaces is
      // one U+3000 in the game's text (0xab59c-0xab5ec) and so one letter (N2-117)
      if (ch === " ") {
        const sp = document.createElement("span");
        sp.className = "ch";
        if (letters[n + 1] === " ") { sp.textContent = "  "; n++; } else sp.textContent = ch;
        parent.appendChild(sp);
        chars.push(sp);
        word = null;
        continue;
      }
      const s = document.createElement("span");
      s.className = flip ? `ch ${flip}` : "ch";
      s.textContent = ch;
      if (flip) {
        if (!word) { word = document.createElement("span"); word.className = "mirror-word"; parent.appendChild(word); }
        word.appendChild(s);
      } else parent.appendChild(s);
      chars.push(s);
    }
  };
  let box = seg, boxCol = 0;
  for (const p of parts) {
    if (p.split) { t = chars.length + p.lf; continue; }
    const col = p.col || 0;
    if (col !== boxCol) {
      boxCol = col;
      box = seg;
      if (col) { box = document.createElement("span"); box.className = `color${col}`; seg.appendChild(box); }
    }
    if (p.glyph) {
      const [row] = GLYPH_ROWS[p.glyph];
      const g = document.createElement("span");
      g.className = "ch glyph";
      g.style.width = `${p.n}em`;
      g.style.backgroundPosition = `0 ${-(row + p.n - 1)}em`;
      g.textContent = "　".repeat(p.n);
      g.dataset.n = String(p.n);
      box.appendChild(g);
      for (let k = 0; k < p.n; k++) chars.push(g);
    } else if (p.t !== undefined) {
      if (p.i || p.s || p.a) {
        const em = document.createElement(p.i ? "i" : p.s ? "sup" : "span");
        if (p.a) em.className = "archaic";
        addChars(em, p.t);
        box.appendChild(em);
      } else addChars(box, p.t, p.m ? (p.it ? "mirror italic" : "mirror") : p.u ? "flip" : "");
    } else {
      const r = document.createElement("ruby");
      if (p.g) r.className = "italic";
      const from = chars.length;
      addChars(r, p.base);
      const rt = document.createElement("rt");
      if (p.rubyItalic) rt.className = "italic";
      // the reading's letters fill in across its base (0xc0684, listing 0xc09d4-0xc0ab4: N2-120)
      const letters = [];
      const at = p.rubyAt || [], len = p.rubyLen || [...p.ruby].length;
      [...p.ruby].forEach((ch, k) => {
        const c = document.createElement("span");
        c.className = "ch";
        c.textContent = ch;
        if (c.dataset) c.dataset.at = String(at[k] ?? k);
        rt.appendChild(c);
        letters.push(c);
      });
      if (rt.dataset) rt.dataset.len = String(len);
      r.appendChild(rt);
      box.appendChild(r);
      ruby.push({ from, to: chars.length, letters, at: letters.map((_, k) => at[k] ?? k), len });
    }
  }
  return { chars, t, ruby };
}

// Letter k of a reading over the base letters from..to, with L letters in all: s = (front - from) / (to - from) x L, drawn at
// min(s - k, 1) (0xc0684); once the front has passed the base it is whole. k and L count the reading as the text has it, its
// spaces and padding too (rubyLetters): on native frames at 100 ms a letter the "l" and "d" of "w o r l d   " over "place" came
// 15 and 20 ticks after the "p", 6 x 5 x 6 / 12 and 6 x 5 x 8 / 12, where five letters spread evenly would be at 18 and 24.
export function rubyAlpha(front, from, to, L, k) {
  if (front >= to) return 1;
  if (front <= from || to <= from) return 0;
  return Math.max(0, Math.min(((front - from) / (to - from)) * L - k, 1));
}

// ---- the backlog's records (native ring of 800 snapshots, 0x527a0; listed by 0x27eb0) -----------------------------
// A record per MSG (0x6e0d0 saves one, type 0): its text, the page end WNTY left in F799, the blank rows F847-F858 (the
// backlog reads F847 + row for the row it draws the record on, 0x28470) and whether it goes on the row before (@x,
// 0xa88b0). MSAD saves none: it copies the line into the newest record (0x6e950), so its text joins that record. The
// rows of a choice are records too (SELD, type 0xc, 0x7f78c), the last one a page end.
export const LOG_ROWS = 12;

// Draws a backlog page (records oldest first) into box as the text window drew it (0x28470: up to 12 records a row
// each, from the window's first row, each after its blank rows), every letter shown.
// wrap(record, row): an element of the caller's to hold that record's text (the scrolling log's lines, each its own).
export function renderLogPage(box, records, wrap = null) {
  box.textContent = "";
  setDashJoin(box);
  records.slice(0, LOG_ROWS).forEach((r, row) => {
    const skip = r.skips?.[row] || 0;
    if (skip > 0) box.appendChild(document.createTextNode("\n".repeat(skip)));
    if (row > 0 && !r.glue) box.appendChild(document.createTextNode("\n"));
    const into = wrap ? box.appendChild(wrap(r, row)) : box;
    if (r.kind === "choice") {
      const seg = newSegment();
      fillSegment(seg, r.parts[0].markup);
      into.appendChild(seg);
    } else {
      r.parts.forEach((p, k) => {
        const seg = newSegment(p.color, p.edge, k === 0 && row > 0 && r.glue);
        fillSegment(seg, p.markup);
        into.appendChild(seg);
      });
    }
  });
  for (const c of box.querySelectorAll(".ch")) c.classList.add("on");
}

// Chrome paints a ruby annotation outside the opacity of an inline ancestor, so the annotation of a dimmed line is dimmed on its own
// (the game dims it with its line, 0x391a0).
const BLINK = typeof navigator !== "undefined" && /Chrome\//.test(navigator.userAgent || "");
function dimReadings(seg, v) {
  if (!BLINK) return;
  for (const rt of seg.querySelectorAll("rt")) rt.style.opacity = v;
}

export class TextBox {
  constructor() {
    this.speed = 22;       // ms per letter; 0 shows at once
    this.charFade = true;  // "Text display" (config +0x61, all text): letters fade in as typed, or appear whole
    this.eraseAtOnce = false;   // "Read text display" (config +0x62): earlier lines "Fade out" (0) or dim at once (1)
    this.history = [];     // backlog records (log, logChoice), oldest first
    this.logged = 0;       // lines logged so far, counting those the log has dropped
    this.dropped = false;  // the 800-record log has let its oldest go
    this.pageParts = [];
    this.lines = [];       // the page's lines in order, the last the current one: {segs, timer, T, k}
    this.run = null;       // the line being typed: {chars, n, t (the @t index), front, insta, lo, ruby, fresh, ended, done}
    // The window (native 0x38d40 each frame): `open` (0xae0550) raises the panel by WINDOW_RATE a frame and lowering
    // it drops it as fast, or by FAST_CLOSE_RATE after CLO3 (0xae0560); `fade` (0xae05b0) moves by `rate` a frame
    // (0xae05a8), set by CLO4 / CLO5 and by a message that starts on a closed or faded window (see render).
    this.open = false;
    this.panelAlpha = 0;
    this.fastClose = false;
    this.fade = 1;
    this.rate = 0;
    this.closed = true;    // F1103 (state +0x89e): the window was closed by a CLO command
    this.pagePending = false;
    this.whole = false;    // "Display whole text" for this page (0xafeba8): earlier lines are not dimmed
    this.noteOn = false;   // F1110
    this.noteAlpha = 0;    // 0xafec74
    this.noteWait = 0;     // 0xafec70, ms
    // The window's pictures as the renderer draws them (item 116): interface art path, and for a balloon its place in stage pixels
    this.pics = [{ path: "DISP_PARTS_JA/txtwindow01-1920", full: true }];
    this.picAlpha = 0;
  }

  // The window's pictures and their opacity now. The game draws them into the frame before its last pass (0x391a0, then shader
  // 138dd8be), so the picture behind the window is darkened before the display curve: the renderer does the same (drawWindow).
  pictures() { return this.pics.map((p) => ({ ...p, alpha: this.picAlpha })); }

  // ---- the window ---------------------------------------------------------------------------------------
  // Open (at once when `now`) or hide the window outright, as starting, restoring and leaving the story do.
  setOpen(v, now = false) {
    this.open = v;
    this.fastClose = false;
    if (v) { if (now) { this.panelAlpha = 1; this.fade = 1; this.rate = 0; } }
    else { this.panelAlpha = 0; this.fade = 1; this.rate = 0; this.closed = true; }
    this.render();
  }

  // The window goes by itself at its own rate (0x2e120(0), then 0x38d40 each frame): Return to Title, from the press.
  closeWindow() {
    this.open = false;
    this.fastClose = false;
  }

  // dt in 60 Hz frames. The game's frame (0x48ac0) runs the script and the typing driver first (0x40ed0: 0x802c0, then
  // 0x81b30), then the window (0x38d40), then draws (0x391a0: the page's dimming, F1110's note): typing sees the panel
  // and fade as the last frame left them, so it goes on the frame after a fade-in ends.
  // `step`: fast forward's 33 (0x38d40 gets 0x590e80): the window's opening, closing and fades go that many frames a frame, so a
  // message after a closed window has its window whole on its first frame and a CLO4 of 1000 ms is gone on its own (native frames, TODO
  // item 110). The lines' dimming keeps the display's frames (0x391a0).
  tick(dt, step = 1) {
    this.type(dt);
    const wasUp = this.panelAlpha > 0;   // a long frame can take the panel down in one step; the game steps by frames
    const w = dt * step;
    if (this.fastClose && !this.open) {
      this.panelAlpha = Math.max(0, this.panelAlpha - FAST_CLOSE_RATE * w);
      if (this.panelAlpha <= 0) this.fastClose = false;
    } else if (this.open && !this.hidden) this.panelAlpha = Math.min(1, this.panelAlpha + WINDOW_RATE * w);
    else this.panelAlpha = Math.max(0, this.panelAlpha - WINDOW_RATE * w);
    if (this.rate) {
      this.fade += this.rate * w;
      if ((this.rate < 0 && this.fade <= 0) || (this.rate > 0 && this.fade >= 1)) { this.fade = Math.min(1, Math.max(0, this.fade)); this.rate = 0; }
    }
    this.firstFrame();
    this.clearEndedPage(wasUp);
    this.dimLines(dt);
    this.tickNote(dt);
    this.render();
  }

  // A new line's first frame (MSG, or a line typed over): its text object is set with a two-frame hold (0xa7790 -> 0xc3834(2)) that
  // is over by the next frame's draw, and a draw inside the hold hands the typing front back as 0 (0xa8240, 0xab710). So on a
  // window that is showing, the frame the line is set draws none of it and the front starts from 0 on the frame after; on a window
  // not drawn that frame (closed, or still under half of its fade-in) nothing takes the front back, and it keeps the step the
  // opening frame gave it. Native frames (TODO item 51): after a click the line before dims, the mark goes, and the first letter
  // comes one frame later, the second 15 frames after it at 250 ms a letter; on a closed window with "Insta display" the first
  // letter is there as the window fades in. MSAD sets no hold (flag 0x20000).
  firstFrame() {
    const r = this.run;
    if (!r || !r.fresh) return;
    r.fresh = false;
    const g = this.panelAlpha * Math.max(0, 2 * (this.fade - 0.5));
    if (!this.closed && g > 0) r.front = 0;
  }

  // The window picture and the page are drawn as two groups (0x391a0: b04b0 0x1d and 0x1e) and composited at the end
  // at g = panel x max(0, 2 (fade - 0.5)), the picture's group only while F1103 is 0 (listing L_3A6EC). Inside them the
  // picture is already at panel x config +0 / 255 (255; 200 / 255 for balloons, both of them) and each line at panel x
  // 2 (fade - 0.5), times its dimming: so the picture shows at g x panel and the text at g x g. A closed window draws
  // no text and no picture; F1104 hides only the picture.
  render() {
    const t = el(), p = panel();
    if (!t) return;
    const g = this.panelAlpha * Math.max(0, 2 * (this.fade - 0.5));
    t.style.opacity = String(this.closed ? 0 : g * g);
    const a = this.intro || this.closed ? 0 : g * this.panelAlpha * (this.balloon ? 200 / 255 : 1);
    this.picAlpha = a;
    if (p) p.style.opacity = String(a);
    const p2 = document.getElementById("panel2");
    if (p2) p2.style.opacity = String(a);
    const n = document.getElementById("note");
    if (n) {
      n.style.opacity = String(Math.min(1, this.noteAlpha));
      n.style.display = this.noteAlpha > 0 ? "block" : "none";
    }
  }

  // F1110's note (listing 0x3a580-0x3a65c): while F1110 is set its wait counts whole milliseconds, 16 a frame (fcvtzs
  // of 1000 / 60), and from 3,500 on the picture comes in at 1/36 a frame up to 1; while F1110 is 0 a picture still
  // showing goes out at the same rate and the wait starts again.
  tickNote(dt) {
    if (!this.noteOn) {
      if (this.noteAlpha > 0) { this.noteAlpha = Math.max(0, this.noteAlpha - NOTE.rate * dt); this.noteWait = 0; }
    } else if (this.noteWait >= NOTE.delay || (this.noteWait += Math.trunc((dt * 1000) / 60)) >= NOTE.delay) {
      this.noteAlpha = Math.min(1, this.noteAlpha + NOTE.rate * dt);
    }
  }

  // The window's style (F1105, placed by F1106 / F1107; a second balloon by F1111-F1113), as native 0x391a0 draws it
  // from the tables in system.json "windows": styles 0-2 are the three full windows, 3-32 balloons anchored at their
  // table position plus the chosen offsets, with the text at the balloon's text offset, as wide as its line width.
  setWindow(w) {
    this.window = w;
    const key = JSON.stringify(w);
    if (key === this.windowKey) return;
    this.windowKey = key;
    const t = this.windows, p = panel(), box = el();
    const off = (axis, i) => (t && i >= 0 && i < t[axis].length ? t[axis][i] : 0);
    const st = t?.styles?.[w.style];
    const st2 = t?.styles?.[w.style2];
    const art = (file) => `DISP_PARTS_JA/${file}`;
    this.pics = [st && st[0] && w.style >= 3 ? { path: art(st[0]), x: (st[1] + off("x", w.x)) * 1.5, y: (st[2] + off("y", w.y)) * 1.5 }
      : { path: art((w.style >= 0 && w.style <= 2 && st?.[0]) || "txtwindow01-1920"), full: true }];
    if (st2 && st2[0] && w.style2 >= 3) this.pics.push({ path: art(st2[0]), x: (st2[1] + off("x", w.x2)) * 1.5, y: (st2[2] + off("y", w.y2)) * 1.5 });
    // Where the text goes, in stage pixels: the first balloon's text origin, and the second's when there is one (see placeCurrent).
    // The row width stays the first style's (0x34defc by F1105).
    const origin = (s, ox, oy) => ({ left: (s[1] + s[3] + ox) * 1.5 - 3, top: (s[2] + s[4] + oy) * 1.5 - 11 });
    this.first = st && st[0] && w.style >= 3 ? { ...origin(st, off("x", w.x), off("y", w.y)), width: st[5] * 3 } : null;
    this.second = this.first && st2 && st2[0] && w.style2 >= 3 ? { ...origin(st2, off("x", w.x2), off("y", w.y2)), width: st[5] * 3 } : null;
    if (!p || !box) return;
    this.balloon = !!(st && st[0] && w.style >= 3);
    if (this.balloon) document.fonts?.load?.('42px "SeuratPro"');   // the balloon's face (N2-21), fetched before its first letter is typed
    if (!this.balloon) {
      const file = (w.style >= 0 && w.style <= 2 && st?.[0]) || "txtwindow01-1920";
      p.style.background = `url("/assets/ui/DISP_PARTS_JA/${file}.webp") 0 0 / 100% 100% no-repeat`;
      box.style.left = box.style.width = box.style.top = "";
      box.classList.remove("balloon");
    } else {
      const [file, x, y, tx, ty, width] = st;
      const ox = off("x", w.x), oy = off("y", w.y);
      p.style.background = `url("/assets/ui/DISP_PARTS_JA/${file}.webp") ${(x + ox) * 1.5}px ${(y + oy) * 1.5}px no-repeat`;
      // the table's text origin in stage pixels, less what the game's cells put above and left of the port's line box (measured on native frames, styles 3 and 5)
      box.style.left = `${(x + tx + ox) * 1.5 - 3}px`;
      box.style.top = `${(y + ty + oy) * 1.5 - 11}px`;
      box.style.width = `${width * 3}px`;
      box.classList.add("balloon");
    }
    // the second balloon's picture; the line it holds is placed as it is added (placeCurrent), and goes back with the balloon
    if (!this.second) this.placeCurrent();
    let p2 = document.getElementById("panel2");
    if (st2 && st2[0] && w.style2 >= 3) {
      if (!p2) { p2 = document.createElement("div"); p2.id = "panel2"; p.after(p2); }
      const [file, x, y] = st2;
      p2.style.background = `url("/assets/ui/DISP_PARTS_JA/${file}.webp") ${(x + off("x", w.x2)) * 1.5}px ${(y + off("y", w.y2)) * 1.5}px no-repeat`;
      p2.style.display = "";
    } else if (p2) p2.style.display = "none";
    this.render();
  }

  // With a second balloon up (F1111 of 3 or more) the page's current line, the last message, is drawn at that balloon's text origin,
  // one row higher than its own row on the page, with the click mark after it; the earlier lines stay in the first balloon, undimmed
  // (0x391a0, listing 0x3a2c0 on: the trailing draw takes the style and the offsets F1112 / F1113 and subtracts a row; native frames
  // of QA_09's page, the only one: "You're dead, punk!" above left, "Come at me!" below right). Here the line's segments move into
  // an element placed there. A line that has become an earlier one goes back into the page's flow.
  placeCurrent() {
    const root = el();
    if (!root || !root.querySelector) return;
    const last = this.lines.at(-1);
    let host = root.querySelector(".second");
    if (host) for (const s of [...host.children]) if (!this.second || !last || !last.segs.includes(s)) root.insertBefore(s, host);
    if (!this.second || !this.first || !last) { host?.remove(); return; }
    const flow = this.flowRows(last);
    if (!host) { host = document.createElement("span"); host.className = "second"; }
    root.appendChild(host);
    for (const s of last.segs) if (s.parentNode !== host) host.appendChild(s);
    host.style.left = `${this.second.left - this.first.left}px`;
    host.style.top = `${this.second.top - this.first.top + (flow - 1) * this.rowPitch()}px`;
    host.style.width = `${this.second.width}px`;
  }

  rowPitch() { return parseFloat(globalThis.getComputedStyle?.(el())?.lineHeight) || 77.5; }

  // The rows the page's earlier lines take (the current line's own row index on the page): from the laid-out text, or a row a line
  // where there is no layout to ask.
  flowRows(current) {
    const box = el();
    const before = this.lines.filter((ln) => ln !== current).flatMap((ln) => ln.segs).filter((s) => !s.closest?.(".second"));
    const lastSeg = before.at(-1);
    const rs = lastSeg?.getClientRects ? lastSeg.getClientRects() : [];
    const stage = document.getElementById("stage");
    const scale = rs.length && stage?.getBoundingClientRect && box.getBoundingClientRect ? stage.getBoundingClientRect().height / 1080 : 0;
    if (!(scale > 0)) return this.lines.length - 1;
    return Math.max(0, Math.round((rs[rs.length - 1].bottom - box.getBoundingClientRect().top) / scale / this.rowPitch()));
  }

  // CLO2: the page goes now and the window with it (0x7f3dc).
  closeNow() {
    this.clear();
    this.open = false;
    this.fastClose = false;
    this.panelAlpha = 0;
    this.closed = true;
    this.render();
  }

  // CLO3: the window closes over four frames; its text stays for the next page (0x7f86c).
  closeQuick() {
    if (!this.open) return;
    this.open = false;
    this.fastClose = true;
    this.closed = true;
  }

  // A FADS with its fourth argument 1 or 2 closes the window for the transition (0x60610 sets +0x89e): 0x391a0 stops
  // drawing the text and the click mark at once, the panel stays, and the next message fades the window in (0x6e0d0).
  closeForFade() {
    this.closed = true;
    this.render();
  }

  // CLO4(ms): the window and its text fade out over ms (0x7f898). Nothing to fade, or ms 0, is at once.
  fadeOut(ms) {
    if (!(ms > 0)) { this.fade = 0; this.rate = 0; this.render(); return; }
    if (this.rate > 0) this.fade = 1;
    else if (this.fade !== 1) { this.fade = 0; this.rate = 0; this.render(); return; }
    this.rate = -(1000 / 60) / ms;
  }

  // CLO5(ms): the window opens, fading in over ms unless it is already showing (0x7f918).
  fadeIn(ms) {
    if (!(ms > 0) || (this.rate >= 0 && this.fade !== 0 && !this.closed)) { this.rate = 0; this.fade = 1; }
    else { this.fade = 0; this.rate = (1000 / 60) / ms; }
    this.closed = false;
    this.open = true;
    this.fastClose = false;
    this.panelAlpha = 1;
    this.render();
  }

  // A message starts (0x6e0d0): a closed or faded window fades back in over 18 frames, and the page that ended with
  // the last click is cleared now rather than at the click (0xae0940), if F823 has not already cleared it (see
  // clearEndedPage).
  beginMessage() {
    if (this.rate <= 0) {
      if (this.fade < 1 || this.closed) { this.fade = 0; this.rate = 1 / 18; }
      else { this.fade = 1; this.rate = 0; }
    }
    this.closed = false;
    if (this.pagePending) {
      this.pagePending = false;
      this.clear();
    }
  }

  // MSAD (0x6e950) only clears F1103: no fade-in and no page clear, so the text it adds shows with the panel as it
  // comes back (123 MSADs follow a closed window).
  continueMessage() { this.closed = false; }

  state() { return { open: this.open, fade: this.fade, rate: this.rate, closed: this.closed, pending: this.pagePending, panel: this.panelAlpha, whole: this.whole }; }

  setState(s) {
    if (!s) return;
    this.open = !!s.open;
    this.fade = s.fade ?? 1;
    this.rate = s.rate ?? 0;
    this.closed = !!s.closed;
    this.pagePending = !!s.pending;
    this.panelAlpha = s.panel ?? (this.open ? 1 : 0);
    this.whole = !!s.whole;
    this.fastClose = false;
    this.render();
  }

  // F1104 ("novel" pages): 0x391a0 reads it once, to leave out the window picture (cbnz at 0x39540); the text keeps
  // the window's own font, box, rows, dimming and click mark, and the scripts' blank rows place the page.
  setIntro(v) {
    this.intro = !!v;
    this.render();
  }

  setWhole(v) { this.whole = !!v; }

  showPanel() { this.render(); }

  // 0x391a0, each frame the panel is up (0xae0558 > 0) in the story's layout (F822 1): a page counter F823 below 1
  // clears the page at once (0x53ab0). Every script sets F823 to 0 right after the click that ends a page (and adds 1
  // before each page), so an ended page goes then, or on the first frame a CLO5 brings the panel back, rather than
  // with the next message: it is not seen during the waits, fades and window openings in between. pageCounter (set
  // by main.js) gives [F822, F823].
  clearEndedPage(wasUp = false) {
    if (!(wasUp || this.panelAlpha > 0) || !this.pageCounter) return;
    const [layout, n] = this.pageCounter();
    if (layout !== 1 || (n | 0) >= 1 || !(this.lines.length || this.pageParts.length || el()?.textContent)) return;
    this.pagePending = false;
    this.clear();
  }

  // Remove the page, as a click at the end of a page or a closed window does.
  clear() {
    this.pageParts = [];
    this.lines = [];
    el().textContent = "";
    this.stop();
  }

  // The page's earlier lines at their dim level (the instant run's end: 0x802c0 sets F859 + k to -1 below F823 - 1, N2-83). `count`:
  // how many lines from the page's top, F823 - 1. The run ends as a message starts, after the script has counted its line and before
  // the line is added, so the line that was the last one on screen is among them (TODO item 51, native frames: three read lines above
  // the first unread one, all three dim from the first frame). Without a count: every line but the last.
  settleEarlier(count = this.lines.length - 1) { for (const ln of this.lines.slice(0, Math.max(0, count))) ln.timer = -1; }

  // Stop typing where it is, without finishing it.
  stop() {
    this.run = null;
  }

  get typing() {
    return this.run !== null;
  }

  // Show the rest of what is being typed. `snap`: the player's click did it, which also takes every earlier line of
  // the page to its dim level at once (0x81b30: F859 ... set to -1).
  finish(snap = false) {
    const r = this.run;
    if (snap) for (const ln of this.lines.slice(0, -1)) ln.timer = -1;
    if (!r) return;
    this.run = null;
    this.showAll(r);
    r.done();
  }

  // The typing driver's frame (0x81b30): the front moves only while the window is not open (opening it), is hidden,
  // is fully open with no fade-in running, or is closed (F1103); otherwise the frame passes with no letter, so a
  // message after a closed window starts typing once its 18-frame fade-in is over. A new line shows nothing on the frame it is
  // set (firstFrame). The line is typed once the front is a letter past its end (typingEnd), and the game sees that on the frame
  // after (0xab8e0 reads the text object's front as the last draw left it): the wait, its mark and an @e line's next command
  // start from that frame.
  type(dt) {
    const r = this.run;
    if (!r) return;
    if (r.ended) { this.finish(); return; }
    if (!this.open || this.hidden || (this.panelAlpha >= 1 && this.rate <= 0) || this.closed) {
      this.open = true;
      this.fastClose = false;
      // fast forward runs the typing 64 times a frame at 60 letters' worth each (0x81b30): the line is whole on its first typing frame
      r.front = r.rush ? 768 : advanceFront(r.front, dt, this.speed, r.base || 0);
    }
    if (r.fresh) return;
    if (r.front >= typingEnd(r.n, r.t)) { r.ended = true; this.showAll(r); return; }
    const set = (i) => {
      const c = r.chars[i];
      if (i > 0 && r.chars[i - 1] === c) return true;   // a dash run or a glyph strip shows with its first letter
      const a = letterAlpha(r.front, i, r.n, r.t, r.insta);
      if (a <= 0) return false;
      c.classList.add("on");
      c.style.opacity = a >= 1 ? "" : String(a);
      return true;
    };
    for (const g of r.ruby) {
      if (r.front <= g.from || g.done) continue;
      g.letters.forEach((c, k) => {
        const a = rubyAlpha(r.front, g.from, g.to, g.len ?? g.letters.length, g.at?.[k] ?? k);
        if (a <= 0) return;
        c.classList.add("on");
        c.style.opacity = a >= 1 ? "" : String(a);
      });
      if (r.front >= g.to) g.done = true;
    }
    if (r.t) { for (let i = 0; i < r.n; i++) set(i); return; }
    for (let i = r.lo; i < r.n; i++) {
      if (!set(i)) break;
      if (i === r.lo && letterAlpha(r.front, i, r.n, 0, r.insta) >= 1) r.lo++;
    }
  }

  showAll(r) {
    for (const c of r.chars) { c.classList.add("on"); c.style.opacity = ""; }
    for (const g of r.ruby) for (const c of g.letters) { c.classList.add("on"); c.style.opacity = ""; }
  }

  // The player's press while a line types (0x81b30: the front goes to 76800 and, with `snap`, every earlier line's timer F859.. to
  // -1): the letters show at once, and the line counts as typed on the frame after, like any other.
  rush(snap = false) {
    const r = this.run;
    if (snap) for (const ln of this.lines.slice(0, -1)) ln.timer = -1;
    if (!r) return;
    r.front = 76800;
    r.fresh = false;
    this.showAll(r);
  }

  // The earlier lines' dimming (0x391a0's page loop): each line's alpha from the timers before this frame's count,
  // then the timers count on while the window is fully shown, and one past its T stops at -1. "Display whole text"
  // keeps them bright, "Insta erasure" (config +0x62) dims them at once, a second balloon (F1111 >= 3) aims at 255.
  dimLines(dt) {
    const lines = this.lines, last = lines.length - 1;
    if (last < 1) return;
    const shown = !this.closed && this.fade === 1;
    const target = (this.window?.style2 ?? 0) > 2 ? 255 : DIM_TARGET;
    lines[last - 1].T = this.speed * 1.2;   // F(870 + j) = speed - 128 for the line before the current one
    const alpha = [];
    for (let j = 0; j < last; j++) {
      if (this.eraseAtOnce) lines[j].timer = -1;
      alpha.push(this.whole ? 1 : lineAlpha(lines, j, target));
    }
    for (let j = 0; j < last; j++) {
      const ln = lines[j];
      if (ln.timer >= 0 && shown) ln.timer += dt;
      if (ln.T < ln.timer) ln.timer = -1;
      for (const s of ln.segs) { const v = String(alpha[j]); if (s.style.opacity !== v) { s.style.opacity = v; dimReadings(s, v); } }
    }
    for (const s of lines[last].segs) if (s.style.opacity !== "") { s.style.opacity = ""; dimReadings(s, ""); }
  }

  // A restored page (a save's HTML): its lines from the segments' line numbers, earlier lines at their dim level, as
  // a load leaves them (0x813e0 sets their timers to -1).
  adoptPage() {
    const lines = [];
    for (const s of el().querySelectorAll(".seg")) {
      const n = Number(s.dataset?.line ?? lines.length);
      let ln = lines.find((l) => l.n === n);
      if (!ln) { ln = { n, segs: [], timer: -1, T: 0, k: s.dataset?.k === "1" }; lines.push(ln); }
      ln.segs.push(s);
      if (s.dataset?.k !== undefined) ln.k = s.dataset.k === "1";
    }
    if (lines.length) lines.at(-1).timer = 0;
    this.lines = lines;
  }

  // A line ending in @k (the next message continues it) keeps the state of its continuation (lineAlpha); MSAD sets it
  // for the line it adds to, an empty one too (0x6e950 drops the old "@k" before adding).
  setKeep(k) { const ln = this.lines.at(-1); if (ln) { ln.k = !!k; for (const s of ln.segs) s.dataset.k = k ? "1" : "0"; } }

  // Adds to the page. A new segment starts a new line unless inline is set (MSAD adds to the current line); `glue`
  // (@x, code 0xc) starts a new line on the previous row, 2 units (6 px) after its end, as 0x391a0 places one that
  // contains the code (0xa88b0, 0xa8190). Returns when it has been typed. `color` and `edge` are the whole message's
  // colour and outline (colourMarks); a colour that starts part way wraps what follows. `k`: the line ends in @k.
  add(markup, { color = 0, edge = 0, inline = false, instant = false, rush = false, glue = false, k = false } = {}) {
    this.finish();
    const root = el();
    const seg = newSegment(color, edge, glue && !inline);
    if (!inline && !glue && this.pageParts.length) root.appendChild(document.createTextNode("\n"));
    // an MSAD goes on a line that has letters already (not a blank MSG's row)
    const before = inline && this.lines.length > 0 && this.lines.at(-1).segs.some((sg) => (sg.querySelector ? sg.querySelector(".ch") : null));
    const base = before ? this.lines.at(-1).units || 0 : 0;   // the letters the typing front has counted on this line (advanceFront)
    if (inline && this.lines.length) this.lines.at(-1).segs.push(seg);
    else {
      // the line before becomes an earlier line, dimming over the new line's speed x 1.2 frames
      if (this.lines.length) this.lines.at(-1).T = this.speed * 1.2;
      this.lines.push({ segs: [seg], timer: 0, T: 0, k: false, n: this.lines.length });
    }
    seg.dataset.line = String(this.lines.at(-1).n);
    this.setKeep(k);
    setDashJoin(root);
    const { chars, t, ruby } = fillSegment(seg, markup);
    this.lines.at(-1).units = (before ? base : 0) + chars.length;
    if (t) seg.dataset.t = String(t);
    root.appendChild(seg);
    if (this.second || root.querySelector?.(".second")) this.placeCurrent();
    this.pageParts.push(plain(markup));
    this.render();
    // skipping (0x81b30 with 0x146e64c: the front at 76800) shows the line whole at once
    if (instant || !chars.length) {
      this.open = true;
      this.fastClose = false;
      for (const c of chars) c.classList.add("on");
      for (const g of ruby) for (const c of g.letters) c.classList.add("on");
      return Promise.resolve();
    }
    // typed by the window's frames (type), at the speed set; speed 0 shows it whole on the first frame it may type. MSAD's text
    // joins the line's (0x6e950): the front, which stood a letter past the old end, goes on from there, so the added part's first
    // two letters come at once (native frames: "IJKL" after "EFGH@k" has I and J on the frame of the click, K 15 frames on).
    return new Promise((done) => {
      this.run = { chars, n: chars.length, t, front: inline && before ? 1 : 0, base, insta: !this.charFade, lo: 0, ruby, fresh: !inline, ended: false, done, rush };
    });
  }

  // The current line typed over (0x5baf0: the front back at 0, set as any new text is, see firstFrame): after a rewind, a Quick Jump or a load
  // (N2-84, N2-77). A page restored from a save whose letters were compacted away shows whole. Null when there is nothing to type.
  retype(insta = false) {
    this.finish();
    const ln = this.lines.at(-1);
    if (!ln) return null;
    const chars = [], ruby = [];
    let t = 0;
    for (const seg of ln.segs) {
      if (seg.dataset?.t) t = chars.length + Number(seg.dataset.t);
      for (const c of seg.querySelectorAll(".ch")) {
        const reading = c.closest("rt");
        c.classList.remove("on");
        c.style.opacity = "";
        if (reading) continue;
        const copies = Number(c.dataset?.n) || 1;   // a glyph strip takes its cells' typing time
        for (let k = 0; k < copies; k++) chars.push(c);
      }
      for (const r of seg.querySelectorAll("ruby")) {
        const base = [...r.querySelectorAll(".ch")].filter((c) => !c.closest("rt"));
        if (!base.length) continue;
        const from = chars.indexOf(base[0]);
        const letters = [...r.querySelectorAll("rt .ch")];
        const len = Number(r.querySelector("rt")?.dataset?.len) || letters.length;
        if (letters.length) ruby.push({ from, to: from + base.length, letters, at: letters.map((c, k) => Number(c.dataset?.at ?? k)), len });
      }
    }
    if (!chars.length) return null;
    return new Promise((done) => {
      this.run = { chars, n: chars.length, t, front: 0, insta, lo: 0, ruby, fresh: true, ended: false, done };
    });
  }

  // Blank rows between paragraphs.
  addBreak(n) {
    el().appendChild(document.createTextNode("\n".repeat(n)));
  }

  endOfTextPos() {
    const last = el().querySelector(".seg:last-of-type");
    if (!last) return null;
    const rs = last.getClientRects();
    if (!rs.length) return null;
    const r = rs[rs.length - 1];
    const stage = document.getElementById("stage").getBoundingClientRect();
    const scale = stage.width / 1920;
    return { x: (r.right - stage.left) / scale, y: (r.bottom - stage.top) / scale };
  }

  // The text box's row pitch and the top of the first free row, in stage pixels, with whether the page has text.
  // Native choices start there (0x84e50 reads the text window's next row, 0xafec7c).
  rows() {
    const box = el(), cs = getComputedStyle(box);
    const top = parseFloat(cs.top) || 0;
    const pitch = parseFloat(cs.lineHeight) || 72;
    const last = box.querySelector(".seg:last-of-type");
    const rs = last ? last.getClientRects() : [];
    if (!rs.length) return { pitch, next: top, used: false };
    const stage = document.getElementById("stage").getBoundingClientRect();
    const bottom = (rs[rs.length - 1].bottom - stage.top) / (stage.height / 1080);
    return { pitch, next: top + Math.max(1, Math.ceil((bottom - top) / pitch)) * pitch, used: true };
  }

  // The backlog keeps 800 records, as the native ring does (0x527a0 sets up 800); `dropped` once it has let one go
  // (0xae0470: the backlog then leaves out its oldest page). A record has its sequence number, which the rewind trail
  // uses to find the point to jump back to, the voice of its line, and what the backlog draws it by (see renderLogPage):
  // info.pageEnd (WNTY, F799), info.skips (F847-F858), info.glue (@x), info.color / edge. An inline message (MSAD) adds
  // its part to the newest record and keeps that record's page end.
  log(markup, voice = null, { inline = false, pageEnd = false, skips = null, glue = false, color = 0, edge = 0 } = {}) {
    const p = plain(markup);
    if (!p.trim()) return;
    this.logged++;
    const part = { markup, color, edge, seq: this.logged };
    const last = this.history.at(-1);
    if (inline && last && last.kind === "msg") { last.parts.push(part); last.text += p; return; }
    this.push({ kind: "msg", text: p, seq: this.logged, voice, pageEnd: !!pageEnd, skips: skips ? skips.slice() : null, glue: !!glue, parts: [part] });
  }

  // A choice's rows (SELD, 0x7f74c): a record each, the last one ending a page. They count as one step of the log, so
  // the choice's own rewind point (taken just before) is the one whose count is a row's seq - 1.
  logChoice(labels, skips = null) {
    if (!labels.length) return;
    this.logged++;
    labels.forEach((label, i) => this.push({ kind: "choice", text: plain(label), seq: this.logged, voice: null, pageEnd: i === labels.length - 1,
      skips: skips ? skips.slice() : null, glue: false, parts: [{ markup: label, color: 0, edge: 0, seq: this.logged }] }));
  }

  push(record) {
    this.history.push(record);
    if (this.history.length > 800) { this.history.shift(); this.dropped = true; }
  }

  // Take back what was logged after the count was `logged`, when the player rewinds.
  unlog(logged = this.logged) {
    const n = this.logged - logged;
    if (n <= 0) return;
    while (this.history.length) {
      const r = this.history.at(-1);
      if (r.seq > logged) { this.history.pop(); continue; }
      // an MSAD's part after the point goes, the MSG's record stays
      if (r.parts?.some((p) => p.seq > logged)) {
        r.parts = r.parts.filter((p) => p.seq <= logged);
        r.text = r.parts.map((p) => plain(p.markup)).join("");
      }
      break;
    }
    this.logged = logged;
  }
}
