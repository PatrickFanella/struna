import assert from "node:assert/strict";
import { test } from "node:test";
import { activeElapsed, hasIncompleteTiming, moveStage, pauseTimer, playedMinutes, stopTimer, startStageBreak, finishStageBreak, STAGE_BREAK_MS, type SessionTimer } from "./sessionTimer.ts";

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
  const recovered = stopTimer(pauseTimer(stopTimer(moved, 19_000), 90_000), 100_000);
  assert.equal(hasIncompleteTiming(recovered), true);
  assert.equal(hasIncompleteTiming(JSON.parse(JSON.stringify(recovered))), true);
  assert.equal(hasIncompleteTiming(waiting), false);
  assert.equal(playedMinutes(waiting, 90_000), 0);
});


test("inter-stage rest excludes break time and resumes a running timer only when the break finishes", () => {
  const playing: SessionTimer = { ...waiting, resumedAt: 1000 };
  const rest = startStageBreak(playing, 1, 61_000);
  assert.equal(rest.stage, 0);
  assert.equal(rest.resumedAt, null);
  assert.deepEqual(rest.stageBreak, { until: 61_000 + STAGE_BREAK_MS, nextStage: 1, running: true });
  assert.equal(activeElapsed(rest, 81_000), 60_000);
  assert.equal(startStageBreak(rest, 2, 65_000), rest, "repeated Next cannot move the break or skip a stage");
  const done = finishStageBreak(rest, 81_000);
  assert.equal(done.stage, 1);
  assert.equal(done.elapsedBefore, 0);
  assert.equal(done.resumedAt, 81_000);
  assert.equal(done.stageBreak, undefined);
  assert.equal(activeElapsed(done, 91_000), 70_000);
  assert.equal(finishStageBreak(done, 99_000), done, "completion is idempotent");
});

test("skipping, paused sessions, and restored/expired breaks retain the right timing", () => {
  const paused: SessionTimer = { ...waiting, elapsedBefore: 30_000, activeBefore: 90_000 };
  const skipped = finishStageBreak(startStageBreak(paused, 1, 100_000), 102_000);
  assert.equal(skipped.resumedAt, null);
  assert.equal(skipped.stage, 1);
  assert.equal(activeElapsed(skipped, 999_000), 90_000);
  const rest = startStageBreak({ ...paused, resumedAt: 100_000 }, 1, 110_000);
  const recovered = finishStageBreak(JSON.parse(JSON.stringify(rest)) as SessionTimer, 300_000);
  assert.equal(recovered.resumedAt, 300_000);
  assert.equal(activeElapsed(recovered, 300_000), 100_000, "time spent away after the deadline is not practice");
  assert.equal(recovered.furthest, 1);
  assert.equal(finishStageBreak(paused, 999_000), paused, "old sessions need no break metadata");
});
