import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, request as httpRequest } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHostedAuth } from "./hosted.ts";
import { hostedPractice } from "./practice.ts";
import { fail } from "../http.ts";

test("two hosted players have separate profiles, plans, logs, tempos and leases, with stale-session denial", async () => {
  const root = mkdtempSync(join(tmpdir(), "struna-private-"));
  const origin = "https://practice.example";
  const practice = hostedPractice(root, [join(root, "..", "owner-fixture")], "UTC");
  const auth = createHostedAuth({ stateDir: root, origin, practice, adapter: {
    issuer: "https://identity.example",
    async begin(state) { return `https://identity.example/?state=${state}`; },
    async finish(url) { return { subject: url.searchParams.get("code")! }; },
  } });
  const server = createServer(async (req, res) => { try { if (!await auth.handle(req, res, new URL(req.url!, origin))) res.end(JSON.stringify(await auth.info(req))); } catch (e) { fail(res, e); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  type Player = { cookie: string; account: string; session: string; csrf: string };
  const call = (path: string, player?: Player, body?: unknown, headers = {}) => fetch(base + path, { method: body === undefined ? "GET" : path === "/api/sessions" ? "POST" : "PUT", headers: { origin, "x-struna": "1", ...(player ? { cookie: player.cookie, "x-struna-session": player.session, "x-csrf-token": player.csrf } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const signIn = async (subject: string, old?: Player): Promise<Player> => {
    const start = await fetch(base + "/auth/login", { method: "POST", headers: { origin, "x-struna": "1" }, body: "{}" });
    const flow = start.headers.getSetCookie()[0]!.split(";")[0]!;
    const state = new URL((await start.json()).redirect).searchParams.get("state");
    const finish = await fetch(`${base}/auth/callback?state=${state}&code=${subject}`, { headers: { cookie: `${flow}; ${old?.cookie ?? ""}` }, redirect: "manual" });
    const cookie = finish.headers.getSetCookie().find((x) => x.startsWith("__Host-struna-session="))!.split(";")[0]!;
    return { cookie, ...await (await fetch(base + "/api/account", { headers: { cookie } })).json() };
  };
  try {
    assert.equal((await call("/api/today")).status, 401);
    const [a, b] = await Promise.all([signIn("A"), signIn("B")]);
    assert.notEqual(a.account, b.account);
    const walk = async (p: Player, name: string, bpm: number, minutes: number) => {
      assert.equal((await call("/api/profile", p, { name, minutesPerSession: minutes, account: p === a ? b.account : a.account, home: "/owner" })).status, 200);
      const today = await (await call("/api/today", p)).json();
      assert.equal(today.profile.name, name);
      assert.equal(today.profile.minutesPerSession, minutes);
      assert.equal((await call("/api/practice-state", p, { client: "same-browser-client", active: true })).status, 200);
      assert.equal((await call("/api/tempos", p, { fragment: "same-material", bpm })).status, 200);
      assert.equal((await call("/api/sessions", p, { session: { id: "full", label: "Full" }, planId: today.block.id, minutes: 3, wentWell: name, cleanTempo: bpm, submissionId: crypto.randomUUID() })).status, 200);
    };
    await Promise.all([walk(a, "Alice", 60, 10), walk(b, "Bob", 90, 25)]);
    for (const [p, name, bpm] of [[a, "Alice", 60], [b, "Bob", 90]] as const) {
      assert.equal((await (await call("/api/profile?account=" + (p === a ? b.account : a.account), p)).json()).profile.name, name);
      assert.equal((await (await call("/api/tempos", p)).json())[0].bpm, bpm);
      const logs = await (await call("/api/logs", p)).json();
      assert.equal(logs.length, 1); assert.equal(logs[0].wentWell, name);
      const info = await (await call("/api/app", p)).json();
      assert.equal(info.account, p.account); assert.equal(info.profile, true); assert.equal(info.mode, "hosted");
      const html = await (await fetch(base, { headers: { cookie: p.cookie } })).text();
      assert.match(html, new RegExp(p.account)); assert.ok(!html.includes(p === a ? b.account : a.account));
      for (const path of ["/api/recordings", "/api/conversations", "/api/providers", "/api/library", "/api/plan-candidates", "/api/file/owner"]) assert.equal((await call(path, p)).status, 503);
      const db = join(root, "accounts", p.account, "state", "struna.sqlite");
      assert.equal(statSync(db).mode & 0o777, 0o600);
      assert.equal(statSync(join(root, "accounts", p.account)).mode & 0o777, 0o700);
    }
    assert.equal((await call("/api/profile", a, { name: "Forged" }, { "x-struna-session": b.session })).status, 409);
    assert.equal((await call("/api/profile", a, { name: "Forged" }, { "x-csrf-token": "bad" })).status, 403);
    assert.equal((await call("/api/profile", a, { name: "Forged" }, { origin: "https://elsewhere.example" })).status, 403);
    // Begin a body under A, rotate the cookie session, then finish the old request.
    const delayed = httpRequest(base + "/api/profile", { method: "PUT", headers: { origin, cookie: a.cookie, "x-struna": "1", "x-struna-session": a.session, "x-csrf-token": a.csrf, "content-length": 18 } });
    delayed.write('{"name":');
    const switched = await signIn("B", a);
    const response = new Promise<number>((r) => delayed.on("response", (res) => { res.resume(); r(res.statusCode!); }));
    delayed.end('"Changed"}');
    assert.equal(await response, 401);
    assert.equal((await call("/api/profile", a)).status, 401);
    assert.equal((await call("/api/profile", switched, { name: "Changed" }, { "x-struna-session": a.session })).status, 409);
    assert.equal((await (await call("/api/profile", b)).json()).profile.name, "Bob");
    const again = await signIn("A");
    assert.equal(again.account, a.account);
    assert.equal((await (await call("/api/profile", again)).json()).profile.name, "Alice");
    const aliceHome = join(root, "accounts", a.account, "workspace");
    const profileBytes = readFileSync(join(aliceHome, "profile.json"));
    symlinkSync(join(root, "accounts", b.account, "workspace", "profile.json"), join(aliceHome, "linked.json"));
    assert.equal((await call("/api/profile", again)).status, 503);
    assert.deepEqual(readFileSync(join(aliceHome, "profile.json")), profileBytes);
    assert.ok(!readdirSync(root).includes("struna.sqlite"), "no owner/global practice DB");
  } finally { await new Promise<void>((r) => server.close(() => r())); auth.close(); rmSync(root, { recursive: true, force: true }); }
});

test("hosted roots cannot overlap an owner workspace", () => {
  const root = mkdtempSync(join(tmpdir(), "struna-root-"));
  try { assert.throws(() => hostedPractice(root, [root], "UTC"), /separate/); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test("production refuses the scratch practice switch before opening identity or owner data", () => {
  const result = spawnSync(process.execPath, ["server/index.ts"], { encoding: "utf8", env: { ...process.env, STRUNA_MODE: "hosted", STRUNA_HOSTED_PRACTICE: "1", NODE_ENV: "production", EDGE_SECRET_FILE: "" } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /scratch-only/);
});
