import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveStageTempo } from "./stageTempo.ts";
import type { Stage } from "../types.ts";

const material = { key: "materials/roll.md", label: "Baseline roll", kind: "text" as const, src: "/api/materials/x" };
const stage: Stage = { key: "technique", title: "Technique", minutes: 6, output: "Play a roll at 120 BPM", material };
test("structured target beats saved tempo and prose does not supply a tempo", () => {
  const records = [{ fragment: `material:${material.key}`, bpm: 96 }];
  assert.deepEqual(resolveStageTempo({ ...stage, targetBpm: 80 }, records, [material]), { bpm: 80, source: "Plan target" });
  assert.equal(resolveStageTempo(stage, records, [material]).bpm, 96);
  assert.equal(resolveStageTempo(stage, [], [material]).bpm, 72);
});
test("stable identities isolate records, ambiguous legacy labels and incompatible values fall back", () => {
  const other = { ...material, key: "materials/second.md" };
  const records = [{ fragment: `material:${material.key}`, bpm: 80 }];
  assert.equal(resolveStageTempo({ ...stage, material: other }, records, [material, other]).bpm, 72);
  assert.equal(resolveStageTempo(stage, [{ fragment: material.label, bpm: 85 }], [material]).bpm, 85);
  assert.equal(resolveStageTempo(stage, [{ fragment: material.label, bpm: 85 }], [material, other]).bpm, 72);
  assert.match(resolveStageTempo(stage, [{ fragment: `material:${material.key}`, bpm: 400 }], [material]).source, /outside/);
});
