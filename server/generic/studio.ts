import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { getSetting, setSetting } from "../db.ts";
import { resolveInside } from "../files.ts";
import { localDate } from "../logs.ts";
import { kindOf } from "./fetch.ts";
import { type GenericLog, isCounted, readLogs } from "./logs.ts";
import { fileId, linkId, listMaterials, srcOf, youtubeId } from "./materials.ts";
import type { GenericStats, Level, MaterialKind, Plan, PlanMaterial, PlanPhase, PlanSession, PlanStage, Profile } from "./types.ts";

export type Studio = { home: string; db: DatabaseSync; timeZone: string; libraryDirs: string[]; web: boolean; appName: string };

export const PLAN_REL = "plan/plan.json";
const DIRS = ["plan", "plan/archive", "logs", "materials", "Recordings"];

export async function ensureStudio(home: string): Promise<void> {
  await mkdir(home, { recursive: true });
  for (const d of DIRS) await mkdir(join(home, d), { recursive: true });
}

/** Write through a temp file so a reader never sees half a file. */
export async function writeAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, text, { mode: 0o664 });
  await rename(tmp, path);
}

// ---------------------------------------------------------------- profile

export const LEVELS: readonly Level[] = ["new", "beginner", "intermediate", "advanced"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const clampInt = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && v !== null && v !== "" ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const list = (v: unknown, max: number, each: number): string[] => {
  const items = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return [...new Set(items.map((x) => text(x, each)).filter(Boolean))].slice(0, max);
};

/**
 * A complete profile from whatever the form or the coach wrote: unknown levels fall back
 * to "beginner", numbers are clamped, strings are capped. Valid time stamps in the input are kept.
 */
export function normalizeProfile(input: unknown, now: string): Profile {
  const o = isObj(input) ? input : {};
  const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : undefined);
  return {
    version: 1,
    name: text(o.name, 80),
    level: LEVELS.includes(o.level as Level) ? (o.level as Level) : "beginner",
    instrument: text(o.instrument, 80) || "acoustic",
    styles: list(o.styles, 20, 60),
    goals: text(o.goals, 2000),
    wants: text(o.wants, 2000),
    minutesPerSession: clampInt(o.minutesPerSession, 5, 180, 20),
    daysPerWeek: clampInt(o.daysPerWeek, 1, 7, 4),
    reads: list(o.reads, 10, 40),
    hand: o.hand === "left" ? "left" : "right",
    limits: text(o.limits, 2000),
    notes: text(o.notes, 4000),
    created: iso(o.created) ?? now,
    updated: iso(o.updated) ?? now,
  };
}

/** The profile, or null when there is none or the file is not a JSON object. The coach may have edited it, so it is normalised on the way in. */
export async function readProfile(s: Studio): Promise<Profile | null> {
  const raw = await readFile(join(s.home, "profile.json"), "utf8").catch(() => undefined);
  if (raw === undefined) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return isObj(v) ? normalizeProfile(v, new Date().toISOString()) : null;
  } catch {
    return null;
  }
}

export async function writeProfile(s: Studio, p: Profile): Promise<void> {
  await mkdir(s.home, { recursive: true });
  await writeAtomic(join(s.home, "profile.json"), `${JSON.stringify(p, null, 2)}\n`);
}

// ---------------------------------------------------------------- plan

/** The limits `validatePlan` enforces; `PLAN_SCHEMA` is written from the same numbers. */
export const PLAN_LIMITS = {
  id: /^[a-z0-9][a-z0-9-]{0,60}$/,
  key: /^[a-z][a-z0-9-]{0,30}$/,
  title: 200,
  goal: 2000,
  next: 4000,
  phases: 24,
  phaseSessions: 200,
  summary: 1000,
  focus: 2000,
  kinds: 8,
  label: 80,
  stages: 12,
  stageTitle: 120,
  stageMinutes: 120,
  task: 2000,
  minBpm: 30,
  maxBpm: 300,
  materials: 100,
  materialLabel: 200,
  note: 1000,
  file: 500,
  url: 2000,
  extras: 20,
  extra: 500,
} as const;

const L = PLAN_LIMITS;

