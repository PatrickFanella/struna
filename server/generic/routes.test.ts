import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const tmp = await mkdtemp(join(tmpdir(), "guitar-generic-routes-"));
const home = join(tmp, "studio");
process.env.STRUNA_MODE = "studio";
process.env.STRUNA_HOME = home;
process.env.STRUNA_STATE_DIR = join(tmp, "state");
process.env.STRUNA_CACHE_DIR = join(tmp, "cache");
process.env.STRUNA_TIMEZONE = "America/Chicago";
process.env.STRUNA_APP_NAME = "Six Strings";
process.env.STRUNA_NO_SCAN = "1";
delete process.env.STRUNA_TABS_DIR;
delete process.env.STRUNA_LIBRARY_DIRS;
delete process.env.STRUNA_COACH_WEB;
// The vault must never be touched in this mode: point it somewhere that does not exist.
process.env.STRUNA_VAULT_ROOT = join(tmp, "no-vault");
process.env.STRUNA_MEDIA_ROOT = join(tmp, "no-media");

const { access, handle } = await import("../index.ts");
const { config } = await import("../config.ts");
const { parseGenericLog } = await import("./logs.ts");
const { DatabaseSync } = await import("node:sqlite");

let server: Server;
let base = "";
before(async () => {
  server = createServer(handle);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});
after(async () => {
  server.close();
  await rm(tmp, { recursive: true, force: true });
});

// Loopback TCP with no edge secret: every request carries the access token.
const T = { "x-struna-token": access!.token };
const H = { ...T, "x-struna": "1", "content-type": "application/json" };
const get = async (path: string) => (await fetch(`${base}${path}`, { headers: T })).json() as Promise<any>;
const put = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "PUT", headers: H, body: JSON.stringify(body) });
const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });

test("the generic config keeps its own state and creates the studio folder", async () => {
  assert.equal(config.mode, "studio");
  assert.equal(config.home, home);
  assert.equal(config.timeZone, "America/Chicago");
  assert.deepEqual((await readdir(home)).sort(), ["Recordings", "logs", "materials", "plan"]);
  assert.ok((await stat(join(home, "plan/archive"))).isDirectory());
});

test("GET /api/app describes the mode before and after setup", async () => {
  assert.deepEqual(await get("/api/app"), { mode: "studio", name: "Six Strings", sections: ["practice", "materials"], web: true, profile: false });
  assert.deepEqual(await get("/api/health"), { ok: true });
});

test("the personal mode's vault routes are not there", async () => {
  for (const path of ["/api/week-override", "/api/vault-file?path=x", "/api/library", "/api/tabs"]) {
    const r = path === "/api/week-override" ? await put(path, { week: 2 }) : await fetch(`${base}${path}`, { headers: T });
    assert.equal(r.status, 404, path);
  }
  await assert.rejects(stat(join(tmp, "no-vault")));
});

test("today before setup says there is no plan", async () => {
  const t = await get("/api/today");
  assert.equal(t.block, null);
  assert.equal(t.error, "No plan yet");
  assert.equal(t.profile, null);
  assert.deepEqual(await get("/api/profile"), { profile: null });
});

test("PUT /api/profile validates, stamps and writes a starter plan once", async () => {
  assert.equal((await put("/api/profile", { level: "wizard" })).status, 400);
  assert.equal((await put("/api/profile", [1])).status, 400);
  assert.equal((await fetch(`${base}/api/profile`, { method: "PUT", headers: T, body: "{}" })).status, 403);
  // Without the token, even a request with the app header is refused, and so is a page.
  assert.equal((await fetch(`${base}/api/profile`, { method: "PUT", headers: { "x-struna": "1" }, body: "{}" })).status, 403);
  assert.equal((await fetch(`${base}/api/today`)).status, 403);

  const r = await put("/api/profile", { name: " Ana ", level: "new", minutesPerSession: 20, daysPerWeek: 9, styles: ["folk"], created: "1999-01-01T00:00:00.000Z" });
  assert.equal(r.status, 200);
  const first = (await r.json()) as any;
  assert.equal(first.plan, "created");
  assert.equal(first.profile.name, "Ana");
  assert.equal(first.profile.daysPerWeek, 7);
  assert.notEqual(first.profile.created, "1999-01-01T00:00:00.000Z");
  assert.equal(first.profile.created, first.profile.updated);
  assert.deepEqual(JSON.parse(await readFile(join(home, "profile.json"), "utf8")), first.profile);
  const plan = JSON.parse(await readFile(join(home, "plan/plan.json"), "utf8"));
  assert.equal(plan.id, "starter-first-steps");
  assert.deepEqual(plan.sessions.map((k: any) => k.stages.reduce((a: number, s: any) => a + s.minutes, 0)), [20, 10, 5]);

  // A later save keeps the plan (and the fields the form did not send) and only moves `updated`.
  await new Promise((r) => setTimeout(r, 5));
  const second = (await (await put("/api/profile", { level: "intermediate", minutesPerSession: 45 })).json()) as any;
  assert.equal(second.plan, "kept");
  assert.equal(second.profile.name, "Ana");
  assert.equal(second.profile.level, "intermediate");
  assert.equal(second.profile.created, first.profile.created);
  assert.ok(second.profile.updated > first.profile.updated);
  assert.equal(JSON.parse(await readFile(join(home, "plan/plan.json"), "utf8")).id, "starter-first-steps");
  assert.equal((await get("/api/app")).profile, true);
});

