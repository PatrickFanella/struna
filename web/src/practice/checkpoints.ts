import { tempoHelper, type HelperState, type Suggestion } from "../audio/tempo.ts";

export type Checkpoint = { materialKey: string; materialLabel: string; stageKey: string; sessionKind: string; bpm: number; confirmedAt: string; context: "clean-pass"; pass: number };
export type PassState = { helper: HelperState; passes: number; suggestion: Suggestion | null };
export const emptyPasses = (): PassState => ({ helper: { cleans: 0, misses: 0 }, passes: 0, suggestion: null });
export function recordPass(previous: PassState, event: "clean" | "miss"): PassState {
  const r = tempoHelper(previous.helper, event);
  return { helper: r.state, passes: event === "miss" ? 0 : previous.passes >= 3 ? 1 : previous.passes + 1, suggestion: r.suggestion };
}
