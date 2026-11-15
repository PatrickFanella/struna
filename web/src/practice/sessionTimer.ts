export const STAGE_BREAK_MS = 20_000;
export type StageBreak = { until: number; nextStage: number; running: boolean };
export type SessionTimer = { stageBreak?: StageBreak; stage: number; elapsedBefore: number; resumedAt: number | null; activeBefore?: number; furthest?: number; timingIncomplete?: true };
const sinceResume = (s: SessionTimer, now: number) => s.resumedAt === null ? 0 : Math.max(0, now - s.resumedAt);

/** Legacy sessions can recover current-stage time, but never infer earlier active time from wall age. */
export const hasIncompleteTiming = (s: SessionTimer) => s.timingIncomplete === true || (s.activeBefore === undefined && s.stage > 0);
export const activeElapsed = (s: SessionTimer, now: number) => (s.activeBefore ?? s.elapsedBefore) + sinceResume(s, now);
export const playedMinutes = (s: SessionTimer, now: number) => Math.min(600, Math.max(0, Math.round(activeElapsed(s, now) / 60_000)));

export function pauseTimer<T extends SessionTimer>(s: T, now: number): T {
  const disclosure = hasIncompleteTiming(s) ? { timingIncomplete: true as const } : {};
  if (s.resumedAt === null) return { ...s, ...disclosure, resumedAt: now };
  return { ...s, ...disclosure, elapsedBefore: s.elapsedBefore + sinceResume(s, now), activeBefore: activeElapsed(s, now), resumedAt: null };
}

/** Manual Next/Back restart that stage's clock and retain running/paused state. */
export function moveStage<T extends SessionTimer>(s: T, at: number, now: number): T {
  return { ...s, ...(hasIncompleteTiming(s) ? { timingIncomplete: true as const } : {}), stage: at, furthest: Math.max(s.furthest ?? s.stage, at), activeBefore: activeElapsed(s, now), elapsedBefore: 0, resumedAt: s.resumedAt === null ? null : now };
}

export function stopTimer<T extends SessionTimer>(s: T, now: number): T {
  return s.resumedAt === null ? s : pauseTimer(s, now);
}

/** Freeze practice time while resting; retain the next stage and prior timer state across reloads. */
export function startStageBreak<T extends SessionTimer>(s: T, nextStage: number, now: number): T {
  if (s.stageBreak) return s;
  return { ...stopTimer(s, now), stageBreak: { until: now + STAGE_BREAK_MS, nextStage, running: s.resumedAt !== null } };
}

/** Resume from now, never from the deadline: time away/reloading cannot become played time. */
export function finishStageBreak<T extends SessionTimer>(s: T, now: number): T {
  if (!s.stageBreak) return s;
  const next = { ...moveStage(s, s.stageBreak.nextStage, now), resumedAt: s.stageBreak.running ? now : null };
  delete next.stageBreak;
  return next;
}
