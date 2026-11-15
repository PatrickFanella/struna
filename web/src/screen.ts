import type { CoachSelection } from "../../shared/coach-context.ts";
/** What the owner is looking at, for the coach chat's context block. */
export type ScreenContext = { view: string; stage?: string; fragment?: string; bpm?: number; subdivision?: string; coach?: CoachSelection };

const listeners = new Set<() => void>();
let current: ScreenContext = { view: "practice" };
export const screenContext = {
  subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  get: (): ScreenContext => current,
  set: (c: ScreenContext) => {
    current = c;
    for (const fn of listeners) fn();
  },
};
