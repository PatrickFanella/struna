import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";

import type { AfterTurn, CoachProfile } from "./chat.ts";
import type { ChatEvent, ChatRequest } from "./providers/process.ts";

// A stand-in for both CLIs, so the whole route can run without a subscription. It must be
// chosen before config.ts is loaded, hence the dynamic imports below.
const dir = await mkdtemp(join(tmpdir(), "guitar-chat-"));
const fake = join(dir, "fake-cli.cjs");
const calls = join(dir, "calls.jsonl");
const goodPlan = join(dir, "good-plan.json");
await writeFile(
  fake,
  `#!/usr/bin/env node
const fs = require("node:fs");
const argv = process.argv.slice(2);
if (argv[0] === "--version") { console.log("offline-test"); process.exit(0); }
if (argv[0] === "auth") { console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "max" })); process.exit(0); }
if (argv[0] === "login") { console.log("Logged in using ChatGPT"); process.exit(0); }
let input = "";
process.stdin.on("data", (d) => (input += d)).on("end", () => {
  fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ argv, cwd: process.cwd(), input }) + "\\n");
  const out = (o) => console.log(JSON.stringify(o));
  out({ type: "system", subtype: "init", session_id: "sess-1", apiKeySource: "none" });
  const candidate = /This turn's plan candidate: ([^\\s]+)\\./.exec(argv.join(" "))?.[1] ?? "plan/plan.json";
  if (input.includes("BREAK THE PLAN")) fs.writeFileSync(candidate, '{"version": 2}');
  if (input.includes("Fix the file")) fs.copyFileSync(${JSON.stringify(goodPlan)}, candidate);
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: argv.includes("--resume") ? "Fixed." : "Done." } } });
  out({ type: "result", is_error: false, result: "unused" });
});
`,
);
await chmod(fake, 0o755);
process.env.CLAUDE_BIN = fake;
process.env.CODEX_BIN = fake;

const { buildContext, chatRoutes, coachTurn, personalCoach, SYSTEM } = await import("./chat.ts");
const { conversations } = await import("./conversations.ts");
const { openDb } = await import("./db.ts");
const { fail, match } = await import("./http.ts");
const { today } = await import("./practice.ts");
const { claudeArgs, claudeCommand } = await import("./providers/claude.ts");
const { codexArgs } = await import("./providers/codex.ts");
const { genericCoach } = await import("./generic/coach.ts");
const { starterPlan } = await import("./generic/starter.ts");
const { ensureStudio, normalizeProfile } = await import("./generic/studio.ts");

after(() => rm(dir, { recursive: true, force: true }));

test("the personal coach is the one the app always had", async () => {
  const vaultRoot = join(import.meta.dirname, "fixtures/vault");
  const paths = { vaultRoot, threadRel: "001 Projects/Threads/Guitar", practiceDir: join(vaultRoot, "001 Projects/Threads/Guitar/Practice"), mediaRoot: "/media/Guitar" };
  const db = openDb(join(dir, "personal"));
  const coach = personalCoach(paths, db);
  assert.equal(coach.system, SYSTEM);
  assert.equal(coach.afterTurn, undefined);
  assert.equal(coach.beforeTurn, undefined);
  assert.equal(coach.claude.cwd, vaultRoot);
  assert.deepEqual(claudeCommand({ system: SYSTEM, threadId: "t", model: "m", options: coach.claude }), claudeArgs({ system: SYSTEM, threadId: "t", model: "m", ...paths }));
  assert.equal(coach.codex.cwd, join(vaultRoot, "001 Projects/Threads/Guitar"));
  assert.deepEqual(codexArgs({ system: SYSTEM, options: coach.codex }), codexArgs({ system: SYSTEM }));
  assert.ok(!codexArgs({ system: SYSTEM, options: coach.codex }).some((a) => /web_search|skip-git|apps/.test(a)));
  const screen = { view: "practice session", stage: "Build vocabulary", fragment: "pattern 1", bpm: 72, subdivision: "eighth notes" };
  assert.equal(await coach.context(screen), buildContext(screen, await today(paths, db)));
  db.close();
});

const profile = (over: Partial<CoachProfile> = {}): CoachProfile => ({ system: "sys", context: async () => "", claude: { cwd: "/", tools: [], allowed: [], addDirs: [] }, codex: { cwd: "/" }, ...over });
const script = (...turns: ChatEvent[][]) => {
  const seen: ChatRequest[] = [];
  return {
    seen,
    run: async function* (req: ChatRequest): AsyncGenerator<ChatEvent> {
      seen.push(req);
      yield* turns[seen.length - 1] ?? [];
    },
  };
};
const collect = () => {
  const events: [string, unknown][] = [];
  return { events, emit: (e: string, d: unknown) => void events.push([e, d]) };
};
const signal = () => new AbortController().signal;

