import assert from "node:assert/strict";
import { test } from "node:test";
import type { MaterialItem } from "../generic.ts";
import { addedMaterials, findOutcome, type FindTurn } from "./find.ts";
const old = { id: "l.old", title: "Existing lesson", url: "https://example.org/old" } as MaterialItem;
const fresh = { id: "l.new", title: "Publisher — Rag", shortTitle: "Rag", url: "https://example.org/new" } as MaterialItem;
const base: FindTurn = { ok: true, complete: true, additions: [], problem: "" };
test("actual additions exclude existing URLs, kept copies, and duplicate links", () => {
  assert.deepEqual(addedMaterials({ items: [old] }, { items: [{ ...old, id: "f.copy" }, fresh, fresh] }), [{ id: fresh.id, title: fresh.title, shortTitle: "Rag", url: fresh.url }]);
  assert.throws(() => addedMaterials({ items: [], total: 1 }, { items: [fresh] }), /complete Materials list/);
  assert.throws(() => addedMaterials({ items: [] }, { items: [], linksError: "invalid JSON" }), /complete Materials list/);
});
test("completion and persisted changes determine outcome, never the reply's claims", () => {
  assert.equal(findOutcome(base).state, "empty");
  assert.equal(findOutcome({ ...base, additions: [fresh] }).state, "added");
  assert.equal(findOutcome({ ...base, additions: null }).state, "unknown");
  assert.equal(findOutcome({ ...base, ok: false, complete: false }).state, "unknown");
  assert.equal(findOutcome({ ...base, ok: false, problem: "provider failed" }).state, "error");
  assert.equal(findOutcome({ ...base, ok: false, unavailable: true, problem: "web disabled" }).state, "unavailable");
  assert.match(findOutcome({ ...base, ok: false, additions: [fresh] }).message, /added before it stopped/);
});
