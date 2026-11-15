import assert from "node:assert/strict";
import { test } from "node:test";

import type { Profile } from "../generic.ts";
import { sessionKind, sessionKinds, type Stage, type Today } from "../types.ts";
import { breakDue, defaultProfile, fromForm, kindLabel, logFacts, nextDraft, profileAction, sameProfile, shortDate, statsFacts, tempo, toForm } from "./genericLogic.ts";

const stage = (key: string, minutes: number): Stage => ({ key, title: key, minutes, output: key });
const personal: Today = {
  block: null,
  position: { week: 1, sessionInWeek: 1, type: "decode", number: 1 },
  weekOverride: null,
  counts: { full: 0, floor: 0 },
  next: { text: "", source: "ledger" },
  stages: { full: [stage("target", 2), stage("music", 43)], floor: [stage("target", 15)] },
  overDue: false,
};

test("personal mode keeps its two fixed session kinds", () => {
  const kinds = sessionKinds(personal);
  assert.deepEqual(kinds.map((k) => [k.id, k.label, k.minutes]), [["full", "Full session (45 min)", 45], ["floor", "Short session (15 min)", 15]]);
  assert.equal(kinds[0]!.stages, personal.stages.full);
  assert.equal(sessionKind(personal, "floor").stages, personal.stages.floor);
});

test("studio mode uses the plan's kinds, and a removed kind falls back to the first", () => {
  const today: Today = { ...personal, sessions: [{ id: "quick", label: "Quick", minutes: 8, stages: [stage("tune", 8)] }, { id: "usual", label: "Usual", minutes: 20, stages: [stage("tune", 20)] }] };
  assert.deepEqual(sessionKinds(today).map((k) => k.id), ["quick", "usual"]);
  assert.equal(sessionKind(today, "usual").label, "Usual");
  assert.equal(sessionKind(today, "full").id, "quick");
});

test("the form round-trips a profile, keeping styles and instruments it does not offer", () => {
  const p: Profile = { version: 1, name: " Ana ", level: "intermediate", instrument: "Ukulele", styles: ["blues", "Bossa nova"], goals: "g", wants: "w", minutesPerSession: 25, daysPerWeek: 9, reads: ["notation", "tab", "x"], hand: "left", limits: "", notes: "", created: "c", updated: "u" };
  const f = toForm(p);
  assert.equal(f.instrument, "other");
  assert.equal(f.instrumentOther, "Ukulele");
  assert.deepEqual(f.styles, ["Blues"]);
  assert.equal(f.stylesOther, "Bossa nova");
  assert.equal(f.minutesPerSession, 20);
  assert.equal(f.daysPerWeek, 7);
  assert.deepEqual(f.reads, ["tab", "notation"]);
  const out = fromForm({ ...f, stylesOther: "Bossa nova, blues; Surf" });
  assert.deepEqual(out.styles, ["Blues", "Bossa nova", "Surf"]);
  assert.equal(out.instrument, "Ukulele");
  assert.equal(out.name, "Ana");
  assert.equal(out.hand, "left");
  assert.ok(!("created" in out));
});

test("the default profile is a beginner the server can take as is", () => {
  const d = defaultProfile();
  assert.equal(d.level, "beginner");
  assert.deepEqual(fromForm(toForm(null)), d);
  assert.ok(sameProfile(d, { ...d, name: "  " }));
  assert.ok(!sameProfile(d, { ...d, level: "new" }));
});

test("which coach action follows a profile save", () => {
  const d = defaultProfile();
  const base = { before: d, after: { ...d, goals: "play at a wedding" }, plan: "kept" as const, skipped: false, skippedBefore: false };
  assert.equal(profileAction({ ...base, before: null, plan: "created" }), "onboarding");
  assert.equal(profileAction({ ...base, before: null, plan: "created", skipped: true }), null);
  assert.equal(profileAction({ ...base, skippedBefore: true }), "onboarding");
  assert.equal(profileAction(base), "profile-changed");
  assert.equal(profileAction({ ...base, after: d }), null);
  assert.equal(profileAction({ ...base, after: d, plan: "created" }), "onboarding");
});

test("labels, stats and history lines", () => {
  assert.equal(kindLabel({ label: "Short", minutes: 10 }), "Short (10 min)");
  assert.equal(kindLabel({ label: "Full session (45 min)", minutes: 45 }), "Full session (45 min)");
  assert.equal(kindLabel({ label: "Ten minutes", minutes: 10 }), "Ten minutes");
  assert.deepEqual(statsFacts(undefined), []);
  assert.deepEqual(statsFacts({ total: 0, thisWeek: 0, streakDays: 0, minutes: 0, last: null }), []);
  assert.deepEqual(statsFacts({ total: 1, thisWeek: 1, streakDays: 1, minutes: 12, last: "2026-11-14" }), ["1 session this week", "1 in all", "12 min played"]);
  assert.deepEqual(statsFacts({ total: 30, thisWeek: 3, streakDays: 4, minutes: 615, last: "2026-11-14" }), ["3 sessions this week", "4 days in a row", "30 in all", "10 hours played"]);
  assert.equal(logFacts({ file: "f", date: "2026-11-03", session: "Short", minutes: 12, material: "Blues in A", cleanTempo: null, difficulty: "about right", pain: false, next: "" }), "Short, 12 min, Blues in A, about right");
  assert.equal(logFacts({ file: "f", date: "2026-11-03", session: "Full", minutes: null, material: "not recorded", cleanTempo: null, difficulty: "too hard", pain: "yes", next: "" }), "Full, stopped for pain or tension");
  assert.equal(shortDate("2026-11-03"), "Tue 3 Nov");
  assert.equal(shortDate("soon"), "soon");
});