/** The plan file described for the coach. Built from `PLAN_LIMITS` so it cannot drift from `validatePlan`. */
export const PLAN_SCHEMA = `{
  "version": 1,
  "id": "lower-case letters, digits and dashes, at most ${L.id.source.match(/\{0,(\d+)\}/)![1]} after the first character; keep it when you only adjust the plan",
  "title": "string, required, at most ${L.title} characters",
  "goal": "string, at most ${L.goal}",
  "started": "YYYY-MM-DD; only logs dated on or after it count toward the plan",
  "phases": [            // 1 to ${L.phases}, in order
    {
      "title": "string, required, at most ${L.title}",
      "sessions": 6,     // whole number 1 to ${L.phaseSessions}: counted sessions this phase lasts
      "summary": "one line on what the phase is for, at most ${L.summary}",
      "focus": { "<stage key>": "what to work on in that stage during this phase, at most ${L.focus}" }
    }
  ],
  "sessions": [          // the session kinds, 1 to ${L.kinds}; put the longest first and the shortest last
    {
      "id": "lower-case key such as full, short, quick (letter first, then letters, digits, dashes; at most 31; not \\"extra\\"); unique",
      "label": "string, required, at most ${L.label}",
      "stages": [        // 1 to ${L.stages}
        { "key": "lower-case key, unique within this kind", "title": "string, required, at most ${L.stageTitle}", "minutes": 5, "task": "what to do, one or two sentences, required, at most ${L.task}", "material": { "file": "materials/exercise.md" }, "targetBpm": 80 }
      ]                  // minutes: whole number 1 to ${L.stageMinutes}
    }
  ],
  "materials": [         // optional, at most ${L.materials}
    { "label": "string, required", "file": "materials/<name> (relative, inside materials/, no ..)", "url": "http(s) link", "note": "string, at most ${L.note}" }
  ],
  "next": "the instruction for the next session, at most ${L.next}",
  "extras": ["optional off-day activities, at most ${L.extras}, each at most ${L.extra}"]
}
Stage material and targetBpm are optional. material has exactly one file (same rules as materials[].file) or http(s) url; targetBpm is a whole number ${L.minBpm} to ${L.maxBpm}. Never derive tempo from prose.
Every key in a phase's "focus" must be a stage key used by at least one session kind.`;

function validDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function fileProblem(v: string): string | null {
  if (v.startsWith("/") || /^[a-zA-Z]:/.test(v) || v.includes("\\") || v.includes("\0")) return "must be a relative path with forward slashes";
  const parts = v.split("/");
  if (parts.some((p) => p === ".." || p === "." || p === "")) return 'must not contain "..", "." or empty path segments';
  if (parts[0] !== "materials" || parts.length < 2) return 'must be a file under "materials/"';
  return null;
}

function urlProblem(v: string): string | null {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? null : "must be an http or https URL";
  } catch {
    return "must be an http or https URL";
  }
}

/**
 * Check a parsed `plan/plan.json`. The coach reads the messages, so each names the JSON path
 * and the rule. Unknown keys are dropped; missing optional arrays and strings get defaults.
 */
