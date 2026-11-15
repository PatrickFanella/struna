import assert from "node:assert/strict";
import { test } from "node:test";

import { tapTempo, tempoHelper } from "./tempo.ts";

test("tap tempo", () => {
  assert.equal(tapTempo([0, 500, 1000, 1500]), 120);
  assert.equal(tapTempo([0, 500, 3000]), null);
  assert.equal(tapTempo([0, 100, 200]), 300);
  assert.equal(tapTempo([0, 5000]), null);
  assert.equal(tapTempo([0]), null);
  assert.equal(tapTempo([0, 3000, 4000]), 60);
});

test("three clean passes suggest raising the tempo", () => {
  let s = { cleans: 0, misses: 0 };
  let r = tempoHelper(s, "clean");
  assert.equal(r.suggestion, null);
  r = tempoHelper(r.state, "clean");
  r = tempoHelper(r.state, "clean");
  assert.deepEqual(r.suggestion, { kind: "raise", delta: 3 });
  assert.equal(r.state.cleans, 0);
  s = r.state;
});

test("one miss repeats, a second lowers", () => {
  let r = tempoHelper({ cleans: 2, misses: 0 }, "miss");
  assert.deepEqual(r.suggestion, { kind: "repeat", delta: 0 });
  assert.equal(r.state.cleans, 0);
  r = tempoHelper(r.state, "miss");
  assert.deepEqual(r.suggestion, { kind: "lower", delta: -4 });
  assert.equal(r.state.misses, 0);
});

test("the raise step can be changed", () => {
  const r = tempoHelper({ cleans: 2, misses: 0 }, "clean", { raise: 5 });
  assert.deepEqual(r.suggestion, { kind: "raise", delta: 5 });
});

test("explicit BPM entry uses clamp limits without clamping rejected input", async () => {
  const { parseBpmEntry } = await import("./tempo.ts");
  for (const text of ["", "abc", "29", "301", "70.5", "1e2"]) assert.equal(parseBpmEntry(text), null);
  assert.equal(parseBpmEntry("30"), 30); assert.equal(parseBpmEntry(" 300 "), 300);
});
