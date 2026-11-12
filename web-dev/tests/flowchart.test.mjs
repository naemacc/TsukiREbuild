import test from "node:test";
import assert from "node:assert/strict";
import { FlowProgress, immediateDominators } from "../../web/app/js/flowchart-model.js";

// 10 -> 20 (connector) -> 11 -> 12, which branches to 13 or 14; both lead to 15. 30 is a separate root.
const edge = (from, to, global) => ({ from, to, global: [global], current: [global] });
const transitions = [edge(10, 20, 100), edge(20, 11, 101), edge(11, 12, 102), edge(12, 13, 103), edge(12, 14, 104),
  edge(13, 15, 105), edge(14, 15, 106), edge(30, 31, 107)];
const chart = { transitions, groups: [{ parts: [10, 11, 12, 13, 14, 15, 30, 31].map((flag) => ({ flag, lines: [] })) }] };
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test("dominators follow every path, and stop at a branch", () => {
  const idom = immediateDominators(transitions);
  assert.equal(idom.get(11), 20);
  assert.equal(idom.get(20), 10);
  assert.equal(idom.get(15), 12);
  assert.equal(idom.get(10), 0);
  assert.equal(idom.get(31), 30);
});

test("a scene reached from a save counts the scenes every path passes, never a branch", () => {
  const storage = memory();
  storage.setItem("tsuki.flow.v2", JSON.stringify({ started: [15], completed: [], secondary: [], migrated: true }));
  const flow = new FlowProgress(storage);
  flow.install(chart);
  assert.deepEqual([...flow.completed].sort((a, b) => a - b), [10, 11, 12]);
  assert.ok(!flow.completed.has(13) && !flow.completed.has(14) && !flow.completed.has(15));
  assert.deepEqual([...flow.secondary].sort((a, b) => a - b), [100, 101, 102]);
  assert.ok(!flow.completed.has(30));
  assert.deepEqual(JSON.parse(storage.getItem("tsuki.flow.v2")).completed.sort((a, b) => a - b), [10, 11, 12]);
});

test("nothing is inferred for a player who has not started anything", () => {
  const flow = new FlowProgress(memory());
  flow.install(chart);
  assert.equal(flow.completed.size, 0);
  assert.equal(flow.secondary.size, 0);
});

test("a flowchart drawn again after a question takes the pointer at once", async () => {
  // opts.reopened: the fade in is already done, so nothing would give the pointer back at its end (No to the rewind question left the chart
  // dead to the wheel, drags and clicks)
  const { readFileSync } = await import("node:fs");
  const fc = readFileSync(new URL("../../web/app/js/flowchart.js", import.meta.url), "utf8");
  assert.match(fc, /if \(opts\.reopened\) fx\.step\(Infinity\);/);
  assert.match(fc, /if \(!fx\.done\) page\.style\.pointerEvents = "none";/);
  assert.doesNotMatch(fc, /\n  page\.style\.pointerEvents = "none";\n  if \(opts\.ghost\)/);
});
