import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { testHosted } from "./test-server.ts";

function tree(root: string): Record<string, string> {
  return Object.fromEntries(readdirSync(root, { recursive: true, encoding: "utf8" }).filter(p => { try { return !readdirSync(join(root, p)); } catch { return true; } }).map(p => [p, readFileSync(join(root, p)).toString("base64")]));
}
test("delete revokes all sessions, drains replies, removes only the owning tree and is retry-safe", async () => {
  let stopped = false;
  const h = await testHosted({ run: async function* ({ signal }) { yield "Start"; await new Promise<void>(r => signal.addEventListener("abort", () => { stopped = true; r(); }, { once: true })); yield "LATE_FORBIDDEN"; } });
  try {
    const a = await h.signIn("A"), a2 = await h.signIn("A"), b = await h.signIn("B");
    for (const [p, name] of [[a, "ALICE"], [b, "BOB"]] as const) {
      await h.call("/api/profile", p, "PUT", { name });
      await h.call("/api/providers/openai", p, "PUT", { key: "DUMMY_" + name, model: "stand-in" });
      await h.call("/api/materials/upload?name=keep.txt", p, "POST", name);
      await h.call("/api/recordings?blockId=test&ext=webm&seconds=1", p, "POST", name, { "x-struna-take": crypto.randomUUID() });
    }
    const owner = join(h.root, "separate-owner"); mkdirSync(owner); writeFileSync(join(owner, "private.txt"), "OWNER");
    const neighbor = join(h.root, "accounts", b.account), before = tree(neighbor);
    const own = join(h.root, "accounts", a.account);
    writeFileSync(join(own, "cache", "cached.txt"), "ALICE_CACHE");
    assert.equal((await h.call("/api/account/export", a, "POST", {})).status, 200);
    for (const body of [{}, { confirm: "delete" }, { confirm: "DELETE", account: b.account }]) assert.equal((await h.call("/auth/delete-account", a, "POST", body)).status, 400);
    assert.equal((await h.call("/auth/delete-account?account=" + b.account, a, "POST", { confirm: "DELETE" })).status, 400);
    assert.equal((await h.call("/auth/delete-account", a, "POST", { confirm: "DELETE" }, { "x-csrf-token": "bad" })).status, 403);
    assert.equal((await h.call("/auth/delete-account", a, "POST", { confirm: "DELETE" }, { "x-struna-session": b.session })).status, 409);
    assert.ok(existsSync(own), "cancel/invalid requests leave account intact");
    const reply = await h.call("/api/chat", a2, "POST", { provider: "openai", message: "wait" });
    const reader = reply.body!.getReader(); await reader.read();
    const drain = (async () => { try { for (;;) { if ((await reader.read()).done) break; } } catch {} })();
    const deleted = await h.call("/auth/delete-account", a, "POST", { confirm: "DELETE" });
    assert.equal(deleted.status, 200); await drain; assert.ok(stopped);
    assert.equal(existsSync(own), false);
    for (const p of [a, a2]) for (const path of ["/api/today", "/api/providers", "/api/conversations"]) assert.equal((await h.call(path, p)).status, 401);
    assert.equal((await h.call("/auth/delete-account", a, "POST", { confirm: "DELETE" })).status, 200);
    assert.deepEqual(tree(neighbor), before); assert.equal(readFileSync(join(owner, "private.txt"), "utf8"), "OWNER");
    const db = new DatabaseSync(join(h.root, "identity.sqlite"));
    assert.equal(db.prepare("SELECT count(*) n FROM accounts WHERE id=?").get(a.account)!.n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM sessions WHERE account=?").get(a.account)!.n, 0); db.close();
    const fresh = await h.signIn("A"); assert.notEqual(fresh.account, a.account);
    assert.equal((await (await h.call("/api/profile", fresh)).json()).profile, null);
  } finally { await h.close(); }
});

test("interrupted deletion retries after revocation and completes after transient cleanup failure", async () => {
  const h = await testHosted();
  try {
    const a = await h.signIn("A"); await h.call("/api/today", a);
    const original = h.practice.removeAccount; let failOnce = true;
    h.practice.removeAccount = async account => { if (failOnce) { failOnce = false; throw Object.assign(new Error("Cleanup unavailable; retry deletion"), { status: 503 }); } await original(account); };
    assert.equal((await h.call("/auth/delete-account", a, "POST", { confirm: "DELETE" })).status, 503);
    assert.equal((await h.call("/api/today", a)).status, 401);
    assert.equal((await h.call("/auth/delete-account", a, "POST", { confirm: "DELETE" })).status, 200);
    assert.equal(existsSync(join(h.root, "accounts", a.account)), false);
  } finally { await h.close(); }
});

test("startup resumes persisted deletion before sign-in and prunes completed retry receipts after 24 hours", async () => {
  let clock = Date.now(); const h = await testHosted({ now: () => clock });
  try {
    const a = await h.signIn("A"); await h.call("/api/today", a);
    const original = h.practice.removeAccount;
    h.practice.removeAccount = async () => { throw Object.assign(new Error("Interrupted"), { status: 503 }); };
    assert.equal((await h.call("/auth/delete-account", a, "POST", { confirm: "DELETE" })).status, 503);
    h.practice.removeAccount = original;
    h.restartAuth();
    assert.equal((await h.call("/api/today", a)).status, 401);
    assert.equal(existsSync(join(h.root, "accounts", a.account)), false);
    assert.equal((await h.call("/auth/delete-account", a, "POST", { confirm: "DELETE" })).status, 200);
    clock += 86_400_001;
    assert.equal((await h.call("/auth/delete-account", a, "POST", { confirm: "DELETE" })).status, 401);
  } finally { await h.close(); }
});
