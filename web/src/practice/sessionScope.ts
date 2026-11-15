import type { Stage } from "../types.ts";

export type Activity = { key: string; title: string };
export const durationSummary = (stages: Stage[]) => stages.map((s) => `${s.title} · ${s.minutes} min`).join("; ");

/** Only this session's stages and explicitly added activities belong in its checklist. */
export function sessionChecklist(stages: Stage[], added: Activity[] = []): Activity[] {
  const rows = stages.map(({ key, title }) => ({ key, title }));
  for (const row of added) if (!rows.some((r) => r.key === row.key)) rows.push(row);
  return rows;
}
