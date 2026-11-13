// langsave.js - a save made in one language, loaded in the other.
//
// A record resumes at a command of its script (vm.js snapshot: script, pc). 241 of the 549 scripts are not the same in the two languages: the translation
// rewrote glued lines (the original's "@x$id" message is its MSAD) and timed ones (a wait in place of "@k@e"), so the same moment of the story is another
// command number there. The dialogue lines are the same lines with the same numbers in both, so a record is carried across by the line it stands at:
//
//   - waiting at a message: the message that shows that line in the other script, run again from its start (the page is written again in the language
//     now in use, with its voice);
//   - a message about to run (msgStart): the same;
//   - a scene's own point (ATSV) and a choice: the command the same distance from the nearest line, the choice's rows read again from their commands.
//
// What the record's page showed is not kept (it is text of the other language): a line already on the page is run again where the record stands at it,
// and is otherwise left out until the page ends.
const IDS = /\$(\d+)/g;
const idsOf = (op) => (op && (op[0] === "MSG" || op[0] === "MSAD" || op[0] === "SELR") ? [...String(op.slice(1).join(",")).matchAll(IDS)].map((m) => Number(m[1])) : []);
const isMessage = (op) => !!op && (op[0] === "MSG" || op[0] === "MSAD");

// The first command at or after `from` (step 1) or at or before it (step -1) that names a line: [index, line number], or null.
function anchor(ops, from, step) {
  for (let i = from; i >= 0 && i < ops.length; i += step) {
    const ids = idsOf(ops[i]);
    if (ids.length) return [i, ids[0]];
  }
  return null;
}
// Where a line is named in a script: its number -> the first command that names it (a message may name two: the original's "$a^$b" is the translation's
// MSG and MSAD).
function lineIndex(ops) {
  const at = new Map();
  ops.forEach((op, i) => { for (const id of idsOf(op)) if (!at.has(id)) at.set(id, i); });
  return at;
}
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

// The command of `b` that is what command `pc` is in `a`: found from the nearest line after it and, failing that, the nearest before, when the commands
// between are the same in both; pc itself where the scripts do not differ there or no line is near.
export function mapPc(a, b, pc) {
  const A = a.ops, B = b.ops, where = lineIndex(B);
  const tries = [];
  const fwd = anchor(A, pc, 1), back = anchor(A, pc - 1, -1);
  if (fwd && where.has(fwd[1])) {
    const d = fwd[0] - pc, at = where.get(fwd[1]) - d;
    if (at >= 0) tries.push([at, same(A.slice(pc, fwd[0]), B.slice(at, at + d))]);
  }
  if (back && where.has(back[1])) {
    const d = pc - back[0], at = where.get(back[1]) + d;
    if (at <= B.length) tries.push([at, same(A.slice(back[0] + 1, pc), B.slice(at - d + 1, at))]);
  }
  const sure = tries.find((t) => t[1]);
  return sure ? sure[0] : tries.length ? tries[0][0] : Math.min(pc, B.length);
}

// The record `s`, made with script `a`, as one for script `b` (the same script in the language now in use). textOf(arg): a line's text now.
export function carryPoint(s, a, b, textOf, lang) {
  const A = a.ops, B = b.ops, where = lineIndex(B);
  const out = { ...s, lang, html: "", page: [] };
  const runAgain = (line) => {
    const at = where.get(line);
    if (at === undefined || !isMessage(B[at])) return false;
    Object.assign(out, { pc: at, msgStart: true, waiting: false, choice: false, choices: undefined });
    return true;
  };
  if (s.choices) {
    // a choice stands at its own command; its rows are the SELR commands before it
    out.pc = mapPc(a, b, s.pc);
    const rows = new Map();
    for (let i = out.pc - 1; i >= 0 && (B[i][0] === "SELR" || /^IF/.test(B[i][0])); i--) if (B[i][0] === "SELR") rows.set(Number(B[i][1]), B[i][2]);
    out.choices = s.choices.map((c) => (c && typeof c === "object" && rows.has(Number(c.value)) ? { ...c, text: textOf(rows.get(Number(c.value))) } : c));
    out.html = s.html;   // (the question above the rows stays as it was written)
    out.page = s.page;
    return out;
  }
  if (s.msgStart) {
    const ids = idsOf(A[s.pc]);
    if (!ids.length || !runAgain(ids[0])) out.pc = mapPc(a, b, s.pc);
    return out;
  }
  if (s.waiting) {
    // the message waited at is the command before
    const ids = idsOf(A[s.pc - 1]);
    if (ids.length && runAgain(ids[0])) return out;
    out.pc = mapPc(a, b, s.pc);
    return out;
  }
  // a scene's point: where it is. A line still on its page (the question over a choice, which did not end the page) is run again with it when the point
  // comes straight after that line; any other stays as it was written.
  out.pc = mapPc(a, b, s.pc);
  const held = (s.page || []).some((t) => t && t.trim()) && !s.win?.pending;
  if (held) {
    if (B[out.pc - 2]?.[0] === "MSG" && B[out.pc - 1]?.[0] === "ATSV") Object.assign(out, { pc: out.pc - 2, msgStart: true });
    else Object.assign(out, { html: s.html, page: s.page });
  }
  return out;
}

// The line a record's note shows (main.js makeSave: the newest line on its page, or the line it is about to run): its number, or null. The note is
// kept as text, in the language the record was made in; the save screen shows that line in the language now in use (vm.js noteIn).
// A record at a message's start keeps the newest piece the message has shown, the translation's MSADs after it included (vm.js message: noteText).
export function noteLine(s, ops) {
  if (!s || !ops) return null;
  if (s.msgStart && isMessage(ops[s.pc])) {
    let last = idsOf(ops[s.pc]).at(-1) ?? null;
    for (let i = s.pc + 1; i < ops.length && ops[i][0] !== "MSG" && ops[i][0] !== "ATSV" && !/^SEL/.test(ops[i][0]); i++) if (ops[i][0] === "MSAD") last = idsOf(ops[i]).at(-1) ?? last;
    if (last !== null) return last;
  }
  for (let i = s.msgStart ? s.pc : s.pc - 1; i >= 0 && i < ops.length; i--) {
    const ids = idsOf(ops[i]);
    if (ids.length) return ids.at(-1);   // (a glued message's newest piece)
  }
  return null;
}
