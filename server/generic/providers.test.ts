import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { sha256, writeFakeBin } from "../../scripts/fake-coach-cli.ts";

// The shared stand-in for both CLIs, chosen before config.ts is loaded. Host tokens in the server's
// environment must reach the host rows (as today) and never the coaches the app signs in itself.
const dir = await mkdtemp(join(tmpdir(), "guitar-providers-"));
const fake = writeFakeBin(dir);
process.env.CLAUDE_BIN = fake;
process.env.CODEX_BIN = fake;
process.env.CLAUDE_CODE_OAUTH_TOKEN = "host-oauth-token-should-stay-home";
process.env.CODEX_ACCESS_TOKEN = "host-access-token-should-stay-home";
process.env.AWS_PROFILE = "host-profile";

const { chatRoutes, FRESH_NOTICE } = await import("../chat.ts");
const { conversations } = await import("../conversations.ts");
const { openDb } = await import("../db.ts");
const { fail, match } = await import("../http.ts");
const { claudeChat, claudeCommand } = await import("../providers/claude.ts");
const { appEnv } = await import("../providers/process.ts");
const { genericCoach } = await import("./coach.ts");
const { credentialStore } = await import("./credentials.ts");
const { CODEX_UNSANDBOXED, coachPolicy, guardedRun, locallyHosted, plainError, providerRoutes, redact } = await import("./providers.ts");
const { codexChat } = await import("../providers/codex.ts");
const { starterPlan } = await import("./starter.ts");
const { ensureStudio, normalizeProfile } = await import("./studio.ts");

const ANTHROPIC = "sk-ant-api03-DUMMY-0000-1111-2222-aaaa";
const OPENAI = "sk-proj-DUMMY-3333-4444-5555-bbbb";
const ENDPOINT = "sk-or-v1-DUMMY-6666-7777-8888-cccc";