export function validatePlan(v: unknown): { plan: Plan | null; errors: string[] } {
  if (!isObj(v)) return { plan: null, errors: ["the plan must be a JSON object"] };
  const errors: string[] = [];
  const err = (m: string) => {
    if (errors.length < 25) errors.push(m);
  };

  /** A string field: wrong type and over-length are errors; `required` also refuses empty. */
  const str = (o: Record<string, unknown>, key: string, path: string, max: number, required = false): string => {
    const x = o[key];
    if (x === undefined || x === null) {
      if (required) err(`${path} is required`);
      return "";
    }
    if (typeof x !== "string") {
      err(`${path} must be a string`);
      return "";
    }
    const t = x.trim();
    if (required && !t) err(`${path} must not be empty`);
    if (t.length > max) err(`${path} must be at most ${max} characters (it has ${t.length})`);
    return t;
  };
  const int = (o: Record<string, unknown>, key: string, path: string, lo: number, hi: number): number => {
    const x = o[key];
    if (typeof x !== "number" || !Number.isInteger(x) || x < lo || x > hi) {
      err(`${path} must be a whole number, ${lo} to ${hi}`);
      return lo;
    }
    return x;
  };
  /** An array field; a missing optional one is `[]`. */
  const arr = (o: Record<string, unknown>, key: string, path: string, min: number, max: number): unknown[] => {
    const x = o[key];
    if (x === undefined || x === null) {
      if (min > 0) err(`${path} is required: an array with at least ${min} item${min === 1 ? "" : "s"}`);
      return [];
    }
    if (!Array.isArray(x)) {
      err(`${path} must be an array`);
      return [];
    }
    if (x.length < min) err(`${path} must have at least ${min} item${min === 1 ? "" : "s"}`);
    if (x.length > max) err(`${path} must have at most ${max} items (it has ${x.length})`);
    return x.slice(0, max);
  };
  const obj = (x: unknown, path: string): Record<string, unknown> | null => {
    if (isObj(x)) return x;
    err(`${path} must be an object`);
    return null;
  };

  if (v.version !== 1) err("version must be 1");
  const id = str(v, "id", "id", 100, true);
  if (id && !L.id.test(id)) err("id must be lower-case letters, digits and dashes, starting with a letter or digit, at most 61 characters");
  const title = str(v, "title", "title", L.title, true);
  const goal = str(v, "goal", "goal", L.goal);
  const started = str(v, "started", "started", 20, true);
  if (started && !validDate(started)) err("started must be a real date written YYYY-MM-DD");
  const next = str(v, "next", "next", L.next);

  const sessions: PlanSession[] = [];
  const kindIds = new Set<string>();
  const stageKeys = new Set<string>();
  arr(v, "sessions", "sessions", 1, L.kinds).forEach((raw, i) => {
    const p = `sessions[${i}]`;
    const o = obj(raw, p);
    if (!o) return;
    const kid = str(o, "id", `${p}.id`, 100, true);
    if (kid && !L.key.test(kid)) err(`${p}.id must start with a lower-case letter and use only lower-case letters, digits and dashes, at most 31 characters`);
    else if (kid === "extra") err(`${p}.id must not be "extra": that word marks off-day sessions in the logs`);
    else if (kindIds.has(kid)) err(`${p}.id "${kid}" is used by an earlier session kind; ids must be unique`);
    kindIds.add(kid);
    const label = str(o, "label", `${p}.label`, L.label, true);
    const stages: PlanStage[] = [];
    const keys = new Set<string>();
    arr(o, "stages", `${p}.stages`, 1, L.stages).forEach((rawStage, j) => {
      const q = `${p}.stages[${j}]`;
      const st = obj(rawStage, q);
      if (!st) return;
      const key = str(st, "key", `${q}.key`, 100, true);
      if (key && !L.key.test(key)) err(`${q}.key must start with a lower-case letter and use only lower-case letters, digits and dashes, at most 31 characters`);
      else if (keys.has(key)) err(`${q}.key "${key}" is used by an earlier stage of this session kind; keys must be unique within a kind`);
      keys.add(key);
      if (L.key.test(key)) stageKeys.add(key);
      let material: PlanStage["material"];
      if (st.material !== undefined) {
        const m = obj(st.material, `${q}.material`);
        if (m) {
          const file = str(m, "file", `${q}.material.file`, L.file);
          const url = str(m, "url", `${q}.material.url`, L.url);
          if (Boolean(file) === Boolean(url)) err(`${q}.material needs exactly one file or url`);
          if (file && fileProblem(file)) err(`${q}.material.file ${fileProblem(file)}`);
          if (url && urlProblem(url)) err(`${q}.material.url ${urlProblem(url)}`);
          material = file ? { file } : { url };
        }
      }
      stages.push({
        key,
        title: str(st, "title", `${q}.title`, L.stageTitle, true),
        minutes: int(st, "minutes", `${q}.minutes`, 1, L.stageMinutes),
        task: str(st, "task", `${q}.task`, L.task, true),
        ...(material ? { material } : {}),
        ...(st.targetBpm !== undefined ? { targetBpm: int(st, "targetBpm", `${q}.targetBpm`, L.minBpm, L.maxBpm) } : {}),
      });
    });
    sessions.push({ id: kid, label, stages });
  });

  const phases: PlanPhase[] = [];
  arr(v, "phases", "phases", 1, L.phases).forEach((raw, i) => {
    const p = `phases[${i}]`;
    const o = obj(raw, p);
    if (!o) return;
    const focus: Record<string, string> = {};
    if (o.focus !== undefined && o.focus !== null) {
      const f = obj(o.focus, `${p}.focus`);
      for (const [k, val] of Object.entries(f ?? {})) {
        const q = `${p}.focus.${k}`;
        if (typeof val !== "string") err(`${q} must be a string`);
        else if (val.trim().length > L.focus) err(`${q} must be at most ${L.focus} characters (it has ${val.trim().length})`);
        else if (sessions.length && !stageKeys.has(k)) err(`${q} does not match any stage key; the stage keys are: ${[...stageKeys].join(", ")}`);
        else if (val.trim()) focus[k] = val.trim();
      }
    }
    phases.push({
      title: str(o, "title", `${p}.title`, L.title, true),
      sessions: int(o, "sessions", `${p}.sessions`, 1, L.phaseSessions),
      summary: str(o, "summary", `${p}.summary`, L.summary),
      focus,
    });
  });

  const materials: PlanMaterial[] = [];
  arr(v, "materials", "materials", 0, L.materials).forEach((raw, i) => {
    const p = `materials[${i}]`;
    const o = obj(raw, p);
    if (!o) return;
    const m: PlanMaterial = { label: str(o, "label", `${p}.label`, L.materialLabel, true) };
    const file = str(o, "file", `${p}.file`, L.file);
    if (file) {
      const problem = fileProblem(file);
      if (problem) err(`${p}.file ${problem} (got "${file.slice(0, 80)}")`);
      m.file = file;
    }
    const url = str(o, "url", `${p}.url`, L.url);
    if (url) {
      const problem = urlProblem(url);
      if (problem) err(`${p}.url ${problem}`);
      m.url = url;
    }
    const note = str(o, "note", `${p}.note`, L.note);
    if (note) m.note = note;
    materials.push(m);
  });

  const extras: string[] = [];
  arr(v, "extras", "extras", 0, L.extras).forEach((raw, i) => {
    if (typeof raw !== "string") err(`extras[${i}] must be a string`);
    else if (raw.trim().length > L.extra) err(`extras[${i}] must be at most ${L.extra} characters (it has ${raw.trim().length})`);
    else if (raw.trim()) extras.push(raw.trim());
  });

  if (errors.length) return { plan: null, errors };
  return { plan: { version: 1, id, title, goal, started, phases, sessions, materials, next, extras }, errors: [] };
}

