import type { PaneContent } from "../workspace/Workspace.tsx";
import { tempoHelper, type HelperState, type Suggestion } from "../audio/tempo.ts";

export type Checkpoint = { materialKey: string; materialLabel: string; stageKey: string; sessionKind: string; bpm: number; confirmedAt: string; context: "clean-pass"; pass: number };
export type PassState = { helper: HelperState; passes: number; suggestion: Suggestion | null };
export const emptyPasses = (): PassState => ({ helper: { cleans: 0, misses: 0 }, passes: 0, suggestion: null });
export function recordPass(previous: PassState, event: "clean" | "miss"): PassState {
  const r = tempoHelper(previous.helper, event);
  return { helper: r.state, passes: event === "miss" ? 0 : previous.passes >= 3 ? 1 : previous.passes + 1, suggestion: r.suggestion };
}

type MeasurementMaterial = { key: string; label: string; missing?: boolean };
export function measurementChoices(stage: MeasurementMaterial | undefined, panes: PaneContent[], materials: MeasurementMaterial[]): MeasurementMaterial[] {
  const open = panes.flatMap((p): MeasurementMaterial[] => p.type === "file" ? [p.item] : p.type === "tab" ? [{ key: `tab:${p.tabId}`, label: p.title }] : []);
  return [...new Map([...(stage ? [stage] : []), ...open, ...materials].filter((m) => !m.missing).map((m) => [m.key, m])).values()];
}
export const selectedMeasurement = (choices: MeasurementMaterial[], saved?: MeasurementMaterial) => choices.find((m) => m.key === saved?.key) ?? choices[0];
