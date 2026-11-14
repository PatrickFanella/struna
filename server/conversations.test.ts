import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildContext } from "./chat.ts";
import { conversations } from "./conversations.ts";
import { openDb } from "./db.ts";
import { STAGES } from "./practice.ts";
import { readActiveBlock } from "./vault.ts";

test("conversations round-trip", async () => {
  const dir = await mkdtemp(join(tmpdir(), "guitar-conv-"));
  try {
    const db = openDb(dir);
    const store = conversations(db);
    const c = store.create("claude", "What is my next instruction?");
    assert.equal(c.provider, "claude");
    assert.equal(c.title, "What is my next instruction?");
    store.append(c.id, "user", "What is my next instruction?");
    store.append(c.id, "assistant", "Establish a baseline.");
    store.setThread(c.id, "sess-1");
    let got = store.get(c.id)!;
    assert.equal(got.thread_id, "sess-1");
    assert.deepEqual(got.messages.map((m) => m.role), ["user", "assistant"]);
    store.rename(c.id, "Baseline");
    assert.equal(store.list()[0]!.title, "Baseline");
    store.remove(c.id);
    assert.equal(store.get(c.id), undefined);
    assert.equal(store.list().length, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n, 0);
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildContext names the block, session, stage, tempo and next instruction", async () => {
  const block = await readActiveBlock(join(import.meta.dirname, "fixtures/vault"));
  const today = {
    block,
    position: { week: 1, sessionInWeek: 1, type: "decode" as const, number: 1 },
    next: { text: "establish a clean working tempo", source: "ledger" as const },
    counts: { full: 0, floor: 0 },
    stages: STAGES,
  };
  const ctx = buildContext({ view: "practice session", stage: "Build vocabulary", fragment: "pattern 1", bpm: 72, subdivision: "eighth notes" }, today);
  for (const s of [block.title, "Week 1, session 1: decode", "Build vocabulary", "pattern 1", "72 BPM, eighth notes", "establish a clean working tempo"]) {
    assert.ok(ctx.includes(s), s);
  }
});