test("a turn without afterTurn streams what the provider sends and nothing else", async () => {
  const p = script([{ type: "thread", id: "th-1" }, { type: "delta", text: "Play " }, { type: "notice", message: "careful" }, { type: "delta", text: "slowly." }, { type: "error", message: "rate limited" }]);
  const { events, emit } = collect();
  const threads: string[] = [];
  const r = await coachTurn({ coach: profile(), run: p.run, prompt: "hello", threadId: "th-0", signal: signal(), emit, onThread: (id) => threads.push(id) });
  assert.deepEqual(r, { reply: "Play slowly.", errors: ["rate limited"] });
  assert.deepEqual(events, [["thread", { id: "th-1" }], ["delta", { text: "Play " }], ["notice", { message: "careful" }], ["delta", { text: "slowly." }], ["error", { message: "rate limited" }]]);
  assert.deepEqual(threads, ["th-1"]);
  assert.equal(p.seen.length, 1);
  assert.deepEqual({ system: p.seen[0]!.system, prompt: p.seen[0]!.prompt, threadId: p.seen[0]!.threadId }, { system: "sys", prompt: "hello", threadId: "th-0" });
});

test("a provider that throws is reported as an error", async () => {
  const { events, emit } = collect();
  const r = await coachTurn({
    coach: profile({ system: async () => "late sys" }),
    run: async function* () {
      throw new Error("spawn failed");
    },
    prompt: "x",
    signal: signal(),
    emit,
  });
  assert.deepEqual(r, { reply: "", errors: ["spawn failed"] });
  assert.deepEqual(events, [["error", { message: "spawn failed" }]]);
});

test("afterTurn can ask for one follow-up on the same thread, and never a second", async () => {
  const p = script([{ type: "thread", id: "th-9" }, { type: "delta", text: "I wrote the plan." }], [{ type: "delta", text: "Corrected." }], [{ type: "delta", text: "never" }]);
  const passes: (boolean | undefined)[] = [];
  const coach = profile({
    system: async () => "late sys",
    beforeTurn: async () => "before-state",
    afterTurn: async (before, pass): Promise<AfterTurn> => {
      assert.equal(before, "before-state");
      passes.push(pass?.final);
      // Still asking on the final pass: the caller must not act on it.
      return { changed: { plan: true, materials: false, profile: false }, notices: pass?.final ? ["still wrong"] : [], followUp: "plan/plan.json is not valid: x. Fix the file." };
    },
  });
  const { events, emit } = collect();
  const r = await coachTurn({ coach, run: p.run, prompt: "build a plan", signal: signal(), emit });
  assert.deepEqual(r, { reply: "I wrote the plan.\n\nCorrected.", errors: [] });
  assert.deepEqual(passes, [false, true]);
  assert.equal(p.seen.length, 2);
  assert.deepEqual({ system: p.seen[1]!.system, prompt: p.seen[1]!.prompt, threadId: p.seen[1]!.threadId }, { system: "late sys", prompt: "plan/plan.json is not valid: x. Fix the file.", threadId: "th-9" });
  assert.deepEqual(events, [
    ["thread", { id: "th-9" }],
    ["delta", { text: "I wrote the plan." }],
    ["changed", { plan: true, materials: false, profile: false }],
    ["delta", { text: "\n\n" }],
    ["delta", { text: "Corrected." }],
    ["changed", { plan: true, materials: false, profile: false }],
    ["notice", { message: "still wrong" }],
  ]);
});

test("no follow-up after a failed turn, a stopped one, or one without a thread: the pass is final", async () => {
  const cases: { name: string; turn: ChatEvent[]; aborted?: boolean }[] = [
    { name: "error", turn: [{ type: "thread", id: "t" }, { type: "error", message: "boom" }] },
    { name: "no thread", turn: [{ type: "delta", text: "hi" }] },
    { name: "stopped", turn: [{ type: "thread", id: "t" }, { type: "delta", text: "hi" }], aborted: true },
  ];
  for (const c of cases) {
    const p = script(c.turn, [{ type: "delta", text: "never" }]);
    const passes: (boolean | undefined)[] = [];
    const ac = new AbortController();
    if (c.aborted) ac.abort();
    const { events, emit } = collect();
    await coachTurn({ coach: profile({ afterTurn: async (_b, pass) => (passes.push(pass?.final), { followUp: "fix it", notices: ["n"] }) }), run: p.run, prompt: "x", signal: ac.signal, emit });
    assert.deepEqual(passes, [true], c.name);
    assert.equal(p.seen.length, 1, c.name);
    assert.deepEqual(events.at(-1), ["notice", { message: "n" }], c.name);
    assert.ok(!events.some(([e]) => e === "changed"), c.name);
  }
});

