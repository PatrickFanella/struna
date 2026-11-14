import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { readActiveBlock, readLedger, VaultError } from "./vault.ts";

const fixture = join(import.meta.dirname, "fixtures/vault");

test("reads the active block from the pointer note", async () => {
  const block = await readActiveBlock(fixture);
  assert.equal(block.id, "g-vocabulary-nine-pound-hammer-01");
  assert.equal(block.started, "2026-08-06");
  assert.equal(block.targetSessions, 28);
  assert.equal(block.weeks.length, 4);
  assert.ok(block.weeks[0]!.vocabulary.startsWith("G major-blues pattern 1 and G minor-blues pattern 1"), block.weeks[0]!.vocabulary);
  assert.ok(block.weeks[0]!.improvisation.startsWith("over G–C–G–D"), block.weeks[0]!.improvisation);
  assert.match(block.weeks[0]!.mechanism, /^alternate-picked one-octave fragments/);
  assert.match(block.weeks[0]!.music, /^Nine Pound Hammer bars 1–8/);
  assert.equal(block.weeks[1]!.n, 2);
  assert.match(block.goal, /^Convert G major-blues/);
  assert.equal(block.crossTraining.length, 2);
});

test("resolves anchor material and marks missing files", async () => {
  const block = await readActiveBlock(fixture);
  const aaron = block.materials.find((m) => m.label.startsWith("Aaron Jaxon"));
  assert.ok(aaron);
  assert.equal(aaron.kind, "pdf");
  assert.equal(aaron.exists, true);
  assert.equal(aaron.path, "001 Projects/Threads/Guitar/Practice/Materials/Aaron Jaxon - Blues Scales for Bluegrass Guitar.pdf");
  const tg = block.materials.find((m) => m.path.endsWith("G Major Pentatonic - 3 note patterns.tg"));
  assert.ok(tg);
  assert.equal(tg.kind, "tg");
  assert.equal(tg.exists, false);
});

test("reads the ledger's current state", async () => {
  const ledger = await readLedger(fixture);
  assert.ok(ledger.nextEvidence.startsWith("establish a clean working tempo"), ledger.nextEvidence);
  assert.equal(ledger.lastReview, "2026-08-06");
});

test("a missing block note rejects with VaultError", async () => {
  const dir = await mkdtemp(join(tmpdir(), "guitar-vault-"));
  try {
    await cp(fixture, dir, { recursive: true });
    const pointer = join(dir, "001 Projects/Threads/Guitar/Practice/Current Practice Block.md");
    const text = await readFile(pointer, "utf8");
    await writeFile(pointer, text.replace(/active-block: .*/, "active-block: 001 Projects/Threads/Guitar/Practice/Blocks/Nope.md"));
    await assert.rejects(readActiveBlock(dir), VaultError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
