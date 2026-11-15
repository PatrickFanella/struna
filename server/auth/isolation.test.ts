import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { testHosted } from "./test-server.ts";

type Entry = { source: string; method: string; path: string; hosted: string };
const inventory: Entry[] = JSON.parse(readFileSync(new URL("../../docs/verification/hosted-route-inventory.json", import.meta.url), "utf8"));

test("hosted ownership inventory covers every literal route registration", () => {
  const server = join(import.meta.dirname, "..");
  const actual = readdirSync(server, { recursive: true, encoding: "utf8" }).filter(p => p.endsWith(".ts") && !p.endsWith(".test.ts")).sort().flatMap(source =>
    [...readFileSync(join(server, source), "utf8").matchAll(/\b(?:route|register)\("(GET|POST|PUT|PATCH|DELETE)",\s*"([^"]+)"/g)].map(m => ({ source, method: m[1], path: m[2] })));
  assert.deepEqual(inventory.map(({ hosted, ...route }) => route), actual, "Classify new/changed registrations in the ownership inventory before shipping");
  assert.ok(inventory.every(r => ["public", "account", "denied"].includes(r.hosted)));
});

test("combined hostile route matrix denies owner/process routes and stale authority without fallback", async () => {
  let clock = Date.now();
  const h = await testHosted({ now: () => clock, run: async function* ({ message, signal }) {
    yield message;
    await new Promise<void>(r => signal.addEventListener("abort", () => r(), { once: true }));
    yield "FORBIDDEN_LATE_OUTPUT";
  } });
  try {
    const [a, b] = await Promise.all([h.signIn("A"), h.signIn("B")]);
    const runtime = await h.practice.inventory(a);
    const keys = (routes: { method: string; path: string }[]) => [...new Set(routes.map(r => `${r.method} ${r.path}`))].sort();
    assert.deepEqual(keys(runtime), keys(inventory.filter(r => r.hosted === "account")), "Inventory must match actual hosted handler registrations");
    const canaries = ["ALICE_PRIVATE_CANARY", "BOB_PRIVATE_CANARY"];
    const resources = await Promise.all([a, b].map(async (p, i) => {
      await h.call("/api/profile", p, "PUT", { name: canaries[i] });
      const uploaded = await h.call(`/api/materials/upload?name=private-${i}.txt`, p, "POST", canaries[i]);
      assert.equal(uploaded.status, 201);
      const file = await uploaded.json();
      const take = await (await h.call("/api/recordings?blockId=test&label=baseline&ext=webm&seconds=1", p, "POST", canaries[i], { "x-struna-take": crypto.randomUUID() })).json();
      await h.call("/api/providers/openai", p, "PUT", { key: canaries[i], model: "test-model" });
      return { file, take };
    }));
    // Fake owner secrets and files live beside accounts, never in an eligible root.
    writeFileSync(join(h.root, "owner-canary.txt"), "OWNER_FORBIDDEN_CANARY");
    writeFileSync(join(h.root, "accounts", a.account, "cache", "private-cache.txt"), "ALICE_CACHE_CANARY");
    for (const [i, p] of [a, b].entries()) {
      const foreign = resources[1 - i]!;
      for (const path of ["/api/today", "/api/app", "/api/materials", "/api/recordings", "/api/providers", "/api/prompts", "/api/conversations"]) {
        const response = await h.call(path, p);
        assert.equal(response.status, 200, path);
        assert.equal(response.headers.get("cache-control"), "no-store");
        const text = await response.text();
        for (const secret of [canaries[1 - i]!, "OWNER_FORBIDDEN_CANARY"]) assert.ok(!text.includes(secret), path);
      }
      for (const path of [foreign.file.src, foreign.take.src]) assert.equal((await h.call(path, p)).status, 404);
      for (const r of inventory.filter(r => r.hosted === "denied")) {
        const path = r.path.replace(/:[^/]+/g, "owner-canary") + "?path=owner-canary.txt&file=owner-canary.txt";
        const response = await h.call(path, p, r.method, ["GET", "HEAD"].includes(r.method) ? undefined : {});
        assert.equal(response.status, 503, `${r.method} ${path}`);
        assert.ok(!(await response.text()).includes("OWNER_FORBIDDEN_CANARY"));
        assert.equal((await h.call(path, undefined, r.method, r.method === "GET" ? undefined : {})).status, 401);
      }
      for (const path of ["/cache/private-cache.txt", "/accounts/" + a.account + "/cache/private-cache.txt", "/owner-canary.txt", "/api/not-ported"]) assert.equal((await h.call(path, p)).status, 503);
      for (const method of ["GET", "HEAD"]) {
        for (const path of [resources[i]!.file.src, resources[i]!.take.src, "/api/today", "/api/providers", "/api/conversations"]) {
          assert.equal((await h.call(path, undefined, method)).status, 401);
          assert.equal((await h.call(path, p, method, undefined, { "x-struna-session": (i ? a : b).session })).status, 409);
        }
      }
    }
    const stream = await h.call("/api/chat", a, "POST", { provider: "openai", message: "Alice question" });
    const reader = stream.body!.getReader(); await reader.read();
    clock += 8 * 86_400_000; // Idle session expiry; no later browser request needed to abort.
    let text = "";
    for (;;) { const next = await reader.read(); if (next.done) break; text += new TextDecoder().decode(next.value); }
    assert.ok(!text.includes("FORBIDDEN_LATE_OUTPUT"));
    assert.ok(text.includes('"aborted":true'));
    for (const path of ["/api/profile", resources[0]!.file.src, resources[0]!.take.src, "/api/conversations", "/api/providers/openai"]) assert.equal((await h.call(path, a)).status, 401);
    const fresh = await h.signIn("B", a);
    assert.equal((await h.call("/api/today", fresh, "GET", undefined, { "x-struna-session": a.session })).status, 409);
    assert.equal((await (await h.call("/api/profile", fresh)).json()).profile.name, canaries[1]);
    await h.call("/auth/logout", fresh, "POST", {});
    assert.equal((await h.call("/api/providers", fresh)).status, 401);
    assert.ok(!readdirSync(h.root).includes("struna.sqlite"));
  } finally { await h.close(); }
});
