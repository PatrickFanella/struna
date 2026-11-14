import assert from "node:assert/strict";
import { test } from "node:test";

import { isSixString, sessionSizes, starterPlan } from "./starter.ts";
import { LEVELS, normalizeProfile, validatePlan } from "./studio.ts";

const profile = (level: string, minutesPerSession: number) => normalizeProfile({ level, minutesPerSession }, "2026-11-14T00:00:00.000Z");

test("every level and session length gives a valid plan of the promised shape", () => {
  for (const level of LEVELS) {
    for (const minutes of [5, 7, 10, 15, 20, 30, 45, 60, 180]) {
      const plan = starterPlan(profile(level, minutes), "2026-11-14");
      const checked = validatePlan(JSON.parse(JSON.stringify(plan)));
      assert.deepEqual(checked.errors, [], `${level} ${minutes}`);
      assert.deepEqual(checked.plan, plan, `${level} ${minutes}: validation changes nothing`);
      assert.ok(plan.phases.length >= 3 && plan.phases.length <= 4);
      for (const p of plan.phases) assert.ok(p.sessions >= 4 && p.sessions <= 8);
      assert.ok(plan.sessions.length >= 2 && plan.sessions.length <= 3);
      const total = (id: string) => plan.sessions.find((k) => k.id === id)?.stages.reduce((a, s) => a + s.minutes, 0);
      const size = sessionSizes(minutes);
      assert.equal(total("full"), minutes);
      assert.equal(total("quick"), size.quick);
      assert.equal(total("short") ?? null, size.short);
      assert.equal(plan.sessions[0]!.id, "full");
      assert.equal(plan.sessions.at(-1)!.id, "quick");
      assert.ok(plan.next.length > 20);
      assert.equal(plan.started, "2026-11-14");
    }
  }
});

test("session kinds are sized around the usual length", () => {
  assert.deepEqual(sessionSizes(5), { full: 5, short: null, quick: 3 });
  assert.deepEqual(sessionSizes(10), { full: 10, short: null, quick: 5 });
  assert.deepEqual(sessionSizes(20), { full: 20, short: 10, quick: 5 });
  assert.deepEqual(sessionSizes(30), { full: 30, short: 15, quick: 10 });
  assert.deepEqual(sessionSizes(45), { full: 45, short: 20, quick: 10 });
  assert.deepEqual(sessionSizes(60), { full: 60, short: 30, quick: 10 });
});

test("a beginner's 30 minutes follow the stage order, and a new player's stages are the five in the spec", () => {
  const fresh = starterPlan(profile("new", 30), "2026-11-14");
  assert.deepEqual(fresh.sessions[0]!.stages.map((s) => s.key), ["tune", "warmup", "new", "song", "next"]);
  assert.deepEqual(fresh.sessions[0]!.stages.map((s) => s.minutes), [3, 5, 10, 9, 3]);
  assert.deepEqual(fresh.sessions.at(-1)!.stages.map((s) => s.key), ["tune", "new", "next"]);
  const adv = starterPlan(profile("advanced", 60), "2026-11-14");
  assert.deepEqual(adv.sessions[0]!.stages.map((s) => s.key), ["tune", "warmup", "technique", "repertoire", "improv", "review"]);
});

test("a five-minute plan keeps only focus lines for stages it has", () => {
  const plan = starterPlan(profile("new", 5), "2026-11-14");
  assert.deepEqual(plan.sessions[0]!.stages.map((s) => s.minutes), [1, 2, 1, 1]);
  assert.ok(!("warmup" in plan.phases[0]!.focus));
  assert.ok("new" in plan.phases[0]!.focus);
});

test("the plan for someone who has never played avoids unexplained jargon", () => {
  const text = JSON.stringify(starterPlan(profile("new", 20), "2026-11-14")).toLowerCase();
  for (const word of ["barre", "pentatonic", "arpeggio", "bpm", "metronome", "subdivision", "triad"]) assert.ok(!text.includes(word), word);
});

test("a plan for an instrument that is not a six-string guitar says so in its goal and next step", () => {
  for (const instrument of ["acoustic", "electric", "classical", "guitar", "12-string", "baritone guitar", "steel-string acoustic", "nylon-string"]) assert.equal(isSixString(instrument), true, instrument);
  for (const instrument of ["bass", "bass guitar", "electric bass", "ukulele", "lap steel", "pedal steel", "7-string guitar", "mandolin"]) assert.equal(isSixString(instrument), false, instrument);
  const bass = starterPlan(normalizeProfile({ level: "new", minutesPerSession: 20, instrument: "bass" }, "2026-11-14T00:00:00.000Z"), "2026-11-14");
  assert.match(bass.goal, /^This starter plan is written for six-string guitar\. Ask the coach to rewrite it for your bass\. /);
  assert.match(bass.next, /^This starter plan is written for six-string guitar\./);
  assert.deepEqual(validatePlan(JSON.parse(JSON.stringify(bass))).errors, []);
  const guitar = starterPlan(normalizeProfile({ level: "new", minutesPerSession: 20, instrument: "electric" }, "2026-11-14T00:00:00.000Z"), "2026-11-14");
  assert.ok(!/six-string/.test(guitar.goal + guitar.next));
});
