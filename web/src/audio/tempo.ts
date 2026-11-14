export const MIN_BPM = 30;
export const MAX_BPM = 300;
export const clampBpm = (n: number) => Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(n)));

/** Median of the last up to six intervals; a gap over two seconds starts over. Taps are in milliseconds. */
export function tapTempo(taps: number[]): number | null {
  let run: number[] = [];
  for (const t of taps) {
    if (run.length && t - run[run.length - 1]! > 2000) run = [];
    run.push(t);
  }
  if (run.length < 2) return null;
  const intervals = run.slice(1).map((t, i) => t - run[i]!).slice(-6).sort((a, b) => a - b);
  const mid = intervals.length / 2;
  const median = intervals.length % 2 ? intervals[Math.floor(mid)]! : (intervals[mid - 1]! + intervals[mid]!) / 2;
  if (median <= 0) return null;
  return clampBpm(60000 / median);
}

export type HelperState = { cleans: number; misses: number };
export type Suggestion = { kind: "raise" | "repeat" | "lower"; delta: number };

/**
 * The practice system's speed rule: three clean passes in a row, then raise;
 * after a miss, repeat once at the same tempo; after a second miss, lower or shorten the loop.
 */
export function tempoHelper(state: HelperState, event: "clean" | "miss", opts: { raise?: number; lower?: number } = {}): { state: HelperState; suggestion: Suggestion | null } {
  const raise = opts.raise ?? 3;
  const lower = opts.lower ?? 4;
  if (event === "clean") {
    const cleans = state.cleans + 1;
    if (cleans >= 3) return { state: { cleans: 0, misses: 0 }, suggestion: { kind: "raise", delta: raise } };
    return { state: { cleans, misses: 0 }, suggestion: null };
  }
  const misses = state.misses + 1;
  if (misses >= 2) return { state: { cleans: 0, misses: 0 }, suggestion: { kind: "lower", delta: -lower } };
  return { state: { cleans: 0, misses }, suggestion: { kind: "repeat", delta: 0 } };
}