/** The active plan: `null` and no errors when there is no file, `null` and the reasons when it is not valid. */
export async function readPlan(s: Studio): Promise<{ plan: Plan | null; errors: string[] }> {
  let raw: string;
  try {
    const path = join(s.home, PLAN_REL);
    if ((await stat(path)).size > 1_000_000) return { plan: null, errors: ["it is larger than 1 MB"] };
    raw = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { plan: null, errors: [] };
    return { plan: null, errors: [`it could not be read: ${(e as Error).message}`] };
  }
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch (e) {
    return { plan: null, errors: [`it is not JSON: ${(e as Error).message}`] };
  }
  return validatePlan(v);
}

// ---------------------------------------------------------------- today

export type Stage = { key: string; title: string; minutes: number; output: string; instruction: string; material?: MaterialRef; targetBpm?: number };
export type MaterialRef = { itemId?: string; label: string; key: string; kind: MaterialKind; src: string | null; url?: string; youtube?: string; missing?: true; note?: string };
export type GenericToday = {
  /** The date in the app's time zone, which log dates and the plan's "started" use. */
  today: string;
  block: { id: string; title: string; path: typeof PLAN_REL; started: string; targetSessions: number; goal: string; weeks: []; materials: []; crossTraining: string[] } | null;
  position: { week: number; sessionInWeek: number; type: string; number: number };
  weekOverride: null;
  counts: { full: number; floor: number };
  next: { text: string; source: "log" | "plan" };
  stages: { full: Stage[]; floor: Stage[] };
  overDue: boolean;
  error?: string;
  sessions: { id: string; label: string; minutes: number; stages: Stage[] }[];
  line: string;
  phase: { n: number; of: number; title: string; summary: string } | null;
  materials: MaterialRef[];
  stats: GenericStats;
  profile: Profile | null;
  daysSinceLast: number | null;
};

