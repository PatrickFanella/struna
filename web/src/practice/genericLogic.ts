/** The studio mode's practice screens, minus the React: defaults, wording and small decisions, kept here so they can be tested. */

import type { SessionState } from "./Session.tsx";
import type { Stage } from "../types.ts";
import type { GenericStats, Level, LogSummary, Profile, ProfileInput, SessionKind } from "../generic.ts";

export const LEVELS: { id: Level; title: string; text: string }[] = [
  { id: "new", title: "Never played", text: "Start from holding the guitar and the first notes." },
  { id: "beginner", title: "Beginner", text: "A few chords or riffs." },
  { id: "intermediate", title: "Intermediate", text: "Songs, barre chords, some lead." },
  { id: "advanced", title: "Advanced", text: "Comfortable across the neck; working on specifics." },
];
/** Six-string guitars: the starter plans and the tuner are written for them. A saved "bass" still loads, as "Other". */
export const INSTRUMENTS: [string, string][] = [["acoustic", "Acoustic"], ["electric", "Electric"], ["classical", "Classical"]];
export const STYLES = ["Rock", "Pop", "Blues", "Folk", "Country", "Metal", "Jazz", "Classical", "Fingerstyle", "Punk", "Funk", "Soul"];
export const MINUTES = [5, 10, 15, 20, 30, 45, 60];
export const READS: [string, string][] = [["tab", "Tab"], ["chords", "Chord charts"], ["notation", "Standard notation"]];

/** What "Skip for now" saves, and what the form starts from. Nothing is assumed readable: an empty `reads` means not known yet. */
export function defaultProfile(): ProfileInput {
  return { name: "", level: "beginner", instrument: "acoustic", styles: [], goals: "", wants: "", minutesPerSession: 20, daysPerWeek: 4, reads: [], hand: "right", limits: "", notes: "" };
}

/** The setup form's fields. Styles and instrument split into the offered choices and free text. */
export type SetupForm = Omit<ProfileInput, "styles" | "instrument"> & { instrument: string; instrumentOther: string; styles: string[]; stylesOther: string };

const list = (s: string) => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function toForm(p: Profile | ProfileInput | null): SetupForm {
  const d = defaultProfile();
  const src = { ...d, ...(p ?? {}) };
  const known = INSTRUMENTS.find(([id]) => same(id, src.instrument.trim()));
  const offered = STYLES.filter((s) => src.styles.some((x) => same(x, s)));
  const other = src.styles.filter((x) => !STYLES.some((s) => same(x, s)));
  return {
    name: src.name,
    level: LEVELS.some((l) => l.id === src.level) ? src.level : d.level,
    instrument: known ? known[0] : src.instrument.trim() ? "other" : d.instrument,
    instrumentOther: known ? "" : src.instrument.trim(),
    styles: offered,
    stylesOther: other.join(", "),
    goals: src.goals,
    wants: src.wants,
    minutesPerSession: nearest(MINUTES, src.minutesPerSession),
    daysPerWeek: Math.min(7, Math.max(1, Math.round(src.daysPerWeek) || d.daysPerWeek)),
    reads: READS.map(([id]) => id).filter((id) => src.reads.includes(id)),
    hand: src.hand === "left" ? "left" : "right",
    limits: src.limits,
    notes: src.notes,
  };
}

function nearest(options: number[], n: number): number {
  return options.reduce((best, o) => (Math.abs(o - n) < Math.abs(best - n) ? o : best), options[0]!);
}

/** The body for `PUT /api/profile`. */
export function fromForm(f: SetupForm): ProfileInput {
  const styles = [...f.styles];
  for (const s of list(f.stylesOther)) if (!styles.some((x) => same(x, s))) styles.push(s);
  return {
    name: f.name.trim(),
    level: f.level,
    instrument: f.instrument === "other" ? f.instrumentOther.trim() || "guitar" : f.instrument,
    styles,
    goals: f.goals.trim(),
    wants: f.wants.trim(),
    minutesPerSession: f.minutesPerSession,
    daysPerWeek: f.daysPerWeek,
    reads: f.reads,
    hand: f.hand,
    limits: f.limits.trim(),
    notes: f.notes.trim(),
  };
}