test("a Stop while the post-turn check runs starts no follow-up", async () => {
  const p = script([{ type: "thread", id: "t" }, { type: "delta", text: "ok" }], [{ type: "delta", text: "never" }]);
  const ac = new AbortController();
  const passes: (boolean | undefined)[] = [];
  const { emit } = collect();
  const r = await coachTurn({
    coach: profile({
      afterTurn: async (_b, pass) => {
        passes.push(pass?.final);
        ac.abort(); // The player presses Stop while the files are checked and the links download.
        return { followUp: "fix it" };
      },
    }),
    run: p.run,
    prompt: "x",
    signal: ac.signal,
    emit,
  });
  assert.deepEqual(passes, [false]);
  assert.equal(p.seen.length, 1);
  assert.deepEqual(r, { reply: "ok", errors: [] });
});

test("a reset before the coach starts: the old session is not resumed with the new setup", async () => {
  // The setup changed while the context was read or the files were fingerprinted, after the conversation was loaded.
  let reset = false;
  const p = script([{ type: "thread", id: "new" }, { type: "delta", text: "hi" }], [{ type: "delta", text: "never" }]);
  const r = await coachTurn({
    coach: profile({ beforeTurn: async () => ((reset = true), undefined), afterTurn: async () => ({ followUp: "fix it" }) }),
    run: p.run,
    prompt: "x",
    threadId: "old",
    signal: signal(),
    emit: collect().emit,
    stale: () => reset,
  });
  assert.equal(p.seen.length, 1);
  assert.equal(p.seen[0]!.threadId, undefined);
  assert.deepEqual(r, { reply: "hi", errors: [] });
});

test("a CLI is never started on a signal that has already aborted", async () => {
  const { jsonLines } = await import("./providers/process.ts");
  const marker = join(dir, "spawned");
  const lines = jsonLines(process.execPath, ["-e", `require("fs").writeFileSync(${JSON.stringify(marker)}, "x")`], { cwd: dir, input: "", signal: AbortSignal.abort(), timeoutMs: 5000 });
  const first = await lines.next();
  assert.deepEqual(first, { done: true, value: { code: null, stderr: "aborted" } });
  await new Promise((r) => setTimeout(r, 300));
  const { stat } = await import("node:fs/promises");
  await assert.rejects(stat(marker));
});

test("an afterTurn that throws becomes a notice, and the reply is kept", async () => {
  const p = script([{ type: "thread", id: "t" }, { type: "delta", text: "ok" }]);
  const { events, emit } = collect();
  const r = await coachTurn({ coach: profile({ afterTurn: async () => Promise.reject(new Error("disk full")) }), run: p.run, prompt: "x", signal: signal(), emit });
  assert.deepEqual(r, { reply: "ok", errors: [] });
  assert.deepEqual(events.at(-1), ["notice", { message: "Could not check what the coach changed: disk full" }]);
});

test("messages keep their automatic mark, and older databases gain the column", async () => {
  const state = join(dir, "old-state");
  const db = openDb(state);
  db.exec("CREATE TABLE conversations (id TEXT PRIMARY KEY, provider TEXT, title TEXT, thread_id TEXT, created TEXT, updated TEXT); CREATE TABLE messages (conversation TEXT, role TEXT, text TEXT, created TEXT);");
  db.prepare("INSERT INTO conversations VALUES ('c-old', 'claude', 'Old', NULL, 't', 't')").run();
  db.prepare("INSERT INTO messages VALUES ('c-old', 'user', 'from before', 't')").run();
  const store = conversations(db);
  conversations(db); // A second start must not try to add the column again.
  assert.deepEqual(store.get("c-old")!.messages, [{ role: "user", text: "from before", created: "t" }]);
  const c = store.create("claude", "I added a file");
  store.append(c.id, "user", "I added a file", { auto: "material-added" });
  store.append(c.id, "assistant", "Worked in.");
  const got = store.get(c.id)!.messages;
  assert.deepEqual(got.map((m) => [m.role, m.meta]), [["user", { auto: "material-added" }], ["assistant", undefined]]);
  // A message without the mark has exactly the keys it had before the column existed.
  assert.deepEqual(Object.keys(got[1]!), ["role", "text", "created"]);
  db.close();
});