const home = join(dir, "home");
const state = join(dir, "state");
await ensureStudio(home);
writeFileSync(join(dir, "good-plan.json"), JSON.stringify(starterPlan(normalizeProfile({ level: "beginner" }, new Date().toISOString()), "2026-11-14")));
const db = openDb(state);
const store = credentialStore(state);
const lookup = async (host: string) => (({ "openrouter.ai": ["104.18.2.115"], "lan.example": ["192.168.1.20"] }) as Record<string, string[]>)[host] ?? [];
// Mutable: tests switch what this instance offers; the routes read it on every request.
// Codex's install folder is known (as with a real install), so the Codex coaches run under the profile.
const policy = coachPolicy({ local: true, hostName: "testhost", lookup, codexSandboxed: true });
const convs = conversations(db);
const studio = { home, db, timeZone: "UTC", libraryDirs: [], web: true, appName: "Struna" };
chatRoutes(genericCoach(studio, { linkWaitMs: 10 }, { codexInstall: join(dir, "codex-install"), store, policy }), db, convs);
const coaches = providerRoutes({ store, policy, web: true }, convs, { showMs: 1500 });
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const found = match(req.method ?? "GET", url.pathname);
  Promise.resolve(found ? found.handler(req, res, { url, params: found.params }) : fail(res, Object.assign(new Error("not found"), { status: 404 }))).catch((e) => fail(res, e));
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => {
  coaches.stop();
  server.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Everything the browser was sent, kept to check that no secret is in it. */
const transcripts: string[] = [];
async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await res.text();
  transcripts.push(text);
  return { status: res.status, json: text ? JSON.parse(text) : null, text };
}
async function chat(body: unknown): Promise<{ status: number; events: [string, any][]; text: string }> {
  const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  transcripts.push(text);
  const events = [...text.matchAll(/^event: (.+)\ndata: (.+)$/gm)].map((m): [string, any] => [m[1]!, JSON.parse(m[2]!)]);
  return { status: res.status, events, text };
}
type Call = { argv: string[]; cwd: string; envNames: string[]; CLAUDE_CONFIG_DIR: string | null; CODEX_HOME: string | null; sha256: Record<string, string>; input?: string };
const calls = (): Call[] => (existsSync(join(dir, "calls.jsonl")) ? readFileSync(join(dir, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
const turns = () => calls().filter((c) => c.argv[0] === "-p" || c.argv[0] === "exec");
const names = (events: [string, any][]) => events.map(([e]) => e);
const HOST_TOKENS = ["CLAUDE_CODE_OAUTH_TOKEN", "CODEX_ACCESS_TOKEN", "AWS_PROFILE"];
const waitFor = async (ok: () => Promise<boolean>, what: string) => {
  for (let i = 0; i < 100; i++) {
    if (await ok()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`timed out waiting for ${what}`);
};

test("the coach list names every coach this locally hosted instance offers, in order", async () => {
  const r = await call("GET", "/api/providers");
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json), ["claude", "codex", "last", "host", "deviceSignIn", "list"]);
  assert.deepEqual(r.json.list.map((x: any) => x.id), ["claude", "codex", "chatgpt", "anthropic", "openai", "bedrock", "endpoint"]);
  assert.equal(r.json.deviceSignIn, true);
  const byId = Object.fromEntries(r.json.list.map((x: any) => [x.id, x]));
  assert.equal(byId.claude.ok, true);
  assert.equal(byId.claude.setup, "host");
  assert.equal(byId.claude.command, "claude auth login");
  assert.match(byId.claude.notes[0], /does not let apps sign you in to a Claude plan. Run `claude auth login` yourself on testhost/);
  assert.deepEqual([byId.anthropic.ok, byId.anthropic.detail, byId.anthropic.model], [false, "No key saved", "sonnet"]);
  assert.equal(byId.endpoint.experimental, true);
  assert.equal(byId.bedrock.web, false);
  assert.equal(byId.chatgpt.ok, false);
});

test("an Anthropic key: saved without echo, used through the environment, same SSE order as today with the repair turn", async () => {
  const put = await call("PUT", "/api/coach/providers/anthropic", { key: ANTHROPIC });
  assert.equal(put.status, 200);
  assert.equal(put.json.ok, true);
  assert.equal(put.json.hint, "…aaaa");
  assert.equal(put.json.detail, "Key ending …aaaa · sonnet");
  assert.ok(!put.text.includes(ANTHROPIC));
  assert.ok(!(await call("GET", "/api/providers")).text.includes(ANTHROPIC));

  const before = turns().length;
  const r = await chat({ provider: "anthropic", message: "BREAK THE PLAN", screen: { view: "start" } });
  assert.equal(r.status, 200);
  assert.deepEqual(names(r.events), ["conversation", "thread", "delta", "delta", "thread", "delta", "notice", "done"]);
  const [first, second] = turns().slice(before);
  for (const c of [first!, second!]) {
    assert.equal(c.CLAUDE_CONFIG_DIR, join(state, "cli", "anthropic"));
    assert.equal(c.sha256.ANTHROPIC_API_KEY, sha256(ANTHROPIC));
    for (const n of HOST_TOKENS) assert.ok(!c.envNames.includes(n), n);
    assert.ok(!c.argv.some((a) => a.includes(ANTHROPIC)));
    assert.ok(c.argv.includes("--model=sonnet"));
    assert.equal(c.argv[c.argv.indexOf("--max-budget-usd") + 1], "2");
    assert.equal(c.cwd, home);
  }
  assert.equal(second!.argv[second!.argv.indexOf("--resume") + 1], "fake-claude-1");
  const conv = convs.get(r.events[0]![1].id)!;
  assert.equal(conv.provider, "anthropic");
  assert.equal(conv.thread_id, "fake-claude-1");
});

test("the host Claude row runs exactly as before: same arguments, the host environment, no notice", async () => {
  const before = turns().length;
  const r = await chat({ provider: "claude", message: "hello" });
  assert.deepEqual(names(r.events), ["conversation", "thread", "delta", "done"]);
  const c = turns()[before]!;
  const expected = claudeCommand({ system: c.argv[c.argv.indexOf("--append-system-prompt") + 1]!, options: genericCoach(studio).claude });
  const allowedAt = c.argv.indexOf("--allowedTools") + 1;
  const normalized = [...c.argv];
  assert.match(normalized[allowedAt]!, /Edit\(\.coach-candidates\//);
  assert.doesNotMatch(normalized[allowedAt]!, /Edit\(plan/);
  normalized[allowedAt] = expected[allowedAt]!;
  assert.deepEqual(normalized, expected);
  assert.equal(c.CLAUDE_CONFIG_DIR, null);
  assert.ok(c.envNames.includes("CLAUDE_CODE_OAUTH_TOKEN"), "the host row keeps subscriptionEnv");
  assert.ok(!c.argv.some((a) => a.startsWith("--model=") || a === "--max-budget-usd"));
});

test("a coach with nothing saved: one plain error, no thread, no repair turn, no CLI started", async () => {
  const before = calls().length;
  const r = await chat({ provider: "openai", message: "BREAK THE PLAN" });
  assert.deepEqual(names(r.events), ["conversation", "error", "done"]);
  assert.equal(r.events[1]![1].message, "No OpenAI API key is saved. Add one under Coach settings.");
  assert.equal(calls().length, before);
});

test("an OpenAI key: Codex in its own CODEX_HOME, the key only in the environment, the shell's environment cut down", async () => {
  await call("PUT", "/api/coach/providers/openai", { key: OPENAI, model: "gpt-5" });
  const before = turns().length;
  const r = await chat({ provider: "openai", message: "hello" });
  assert.deepEqual(names(r.events), ["conversation", "thread", "delta", "done"]);
  const c = turns()[before]!;
  assert.equal(c.CODEX_HOME, join(state, "cli", "openai"));
  assert.equal(c.sha256.CODEX_API_KEY, sha256(OPENAI));
  for (const n of [...HOST_TOKENS, "ANTHROPIC_API_KEY"]) assert.ok(!c.envNames.includes(n), n);
  for (const x of ['model="gpt-5"', 'shell_environment_policy.inherit="core"', 'shell_environment_policy.exclude=["*KEY*","*TOKEN*","*SECRET*"]', 'web_search="live"']) assert.ok(c.argv.includes(x), x);
  assert.ok(!c.argv.includes("-m"));
  assert.ok(!c.argv.some((a) => a.includes(OPENAI)));
});

test("an endpoint: the custom provider, web search off, the no-web instructions, the key only when there is one", async () => {
  const local = await call("PUT", "/api/coach/providers/endpoint", { preset: "ollama", baseUrl: "http://127.0.0.1:11434/v1/", model: "gpt-oss:20b" });
  assert.equal(local.status, 200);
  assert.equal(local.json.detail, "Ollama · 127.0.0.1:11434 · gpt-oss:20b · no key");
  let before = turns().length;
  let r = await chat({ provider: "endpoint", message: "hello" });
  assert.deepEqual(names(r.events), ["conversation", "thread", "delta", "done"]);
  let c = turns()[before]!;
  assert.equal(c.CODEX_HOME, join(state, "cli", "endpoint"));
  for (const x of ['model_provider="struna"', 'model_providers.struna.base_url="http://127.0.0.1:11434/v1"', 'model_providers.struna.wire_api="responses"', 'web_search="disabled"', "apps", 'model="gpt-oss:20b"']) assert.ok(c.argv.includes(x), x);
  assert.ok(!c.argv.some((a) => /env_key|env_http_headers/.test(a)));
  assert.ok(!c.envNames.includes("STRUNA_ENDPOINT_KEY"));
  // Its only way out is the run's own proxy, which keeps it to the endpoint's origin.
  for (const n of ["HTTPS_PROXY", "HTTP_PROXY"]) assert.ok(c.envNames.includes(n), n);
  for (const n of ["NO_PROXY", "no_proxy", "ALL_PROXY"]) assert.ok(!c.envNames.includes(n), n);
  const instructions = c.argv.find((a) => a.startsWith("developer_instructions="))!;
  assert.match(instructions, /You have no web access here/);

  const remote = await call("PUT", "/api/coach/providers/endpoint", { preset: "openrouter", baseUrl: "https://openrouter.ai/api/v1", key: ENDPOINT, model: "anthropic/claude-sonnet-4.5" });
  assert.equal(remote.status, 200);
  assert.ok(!remote.text.includes(ENDPOINT));
  before = turns().length;
  r = await chat({ provider: "endpoint", message: "hello" });
  c = turns()[before]!;
  assert.ok(c.argv.includes('model_providers.struna.env_key="STRUNA_ENDPOINT_KEY"'));
  assert.equal(c.sha256.STRUNA_ENDPOINT_KEY, sha256(ENDPOINT));
});

test("endpoint addresses on a private network are refused when the instance is not locally hosted", async () => {
  policy.privateEndpoints = false;
  try {
    for (const baseUrl of ["http://127.0.0.1:11434/v1", "https://lan.example/v1"]) {
      const r = await call("PUT", "/api/coach/providers/endpoint", { preset: "other", baseUrl, model: "m" });
      assert.equal(r.status, 400, baseUrl);
      assert.match(r.json.error, /public internet/);
    }
    // A saved private address is checked again before every turn.
    store.put("endpoint", { preset: "ollama", baseUrl: "http://127.0.0.1:11434/v1", key: null, header: "bearer", model: "m", saved: "t" });
    const before = calls().length;
    const r = await chat({ provider: "endpoint", message: "hello" });
    assert.deepEqual(names(r.events), ["conversation", "error", "done"]);
    assert.match(r.events[1]![1].message, /^Other provider \(Responses API\): This instance only reaches providers on the public internet/);
    assert.equal(calls().length, before);
  } finally {
    policy.privateEndpoints = true;
  }
});

test("a refused key: the error is redacted, labelled and given a hint; a used-up limit gets its own", async () => {
  writeFileSync(join(dir, "fail"), "401");
  try {
    const r = await chat({ provider: "anthropic", message: "hello" });
    const err = r.events.find(([e]) => e === "error")![1].message as string;
    assert.ok(!err.includes(ANTHROPIC));
    assert.match(err, /^Anthropic API key: API Error: 401 .*invalid x-api-key …aaaa.* Check or replace the key under Coach settings\.$/);
    const id = r.events[0]![1].id;
    assert.ok(!JSON.stringify(convs.get(id)).includes(ANTHROPIC), "the stored error is redacted too");
    writeFileSync(join(dir, "fail"), "429");
    const limited = await chat({ provider: "openai", message: "hello" });
    assert.match(limited.events.find(([e]) => e === "error")![1].message, /^OpenAI API key: exceeded retry limit, last status: 429 Too Many Requests The usage limit or credit is used up/);
  } finally {
    rmSync(join(dir, "fail"), { force: true });
  }
});

test("a changed setup clears the coach's sessions and the next turn says it starts fresh; a new key alone does not", async () => {
  const r = await chat({ provider: "anthropic", message: "hello" });
  const id = r.events[0]![1].id;
  assert.equal(convs.get(id)!.thread_id, "fake-claude-1");
  await call("PUT", "/api/coach/providers/anthropic", { key: `${ANTHROPIC}-rotated` });
  assert.equal(convs.get(id)!.thread_id, "fake-claude-1", "a key rotation keeps the session");
  await call("PUT", "/api/coach/providers/anthropic", { model: "opus" });
  assert.equal(convs.get(id)!.thread_id, null);
  const before = turns().length;
  const next = await chat({ provider: "anthropic", conversation: id, message: "again" });
  assert.deepEqual(next.events.slice(0, 2), [["conversation", { id }], ["notice", { message: FRESH_NOTICE }]]);
  assert.ok(!turns()[before]!.argv.includes("--resume"));
  assert.ok(turns()[before]!.argv.includes("--model=opus"));
  // Only once: the conversation has its new session now.
  const third = await chat({ provider: "anthropic", conversation: id, message: "and again" });
  assert.ok(!third.events.some(([, d]) => d?.message === FRESH_NOTICE));
  // A conversation may not switch coach.
  const other = await chat({ provider: "openai", conversation: id, message: "x" });
  assert.equal(other.status, 400);
  await call("PUT", "/api/coach/providers/anthropic", { key: ANTHROPIC, model: "" });
});

test("host logins turned off: hidden, reported as off, and refused before anything is stored", async () => {
  policy.hostLogins = false;
  try {
    const p = await call("GET", "/api/providers");
    assert.deepEqual(p.json.claude, { ok: false, detail: "turned off" });
    assert.deepEqual(p.json.codex, { ok: false, detail: "turned off" });
    assert.ok(!p.json.list.some((x: any) => x.id === "claude" || x.id === "codex"));
    const n = convs.list().length;
    const r = await chat({ provider: "claude", message: "hello" });
    assert.equal(r.status, 400);
    assert.match(r.text, /turned off here\. Start a new conversation with another coach/);
    assert.equal(convs.list().length, n);
    assert.equal((await call("PUT", "/api/coach/providers/claude", { model: "x" })).status, 403);
  } finally {
    policy.hostLogins = true;
  }
});

test("keys and endpoints on an instance others can open without REQUIRE_USER: hidden and refused", async () => {
  policy.keys = false;
  policy.local = false;
  try {
    const p = await call("GET", "/api/providers");
    assert.deepEqual(p.json.list.map((x: any) => x.id), ["claude", "codex", "chatgpt"]);
    // The Claude plan row does not point to a key row this instance does not have.
    const claudeNote = p.json.list[0].notes[0] as string;
    assert.match(claudeNote, /Run `claude auth login` yourself on testhost\.$/);
    assert.doesNotMatch(claudeNote, /API key/);
    const put = await call("PUT", "/api/coach/providers/anthropic", { key: ANTHROPIC });
    assert.equal(put.status, 403);
    assert.match(put.json.error, /REQUIRE_USER/);
    assert.equal((await chat({ provider: "anthropic", message: "x" })).status, 400);
  } finally {
    policy.keys = true;
    policy.local = true;
  }
});

test("host rows cannot be changed or removed from the app: the terminal command instead", async () => {
  const put = await call("PUT", "/api/coach/providers/claude", { model: "opus" });
  assert.equal(put.status, 400);
  assert.match(put.json.error, /claude auth login/);
  const del = await call("DELETE", "/api/coach/providers/codex");
  assert.equal(del.status, 400);
  assert.match(del.json.error, /codex logout/);
  assert.equal((await call("PUT", "/api/coach/providers/gemini", {})).status, 404);
});

test("ChatGPT device sign-in: one job, the link and code, done after Codex finishes, then a coach of its own", async () => {
  const start = await call("POST", "/api/coach/providers/chatgpt/login");
  assert.equal(start.status, 200);
  assert.equal(start.json.state, "waiting");
  assert.equal(start.json.url, "https://auth.openai.com/codex/device");
  assert.equal(start.json.code, "FAKE-1A2B3");
  assert.ok(Date.parse(start.json.expiresAt) > Date.now() + 14 * 60_000);
  const again = await call("POST", "/api/coach/providers/chatgpt/login");
  assert.deepEqual(again.json, start.json, "a second POST returns the running job");
  assert.equal(calls().filter((c) => c.argv.join(" ") === "login --device-auth").length, 1);
  const login = calls().find((c) => c.argv.join(" ") === "login --device-auth")!;
  assert.equal(login.CODEX_HOME, join(state, "cli", "chatgpt"));
  for (const n of HOST_TOKENS) assert.ok(!login.envNames.includes(n), n);

  writeFileSync(join(dir, "device-ok"), "ok");
  await waitFor(async () => (await call("GET", "/api/coach/providers/chatgpt/login")).json.state === "done", "the sign-in to finish");
  rmSync(join(dir, "device-ok"));
  assert.ok(existsSync(join(state, "cli", "chatgpt", "auth.json")));
  const row = (await call("GET", "/api/providers")).json.list.find((x: any) => x.id === "chatgpt");
  assert.deepEqual([row.ok, row.detail], [true, "Signed in here"]);

  const before = turns().length;
  const r = await chat({ provider: "chatgpt", message: "hello" });
  assert.deepEqual(names(r.events), ["conversation", "thread", "delta", "done"]);
  const c = turns()[before]!;
  assert.equal(c.CODEX_HOME, join(state, "cli", "chatgpt"));
  assert.ok(!c.envNames.includes("CODEX_API_KEY"));
  assert.ok(c.argv.includes('shell_environment_policy.inherit="core"'));
  const id = r.events[0]![1].id;
  assert.equal(convs.get(id)!.thread_id, "fake-codex-1");

  // A new sign-in may be another account: the sessions start fresh.
  await call("POST", "/api/coach/providers/chatgpt/login");
  writeFileSync(join(dir, "device-ok"), "ok");
  await waitFor(async () => (await call("GET", "/api/coach/providers/chatgpt/login")).json.state === "done", "the second sign-in");
  rmSync(join(dir, "device-ok"));
  assert.equal(convs.get(id)!.thread_id, null);

  // Signing out runs `codex logout` in that folder and leaves no auth.json.
  const out = await call("DELETE", "/api/coach/providers/chatgpt");
  assert.equal(out.json.ok, false);
  assert.ok(!existsSync(join(state, "cli", "chatgpt", "auth.json")));
  assert.ok(calls().some((c) => c.argv[0] === "logout" && c.CODEX_HOME === join(state, "cli", "chatgpt")));
  const r2 = await chat({ provider: "chatgpt", message: "hello" });
  assert.equal(r2.events[1]![1].message, "ChatGPT is not signed in here. Sign in under Coach settings.");
});

test("ChatGPT device sign-in: cancel, a failed sign-in, a CLI that shows no code, and 403 when it is off", async () => {
  const started = await call("POST", "/api/coach/providers/chatgpt/login");
  assert.equal(started.json.state, "waiting");
  assert.equal((await call("DELETE", "/api/coach/providers/chatgpt/login")).json.state, "idle");
  assert.equal((await call("GET", "/api/coach/providers/chatgpt/login")).json.state, "idle");

  await call("POST", "/api/coach/providers/chatgpt/login");
  writeFileSync(join(dir, "device-ok"), "fail");
  await waitFor(async () => (await call("GET", "/api/coach/providers/chatgpt/login")).json.state === "failed", "the failure");
  rmSync(join(dir, "device-ok"));
  const failed = (await call("GET", "/api/coach/providers/chatgpt/login")).json;
  assert.match(failed.detail, /^Codex stopped before the sign-in finished\. Its last line: Error logging in with device code: device code expired$/);
  assert.equal(failed.code, undefined);

  writeFileSync(join(dir, "device-silent"), "");
  try {
    const silent = await call("POST", "/api/coach/providers/chatgpt/login");
    assert.equal(silent.status, 502);
    assert.equal(silent.json.error, "Codex did not show a sign-in code. Its last line: Starting device login [code] ...");
  } finally {
    rmSync(join(dir, "device-silent"));
  }

  policy.deviceSignIn = false;
  try {
    assert.equal((await call("POST", "/api/coach/providers/chatgpt/login")).status, 403);
    assert.ok(!(await call("GET", "/api/providers")).json.list.some((x: any) => x.id === "chatgpt"));
  } finally {
    policy.deviceSignIn = true;
  }
});

test("removing a key: the row is not ready and the next turn says what is missing", async () => {
  const del = await call("DELETE", "/api/coach/providers/openai");
  assert.deepEqual([del.status, del.json.ok, del.json.detail], [200, false, "No key saved"]);
  const r = await chat({ provider: "openai", message: "hello" });
  assert.equal(r.events[1]![1].message, "No OpenAI API key is saved. Add one under Coach settings.");
});

test("Claude's API-key notice: silent for the key this run means to use, still said for any other", async () => {
  const run = (keySource?: string) =>
    claudeChat({ system: "s", prompt: "hi", signal: new AbortController().signal }, { cwd: home, tools: ["Read"], allowed: [], addDirs: [], env: appEnv({ ANTHROPIC_API_KEY: "sk-ant-notice-test-1234" }), ...(keySource ? { keySource } : {}) });
  const notices = async (g: ReturnType<typeof run>) => {
    const out: string[] = [];
    for await (const ev of g) if (ev.type === "notice") out.push(ev.message);
    return out;
  };
  assert.deepEqual(await notices(run("ANTHROPIC_API_KEY")), []);
  assert.deepEqual(await notices(run()), ["Claude is using an API key (ANTHROPIC_API_KEY), not the subscription login."]);
});

test("redact and plainError", async () => {
  assert.equal(redact("bad key sk-abcdefghijkl and sk-abcdefghijkl again", ["sk-abcdefghijkl"]), "bad key …ijkl and …ijkl again");
  assert.equal(plainError("Request failed: 403 Forbidden", { label: "OpenAI API key" }), "OpenAI API key: Request failed: 403 Forbidden Check or replace the key under Coach settings.");
  assert.equal(plainError("unexpected status 401", { label: "ChatGPT plan (signed in here)", chatgpt: true }), "ChatGPT plan (signed in here): unexpected status 401 The ChatGPT sign-in has expired or was revoked. Sign in again under Coach settings.");
  assert.equal(plainError("model not found", { label: "X" }), "X: model not found");
  assert.equal(plainError("x".repeat(900), { label: "X" }).length, 803);
  const thrown = guardedRun(
    (async function* () {
      yield { type: "notice" as const, message: "key sk-abcdefghijkl" };
      throw new Error("spawn sk-abcdefghijkl ENOENT");
    })(),
    { label: "X", secrets: ["sk-abcdefghijkl"] },
  );
  const out = [];
  for await (const ev of thrown) out.push(ev);
  assert.deepEqual(out, [{ type: "notice", message: "key …ijkl" }, { type: "error", message: "X: spawn …ijkl ENOENT" }]);
});

test("Codex's install folder unknown: every Codex coach is shown as unusable and refused, the Claude ones still run", async () => {
  policy.codexSandboxed = false;
  try {
    const p = await call("GET", "/api/providers");
    const byId = Object.fromEntries(p.json.list.map((x: any) => [x.id, x]));
    for (const id of ["codex", "chatgpt", "openai", "endpoint"]) {
      assert.deepEqual([byId[id].ok, byId[id].detail, byId[id].unavailable], [false, CODEX_UNSANDBOXED, true], id);
    }
    assert.equal(byId.anthropic.unavailable, undefined);
    store.put("openai", { key: OPENAI, model: null, saved: "t" });
    const before = calls().length;
    for (const id of ["codex", "openai", "endpoint", "chatgpt"]) {
      const r = await chat({ provider: id, message: "hello" });
      assert.equal(r.status, 400, id);
      assert.match(r.text, /install folder was not found/, id);
    }
    assert.equal((await call("POST", "/api/coach/providers/chatgpt/login")).status, 403);
    assert.equal(calls().length, before, "no Codex was started");
    const claude = await chat({ provider: "anthropic", message: "hello" });
    assert.ok(!names(claude.events).includes("error"));
  } finally {
    policy.codexSandboxed = true;
    store.remove("openai");
  }
});

test("codexChat refuses a run the app signs in that has no permission profile", async () => {
  const out = [];
  for await (const ev of codexChat({ system: "s", prompt: "p", signal: new AbortController().signal }, { cwd: home, env: appEnv({ CODEX_HOME: join(state, "cli", "openai") }) })) out.push(ev);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.type, "error");
});

test("a setup change during a turn: the old session is not saved back, and no repair resumes it", async () => {
  await call("PUT", "/api/coach/providers/anthropic", { key: ANTHROPIC });
  writeFileSync(join(dir, "slow"), "1200");
  try {
    const before = turns().length;
    const pending = chat({ provider: "anthropic", message: "BREAK THE PLAN" });
    await waitFor(async () => turns().length > before, "the turn to start");
    // What a PUT that changes the model, or a new ChatGPT sign-in, does while the CLI is still working.
    convs.resetThreads("anthropic");
    const r = await pending;
    assert.equal(r.status, 200);
    const id = r.events[0]![1].id;
    assert.equal(convs.get(id)!.thread_id, null, "the reset stands");
    assert.equal(turns().length, before + 1, "no repair turn ran");
    assert.ok(!r.events.some(([e, d]) => e === "notice" && /proposed plan is ready/.test(d.message)), "a stale turn creates no proposal");
    const next = await chat({ provider: "anthropic", conversation: id, message: "again" });
    assert.deepEqual(next.events[1], ["notice", { message: FRESH_NOTICE }]);
    assert.ok(!turns().at(-1)!.argv.includes("--resume"));
  } finally {
    rmSync(join(dir, "slow"), { force: true });
    writeFileSync(join(home, "plan", "plan.json"), readFileSync(join(dir, "good-plan.json")));
  }
});

test("replacing only the key keeps the history, also when the model field holds the default by name", async () => {
  store.remove("anthropic");
  await call("PUT", "/api/coach/providers/anthropic", { key: ANTHROPIC });
  assert.equal(store.get("anthropic")!.model, null);
  const r = await chat({ provider: "anthropic", message: "hello" });
  const id = r.events[0]![1].id;
  assert.equal(convs.get(id)!.thread_id, "fake-claude-1");
  // An older page sends the model it shows, which is the default.
  await call("PUT", "/api/coach/providers/anthropic", { key: `${ANTHROPIC}-new`, model: "sonnet" });
  assert.equal(convs.get(id)!.thread_id, "fake-claude-1");
  await call("PUT", "/api/coach/providers/anthropic", { key: ANTHROPIC, model: "" });
});

test("host logins signed out: the rows say so in words, not with the command's error", async () => {
  writeFileSync(join(dir, "signed-out"), "");
  try {
    const p = await call("GET", "/api/providers");
    const byId = Object.fromEntries(p.json.list.map((x: any) => [x.id, x]));
    assert.deepEqual([byId.claude.ok, byId.claude.detail], [false, "Not signed in on testhost"]);
    assert.deepEqual([byId.codex.ok, byId.codex.detail], [false, "Not signed in on testhost"]);
    assert.doesNotMatch(p.text, /Command failed|fake-cli/);
  } finally {
    rmSync(join(dir, "signed-out"), { force: true });
  }
});

test("locally hosted: loopback TCP with the token, no public name in ALLOWED_HOSTS and no REQUIRE_USER", () => {
  const loop = new Set(["localhost", "127.0.0.1", "[::1]"]);
  assert.equal(locallyHosted({ access: true, host: "127.0.0.1", allowedHosts: loop }), true);
  assert.equal(locallyHosted({ access: true, host: "127.0.0.1", allowedHosts: new Set([...loop, "localhost:5190"]) }), true);
  assert.equal(locallyHosted({ access: false, host: "127.0.0.1", allowedHosts: loop }), false);
  assert.equal(locallyHosted({ access: true, host: "0.0.0.0", allowedHosts: loop }), false);
  // Behind a proxy that names a public host: the remote defaults, so no host logins, keys or private endpoints.
  const proxied = locallyHosted({ access: true, host: "127.0.0.1", allowedHosts: new Set([...loop, "guitar.example.org"]) });
  assert.equal(proxied, false);
  const p = coachPolicy({ local: proxied });
  assert.deepEqual([p.hostLogins, p.keys, p.privateEndpoints, p.deviceSignIn], [false, false, false, false]);
  assert.equal(locallyHosted({ access: true, host: "127.0.0.1", allowedHosts: loop, requireUser: "pat" }), false);
});

test("a reply that repeats a saved secret, even split across streamed pieces, reaches nobody", async () => {
  const secret = "sk-ant-api03-STREAMED-SECRET-9999";
  const pieces = ["Your key is sk-ant-", "api03-STREAMED-SEC", "RET-9999, done. sk-a", "nd more"];
  const out: string[] = [];
  for await (const ev of guardedRun(
    (async function* () {
      for (const t of pieces) yield { type: "delta" as const, text: t };
    })(),
    { label: "X", secrets: [secret] },
  )) {
    if (ev.type === "delta") out.push(ev.text);
  }
  assert.equal(out.join(""), "Your key is …9999, done. sk-and more");
  assert.ok(!out.some((t) => t.includes("STREAMED")));
});

test("no secret reached a response, the database or the fake's log", () => {
  const all = [...transcripts, readFileSync(join(dir, "calls.jsonl"), "utf8"), readFileSync(join(state, "struna.sqlite")).toString("latin1")].join("\n");
  for (const k of [ANTHROPIC, OPENAI, ENDPOINT]) assert.ok(!all.includes(k), k.slice(0, 12));
  // The store is the one place that holds them.
  assert.ok(readFileSync(store.file, "utf8").includes(ANTHROPIC));
});

test("all seven Studio paths stage automatic proposals and cannot write active plan/archive", async () => {
  await call("PUT", "/api/coach/providers/anthropic", { key: ANTHROPIC });
  await call("PUT", "/api/coach/providers/openai", { key: OPENAI });
  await call("PUT", "/api/coach/providers/bedrock", { key: "bedrock-DUMMY-qualification", region: "us-east-1" });
  await call("PUT", "/api/coach/providers/endpoint", { preset: "openrouter", key: ENDPOINT, model: "test-model" });
  writeFileSync(join(store.dir("chatgpt"), "auth.json"), JSON.stringify({ fake: true }));
  const original = readFileSync(join(home, "plan/plan.json"), "utf8");
  for (const provider of ["claude", "anthropic", "bedrock", "codex", "chatgpt", "openai", "endpoint"]) {
    const count = (db.prepare("SELECT COUNT(*) AS n FROM plan_proposals WHERE state='pending'").get() as { n: number }).n;
    const r = await chat({ provider, message: "PROPOSE PLAN; TRY LIVE WRITE", auto: "material-added" });
    assert.equal(r.status, 200);
    assert.ok(!names(r.events).includes("error"), provider);
    assert.ok(r.events.some(([e, d]) => e === "notice" && /proposed plan is ready/.test(d.message)), provider);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "denied-writes.json"), "utf8")), [true, true]);
    assert.equal(readFileSync(join(home, "plan/plan.json"), "utf8"), original);
    assert.equal(existsSync(join(home, "plan/archive/hostile.json")), false);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM plan_proposals WHERE state='pending'").get() as { n: number }).n, count + 1);
  }
});

test("failed qualification disables every provider path without a direct-write fallback", async () => {
  policy.planSandbox = { claude: { ok: false, detail: "Offline plan sandbox probe failed" }, codex: { ok: false, detail: "Offline plan sandbox probe failed" } };
  try {
    const rows = (await call("GET", "/api/providers")).json.list;
    assert.ok(rows.every((r: { ok: boolean; unavailable: boolean }) => !r.ok && r.unavailable));
    for (const provider of ["claude", "anthropic", "bedrock", "codex", "chatgpt", "openai", "endpoint"]) {
      const r = await chat({ provider, message: "Try to change my plan" });
      assert.equal(r.status, 400, provider);
      assert.match(r.text, /probe failed/);
    }
  } finally { delete policy.planSandbox; }
});
