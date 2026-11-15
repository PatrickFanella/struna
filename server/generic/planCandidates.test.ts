import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, symlink, link, rename, lstat, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDb } from "../db.ts";
import { ensureStudio, normalizeProfile, type Studio } from "./studio.ts";
import { starterPlan } from "./starter.ts";
import { planCandidates } from "./planCandidates.ts";
import { probePlanSandbox } from "./planSandbox.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "struna-candidates-test-"));
  const home = join(root, "home"); await ensureStudio(home);
  const db = openDb(join(root, "state"));
  const s: Studio = { home, db, timeZone: "UTC", libraryDirs: [], web: false, appName: "Struna" };
  const base = starterPlan(normalizeProfile({}, new Date().toISOString()), "2026-11-14");
  await writeFile(join(home, "plan/plan.json"), JSON.stringify(base));
  const store = planCandidates(s); await store.recover();
  const propose = async (change: object = { next: "Play a slower roll" }) => {
    const turn = await store.begin("stand-in");
    await writeFile(join(home, turn.relative), JSON.stringify({ ...base, ...change }));
    return (await store.finish(turn, true))!;
  };
  return { root, home, db, s, base, store, propose, close: async () => { db.close(); await rm(root, { recursive: true, force: true }); } };
}

test("exact preview remains private and changes nothing until idempotent Apply", async () => {
  const f = await fixture();
  try {
    const before = await readFile(join(f.home, "plan/plan.json"), "utf8");
    const p = await f.propose({ next: "<script>not executable</script>", title: "New title" });
    assert.deepEqual(p.changes.map((c) => c.field).sort(), ["next", "title"]);
    assert.equal(await readFile(join(f.home, "plan/plan.json"), "utf8"), before);
    assert.equal((await readdir(join(f.home, "plan/archive"))).length, 0);
    assert.equal(f.store.list()[0]!.digest, p.digest);
    const receipt = await f.store.apply(p.id, p.digest, f.store.state().revision);
    assert.equal(JSON.parse(await readFile(join(f.home, "plan/plan.json"), "utf8")).title, "New title");
    assert.deepEqual(await f.store.apply(p.id, p.digest, 9999), receipt);
    assert.equal(f.store.list().length, 0);
  } finally { await f.close(); }
});

test("advice, failure/cancel, dismissal and expiration never activate candidates", async () => {
  const f = await fixture();
  try {
    const advice = await f.store.begin("stand-in");
    assert.equal(await f.store.finish(advice, true), null);
    const canceled = await f.store.begin("stand-in");
    await writeFile(join(f.home, canceled.relative), JSON.stringify({ ...f.base, title: "Canceled" }));
    assert.equal(await f.store.finish(canceled, false), null);
    const p = await f.propose(); await f.store.dismiss(p.id);
    await assert.rejects(f.store.apply(p.id, p.digest, 0), /no longer pending/);
    const expired = await f.propose();
    f.db.prepare("UPDATE plan_proposals SET created=0 WHERE id=?").run(expired.id);
    assert.equal(f.store.list().length, 0);
    await assert.rejects(f.store.apply(expired.id, expired.digest, 0), /no longer pending/);
    assert.deepEqual(JSON.parse(await readFile(join(f.home, "plan/plan.json"), "utf8")), f.base);
  } finally { await f.close(); }
});

test("invalid JSON, future dates, missing/escaping materials and links are refused", async () => {
  const f = await fixture();
  try {
    for (const raw of ["{", JSON.stringify({ ...f.base, started: "2099-01-01" }), JSON.stringify({ ...f.base, materials: [{ label: "Missing", file: "materials/missing.md" }] }), JSON.stringify({ ...f.base, materials: [{ label: "Escape", file: "../secret.md" }] })]) {
      const turn = await f.store.begin("stand-in"); await writeFile(join(f.home, turn.relative), raw);
      await assert.rejects(f.store.finish(turn, true));
    }
    const target = join(f.root, "outside.json"); await writeFile(target, JSON.stringify(f.base));
    for (const make of [symlink, link]) {
      const turn = await f.store.begin("stand-in"); const path = join(f.home, turn.relative); await rm(path); await make(target, path);
      await assert.rejects(f.store.finish(turn, true), /regular files/);
    }
    assert.equal(f.store.list().length, 0);
  } finally { await f.close(); }
});

