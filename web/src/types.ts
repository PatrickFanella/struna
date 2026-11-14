export type Week = { n: number; title: string; vocabulary: string; mechanism: string; music: string; improvisation: string };
export type Material = { label: string; path: string; kind: "pdf" | "tg" | "other"; exists: boolean };
export type Block = { id: string; title: string; path: string; started: string; targetSessions: number; goal: string; weeks: Week[]; materials: Material[]; crossTraining: string[] };
export type SessionType = "decode" | "connect" | "vary" | "prove";
export type StageKey = "target" | "prepare" | "vocabulary" | "mechanism" | "music" | "review";
export type Stage = { key: StageKey; title: string; minutes: number; output: string; weekField?: "vocabulary" | "mechanism" | "music" };
export type Today = {
  block: Block | null;
  position: { week: number; sessionInWeek: number; type: SessionType; number: number };
  weekOverride: number | null;
  counts: { full: number; floor: number };
  next: { text: string; source: "log" | "ledger" };
  stages: { full: Stage[]; floor: Stage[] };
  overDue: boolean;
  error?: string;
};

/** "G Vocabulary and Nine Pound Hammer - Block 01.md" → "1: G Vocabulary and Nine Pound Hammer". */
export function blockName(b: Block): string {
  const file = b.path.split("/").pop()!.replace(/\.md$/, "");
  const m = /^(.*?)\s*-\s*Block\s+0*(\d+)$/i.exec(file);
  return m ? `${m[2]}: ${m[1]}` : b.title;
}

/** "G Vocabulary and Nine Pound Hammer — Block 01", as the vault's own links name it. */
export function blockLogName(b: Block): string {
  const file = b.path.split("/").pop()!.replace(/\.md$/, "");
  const m = /^(.*?)\s*-\s*(Block\s+\d+)$/i.exec(file);
  return m ? `${m[1]} — ${m[2]}` : b.title;
}

export function todayLine(t: Today): string {
  const p = t.position;
  return `Week ${p.week}, session ${p.sessionInWeek}: ${p.type}${p.number === 1 ? " (baseline)" : ""}`;
}

/** The first sentence of a block paragraph, for log lines. */
export function firstSentence(s: string): string {
  const m = /^(.+?[.;])(\s|$)/.exec(s);
  return (m ? m[1]! : s).trim();
}