test("an invalid plan is archived and replaced by a starter; a valid one is never replaced", async () => {
  await writeFile(join(home, "plan/plan.json"), '{"version": 1, "id": "broken"}');
  assert.match((await get("/api/today")).error, /^plan\/plan\.json is not valid: title is required; /);
  const r = (await (await put("/api/profile", {})).json()) as any;
  assert.equal(r.plan, "created");
  const archived = (await readdir(join(home, "plan/archive"))).filter((n) => n.startsWith("invalid-"));
  assert.equal(archived.length, 1);
  assert.equal(await readFile(join(home, "plan/archive", archived[0]!), "utf8"), '{"version": 1, "id": "broken"}');
  assert.equal(JSON.parse(await readFile(join(home, "plan/plan.json"), "utf8")).id, "starter-fluent-playing");
});

test("a session is logged, counted and listed; today moves on", async () => {
  let t = await get("/api/today");
  assert.equal(t.block.id, "starter-fluent-playing");
  assert.equal(t.line, "Phase 1 of 4: Barre chords and tight time, session 1 of 6");
  assert.equal(t.next.source, "plan");
  assert.deepEqual(t.sessions.map((k: any) => [k.id, k.minutes]), [["full", 45], ["short", 20], ["quick", 10]]);
  assert.equal(t.profile.level, "intermediate");
  assert.match(t.sessions[0].stages[0].instruction, /\n\nToday: Tune, then play an F major/);

  const review = {
    planId: t.block.id, planTitle: t.block.title, phase: t.phase.title, session: { id: "short", label: "Short session" }, minutes: 21,
    material: "F and Bm barre chords", target: "", startTempo: "60", cleanTempo: "66", subdivision: "quarter notes", difficulty: "about right",
    wentWell: "F rings", struggled: "Bm string 1", pain: false, notes: "", next: "Start at 66 and fix string 1 of Bm.",
  };
  assert.equal((await post("/api/sessions", { ...review, session: { id: "Short!" } })).status, 400);
  const r = await post("/api/sessions", review);
  assert.equal(r.status, 200);
  const { file } = (await r.json()) as any;
  assert.match(file, /^\d{4}-\d{2}-\d{2}\.md$/);
  assert.match(await readFile(join(home, "logs", file), "utf8"), /- \*\*Material:\*\* F and Bm barre chords/);
  const again = (await (await post("/api/sessions", { ...review, pain: true, next: "Rest." })).json()) as any;
  assert.equal(again.file, file.replace(".md", "-2.md"));

  t = await get("/api/today");
  assert.equal(t.position.number, 2);
  assert.equal(t.line, "Phase 1 of 4: Barre chords and tight time, session 2 of 6");
  assert.deepEqual(t.next, { text: "Start at 66 and fix string 1 of Bm.", source: "log" });
  assert.deepEqual(t.counts, { full: 1, floor: 0 });
  assert.equal(t.stats.total, 1);
  assert.equal(t.stats.minutes, 42);
  assert.equal(t.stats.streakDays, 1);
  assert.equal(t.daysSinceLast, 0);

  const logs = await get("/api/logs");
  assert.deepEqual(logs.map((l: any) => l.file), [again.file, file]);
  assert.deepEqual(logs[1], {
    file, date: file.slice(0, 10), session: "Short session", sessionId: "short", extra: false, phase: "Barre chords and tight time", minutes: 21,
    material: "F and Bm barre chords", cleanTempo: 66, difficulty: "about right", pain: false, wentWell: "F rings", struggled: "Bm string 1", next: "Start at 66 and fix string 1 of Bm.",
  });
  assert.equal(logs[0].pain, true);
  assert.equal((await get("/api/logs?limit=1")).length, 1);
});

test("tempos round-trip as in the personal mode", async () => {
  assert.equal((await put("/api/tempos", { fragment: "F to Bm", bpm: 66, subdivision: "quarter" })).status, 200);
  assert.equal((await put("/api/tempos", { fragment: "", bpm: 66 })).status, 400);
  const t = await get("/api/tempos");
  assert.equal(t.find((x: any) => x.fragment === "F to Bm").bpm, 66);
});

