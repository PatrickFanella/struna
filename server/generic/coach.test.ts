import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDb } from "../db.ts";
import { claudeCommand } from "../providers/claude.ts";
import { codexArgs } from "../providers/codex.ts";
import { type CoachDeps, genericCoach, genericContext, genericSystem } from "./coach.ts";
import { starterPlan } from "./starter.ts";
import { ensureStudio, normalizeProfile, PLAN_SCHEMA, type Studio, validatePlan, writeProfile } from "./studio.ts";

const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

async function studio(over: Partial<Studio> = {}): Promise<Studio & { cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "guitar-coach-"));
  const home = join(dir, "home");
  await ensureStudio(home);
  const db = openDb(join(dir, "state"));
  return { home, db, timeZone: "UTC", libraryDirs: [], web: true, appName: "Guitar Room", ...over, cleanup: async () => (db.close(), rm(dir, { recursive: true, force: true })) };
}

const profile = normalizeProfile({ level: "new", minutesPerSession: 20 }, "2026-11-14T00:00:00.000Z");
const goodPlan = () => JSON.stringify(starterPlan(profile, "2026-11-14"));

test("claude works in the studio folder and may write only the plan, materials, notes and profile", async () => {
  const s = await studio({ libraryDirs: ["/lib/a", "/lib/b"] });
  try {
    const coach = genericCoach(s);
    assert.equal(coach.claude.cwd, s.home);
    const a = claudeCommand({ system: "sys", options: coach.claude });
    assert.equal(after(a, "--tools"), "Read,Glob,Grep,Edit,Write,WebSearch,WebFetch");
    // Relative rules, as verified against the real CLI: they match inside the working directory only.
    assert.equal(after(a, "--allowedTools"), "Edit(plan/**),Write(plan/**),Edit(materials/**),Write(materials/**),Edit(coach-notes.md),Write(coach-notes.md),Edit(profile.json),Write(profile.json),WebSearch,WebFetch");
    assert.equal(after(a, "--permission-mode"), "dontAsk");
    assert.equal(after(a, "--setting-sources"), "");
    assert.ok(a.includes("--strict-mcp-config"));
    assert.deepEqual(a.flatMap((x, i) => (x === "--add-dir" ? [a[i + 1]] : [])), ["/lib/a", "/lib/b"]);
    assert.ok(!a.some((x) => /Bash|logs|Recordings/.test(x) && x !== "sys"));
    // No bare read rule: reads outside the home and the library folders are denied in dontAsk mode.
    assert.deepEqual(after(a, "--allowedTools")!.split(",").filter((r) => /^(Read|Glob|Grep|Edit|Write)$/.test(r)), []);
  } finally {
    await s.cleanup();
  }
});

test("turning the web off removes claude's web tools and codex's search", async () => {
  const s = await studio({ web: false });
  try {
    const coach = genericCoach(s);
    const a = claudeCommand({ system: "sys", options: coach.claude });
    assert.equal(after(a, "--tools"), "Read,Glob,Grep,Edit,Write");
    assert.ok(!/Web/.test(after(a, "--allowedTools")!));
    assert.ok(!a.includes("--add-dir"));
    const c = codexArgs({ system: "sys", options: coach.codex });
    assert.ok(c.includes('web_search="disabled"'));
    assert.ok(!/search the web|open the page/i.test(String(coach.system).split("Safety")[0]!.split("Materials")[1]!.replace(/You have no web access[^\n]*/, "")));
    assert.match(String(coach.system), /You have no web access/);
  } finally {
    await s.cleanup();
  }
});

test("codex works in the studio folder, outside git, with live search and the same sandbox", async () => {
  const s = await studio();
  try {
    const coach = genericCoach(s);
    assert.equal(coach.codex.cwd, s.home);
    const first = codexArgs({ system: "sys", options: coach.codex });
    const resumed = codexArgs({ system: "sys", threadId: "t-1", options: coach.codex });
    assert.equal(first[0], "exec");
    assert.deepEqual(resumed.slice(0, 3), ["exec", "resume", "t-1"]);
    for (const a of [first, resumed]) {
      // `exec` has no --search flag; the config key is what both `exec` and `exec resume` accept.
      assert.ok(!a.includes("--search"));
      for (const x of ["--skip-git-repo-check", 'web_search="live"', 'sandbox_mode="workspace-write"', "sandbox_workspace_write.network_access=false", 'approval_policy="never"', "--ignore-user-config", "--ignore-rules"]) assert.ok(a.includes(x), x);
      assert.equal(a.at(-1), "-");
    }
  } finally {
    await s.cleanup();
  }
});

