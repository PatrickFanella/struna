export type SessionTimer = { stage: number; elapsedBefore: number; resumedAt: number | null; activeBefore?: number; furthest?: number };
const sinceResume = (s: SessionTimer, now: number) => s.resumedAt === null ? 0 : Math.max(0, now - s.resumedAt);

/** Legacy sessions can recover current-stage time, but never infer earlier active time from wall age. */
export const activeElapsed = (s: SessionTimer, now: number) => (s.activeBefore ?? s.elapsedBefore) + sinceResume(s, now);
export const playedMinutes = (s: SessionTimer, now: number) => Math.min(600, Math.max(0, Math.round(activeElapsed(s, now) / 60_000)));

export function pauseTimer<T extends SessionTimer>(s: T, now: number): T {
  if (s.resumedAt === null) return { ...s, resumedAt: now };
  return { ...s, elapsedBefore: s.elapsedBefore + sinceResume(s, now), activeBefore: activeElapsed(s, now), resumedAt: null };
}

/** Manual Next/Back restart that stage's clock and retain running/paused state. */
export function moveStage<T extends SessionTimer>(s: T, at: number, now: number): T {
  return { ...s, stage: at, furthest: Math.max(s.furthest ?? s.stage, at), activeBefore: activeElapsed(s, now), elapsedBefore: 0, resumedAt: s.resumedAt === null ? null : now };
}

export function stopTimer<T extends SessionTimer>(s: T, now: number): T {
  return s.resumedAt === null ? s : pauseTimer(s, now);
}
