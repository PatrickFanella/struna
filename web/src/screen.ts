/** What the owner is looking at, for the coach chat's context block. */
export type ScreenContext = { view: string; stage?: string; fragment?: string; bpm?: number; subdivision?: string };

let current: ScreenContext = { view: "practice" };
export const screenContext = {
  get: (): ScreenContext => current,
  set: (c: ScreenContext) => {
    current = c;
  },
};
