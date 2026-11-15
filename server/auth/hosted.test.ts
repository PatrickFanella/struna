import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHostedAuth, returnTo, type IdentityAdapter } from "./hosted.ts";
import { fail } from "../http.ts";

const origin = "https://practice.example";
test("hosted identities, rotation, revocation, expiry, CSRF and private-route denial", async () => {
  const dir = mkdtempSync(join(tmpdir(), "struna-auth-"));
  let clock = Date.now();
  const challenges = new Map<string, { nonce: string; verifier: string }>();
  const adapter: IdentityAdapter = {
    issuer: "https://identity.example",
    async begin(state, nonce, verifier) { challenges.set(state, { nonce, verifier }); return `https://identity.example/authorize?state=${state}`; },
    async finish(url, state, nonce, verifier) {
      assert.deepEqual(challenges.get(state), { nonce, verifier });
      if (url.searchParams.has("error")) throw new Error("denied");
      return { subject: url.searchParams.get("code")! };
    },
  };
  const auth = createHostedAuth({ stateDir: dir, origin, adapter, now: () => clock });
  const server = createServer(async (req, res) => { try {
    if (!await auth.handle(req, res, new URL(req.url!, origin))) { res.end("public shell"); }
  } catch (e) { fail(res, e); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (path: string, init: RequestInit = {}) => fetch(base + path, { ...init, redirect: "manual" });
  const start = async (old = "", destination = "#practice") => {
    const r = await request("/auth/login", { method: "POST", headers: { origin, "x-struna": "1", cookie: old }, body: JSON.stringify({ returnTo: destination }) });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("set-cookie")!, /Secure; HttpOnly; SameSite=Lax/);
    const state = new URL((await r.json()).redirect).searchParams.get("state")!;
    return { state, flow: r.headers.getSetCookie().find((v) => v.startsWith("__Host-struna-login="))!.split(";")[0]! };
  };
  const finish = (flow: string, state: string, code: string, old = "") => request(`/auth/callback?state=${state}&code=${code}`, { headers: { cookie: `${flow}; ${old}` } });
  try {
    for (const path of ["/api/profile", "/api/today", "/api/materials", "/api/conversations", "/api/providers", "/api/recordings", "/api/library", "/unknown"]) {
      assert.equal((await request(path, { headers: { "remote-user": "owner", "x-struna-token": "owner" } })).status, 401);
    }
    for (const path of ["/", "/brand/app-icon.svg", "/api/health", "/api/app"]) assert.equal((await request(path)).status, 200);
    assert.deepEqual(await (await request("/api/account")).json(), { signedIn: false });
    assert.equal((await request("/auth/login", { method: "POST" })).status, 403);
    assert.equal((await request("/auth/login", { method: "POST", headers: { origin: "https://evil.example", "x-struna": "1" } })).status, 403);
    const a = await start("", "https://evil.example");
    assert.equal((await finish("", a.state, "alice")).status, 400);
    const signed = await finish(a.flow, a.state, "alice");
    assert.equal(signed.status, 303); assert.equal(signed.headers.get("location"), "/#practice");
    const session = signed.headers.getSetCookie().find((v) => v.startsWith("__Host-struna-session="))!.split(";")[0]!;
    assert.equal((await finish(a.flow, a.state, "alice")).status, 400, "callback is one-use");
    const alice = await (await request("/api/account", { headers: { cookie: session } })).json();
    assert.equal(alice.signedIn, true);
    assert.equal((await request("/api/profile", { headers: { cookie: session } })).status, 503);
    assert.equal((await request("/auth/logout", { method: "POST", headers: { origin, "x-struna": "1", cookie: session } })).status, 403);
    const b = await start(session);
    const switched = await finish(b.flow, b.state, "bob", session);
    const sessionB = switched.headers.getSetCookie().find((v) => v.startsWith("__Host-struna-session="))!.split(";")[0]!;
    assert.equal((await (await request("/api/account", { headers: { cookie: session } })).json()).signedIn, false, "login rotates old session");
    const bob = await (await request("/api/account", { headers: { cookie: sessionB } })).json();
    assert.notEqual(alice.account, bob.account);
    assert.equal((await request("/auth/logout", { method: "POST", headers: { origin, "x-struna": "1", cookie: sessionB, "x-csrf-token": bob.csrf } })).status, 200);
    assert.equal((await (await request("/api/account", { headers: { cookie: sessionB } })).json()).signedIn, false, "logout revokes replay");
    const c = await start(); const cs = await finish(c.flow, c.state, "alice");
    const sessionC = cs.headers.getSetCookie().find((v) => v.startsWith("__Host-struna-session="))!.split(";")[0]!;
    clock += 7 * 86400000;
    assert.equal((await (await request("/api/account", { headers: { cookie: sessionC } })).json()).signedIn, false, "idle expiry");
    const d = await start(); clock += 600001;
    assert.equal((await finish(d.flow, d.state, "alice")).status, 400, "flow expiry");
    const e = await start();
    assert.equal((await request(`/auth/callback?state=${e.state}&error=denied`, { headers: { cookie: e.flow } })).headers.get("location"), "/?signin=failed");
    const f = await start(); assert.equal((await finish(f.flow, "forged", "alice")).status, 400);
    const rateCookie = "__Host-struna-rate=browser-one";
    for (let i = 0; i < 31; i++) await request("/auth/login", { method: "POST", headers: { origin, "x-struna": "1", cookie: rateCookie } });
    assert.equal((await request("/auth/login", { method: "POST", headers: { origin, "x-struna": "1", cookie: rateCookie } })).status, 429);
    assert.equal((await request("/auth/login", { method: "POST", headers: { origin, "x-struna": "1", cookie: "__Host-struna-rate=browser-two" } })).status, 200, "another browser behind the proxy has a separate quota");
  } finally { await new Promise<void>((r) => server.close(() => r())); auth.close(); rmSync(dir, { recursive: true, force: true }); }
});
test("return destinations only accept named app locations", () => {
  for (const v of ["//evil.example", "/auth/callback", "javascript:alert(1)", "#practice\n", {}, null]) assert.equal(returnTo(v), "/#practice");
  assert.equal(returnTo("#materials"), "/#materials");
});