test("Apply refuses changed bases, stale session assertions and any active tab", async () => {
  const f = await fixture();
  try {
    const p = await f.propose(); const idle = f.store.state();
    await f.store.practice("tab-a", true); await f.store.practice("tab-b", true);
    await assert.rejects(f.store.apply(p.id, p.digest, idle.revision), /all open tabs/);
    await f.store.practice("tab-a", false);
    await assert.rejects(f.store.apply(p.id, p.digest, f.store.state().revision), /all open tabs/);
    await f.store.practice("tab-b", false);
    await assert.rejects(f.store.apply(p.id, p.digest, idle.revision), /all open tabs/);
    await writeFile(join(f.home, "plan/plan.json"), JSON.stringify({ ...f.base, next: "External change" }));
    await assert.rejects(f.store.apply(p.id, p.digest, f.store.state().revision), /active plan changed/);
  } finally { await f.close(); }
});

test("replacement archives exact original bytes and refuses archive collisions", async () => {
  const f = await fixture();
  try {
    const original = await readFile(join(f.home, "plan/plan.json"), "utf8");
    const p = await f.propose({ id: "replacement-plan" });
    const archive = join(f.home, "plan/archive", `${f.base.id}.json`);
    await writeFile(archive, "external archive");
    await assert.rejects(f.store.apply(p.id, p.digest, 0), /archive destination changed/);
    assert.equal(await readFile(join(f.home, "plan/plan.json"), "utf8"), original);
    await rm(archive);
    await f.store.apply(p.id, p.digest, 0);
    assert.equal(await readFile(archive, "utf8"), original);
    assert.equal((await lstat(archive)).nlink, 1);
  } finally { await f.close(); }
});

test("startup recovers both sides of a durable Apply intent without overwriting archives", async () => {
  for (const committed of [false, true]) {
    const f = await fixture();
    try {
      const p = await f.propose({ id: "next-plan" });
      const row = f.db.prepare("SELECT * FROM plan_proposals WHERE id=?").get(p.id) as { base: string; candidate: string; archive: string };
      const source = join(f.home, "plan", `.archive-${p.id}.json`);
      const next = join(f.home, "plan", `.candidate-${p.id}.json`);
      await writeFile(source, row.base); await writeFile(next, row.candidate);
      f.db.prepare("UPDATE plan_proposals SET state='applying' WHERE id=?").run(p.id);
      await link(source, join(f.home, "plan/archive", row.archive));
      if (committed) await rename(next, join(f.home, "plan/plan.json"));
      await planCandidates(f.s).recover();
      assert.equal((f.db.prepare("SELECT state FROM plan_proposals WHERE id=?").get(p.id) as { state: string }).state, committed ? "applied" : "pending");
      assert.equal((await readdir(join(f.home, "plan/archive"))).length, committed ? 1 : 0);
    } finally { await f.close(); }
  }
});

test("the real offline wrapper blocks live writes and fails closed for an absent CLI", async () => {
  assert.equal((await probePlanSandbox(process.execPath)).ok, true);
  assert.equal((await probePlanSandbox("/absent-struna-cli")).ok, false);
});

test("vanished practice leases expire and invalidate older idle assertions", async () => {
  const f = await fixture();
  try {
    const p = await f.propose();
    const original = f.store.state().revision;
    await f.store.practice("closed-tab", true);
    f.db.prepare("UPDATE practice_clients SET updated=0 WHERE id='closed-tab'").run();
    const current = f.store.state();
    assert.equal(current.active, false); assert.ok(current.revision > original);
    await assert.rejects(f.store.apply(p.id, p.digest, original), /all open tabs/);
    await f.store.apply(p.id, p.digest, current.revision);
  } finally { await f.close(); }
});
