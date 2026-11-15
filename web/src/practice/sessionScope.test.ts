import assert from "node:assert/strict";
import { test } from "node:test";
import { durationSummary, sessionChecklist } from "./sessionScope.ts";

const stages = [
  { key: "tune", title: "Tuning", minutes: 2, output: "Tune" },
  { key: "technique", title: "Technique", minutes: 6, output: "Roll" },
  { key: "log", title: "Logging", minutes: 2, output: "Log" },
];
test("2/6/2 Quick summary and checklist name only selected work", () => {
  assert.equal(durationSummary(stages), "Tuning · 2 min; Technique · 6 min; Logging · 2 min");
  assert.deepEqual(sessionChecklist(stages).map((r) => r.key), ["tune", "technique", "log"]);
  assert.deepEqual(sessionChecklist(stages, [{ key: "extra:rag", title: "Black Mountain Rag" }, { key: "technique", title: "duplicate" }]).map((r) => r.title), ["Tuning", "Technique", "Logging", "Black Mountain Rag"]);
});
