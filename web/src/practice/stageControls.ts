import type { Stage } from "../types.ts";

/** Recognize supported stage intent; unfamiliar and personal stages keep general tools. */
export function stageControls(stage: Stage, studio: boolean): "tune" | "play" | "record" | "notes" | "general" {
  if (!studio) return "general";
  if (/^(tune|tuning|tuner)$/.test(stage.key) || /^tune up$/i.test(stage.title)) return "tune";
  if (/^(record|recording)$/.test(stage.key) || /^(record|recording)\b/i.test(stage.title)) return "record";
  if (/^(log|logging)$/.test(stage.key) || /^(log|write down|note)\b/i.test(stage.title)) return "notes";
  if (stage.targetBpm !== undefined || /^(technique|warmup|chords|rhythm|song|repertoire|improv|music|vocabulary|mechanism|new)$/.test(stage.key)) return "play";
  return "general";
}
