import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../db.ts";
import { parseGenericLog } from "../generic/logs.ts";
import { validatePlan } from "../generic/studio.ts";
import { testHosted } from "./test-server.ts";
import { EXPORT_LIMITS } from "./export.ts";

test("account export is readable, bounded, read-only and excludes credentials, owner and foreign data", async () => {
  const h = await testHosted({ run: async function* () { yield "Alice reply"; } });
  try {
    const a = await h.signIn("A"), b = await h.signIn("B");
    for (const [p, name] of [[a, "ALICE"], [b, "BOB_FORBIDDEN"]] as const) {
      assert.equal((await h.call("/api/profile", p, "PUT", { name, notes: `${name} notes` })).status, 200);
      await h.call("/api/sessions", p, "POST", { session: { id: "full", label: "Full" }, minutes: 3, wentWell: name, notes: "Complete reflection", cleanTempo: 72 });
      await h.call("/api/tempos", p, "PUT", { fragment: "passage", bpm: 72 });
      await h.call("/api/prompts/custom", p, "PUT", { prompts: [{ label: "Mine", text: `${name} question` }] });
      await h.call("/api/providers/openai", p, "PUT", { key: `${name}_DUMMY_CREDENTIAL`, model: "test-model" });
      await (await h.call("/api/chat", p, "POST", { provider: "openai", message: `${name} conversation` })).text();
    }
    const home = join(h.root, "accounts", a.account, "workspace");
    const profile = readFileSync(join(home, "profile.json")), plan = readFileSync(join(home, "plan/plan.json"));
    const names = readdirSync(join(home, "logs")), log = readFileSync(join(home, "logs", names[0]!));
    const db = openDb(join(h.root, "accounts", a.account, "state"));
    db.prepare("INSERT INTO settings VALUES(?, ?)").run("operator-secret", "DO_NOT_EXPORT_SETTING"); db.close();
    writeFileSync(join(h.root, "owner-config"), "OWNER_FORBIDDEN");
    writeFileSync(join(home, "materials", "excluded.txt"), "MATERIAL_BINARY_EXCLUDED");
    writeFileSync(join(home, "Recordings", "excluded.webm"), "TAKE_BINARY_EXCLUDED");
    const res = await h.call("/api/account/export", a, "POST", {});
    assert.equal(res.status, 200); assert.equal(res.headers.get("cache-control"), "no-store");
    assert.match(res.headers.get("content-disposition")!, /attachment/);
    const text = await res.text(), exported = JSON.parse(text);
    for (const secret of ["BOB_FORBIDDEN", "DUMMY_CREDENTIAL", "DO_NOT_EXPORT_SETTING", "OWNER_FORBIDDEN", "MATERIAL_BINARY_EXCLUDED", "TAKE_BINARY_EXCLUDED", h.root, a.session, b.account, a.csrf, a.cookie.split("=")[1]!]) assert.ok(!text.includes(secret), secret);
    assert.equal(exported.format, "struna-practice-export"); assert.equal(exported.version, 1);
    assert.ok(Number.isFinite(Date.parse(exported.exportedAt)));
    assert.equal(exported.data.profile.name, "ALICE"); assert.equal(exported.data.tempos[0].bpm, 72);
    assert.equal(validatePlan(exported.data.plan).errors.length, 0);
    assert.equal(parseGenericLog(exported.data.logs[0].name, exported.data.logs[0].markdown).wentWell, "ALICE");
    assert.match(exported.data.logs[0].markdown, /Complete reflection/);
    assert.equal(exported.data.messages.length, 2); assert.match(JSON.stringify(exported.data.customPrompts), /ALICE question/);
    assert.equal(JSON.parse(JSON.stringify(exported)).data.logs[0].markdown, log.toString());
    assert.deepEqual(readFileSync(join(home, "profile.json")), profile);
    assert.deepEqual(readFileSync(join(home, "plan/plan.json")), plan);
    assert.deepEqual(readFileSync(join(home, "logs", names[0]!)), log);
    assert.deepEqual(readdirSync(join(home, "logs")), names);
    for (const body of [{ account: b.account }, { path: h.root }, { session: b.session }]) assert.equal((await h.call("/api/account/export", a, "POST", body)).status, 400);
    assert.equal((await h.call(`/api/account/export?account=${b.account}`, a, "POST", {})).status, 400);
    assert.equal((await h.call("/api/account/export", undefined, "POST", {})).status, 401);
    assert.equal((await h.call("/api/account/export", a, "POST", {}, { "x-struna-session": b.session })).status, 409);
    assert.equal((await h.call("/api/account/export", a, "POST", {}, { "x-csrf-token": "bad" })).status, 403);
    writeFileSync(join(home, "profile.json"), "invalid-json");
    const failed = await h.call("/api/account/export", a, "POST", {});
    assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes(h.root));
    writeFileSync(join(home, "profile.json"), profile);
    writeFileSync(join(home, "logs", "2026-11-15-999.md"), "x".repeat(EXPORT_LIMITS.fileBytes + 1));
    assert.equal((await h.call("/api/account/export", a, "POST", {})).status, 413);
    await h.call("/auth/logout", a, "POST", {});
    assert.equal((await h.call("/api/account/export", a, "POST", {})).status, 401);
  } finally { await h.close(); }
});
