import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { openDb } from "../db.ts";
import { parseGenericReview, writeGenericLog } from "./logs.ts";
import { computeStats, ensureStudio, genericToday, materialSrc, normalizeProfile, PLAN_SCHEMA, placeInPlan, readPlan, readProfile, type Studio, validatePlan, writeProfile } from "./studio.ts";
import type { Plan } from "./types.ts";

const tmp = await mkdtemp(join(tmpdir(), "guitar-generic-studio-"));
after(() => rm(tmp, { recursive: true, force: true }));

let n = 0;
async function studio(): Promise<Studio> {
  const home = join(tmp, `home-${++n}`);
  await ensureStudio(home);
  return { home, db: openDb(join(tmp, `state-${n}`)), timeZone: "America/Chicago", libraryDirs: [], web: true, appName: "Guitar Room" };
}

const PLAN = {
  version: 1,
  id: "open-chords",
  title: "Open chords",
  goal: "Change chords in time.",
  started: "2026-11-10",
  phases: [
    { title: "Shapes", sessions: 2, summary: "Make them ring.", focus: { chords: "G and C." } },
    { title: "Changes", sessions: 3, summary: "Move in time.", focus: { chords: "G to C to D.", song: "One strum per beat." } },
  ],
  sessions: [
    { id: "full", label: "Full session", stages: [{ key: "tune", title: "Tune", minutes: 2, task: "Tune up." }, { key: "chords", title: "Chords", minutes: 10, task: "Work on the chords." }, { key: "song", title: "Song", minutes: 8, task: "Play the song." }] },
    { id: "quick", label: "Quick session", stages: [{ key: "chords", title: "Chords", minutes: 5, task: "Work on the chords." }] },
  ],
  materials: [],
  next: "Start with G.",
  extras: ["Listen to a record."],
};
const writePlan = (s: Studio, plan: unknown) => writeFile(join(s.home, "plan/plan.json"), JSON.stringify(plan));
const log = (s: Studio, at: string, fields: Record<string, unknown> = {}) =>
  writeGenericLog(s.home, parseGenericReview({ planId: "open-chords", session: { id: "full", label: "Full session" }, minutes: 20, ...fields }), new Date(at), s.timeZone);

test("ensureStudio makes the folder layout", async () => {
  const s = await studio();
  for (const d of ["plan/archive", "logs", "materials", "Recordings"]) await writeFile(join(s.home, d, ".probe"), "");
});

test("a valid plan passes and comes back normalised", () => {
  const { plan, errors } = validatePlan({ ...PLAN, materials: undefined, extras: undefined, surprise: 1, title: "  Open chords " });
  assert.deepEqual(errors, []);
  assert.deepEqual(plan, { ...PLAN, extras: [] });
  assert.ok(!("surprise" in plan!));
});

test("errors name the JSON path and the rule", () => {
  const bad = structuredClone(PLAN) as any;
  bad.version = 2;
  bad.id = "Open Chords";
  bad.started = "2026-02-30";
  bad.sessions[0].stages[2].minutes = 0;
  bad.sessions[0].stages[1].key = "tune";
  bad.sessions[1].id = "full";
  bad.sessions[1].stages[0].key = "Chords";
  bad.phases[0].sessions = 1.5;
  bad.phases[1].focus = { riffs: "x" };
  bad.materials = [{ label: "A", file: "../secret.pdf" }, { label: "B", file: "/etc/passwd" }, { label: "C", file: "logs/x.md" }, { label: "D", url: "ftp://x/y" }, { file: "materials/x.pdf" }, { label: "E", file: "materials/ok.pdf", url: "https://example.com/a" }];
  bad.extras = ["ok", 3];
  bad.title = "x".repeat(201);
  const { plan, errors } = validatePlan(bad);
  assert.equal(plan, null);
  for (const want of [
    "version must be 1",
    "id must be lower-case letters, digits and dashes, starting with a letter or digit, at most 61 characters",
    "title must be at most 200 characters (it has 201)",
    "started must be a real date written YYYY-MM-DD",
    "sessions[0].stages[2].minutes must be a whole number, 1 to 120",
    'sessions[0].stages[1].key "tune" is used by an earlier stage of this session kind; keys must be unique within a kind',
    'sessions[1].id "full" is used by an earlier session kind; ids must be unique',
    "sessions[1].stages[0].key must start with a lower-case letter and use only lower-case letters, digits and dashes, at most 31 characters",
    "phases[0].sessions must be a whole number, 1 to 200",
    "phases[0].focus.chords does not match any stage key; the stage keys are: tune, song",
    "phases[1].focus.riffs does not match any stage key; the stage keys are: tune, song",
    'materials[0].file must not contain "..", "." or empty path segments (got "../secret.pdf")',
    'materials[1].file must be a relative path with forward slashes (got "/etc/passwd")',
    'materials[2].file must be a file under "materials/" (got "logs/x.md")',
    "materials[3].url must be an http or https URL",
    "materials[4].label is required",
    "extras[1] must be a string",
  ]) assert.ok(errors.includes(want), `missing: ${want}\n${errors.join("\n")}`);
  assert.equal(errors.length, 17, errors.join("\n"));
});