/** Whether saving changed anything the coach plans around. */
export function sameProfile(a: ProfileInput, b: ProfileInput): boolean {
  return JSON.stringify(fromForm(toForm(a))) === JSON.stringify(fromForm(toForm(b)));
}

/** "Short (10 min)"; a label that already states its minutes is left alone. */
export function kindLabel(k: Pick<SessionKind, "label" | "minutes">): string {
  return /\bmin(ute)?s?\b/i.test(k.label) || !k.minutes ? k.label : `${k.label} (${k.minutes} min)`;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The start screen's stats, as short facts; empty before the first session. */
export function statsFacts(s: GenericStats | undefined): string[] {
  if (!s || s.total === 0) return [];
  return [`${count(s.thisWeek, "session")} this week`, ...(s.streakDays > 1 ? [`${s.streakDays} days in a row`] : []), `${s.total} in all`, ...(s.minutes > 0 ? [timeSpent(s.minutes)] : [])];
}

function timeSpent(minutes: number): string {
  if (minutes < 90) return `${minutes} min played`;
  const h = minutes / 60;
  return `${h >= 10 ? Math.round(h) : Math.round(h * 10) / 10} hours played`;
}

export type Difficulty = "too easy" | "about right" | "too hard";

/**
 * A first draft of the next instruction. The player may change it, and the coach sets the plan's
 * own next instruction after reading the log; this only saves typing.
 */
export function nextDraft(o: { material: string; bpm: number | null; difficulty: Difficulty; pain: boolean; fallback: string }): string {
  if (o.pain) return "Rest until the pain or tension is gone. Then a short, easy session; stop if it comes back.";
  const material = o.material.trim();
  if (!material) return o.fallback;
  if (o.difficulty === "too easy") return o.bpm ? `Start with ${material} at ${o.bpm} BPM, then move on to the next step.` : `Play ${material} once, then move on to the next step.`;
  if (o.difficulty === "too hard") return o.bpm ? `Start with ${material} slower than ${o.bpm} BPM, a few bars at a time.` : `Start with ${material} slowly, a few bars at a time.`;
  return o.bpm ? `Start with ${material} at ${o.bpm} BPM.` : `Start with ${material}, from where you stopped.`;
}

/** A tempo field's number when the log will take it (20 to 400 BPM); anything else is left out. */
export function tempo(v: string): number | null {
  const n = Number(v);
  return v.trim() && Number.isFinite(n) && n >= 20 && n <= 400 ? Math.round(n) : null;
}

/** One line for the start screen's history: "Short, 12 min, Blues in A, about right". */
export function logFacts(l: LogSummary): string {
  const pain = l.pain === true || l.pain === "yes";
  return [l.session, typeof l.minutes === "number" && l.minutes > 0 ? `${l.minutes} min` : "", l.material, ...(l.measurements ?? []).filter((m) => m.bpm !== null).map((m) => `${m.materialLabel}: ${m.bpm} BPM`), pain ? "stopped for pain or tension" : l.difficulty]
    .map((x) => String(x ?? "").trim())
    .filter((x) => x && x !== "not recorded")
    .join(", ");
}

/** "Mon 3 Nov" from "2026-11-03", without a time zone shifting the day. */
export function shortDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** What the "back after a break" prompt is remembered under: one prompt per gap after this last session. */
export function breakKey(stats: GenericStats | undefined): string {
  return stats?.last ?? "none";
}

/** Whether to offer the "back after a break" prompt: a week or more away, and not offered for this gap yet. */
export function breakDue(daysSinceLast: number | null | undefined, stats: GenericStats | undefined, remembered: string | null): boolean {
  return typeof daysSinceLast === "number" && daysSinceLast >= 7 && remembered !== breakKey(stats);
}

/** Which coach action follows a profile save, if any. */
export function profileAction(o: { before: ProfileInput | null; after: ProfileInput; plan: "created" | "kept"; skipped: boolean; skippedBefore: boolean }): "onboarding" | "profile-changed" | null {
  // Skipping leaves the starter plan alone; the coach builds the real one once there is something to go on.
  if (o.skipped) return null;
  if (!o.before || o.skippedBefore || o.plan === "created") return "onboarding";
  return sameProfile(o.before, o.after) ? null : "profile-changed";
}

export const REVIEW_DRAFT_KEY = "struna.review-draft";

/**
 * The review form after a reload: the stored draft over the fresh one, but only when it belongs to
 * this session (same start time), so an older session's answers never leak into a new one.
 */
export function restoreReviewDraft<T extends object>(raw: string | null, startedAt: number | undefined, first: T): T {
  if (!raw || startedAt === undefined) return first;
  try {
    const d = JSON.parse(raw) as { startedAt?: unknown; form?: unknown };
    if (d.startedAt !== startedAt || !d.form || typeof d.form !== "object") return first;
    const out = { ...first };
    for (const k of Object.keys(first) as (keyof T)[]) {
      const v = (d.form as Record<string, unknown>)[k as string];
      if (typeof v === typeof first[k]) out[k] = v as T[keyof T];
    }
    return out;
  } catch {
    return first;
  }
}

export type ReviewMeasurement = { materialKey: string; materialLabel: string; bpm: string };
export type ReviewContext = { reflection: string; measurements: ReviewMeasurement[] };

/** Review edits, including a blank, override checkpoints for the selected material. */
export function reviewTempo(key: string | undefined, rows: ReviewMeasurement[], refs: { key: string; itemId?: string }[]): number | undefined {
  if (!key) return undefined;
  const identity = refs.find(m => m.itemId && `mat:${m.itemId}` === key)?.key ?? key.replace(/^plan:/, "");
  const value = rows.find(m => m.materialKey === identity)?.bpm.trim();
  const bpm = value ? Number(value) : NaN;
  return Number.isInteger(bpm) && bpm >= 20 && bpm <= 400 ? bpm : undefined;
}


/** Use only scoped materials and confirmed checkpoints, never the current click or the whole plan. */
export function reviewMeasurements(stages: Stage[], session: Pick<SessionState, "checkpoints" | "addedActivities" | "today">, saved?: unknown): ReviewMeasurement[] {
  const rows = new Map<string, ReviewMeasurement>();
  // Workspace keys wrap plan references; catalog panes can refer to the same file by itemId.
  const refs = [...(session.today?.materials ?? []), ...stages.flatMap((s) => s.material ? [s.material] : [])];
  const aliases = new Map(refs.flatMap((m): [string, string][] => m.itemId ? [[`mat:${m.itemId}`, m.key]] : []));
  const identity = (key: string) => aliases.get(key) ?? key.replace(/^plan:/, "");
  const add = (key: string, label: string, bpm = "") => {
    const materialKey = identity(key);
    rows.set(materialKey, { materialKey, materialLabel: label, bpm });
  };
  for (const stage of stages) if (stage.material && !rows.has(stage.material.key)) add(stage.material.key, stage.material.label);
  for (const a of session.addedActivities ?? []) if (!rows.has(identity(a.key))) add(a.key, a.title);
  for (const c of session.checkpoints ?? []) add(c.materialKey, c.materialLabel, String(c.bpm));
  // Reconcile by identity: edits (including an explicit blank) survive Back and reload,
  // while newly practiced materials still get their own checkpoint defaults.
  if (Array.isArray(saved)) for (const m of saved) {
    const row = m && typeof m.materialKey === "string" ? rows.get(identity(m.materialKey)) : undefined;
    if (row && typeof m.bpm === "string") row.bpm = m.bpm;
  }
  return [...rows.values()];
}