test("a plan material's src is served by the materials route", async () => {
  await writeFile(join(home, "materials/Barre shapes.md"), "# Barre shapes\n");
  const plan = JSON.parse(await readFile(join(home, "plan/plan.json"), "utf8"));
  plan.materials = [{ label: "Barre shapes", file: "materials/Barre shapes.md" }];
  await writeFile(join(home, "plan/plan.json"), JSON.stringify(plan));
  const [m] = (await get("/api/today")).materials;
  assert.equal(m.kind, "text");
  const r = await fetch(`${base}${m.src}`, { headers: T });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "# Barre shapes\n");
});

test("the prompt, chat-history and recording routes are registered", async () => {
  const p = await get("/api/prompts");
  assert.ok(p.prompts.length > 0);
  assert.ok(p.actions.some((a: any) => a.id === "onboarding"));
  assert.deepEqual(await get("/api/conversations"), []);
  const r = await fetch(`${base}/api/recordings?blockId=starter-fluent-playing&label=baseline&ext=webm`, { method: "POST", headers: { ...T, "x-struna": "1" }, body: "take" });
  assert.equal(r.status, 200);
  const { path } = (await r.json()) as any;
  assert.match(path, /^Recordings\/starter-fluent-playing\/\d{4}-\d{2}-\d{2}-baseline\.webm$/);
  assert.equal(await readFile(join(home, path), "utf8"), "take");
});


test("saved measurements agree on disk and API, cache by identity, and never change old logs", async () => {
  const before = new Map(await Promise.all((await readdir(join(home, "logs"))).map(async (file) => [file, await readFile(join(home, "logs", file), "utf8")] as const)));
  const measurements = [
    { materialKey: "materials/roll.md", materialLabel: "Baseline roll", bpm: 80 },
    { materialKey: "tab:tune", materialLabel: "Black Mountain Rag", bpm: null },
    { materialKey: "materials/slow.md", materialLabel: "Slow exercise", bpm: 20 },
    { materialKey: "materials/fast.md", materialLabel: "Fast exercise", bpm: 400 },
  ];
  const body = { session: { id: "full", label: "Full" }, measurements };
  const response = await post("/api/sessions", body);
  assert.equal(response.status, 200);
  const { file, warnings } = await response.json() as any;
  assert.equal(warnings.length, 2);
  assert.match(warnings.join(" "), /20 BPM saved in the log only/);
  assert.match(warnings.join(" "), /400 BPM saved in the log only/);
  assert.deepEqual(parseGenericLog(file, await readFile(join(home, "logs", file), "utf8")).measurements, measurements);
  assert.deepEqual((await get("/api/logs")).find((l: any) => l.file === file).measurements, measurements);
  assert.equal((await get("/api/tempos")).find((t: any) => t.fragment === "material:materials/roll.md").bpm, 80);
  assert.equal((await get("/api/tempos")).some((t: any) => t.fragment === "material:tab:tune"), false);
  await post("/api/sessions", { ...body, pain: true, measurements: [{ ...measurements[0], bpm: 90 }] });
  assert.equal((await get("/api/tempos")).find((t: any) => t.fragment === "material:materials/roll.md").bpm, 80);
  const count = (await readdir(join(home, "logs"))).length;
  assert.equal((await post("/api/sessions", { ...body, measurements: [{ ...measurements[0], bpm: 401 }] })).status, 400);
  assert.equal((await readdir(join(home, "logs"))).length, count);
  for (const [old, text] of before) assert.equal(await readFile(join(home, "logs", old), "utf8"), text);
});

test("cache write failure reports a saved log without inviting a duplicate save", async () => {
  const db = new DatabaseSync(join(config.stateDir, "struna.sqlite"));
  try {
    db.exec("CREATE TRIGGER refuse_tempos BEFORE INSERT ON tempos BEGIN SELECT RAISE(FAIL, 'scratch cache failure'); END");
    const response = await post("/api/sessions", { session: { id: "quick", label: "Quick" }, measurements: [{ materialKey: "tab:cache-failure", materialLabel: "Cache test", bpm: 88 }] });
    assert.equal(response.status, 200);
    const { file, warnings } = await response.json() as any;
    assert.match(warnings.join(" "), /saved in the log, but the tempo suggestion cache could not be updated/);
    assert.equal(parseGenericLog(file, await readFile(join(home, "logs", file), "utf8")).measurements?.[0]?.bpm, 88);
  } finally { db.exec("DROP TRIGGER IF EXISTS refuse_tempos"); db.close(); }
});
