import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyPasses, recordPass } from "./checkpoints.ts";

test("material helper states remain separate and misses restart the run", () => {
  let roll = emptyPasses();
  for (let i = 0; i < 3; i++) roll = recordPass(roll, "clean");
  assert.equal(roll.suggestion?.kind, "raise");
  const tune = recordPass(emptyPasses(), "clean");
  assert.equal(tune.passes, 1);
  assert.equal(tune.suggestion, null);
  assert.equal(roll.passes, 3);
  assert.equal(recordPass(roll, "miss").passes, 0);
  assert.deepEqual(JSON.parse(JSON.stringify({ roll, tune })), { roll, tune });
});