/** Where the materials route serves a studio file from. */
export const materialSrc = (file: string) => srcOf(fileId(file.replace(/^materials\//, "")));

async function resolveMaterials(home: string, plan: Plan): Promise<MaterialRef[]> {
  const listed = await listMaterials({ home, libraryDirs: [] }, { limit: 100000 });
  return Promise.all(
    plan.materials.map(async (m, i): Promise<MaterialRef> => {
      const ref: MaterialRef = { label: m.label, key: m.file ?? m.url ?? `label-${i}`, kind: m.file ? kindOf(m.file) : m.url ? "link" : "other", src: null };
      const item = listed.items.find((i) => m.file ? i.path === m.file : i.url === m.url);
      if (item) { ref.itemId = item.id; ref.label = item.shortTitle || item.title; }
      else if (m.file) ref.itemId = fileId(m.file.replace(/^materials\//, ""));
      else if (m.url) ref.itemId = linkId(m.url);
      if (m.note) ref.note = m.note;
      if (m.url) {
        ref.url = m.url;
        const yt = youtubeId(m.url);
        if (yt) ref.youtube = yt;
      }
      if (m.file) {
        // resolveInside follows symlinks, so a link out of the home counts as missing.
        const found = await resolveInside(home, m.file).then(
          () => true,
          () => false,
        );
        if (found) ref.src = materialSrc(m.file);
        else ref.missing = true;
      }
      return ref;
    }),
  );
}

const DAY = 86_400_000;
const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function computeStats(logs: GenericLog[], today: string): GenericStats {
  const now = dayNumber(today);
  // Monday-based: getUTCDay() is 0 for Sunday.
  const monday = now - ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7);
  const days = new Set(logs.map((l) => dayNumber(l.date)));
  let streakDays = 0;
  for (let d = days.has(now) ? now : now - 1; days.has(d); d--) streakDays++;
  const counted = logs.filter(isCounted);
  const last = logs.reduce<string | null>((a, l) => (a === null || l.date > a ? l.date : a), null);
  return {
    total: counted.length,
    thisWeek: counted.filter((l) => dayNumber(l.date) >= monday && dayNumber(l.date) <= now).length,
    streakDays,
    minutes: logs.reduce((a, l) => a + l.minutes, 0),
    last,
  };
}

/** Walk the phases with the counted total; past the end, stay on the last phase. */
export function placeInPlan(plan: Plan, counted: number): { index: number; sessionInPhase: number } {
  let before = 0;
  for (let i = 0; i < plan.phases.length; i++) {
    const n = plan.phases[i]!.sessions;
    if (counted < before + n || i === plan.phases.length - 1) return { index: i, sessionInPhase: counted - before + 1 };
    before += n;
  }
  return { index: 0, sessionInPhase: counted + 1 };
}

/**
 * When `plan.next` was last seen to change. The coach cannot be trusted to stamp times, so the
 * app keeps a hash of the text and the time it first saw that hash: the plan file's mtime, which
 * is the latest moment the text can have changed.
 */
async function nextSeenAt(s: Studio, plan: Plan): Promise<number> {
  const hash = sha(`${plan.id}\n${plan.next}`);
  const stored = getSetting(s.db, "generic.planNext");
  if (stored) {
    try {
      const v = JSON.parse(stored) as { hash: string; seen: number };
      if (v.hash === hash && Number.isFinite(v.seen)) return v.seen;
    } catch {
      // Fall through and store a fresh value.
    }
  }
  const mtime = await stat(join(s.home, PLAN_REL)).then(
    (st) => st.mtimeMs,
    () => Date.now(),
  );
  const seen = Math.min(Date.now(), mtime);
  setSetting(s.db, "generic.planNext", JSON.stringify({ hash, seen }));
  return seen;
}

export async function genericToday(s: Studio, now = new Date()): Promise<GenericToday> {
  const today = localDate(now, s.timeZone);
  const [{ plan, errors }, logs, profile] = await Promise.all([readPlan(s), readLogs(s.home), readProfile(s)]);
  const stats = computeStats(logs, today);
  const daysSinceLast = stats.last ? Math.max(0, dayNumber(today) - dayNumber(stats.last)) : null;
  if (!plan) {
    return {
      today,
      block: null,
      position: { week: 1, sessionInWeek: 1, type: "", number: 1 },
      weekOverride: null,
      counts: { full: 0, floor: 0 },
      next: { text: "", source: "plan" },
      stages: { full: [], floor: [] },
      overDue: false,
      error: errors.length ? `${PLAN_REL} is not valid: ${errors.join("; ")}` : "No plan yet",
      sessions: [],
      line: "",
      phase: null,
      materials: [],
      stats,
      profile,
      daysSinceLast,
    };
  }

  const counted = logs.filter((l) => l.date >= plan.started && isCounted(l));
  const { index, sessionInPhase } = placeInPlan(plan, counted.length);
  const phase = plan.phases[index]!;
  const targetSessions = plan.phases.reduce((a, p) => a + p.sessions, 0);

  const latest = [...counted].reverse().find((l) => l.next);
  const seen = await nextSeenAt(s, plan);
  const fromLog = latest?.next && (!plan.next || (latest.created !== null && latest.created > seen));
  const next: GenericToday["next"] = fromLog ? { text: latest.next!, source: "log" } : { text: plan.next, source: "plan" };

  const minutesOf = (k: PlanSession) => k.stages.reduce((a, st) => a + st.minutes, 0);
  const stageMaterials = new Map<string, MaterialRef>();
  for (const k of plan.sessions) for (const st of k.stages) {
    if (!st.material) continue;
    const key = st.material.file ?? st.material.url!;
    const label = plan.materials.find((m) => (m.file ?? m.url) === key)?.label ?? key.split("/").at(-1)!;
    const [resolved] = await resolveMaterials(s.home, { ...plan, materials: [{ label, ...st.material }] });
    stageMaterials.set(key, resolved!);
  }
  const sessions = plan.sessions.map((k) => ({
    id: k.id,
    label: k.label,
    minutes: minutesOf(k),
    stages: k.stages.map((st, i): Stage => {
      // Only the phase's own keys: a stage keyed "constructor" must not pick up Object.prototype.
      const parts = [st.task, Object.hasOwn(phase.focus, st.key) ? phase.focus[st.key]! : ""];
      if (i === 0 && next.text) parts.push(`Today: ${next.text}`);
      return { key: st.key, title: st.title, minutes: st.minutes, output: st.task, instruction: parts.filter(Boolean).join("\n\n"), ...(st.material ? { material: stageMaterials.get(st.material.file ?? st.material.url!)! } : {}), ...(st.targetBpm !== undefined ? { targetBpm: st.targetBpm } : {}) };
    }),
  }));
  // The shortest kind is the "floor" of the old counts; with one kind there is no floor.
  const shortest = sessions.length > 1 ? sessions.reduce((a, k) => (k.minutes < a.minutes ? k : a)).id : null;
  const floor = counted.filter((l) => l.session === shortest).length;

  const of = plan.phases.length;
  const done = counted.length >= targetSessions;
  const line = `Phase ${index + 1} of ${of}: ${phase.title}, ${done ? `session ${sessionInPhase} (plan complete)` : `session ${sessionInPhase} of ${phase.sessions}`}`;

  return {
    today,
    block: { id: plan.id, title: plan.title, path: PLAN_REL, started: plan.started, targetSessions, goal: plan.goal, weeks: [], materials: [], crossTraining: plan.extras },
    position: { week: index + 1, sessionInWeek: sessionInPhase, type: phase.title, number: counted.length + 1 },
    weekOverride: null,
    counts: { full: counted.length - floor, floor },
    next,
    stages: { full: sessions[0]!.stages, floor: sessions.at(-1)!.stages },
    overDue: targetSessions > 0 && done,
    sessions,
    line,
    phase: { n: index + 1, of, title: phase.title, summary: phase.summary },
    materials: await resolveMaterials(s.home, plan),
    stats,
    profile,
    daysSinceLast,
  };
}
