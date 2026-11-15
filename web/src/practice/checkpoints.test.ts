import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyPasses, recordPass, measurementChoices, selectedMeasurement } from "./checkpoints.ts";

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

test("open tabs have stable measurement identities and removed selections cannot hide behind another label", () => {
  const roll = { key: "plan:roll", label: "Roll" };
  const choices = measurementChoices(roll, [{ type: "tab", tabId: "tab-one", title: "A tune", artist: "Player" }], []);
  assert.deepEqual(choices, [roll, { key: "tab:tab-one", label: "A tune" }]);
  assert.equal(selectedMeasurement(choices, { key: "tab:tab-one", label: "Old title" })?.label, "A tune");
  const afterClose = measurementChoices(roll, [], []);
  assert.deepEqual(selectedMeasurement(afterClose, { key: "tab:tab-one", label: "A tune" }), roll);
  assert.equal(selectedMeasurement([], roll), undefined);
});
