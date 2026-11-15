import assert from "node:assert/strict";
import { test } from "node:test";
import { materialHash, materialListState, materialRoute } from "./route.ts";

test("item hashes round trip IDs and leave other sections alone", () => {
  for (const id of ["l.0123456789abcdef", "f.Tm90ZXMubWQ", "d0.UmlmZi5wZGY"]) assert.deepEqual(materialRoute(materialHash(id)), { type: "item", id });
  assert.deepEqual(materialRoute("#materials/item/f%2ETm90ZXMubWQ"), { type: "item", id: "f.Tm90ZXMubWQ" });
  for (const hash of ["#practice", "#tabs/x", "#materials", "#/materials"]) assert.deepEqual(materialRoute(hash), { type: "list" });
  for (const hash of ["#materials/item/%", "#materials/item/%FF", "#materials/item/", "#materials/unknown/x", "#materials/item/f.x/extra", "#materials/item/../../etc/passwd"]) assert.deepEqual(materialRoute(hash), { type: "missing" });
});
test("list history accepts only valid context and never needs a token or absolute path", () => {
  assert.deepEqual(materialListState({ materialList: { q: "rag", kind: "link", filters: true, scroll: 450 } }), { q: "rag", kind: "link", filters: true, scroll: 450 });
  assert.deepEqual(materialListState({ materialList: { q: 3, kind: "oops", scroll: Infinity } }), { q: "", kind: null, filters: false, scroll: 0 });
  assert.deepEqual(materialListState(null), { q: "", kind: null, filters: false, scroll: 0 });
});