test("the instructions carry the plan schema and the rules a coach of any level needs", () => {
  const sys = genericSystem({ appName: "Six Strings", web: true, libraryDirs: ["/lib/tabs"] });
  assert.ok(sys.includes(PLAN_SCHEMA), "the schema text comes from studio.ts, next to validatePlan");
  for (const s of ["Six Strings", "profile.json", "coach-notes.md", "plan/archive/", "materials/links.json", "logs/", "Recordings/", "/lib/tabs", '"save": true', "Never add a URL you have not opened", "never copy them out", "YouTube", "numbness", "Do not diagnose", "too hard", "too easy", "at most one question", "[Guitar Room]", "left-handed", "no term without a one-line explanation"]) {
    assert.ok(sys.includes(s), s);
  }
  assert.ok(!/Kvant|Obsidian|vault|Ars Malefica/i.test(sys));
  // Sent on every turn as an argument: keep it well under what a command line holds.
  assert.ok(sys.length < 12_000, String(sys.length));
});

test("a starter plan passes the validator the instructions describe", () => {
  assert.deepEqual(validatePlan(JSON.parse(goodPlan())).errors, []);
});

test("the context block names the level, plan, place, stage, material, tempo, next step and the gap", () => {
  const ctx = genericContext(
    { view: "practice session", stage: "One new thing", fragment: "Em to G change", bpm: 60, subdivision: "quarter notes" },
    { block: { title: "First chords", id: "first-chords" }, line: "Phase 2 of 4: Clean chord changes, session 3 of 6", next: { text: "four slow changes, eyes closed" }, profile: { level: "new" }, daysSinceLast: 9 },
  );
  assert.equal(
    ctx,
    ["[Guitar Room]", "Screen: practice session", "Level: new", "Plan: First chords (first-chords)", "Phase 2 of 4: Clean chord changes, session 3 of 6", "Stage: One new thing", "Material: Em to G change", "Metronome: 60 BPM, quarter notes", "Next instruction: four slow changes, eyes closed", "Days since the last session: 9", "[/Guitar Room]"].join("\n"),
  );
  const empty = genericContext({ view: "start" }, { block: null, line: "", next: { text: "" }, profile: null, daysSinceLast: null, error: "No plan yet" });
  assert.equal(empty, "[Guitar Room]\nScreen: start\nProfile: not set up yet\nPlan: No plan yet\n[/Guitar Room]");
});

test("the context comes from the real studio and survives a broken one", async () => {
  const s = await studio();
  try {
    await writeProfile(s, profile);
    await writeFile(join(s.home, "plan/plan.json"), goodPlan());
    const ctx = await genericCoach(s).context({ view: "start" });
    assert.match(ctx, /^\[Guitar Room\]\nScreen: start\nLevel: new\nPlan: .+\nPhase 1 of \d: .+, session 1 of \d+\nNext instruction: .+\n\[\/Guitar Room\]$/);
    const broken = genericCoach(s, { genericToday: async () => Promise.reject(new Error("disk")) });
    assert.equal(await broken.context({ view: "start" }), "[Guitar Room]\nScreen: start\n[/Guitar Room]");
  } finally {
    await s.cleanup();
  }
});

const noLinks: Pick<CoachDeps, "reconcileLinks"> = { reconcileLinks: async () => ({ saved: [], failed: [] }) };

test("after a turn: nothing changed, nothing to say", async () => {
  const s = await studio();
  try {
    const coach = genericCoach(s, noLinks);
    const before = await coach.beforeTurn!();
    assert.deepEqual(await coach.afterTurn!(before), { changed: { plan: false, materials: false, profile: false }, notices: [] });
  } finally {
    await s.cleanup();
  }
});

test("after a turn: plan, profile and materials changes are told apart", async () => {
  const s = await studio();
  try {
    const coach = genericCoach(s, noLinks);
    let before = await coach.beforeTurn!();
    await writeFile(join(s.home, "plan/plan.json"), goodPlan());
    assert.deepEqual(await coach.afterTurn!(before), { changed: { plan: true, materials: false, profile: false }, notices: [] });

    before = await coach.beforeTurn!();
    await writeProfile(s, profile);
    await writeFile(join(s.home, "materials/Em chord.md"), "# Em\n");
    assert.deepEqual((await coach.afterTurn!(before)).changed, { plan: false, materials: true, profile: true });

    // Notes, logs and recordings are not something the web reloads.
    before = await coach.beforeTurn!();
    await writeFile(join(s.home, "coach-notes.md"), "- likes blues\n");
    assert.deepEqual((await coach.afterTurn!(before)).changed, { plan: false, materials: false, profile: false });
  } finally {
    await s.cleanup();
  }
});

