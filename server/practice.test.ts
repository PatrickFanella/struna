import assert from "node:assert/strict";
import { cp, mkdtemp, rename, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const tmp = await mkdtemp(join(tmpdir(), "guitar-practice-"));
const vault = join(tmp, "vault");
await cp(join(import.meta.dirname, "fixtures/vault"), vault, { recursive: true });
process.env.GUITAR_VAULT_ROOT = vault;
process.env.GUITAR_STATE_DIR = join(tmp, "state");
process.env.GUITAR_MEDIA_ROOT = join(tmp, "media");

const { handle } = await import("./index.ts");
const { openDb } = await import("./db.ts");

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

const H = { "x-guitar-room": "1", "content-type": "application/json" };

test("GET /api/today places the first session of the block", async () => {
  const r = await fetch(`${base}/api/today`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-robots-tag"), "noindex, nofollow");
  const t = await r.json();
  assert.equal(t.block.id, "g-vocabulary-nine-pound-hammer-01");
  assert.equal(t.position.type, "decode");
  assert.equal(t.position.week, 1);
  assert.deepEqual(t.stages.full.map((s: any) => s.minutes), [2, 5, 8, 10, 15, 5]);
  assert.deepEqual(t.stages.floor.map((s: any) => s.minutes), [2, 4, 6, 3]);
  assert.equal(t.stages.full[0].output, "One sentence: material, measure or pattern, tempo, and quality criterion");
  assert.equal(t.stages.full[2].weekField, "vocabulary");
  assert.equal(t.next.source, "ledger");
  assert.equal(t.overDue, false);
});

test("the week override persists across a new database handle", async () => {
  const r = await fetch(`${base}/api/week-override`, { method: "PUT", headers: H, body: JSON.stringify({ week: 3 }) });
  assert.equal(r.status, 200);
  assert.equal((await (await fetch(`${base}/api/today`)).json()).position.week, 3);
  const db = openDb(join(tmp, "state"));
  assert.equal((db.prepare("SELECT value FROM settings WHERE key = 'weekOverride'").get() as any).value, "3");
  db.close();
  assert.equal((await fetch(`${base}/api/week-override`, { method: "PUT", headers: H, body: JSON.stringify({ week: 9 }) })).status, 400);
  await fetch(`${base}/api/week-override`, { method: "PUT", headers: H, body: JSON.stringify({ week: null }) });
  assert.equal((await (await fetch(`${base}/api/today`)).json()).position.week, 1);
});

test("tempos round-trip", async () => {
  await fetch(`${base}/api/tempos`, { method: "PUT", headers: H, body: JSON.stringify({ fragment: "pattern 1", bpm: 72, subdivision: "eighth" }) });
  const t = await (await fetch(`${base}/api/tempos`)).json();
  assert.equal(t.find((x: any) => x.fragment === "pattern 1").bpm, 72);
});

test("vault-file serves thread PDFs and refuses others", async () => {
  const ok = await fetch(`${base}/api/vault-file?path=${encodeURIComponent("001 Projects/Threads/Guitar/Practice/Materials/Aaron Jaxon - Blues Scales for Bluegrass Guitar.pdf")}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "application/pdf");
  assert.equal((await fetch(`${base}/api/vault-file?path=${encodeURIComponent("001 Projects/Threads/Guitar/../../../etc/passwd")}`)).status, 404);
  assert.equal((await fetch(`${base}/api/vault-file?path=${encodeURIComponent("AGENTS.md")}`)).status, 404);
});

test("POST /api/sessions writes a new log", async () => {
  const review = {
    blockTitle: "Block 01", blockId: "g-vocabulary-nine-pound-hammer-01", type: "decode", length: "floor",
    material: "pattern 1", target: "even", startTempo: "60", cleanTempo: "72", subdivision: "eighth notes",
    threePass: "met", recall: "memory", pain: false, improvement: "a", failure: "b", next: "Start at 72.",
  };
  const r = await fetch(`${base}/api/sessions`, { method: "POST", headers: H, body: JSON.stringify(review) });
  assert.equal(r.status, 200);
  assert.match((await r.json()).file, /^Practice Log - \d{4}-\d{2}-\d{2}\.md$/);
  const t = await (await fetch(`${base}/api/today`)).json();
  assert.equal(t.counts.floor, 1);
  assert.equal(t.position.number, 2);
  assert.equal(t.next.source, "log");
  assert.equal((await fetch(`${base}/api/sessions`, { method: "POST", headers: H, body: JSON.stringify({ ...review, type: "nope" }) })).status, 400);
});

test("a missing block note gives a readable error, not a crash", async () => {
  const blocks = join(vault, "001 Projects/Threads/Guitar/Practice/Blocks");
  await rename(join(blocks, "G Vocabulary and Nine Pound Hammer - Block 01.md"), join(blocks, "moved.md"));
  try {
    const r = await fetch(`${base}/api/today`);
    assert.equal(r.status, 200);
    const t = await r.json();
    assert.equal(t.block, null);
    assert.match(t.error, /not found/i);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  } finally {
    await rename(join(blocks, "moved.md"), join(blocks, "G Vocabulary and Nine Pound Hammer - Block 01.md"));
  }
});
