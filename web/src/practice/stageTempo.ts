import { MAX_BPM, MIN_BPM } from "../audio/tempo.ts";
import type { MaterialRef } from "../generic.ts";
import type { Stage } from "../types.ts";

export type TempoRecord = { fragment: string; bpm: number };
export type StageTempo = { bpm: number; source: string; override?: number };
export const validBpm = (n: number) => Number.isInteger(n) && n >= MIN_BPM && n <= MAX_BPM;

/** Old label records are used only for an unambiguous material label. */
export function resolveStageTempo(stage: Stage, records: TempoRecord[], materials: MaterialRef[]): StageTempo {
  if (stage.targetBpm !== undefined && validBpm(stage.targetBpm)) return { bpm: stage.targetBpm, source: "Plan target" };
  const material = stage.material;
  const saved = material && records.find((r) => r.fragment === `material:${material.key}`);
  const legacy = material && !saved && new Set(materials.filter((m) => m.label === material.label).map((m) => m.key)).size === 1
    ? records.find((r) => r.fragment === material.label) : undefined;
  const record = saved ?? legacy;
  if (record && validBpm(record.bpm)) return { bpm: record.bpm, source: legacy ? "Last confirmed clean tempo (legacy label)" : "Last confirmed clean tempo" };
  return { bpm: 72, source: record ? "Fallback: saved tempo is outside 30–300 BPM" : "Fallback: no stage target or confirmed clean tempo" };
}