test("after a turn: an invalid plan asks for one fix, then becomes a notice", async () => {
  const s = await studio();
  try {
    const coach = genericCoach(s, noLinks);
    const before = await coach.beforeTurn!();
    const bad = JSON.parse(goodPlan());
    bad.sessions[0].stages[0].minutes = 500;
    await writeFile(join(s.home, "plan/plan.json"), JSON.stringify(bad));

    const first = await coach.afterTurn!(before, { final: false });
    assert.match(first.followUp!, /^plan\/plan\.json is not valid: sessions\[0\]\.stages\[0\]\.minutes must be a whole number, 1 to 120\.\nFix the file now/);
    assert.deepEqual(first.notices, []);
    assert.equal(first.changed!.plan, true);

    const second = await coach.afterTurn!(before, { final: true });
    assert.equal(second.followUp, undefined);
    assert.equal(second.notices!.length, 1);
    assert.match(second.notices![0]!, /cannot use\. plan\/plan\.json is not valid: sessions\[0\]\.stages\[0\]\.minutes/);

    // Fixed on the follow-up turn: compared with the state before the first turn, so still "changed".
    await writeFile(join(s.home, "plan/plan.json"), goodPlan());
    assert.deepEqual(await coach.afterTurn!(before, { final: true }), { changed: { plan: true, materials: false, profile: false }, notices: [] });
  } finally {
    await s.cleanup();
  }
});

test("after a turn: a plan that was there and is now gone or unparsable is reported", async () => {
  const s = await studio();
  try {
    await writeFile(join(s.home, "plan/plan.json"), goodPlan());
    const coach = genericCoach(s, noLinks);
    const before = await coach.beforeTurn!();
    await rm(join(s.home, "plan/plan.json"));
    assert.match((await coach.afterTurn!(before)).followUp!, /plan\/plan\.json is missing/);
    await writeFile(join(s.home, "plan/plan.json"), "{ nope");
    assert.match((await coach.afterTurn!(before)).followUp!, /plan\/plan\.json is not valid: .*not valid JSON/);
  } finally {
    await s.cleanup();
  }
});

test("after a turn: an untouched invalid plan is not the coach's to fix", async () => {
  const s = await studio();
  try {
    await writeFile(join(s.home, "plan/plan.json"), "{ nope");
    const coach = genericCoach(s, noLinks);
    const before = await coach.beforeTurn!();
    assert.deepEqual(await coach.afterTurn!(before), { changed: { plan: false, materials: false, profile: false }, notices: [] });
  } finally {
    await s.cleanup();
  }
});

test("after a turn: new links are saved, failures become notices, and a broken links.json goes back to the coach", async () => {
  const s = await studio();
  try {
    let calls = 0;
    const coach = genericCoach(s, {
      reconcileLinks: async (st) => {
        calls++;
        await writeFile(join(st.home, "materials/Scale chart.pdf"), "%PDF");
        return { saved: ["materials/Scale chart.pdf"], failed: ["https://example.org/x: this is a web page, not a file; it stays a link"] };
      },
    });
    let before = await coach.beforeTurn!();
    const r = await coach.afterTurn!(before);
    assert.equal(calls, 1);
    assert.deepEqual(r, { changed: { plan: false, materials: true, profile: false }, notices: ["Could not save a copy: https://example.org/x: this is a web page, not a file; it stays a link"] });

    before = await coach.beforeTurn!();
    await mkdir(join(s.home, "materials"), { recursive: true });
    await writeFile(join(s.home, "materials/links.json"), '{"url": "https://example.org"}');
    const broken = await coach.afterTurn!(before);
    assert.match(broken.followUp!, /^materials\/links\.json is not valid: it must be a JSON array/);
    assert.equal(calls, 1, "no downloads while links.json cannot be read");

    const thrower = genericCoach(s, { reconcileLinks: async () => Promise.reject(new Error("offline")) });
    await writeFile(join(s.home, "materials/links.json"), "[]");
    assert.deepEqual((await thrower.afterTurn!(await thrower.beforeTurn!())).notices, ["Could not save copies of the new links: offline"]);
  } finally {
    await s.cleanup();
  }
});

test("after a turn: the real link reconciler runs against the studio", async () => {
  const s = await studio();
  try {
    const coach = genericCoach(s);
    const before = await coach.beforeTurn!();
    await writeFile(join(s.home, "materials/links.json"), JSON.stringify([{ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "A lesson", note: "watch the right hand" }]));
    assert.deepEqual(await coach.afterTurn!(before), { changed: { plan: false, materials: true, profile: false }, notices: [] });
  } finally {
    await s.cleanup();
  }
});
