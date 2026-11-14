import assert from "node:assert/strict";
import { test } from "node:test";

import { scheduleBeats } from "./beats.ts";

test("eighths at 60 BPM in 4/4", () => {
  const ev = scheduleBeats({ start: 0, bpm: 60, beatsPerBar: 4, subdivision: 2, from: 0, until: 2 });
  assert.deepEqual(ev.map((e) => e.time), [0, 0.5, 1, 1.5]);
  assert.deepEqual(ev.map((e) => e.accent), [true, false, false, false]);
  assert.deepEqual(ev.map((e) => e.sub), [0, 1, 0, 1]);
  assert.deepEqual(ev.map((e) => e.beat), [0, 0, 1, 1]);
});

test("triplets are spaced a third of a beat apart", () => {
  const ev = scheduleBeats({ start: 0, bpm: 60, beatsPerBar: 4, subdivision: 3, from: 0, until: 1 });
  assert.equal(ev.length, 3);
  for (let i = 1; i < ev.length; i++) assert.ok(Math.abs(ev[i]!.time - ev[i - 1]!.time - 1 / 3) < 1e-9);
});

test("a window in the middle continues the bar count", () => {
  const ev = scheduleBeats({ start: 10, bpm: 120, beatsPerBar: 3, subdivision: 1, from: 11.4, until: 12.1 });
  assert.deepEqual(ev.map((e) => e.time), [11.5, 12]);
  assert.deepEqual(ev.map((e) => e.beat), [0, 1]);
  assert.equal(ev[0]!.accent, true);
});
