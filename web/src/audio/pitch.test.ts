import assert from "node:assert/strict";
import { test } from "node:test";

import { noteFor, TUNINGS, yin } from "./pitch.ts";

const SR = 48_000;
function sine(freq: number, n = 4096, harmonics = false): Float32Array {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    b[i] = 0.5 * Math.sin(2 * Math.PI * freq * t) + (harmonics ? 0.3 * Math.sin(4 * Math.PI * freq * t) + 0.2 * Math.sin(6 * Math.PI * freq * t) : 0);
  }
  return b;
}

test("yin finds the low E and the D string", () => {
  for (const f of [82.41, 146.83]) {
    const got = yin(sine(f), SR);
    assert.ok(got !== null && Math.abs(got - f) < 0.5, `${f} → ${got}`);
  }
});

test("yin handles a string with harmonics and a capo at the 7th fret", () => {
  for (const f of [82.41, 110, 329.63, 329.63 * 2 ** (7 / 12)]) {
    const got = yin(sine(f, 4096, true), SR);
    assert.ok(got !== null && Math.abs(got - f) / f < 0.005, `${f} → ${got}`);
  }
});

test("yin returns null on silence", () => {
  assert.equal(yin(new Float32Array(4096), SR), null);
});

test("noteFor names notes and cents", () => {
  const e = noteFor(82.41);
  assert.equal(e.name, "E");
  assert.equal(e.octave, 2);
  assert.ok(Math.abs(e.cents) < 2);
  const d = noteFor(146.83 * 2 ** (-12 / 1200));
  assert.equal(`${d.name}${d.octave}`, "D3");
  assert.ok(Math.abs(d.cents + 12) < 0.5, String(d.cents));
  const a = noteFor(440, 432);
  assert.equal(`${a.name}${a.octave}`, "A4");
  assert.ok(Math.abs(a.cents - 31.8) < 0.5, String(a.cents));
  assert.equal(a.midi, 69);
});

test("tunings", () => {
  assert.deepEqual(TUNINGS.standard, ["E2", "A2", "D3", "G3", "B3", "E4"]);
  assert.deepEqual(TUNINGS.dropD, ["D2", "A2", "D3", "G3", "B3", "E4"]);
  assert.deepEqual(TUNINGS.doubleDropD, ["D2", "A2", "D3", "G3", "B3", "D4"]);
});