test("structure errors: missing arrays, wrong types, reserved id, too many stages", () => {
  assert.deepEqual(validatePlan([]).errors, ["the plan must be a JSON object"]);
  const e = validatePlan({ version: 1, id: "a", title: "A", started: "2026-11-10", phases: [], sessions: "x" }).errors;
  assert.deepEqual(e, ["sessions must be an array", "phases must have at least 1 item"]);
  assert.deepEqual(validatePlan({ version: 1 }).errors, ["id is required", "title is required", "started is required", "sessions is required: an array with at least 1 item", "phases is required: an array with at least 1 item"]);
  const many = structuredClone(PLAN) as any;
  many.sessions[1] = { id: "extra", label: "X", stages: Array.from({ length: 13 }, (_, i) => ({ key: `s${i}`, title: "S", minutes: 1, task: "t" })) };
  assert.deepEqual(validatePlan(many).errors, ['sessions[1].id must not be "extra": that word marks off-day sessions in the logs', "sessions[1].stages must have at most 12 items (it has 13)"]);
  const typed = structuredClone(PLAN) as any;
  typed.phases[0] = "one";
  typed.sessions[0].stages[0].task = 5;
  assert.deepEqual(validatePlan(typed).errors, ["sessions[0].stages[0].task must be a string", "phases[0] must be an object"]);
});

