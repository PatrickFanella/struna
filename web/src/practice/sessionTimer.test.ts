import assert from "node:assert/strict";
import { test } from "node:test";
import { activeElapsed, moveStage, pauseTimer, playedMinutes, stopTimer } from "./sessionTimer.ts";

const waiting = { stage: 0, elapsedBefore: 0, resumedAt: null, activeBefore: 0 };
test("Next and Back preserve waiting/paused/running state while accounting once", () => {
  assert.equal(moveStage(waiting, 1, 100).resumedAt, null);
  let s = pauseTimer(waiting, 1000);
  s = moveStage(s, 1, 61_000);
  assert.equal(s.resumedAt, 61_000);
  assert.equal(s.elapsedBefore, 0);
  assert.equal(activeElapsed(s, 91_000), 90_000);
  s = pauseTimer(s, 91_000);
  s = moveStage(s, 0, 200_000);
  assert.equal(s.resumedAt, null);
  assert.equal(activeElapsed(s, 500_000), 90_000);
  s = pauseTimer(s, 500_000);
  s = stopTimer(s, 530_000);
  assert.equal(activeElapsed(s, 999_000), 120_000);
  assert.deepEqual(stopTimer(s, 999_000), s);
  assert.equal(playedMinutes(s, 999_000), 2);
});
test("reload retains totals and legacy sessions recover only known current-stage time", () => {
  const s = { stage: 3, elapsedBefore: 12_000, resumedAt: 1000 };
  assert.equal(activeElapsed(s, 9000), 20_000);
  const moved = moveStage(s, 4, 9000);
  assert.equal(activeElapsed(JSON.parse(JSON.stringify(moved)), 19_000), 30_000);
  assert.equal(playedMinutes(waiting, 90_000), 0);
});
