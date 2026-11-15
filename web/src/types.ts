import type { GenericStats, MaterialRef, Profile, SessionKind } from "./generic.ts";

export type Week = { n: number; title: string; vocabulary: string; mechanism: string; music: string; improvisation: string };
export type Material = { label: string; path: string; kind: "pdf" | "tg" | "other"; exists: boolean };
export type Block = { id: string; title: string; path: string; started: string; targetSessions: number; goal: string; weeks: Week[]; materials: Material[]; crossTraining: string[] };
export type SessionType = "decode" | "connect" | "vary" | "prove";
export type StageKey = "target" | "prepare" | "vocabulary" | "mechanism" | "music" | "review";
/** `key` is a `StageKey` in personal mode and whatever the plan names it in studio mode. */
export type Stage = { key: string; title: string; minutes: number; output: string; weekField?: "vocabulary" | "mechanism" | "music"; /** Studio mode: the whole instruction, ready to show. */ instruction?: string; material?: MaterialRef; targetBpm?: number };
/** What `/api/today` returns. The optional fields are the studio mode's extras. */
export type Today = {
  block: Block | null;
  /** `type` is a `SessionType` in personal mode and the phase title in studio mode. */
  position: { week: number; sessionInWeek: number; type: string; number: number };
  weekOverride: number | null;
  counts: { full: number; floor: number };
  next: { text: string; source: "log" | "ledger" | "plan" };
  stages: { full: Stage[]; floor: Stage[] };
  overDue: boolean;
  error?: string;
  sessions?: SessionKind[];
  /** "Phase 2 of 4: Clean chord changes, session 3 of 6". */
  line?: string;
  phase?: { n: number; of: number; title: string; summary: string } | null;
  materials?: MaterialRef[];
  stats?: GenericStats;
  profile?: Profile | null;
  daysSinceLast?: number | null;
};

/**
 * The session kinds on offer today: the plan's own in studio mode, and the two fixed ones in
 * personal mode, whose ids stay `full` and `floor`.
 */
export function sessionKinds(today: Today): SessionKind[] {
  if (today.sessions) return today.sessions;
  const minutes = (stages: Stage[]) => stages.reduce((n, s) => n + s.minutes, 0);
  return [
    { id: "full", label: "Full session (45 min)", minutes: minutes(today.stages.full), stages: today.stages.full },
    { id: "floor", label: "Short session (15 min)", minutes: minutes(today.stages.floor), stages: today.stages.floor },
  ];
}

/** The kind with this id, or the first one when a plan change removed it. */
export function sessionKind(today: Today, id: string): SessionKind {
  const kinds = sessionKinds(today);
  return kinds.find((k) => k.id === id) ?? kinds[0] ?? { id, label: "Session", minutes: 0, stages: [] };
}

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