test("optional tempos for the review", () => {
  assert.equal(tempo("72"), 72);
  assert.equal(tempo(""), null);
  assert.equal(tempo("12"), null);
  assert.equal(tempo("fast"), null);
});

test("the next-instruction draft follows difficulty, tempo and pain", () => {
  const o = { material: "Blues in A", bpm: 72 as number | null, difficulty: "about right" as const, pain: false, fallback: "Keep going." };
  assert.equal(nextDraft(o), "Start with Blues in A at 72 BPM.");
  assert.equal(nextDraft({ ...o, bpm: null }), "Start with Blues in A, from where you stopped.");
  assert.match(nextDraft({ ...o, difficulty: "too hard" }), /slower than 72 BPM/);
  assert.match(nextDraft({ ...o, difficulty: "too easy", bpm: null }), /move on to the next step/);
  assert.equal(nextDraft({ ...o, material: " " }), "Keep going.");
  assert.match(nextDraft({ ...o, pain: true }), /^Rest until/);
});

test("the break prompt is offered once per gap", () => {
  const stats = { total: 3, thisWeek: 0, streakDays: 0, minutes: 40, last: "2026-11-01" };
  assert.ok(breakDue(9, stats, null));
  assert.ok(!breakDue(9, stats, "2026-11-01"));
  assert.ok(breakDue(8, { ...stats, last: "2026-11-20" }, "2026-11-01"));
  assert.ok(!breakDue(6, stats, null));
  assert.ok(!breakDue(null, undefined, null));
});

test("the setup form offers six-string guitars and assumes nothing readable", async () => {
  const { INSTRUMENTS } = await import("./genericLogic.ts");
  assert.deepEqual(INSTRUMENTS.map(([id]) => id), ["acoustic", "electric", "classical"]);
  assert.deepEqual(defaultProfile().reads, []);
  // A profile saved as "bass" before still loads, as Other with its text kept.
  const f = toForm({ ...defaultProfile(), instrument: "bass" });
  assert.deepEqual([f.instrument, f.instrumentOther], ["other", "bass"]);
});

test("a review draft comes back after a reload, only for the same session", async () => {
  const { restoreReviewDraft } = await import("./genericLogic.ts");
  const first = { material: "", struggled: "", minutes: "3", nextEdited: false };
  const stored = JSON.stringify({ startedAt: 111, form: { material: "G to C", struggled: "wrist ached on barre", minutes: 5, nextEdited: true, extra: "x" } });
  assert.deepEqual(restoreReviewDraft(stored, 111, first), { material: "G to C", struggled: "wrist ached on barre", minutes: "3", nextEdited: true });
  assert.equal(restoreReviewDraft(stored, 222, first), first);
  assert.equal(restoreReviewDraft("{nope", 111, first), first);
  assert.equal(restoreReviewDraft(null, 111, first), first);
  assert.equal(restoreReviewDraft(stored, undefined, first), first);
});


test("review uses only scoped materials and the latest confirmed checkpoint, with separate editable blanks", async () => {
  const { reviewMeasurements } = await import("./genericLogic.ts");
  const roll = { itemId: "file-roll", key: "materials/roll.md", label: "Baseline roll", kind: "text" as const, src: null, file: "materials/roll.md" };
  const tune = { key: "tab:tune", label: "Black Mountain Rag", kind: "link" as const, src: null };
  const stages = [{ key: "technique", title: "Technique", minutes: 6, instruction: "Roll", output: "", material: roll }, { key: "song", title: "Tune", minutes: 10, instruction: "Tune", output: "", material: tune }];
  const checkpoint = { materialKey: `plan:${roll.key}`, materialLabel: roll.label, stageKey: "technique", sessionKind: "full", bpm: 80, confirmedAt: "2026-11-15T10:00:00Z", context: "clean-pass" as const, pass: 1 };
  const fresh = reviewMeasurements(stages, { checkpoints: [checkpoint, { ...checkpoint, bpm: 84 }] });
  assert.deepEqual(fresh, [{ materialKey: roll.key, materialLabel: roll.label, bpm: "84" }, { materialKey: tune.key, materialLabel: tune.label, bpm: "" }]);
  const edited = fresh.map((m, i) => ({ ...m, bpm: i === 0 ? "" : "96" }));
  assert.deepEqual(reviewMeasurements(stages, { checkpoints: [checkpoint] }, JSON.parse(JSON.stringify(edited))), edited);
  assert.equal(reviewMeasurements(stages.slice(0, 1), {}).some((m) => m.materialKey === tune.key), false);
  assert.deepEqual(reviewMeasurements([], { checkpoints: [checkpoint] }), [{ materialKey: roll.key, materialLabel: roll.label, bpm: "80" }]);
  assert.deepEqual(reviewMeasurements([], {}), []);
  assert.deepEqual(reviewMeasurements(stages, { checkpoints: [{ ...checkpoint, materialKey: "mat:file-roll" }], addedActivities: [{ key: "plan:materials/roll.md", title: "Baseline roll" }] }), [{ materialKey: roll.key, materialLabel: roll.label, bpm: "80" }, { materialKey: tune.key, materialLabel: tune.label, bpm: "" }]);
  assert.deepEqual(reviewMeasurements(stages, {}, [{ bpm: "88" }, null]), reviewMeasurements(stages, {}));
  assert.equal(reviewMeasurements(stages, {}, null).length, 2);
});