test("the schema text for the coach carries the same limits", () => {
  assert.match(PLAN_SCHEMA, /whole number 1 to 120/);
  assert.match(PLAN_SCHEMA, /1 to 12\n/);
  assert.match(PLAN_SCHEMA, /"phases": \[ +\/\/ 1 to 24/);
});

test("readPlan: no file, broken JSON, invalid, valid", async () => {
  const s = await studio();
  assert.deepEqual(await readPlan(s), { plan: null, errors: [] });
  await writeFile(join(s.home, "plan/plan.json"), "{ nope");
  const broken = await readPlan(s);
  assert.equal(broken.plan, null);
  assert.match(broken.errors[0]!, /^plan\/plan\.json is not valid JSON: /);
  await writePlan(s, { ...PLAN, version: 3 });
  assert.deepEqual((await readPlan(s)).errors, ["version must be 1"]);
  await writePlan(s, PLAN);
  assert.equal((await readPlan(s)).plan!.id, "open-chords");
});

test("the profile is clamped and survives a coach's edit", async () => {
  const s = await studio();
  assert.equal(await readProfile(s), null);
  const p = normalizeProfile({ level: "wizard", minutesPerSession: 999, daysPerWeek: 0, styles: "blues, folk ,blues", reads: ["tab"], hand: "left", name: "x".repeat(200) }, "2026-11-14T00:00:00.000Z");
  assert.equal(p.level, "beginner");
  assert.equal(p.minutesPerSession, 180);
  assert.equal(p.daysPerWeek, 1);
  assert.deepEqual(p.styles, ["blues", "folk"]);
  assert.equal(p.hand, "left");
  assert.equal(p.name.length, 80);
  assert.equal(p.created, "2026-11-14T00:00:00.000Z");
  await writeProfile(s, p);
  assert.deepEqual(await readProfile(s), p);
  await writeFile(join(s.home, "profile.json"), JSON.stringify({ level: "advanced", minutesPerSession: "45", created: "2026-01-01T00:00:00.000Z" }));
  const edited = await readProfile(s);
  assert.equal(edited!.level, "advanced");
  assert.equal(edited!.minutesPerSession, 45);
  assert.equal(edited!.created, "2026-01-01T00:00:00.000Z");
  await writeFile(join(s.home, "profile.json"), "[1]");
  assert.equal(await readProfile(s), null);
});

test("placeInPlan walks the phases and stays on the last", () => {
  const plan = PLAN as unknown as Plan;
  assert.deepEqual(placeInPlan(plan, 0), { index: 0, sessionInPhase: 1 });
  assert.deepEqual(placeInPlan(plan, 1), { index: 0, sessionInPhase: 2 });
  assert.deepEqual(placeInPlan(plan, 2), { index: 1, sessionInPhase: 1 });
  assert.deepEqual(placeInPlan(plan, 4), { index: 1, sessionInPhase: 3 });
  assert.deepEqual(placeInPlan(plan, 7), { index: 1, sessionInPhase: 6 });
});

test("stats: Monday-based week, streak up to today or yesterday, minutes", () => {
  const l = (date: string, o: object = {}) => ({ file: `${date}.md`, date, created: null, planId: "", phase: "", session: "full", sessionLabel: "Full", extra: false, minutes: 10, material: "", cleanTempo: null, difficulty: null, wentWell: "", struggled: "", pain: false, next: null, ...o });
  // 2026-11-14 is a Saturday; the week began on Monday the 9th.
  const logs = [l("2026-11-07"), l("2026-11-08"), l("2026-11-11"), l("2026-11-12", { pain: true }), l("2026-11-13", { extra: true, session: "extra" })];
  assert.deepEqual(computeStats(logs, "2026-11-14"), { total: 3, thisWeek: 1, streakDays: 3, minutes: 50, last: "2026-11-13" });
  assert.equal(computeStats(logs, "2026-11-13").streakDays, 3);
  assert.equal(computeStats(logs, "2026-11-15").streakDays, 0);
  assert.deepEqual(computeStats([], "2026-11-14"), { total: 0, thisWeek: 0, streakDays: 0, minutes: 0, last: null });
  assert.equal(computeStats([l("2026-11-09")], "2026-11-15").thisWeek, 1);
  assert.equal(computeStats([l("2026-11-08")], "2026-11-09").thisWeek, 0);
});

test("today without a plan, and with an invalid one", async () => {
  const s = await studio();
  const none = await genericToday(s, new Date("2026-11-14T18:00:00Z"));
  assert.equal(none.block, null);
  assert.equal(none.error, "No plan yet");
  assert.deepEqual(none.sessions, []);
  assert.equal(none.daysSinceLast, null);
  assert.equal(none.profile, null);
  await writePlan(s, { ...PLAN, sessions: [] });
  assert.equal((await genericToday(s)).error, "plan/plan.json is not valid: sessions must have at least 1 item");
});

test("today places the session, counts and builds the stages", async () => {
  const s = await studio();
  await writePlan(s, PLAN);
  const at = new Date("2026-11-14T18:00:00Z");
  let t = await genericToday(s, at);
  assert.deepEqual(t.block, { id: "open-chords", title: "Open chords", path: "plan/plan.json", started: "2026-11-10", targetSessions: 5, goal: "Change chords in time.", weeks: [], materials: [], crossTraining: ["Listen to a record."] });
  assert.deepEqual(t.position, { week: 1, sessionInWeek: 1, type: "Shapes", number: 1 });
  assert.equal(t.line, "Phase 1 of 2: Shapes, session 1 of 2");
  assert.deepEqual(t.phase, { n: 1, of: 2, title: "Shapes", summary: "Make them ring." });
  assert.deepEqual(t.next, { text: "Start with G.", source: "plan" });
  assert.deepEqual(t.sessions.map((k) => [k.id, k.label, k.minutes]), [["full", "Full session", 20], ["quick", "Quick session", 5]]);
  assert.deepEqual(t.sessions[0]!.stages[0], { key: "tune", title: "Tune", minutes: 2, output: "Tune up.", instruction: "Tune up.\n\nToday: Start with G." });
  assert.deepEqual(t.sessions[0]!.stages[1], { key: "chords", title: "Chords", minutes: 10, output: "Work on the chords.", instruction: "Work on the chords.\n\nG and C." });
  assert.equal(t.sessions[0]!.stages[2]!.instruction, "Play the song.");
  assert.equal(t.stages.full, t.sessions[0]!.stages);
  assert.equal(t.stages.floor, t.sessions[1]!.stages);
  assert.equal(t.weekOverride, null);
  assert.equal(t.overDue, false);
  assert.equal(t.error, undefined);

  await log(s, "2026-11-09T18:00:00Z"); // before the plan started
  await log(s, "2026-11-10T18:00:00Z");
  await log(s, "2026-11-11T18:00:00Z", { session: { id: "quick", label: "Quick session" } });
  await log(s, "2026-11-12T18:00:00Z", { pain: true });
  await log(s, "2026-11-12T19:00:00Z", { extra: "Listen to a record." });
  await log(s, "2026-11-13T18:00:00Z");
  t = await genericToday(s, at);
  assert.deepEqual(t.position, { week: 2, sessionInWeek: 2, type: "Changes", number: 4 });
  assert.equal(t.line, "Phase 2 of 2: Changes, session 2 of 3");
  assert.deepEqual(t.counts, { full: 2, floor: 1 });
  assert.equal(t.sessions[0]!.stages[2]!.instruction, "Play the song.\n\nOne strum per beat.");
  assert.deepEqual(t.stats, { total: 4, thisWeek: 4, streakDays: 5, minutes: 120, last: "2026-11-13" });
  assert.equal(t.daysSinceLast, 1);

  await log(s, "2026-11-14T15:00:00Z");
  await log(s, "2026-11-14T16:00:00Z");
  t = await genericToday(s, at);
  assert.equal(t.overDue, true);
  assert.equal(t.line, "Phase 2 of 2: Changes, session 4 (plan complete)");
  assert.equal(t.daysSinceLast, 0);
});

test("the next instruction comes from the newest log unless the plan's changed after it", async () => {
  const s = await studio();
  const planPath = join(s.home, "plan/plan.json");
  const at = (iso: string) => utimes(planPath, new Date(iso), new Date(iso));
  await writePlan(s, PLAN);
  await at("2026-11-10T12:00:00Z");
  assert.deepEqual((await genericToday(s)).next, { text: "Start with G.", source: "plan" });

  await log(s, "2026-11-10T18:00:00Z", { next: "Start at 60 with G to C." });
  await log(s, "2026-11-11T18:00:00Z", {}); // no instruction: the earlier one stands
  assert.deepEqual((await genericToday(s)).next, { text: "Start at 60 with G to C.", source: "log" });

  // The coach edits other parts of the plan: the file is newer but the instruction is the same.
  await writePlan(s, { ...PLAN, goal: "Change chords in time, relaxed." });
  await at("2026-11-11T20:00:00Z");
  assert.equal((await genericToday(s)).next.source, "log");

  // The coach sets a new instruction after the log.
  await writePlan(s, { ...PLAN, next: "Coach: slow the change to 50." });
  await at("2026-11-11T21:00:00Z");
  const t = await genericToday(s);
  assert.deepEqual(t.next, { text: "Coach: slow the change to 50.", source: "plan" });
  assert.equal(t.sessions[0]!.stages[0]!.instruction, "Tune up.\n\nToday: Coach: slow the change to 50.");
  assert.equal((await genericToday(s)).next.source, "plan");

  // A later session's instruction takes over again.
  await log(s, "2026-11-12T18:00:00Z", { next: "Start at 54." });
  assert.deepEqual((await genericToday(s)).next, { text: "Start at 54.", source: "log" });

  // A pain stop is not counted, so its instruction is not used.
  await log(s, "2026-11-13T18:00:00Z", { next: "Rest.", pain: true });
  assert.equal((await genericToday(s)).next.text, "Start at 54.");

  // An empty plan instruction never hides a log's.
  await writePlan(s, { ...PLAN, next: "" });
  assert.equal((await genericToday(s)).next.text, "Start at 54.");
});

test("plan materials resolve inside the home; missing files and links out are marked", async () => {
  const s = await studio();
  await writeFile(join(s.home, "materials/Blues in A.pdf"), "%PDF");
  await mkdir(join(s.home, "materials/sheets"));
  await writeFile(join(s.home, "materials/sheets/riff.md"), "tab");
  await writeFile(join(tmp, "outside.pdf"), "%PDF");
  await symlink(join(tmp, "outside.pdf"), join(s.home, "materials/link.pdf"));
  await writePlan(s, {
    ...PLAN,
    materials: [
      { label: "Blues", file: "materials/Blues in A.pdf", note: "Page 2" },
      { label: "Riff", file: "materials/sheets/riff.md" },
      { label: "Gone", file: "materials/gone.mp4" },
      { label: "Escapes", file: "materials/link.pdf" },
      { label: "Lesson", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
      { label: "Site", url: "https://example.com/lesson" },
      { label: "Your songbook" },
    ],
  });
  const m = (await genericToday(s)).materials;
  assert.deepEqual(m[0], { label: "Blues", key: "materials/Blues in A.pdf", kind: "pdf", src: materialSrc("materials/Blues in A.pdf"), note: "Page 2" });
  assert.equal(m[0]!.src, `/api/materials/file?id=f.${Buffer.from("Blues in A.pdf").toString("base64url")}`);
  assert.deepEqual(m[1], { label: "Riff", key: "materials/sheets/riff.md", kind: "text", src: materialSrc("materials/sheets/riff.md") });
  assert.deepEqual(m[2], { label: "Gone", key: "materials/gone.mp4", kind: "video", src: null, missing: true });
  assert.deepEqual(m[3], { label: "Escapes", key: "materials/link.pdf", kind: "pdf", src: null, missing: true });
  assert.deepEqual(m[4], { label: "Lesson", key: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", kind: "link", src: null, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", youtube: "dQw4w9WgXcQ" });
  assert.deepEqual(m[5], { label: "Site", key: "https://example.com/lesson", kind: "link", src: null, url: "https://example.com/lesson" });
  assert.deepEqual(m[6], { label: "Your songbook", key: "label-6", kind: "other", src: null });
});