// ---- The route, end to end, with the generic coach and the stand-in CLI.

const home = join(dir, "home");
await ensureStudio(home);
await writeFile(goodPlan, JSON.stringify(starterPlan(normalizeProfile({ level: "beginner" }, new Date().toISOString()), "2026-11-14")));
const db: DatabaseSync = openDb(join(dir, "state"));
const store = conversations(db);
chatRoutes(genericCoach({ home, db, timeZone: "UTC", libraryDirs: [], web: true, appName: "Struna" }), db, store);
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const found = match(req.method ?? "GET", url.pathname);
  Promise.resolve(found?.handler(req, res, { url, params: found.params })).catch((e) => fail(res, e));
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => (server.close(), db.close()));

async function post(body: unknown): Promise<{ status: number; events: [string, any][]; text: string }> {
  const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  const events = [...text.matchAll(/^event: (.+)\ndata: (.+)$/gm)].map((m): [string, any] => [m[1]!, JSON.parse(m[2]!)]);
  return { status: res.status, events, text };
}
const cliCalls = async () => (await readFile(calls, "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { argv: string[]; cwd: string; input: string });

test("generic chat: an invalid plan gets one fix on the same thread, in the same reply", async () => {
  const r = await post({ provider: "claude", message: "I just logged a session. BREAK THE PLAN", auto: "session-logged", screen: { view: "review", material: "Em to G" } });
  assert.equal(r.status, 200);
  const id = r.events[0]![1].id as string;
  assert.deepEqual(r.events.map(([e]) => e), ["conversation", "thread", "delta", "delta", "thread", "delta", "notice", "done"]);
  assert.match(r.events.at(-2)![1].message, /proposed plan/);
  assert.deepEqual(r.events.at(-1)![1], { aborted: false });

  const [first, second] = await cliCalls();
  assert.equal(first!.cwd, home);
  assert.match(first!.input, /^\[Struna\]\nScreen: review\nToday: \d{4}-\d{2}-\d{2} \(UTC\)\nProfile: not set up yet\nPlan: No plan yet\nMaterial: Em to G\n\[\/Struna\]\n\nI just logged a session\. BREAK THE PLAN$/);
  assert.ok(first!.argv.some((a) => a.includes("Edit(.coach-candidates/")));
  assert.ok(!first!.argv.some((a) => a.includes("Edit(plan/**)")));
  assert.ok(!first!.argv.includes("--resume"));
  assert.equal(second!.argv[second!.argv.indexOf("--resume") + 1], "sess-1");
  assert.match(second!.input, /Plan candidate is not valid: version must be 1; .*\nFix the file at/s);
  await assert.rejects(readFile(join(home, "plan/plan.json")), { code: "ENOENT" });

  const conv = store.get(id)!;
  assert.equal(conv.thread_id, "sess-1");
  assert.deepEqual(conv.messages.map((m) => [m.role, m.text, m.meta]), [
    ["user", "I just logged a session. BREAK THE PLAN", { auto: "session-logged" }],
    ["assistant", "Done.\n\nFixed.", undefined],
  ]);
});

test("generic chat: a plan still invalid after the fix becomes a notice, with no third turn", async () => {
  const before = (await cliCalls()).length;
  // The stand-in "fixes" the plan by copying this file, so make the fix wrong too.
  await writeFile(goodPlan, '{"version": 3}');
  const again = await post({ provider: "claude", message: "BREAK THE PLAN" });
  assert.equal((await cliCalls()).length - before, 2);
  const notices = again.events.filter(([e]) => e === "notice").map(([, d]) => d.message as string);
  assert.equal(notices.length, 1);
  assert.match(notices[0]!, /^The coach left a candidate the app cannot use\. Plan candidate is not valid: version must be 1/);
  assert.deepEqual(again.events.map(([e]) => e).slice(-2), ["notice", "done"]);
});

test("generic chat: an unknown automatic action is refused before anything is stored", async () => {
  const n = store.list().length;
  const r = await post({ provider: "claude", message: "hi", auto: "format-disk" });
  assert.equal(r.status, 400);
  assert.match(r.text, /unknown action/);
  assert.equal(store.list().length, n);
});

test("providers report where the CLIs are signed in", async () => {
  const got = (await (await fetch(`${base}/api/providers`)).json()) as Record<string, any>;
  assert.deepEqual(got.claude, { ok: true, detail: "claude.ai max" });
  assert.equal(got.codex.ok, true);
  assert.equal(got.last, "claude");
  assert.equal(got.host, "this computer");
});
