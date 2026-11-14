import { mkdir, open, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseFrontMatter, str } from "../frontmatter.ts";
import { HttpError } from "../http.ts";
import { localDate } from "../logs.ts";
import { value } from "../sessions.ts";

export const DIFFICULTY = ["too easy", "about right", "too hard"] as const;
export type Difficulty = (typeof DIFFICULTY)[number];

/** What the review form sends to `POST /api/sessions`. */
export type GenericReview = {
  planId: string;
  planTitle: string;
  phase: string;
  /** The session kind. Absent for an off-day "extra" session. */
  session: { id: string; label: string } | null;
  /** The off-day activity, when this was one; such a session is logged but not counted. */
  extra: string;
  minutes: number;
  material: string;
  target: string;
  /** Digits, or empty when the metronome was not used. */
  startTempo: string;
  cleanTempo: string;
  subdivision: string;
  difficulty: Difficulty | "";
  wentWell: string;
  struggled: string;
  pain: boolean;
  recording: string;
  notes: string;
  next: string;
};

/** What a log says, read back from its Markdown. */
export type GenericLog = {
  file: string;
  date: string;
  /** Epoch milliseconds from the front matter's `created`, or null in a hand-written log without one. */
  created: number | null;
  planId: string;
  phase: string;
  /** The session kind id, "extra" for an off-day session, or "" when the line is missing. */
  session: string;
  sessionLabel: string;
  extra: boolean;
  minutes: number;
  material: string;
  cleanTempo: number | null;
  difficulty: Difficulty | null;
  wentWell: string;
  struggled: string;
  pain: boolean;
  next: string | null;
};

export const LOG_NAME = /^(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.md$/;
const BLANK = "not recorded";
const KIND_ID = /^[a-z][a-z0-9-]{0,30}$/;

/** A counted session: not stopped for pain and not an off-day extra. */
export const isCounted = (l: GenericLog) => !l.pain && !l.extra;

export function parseGenericReview(input: any): GenericReview {
  const s = (v: unknown, max = 2000) => (typeof v === "string" || typeof v === "number" ? String(v).slice(0, max) : "");
  if (typeof input !== "object" || input === null) throw new HttpError(400, "a session review is required");
  const extra = s(input.extra, 500).trim();
  let session: GenericReview["session"] = null;
  if (input.session !== undefined && input.session !== null) {
    const id = s(input.session.id, 40);
    if (!KIND_ID.test(id) || id === "extra") throw new HttpError(400, "session.id must be a session kind id from the plan");
    session = { id, label: s(input.session.label, 80).trim() || id };
  }
  if (!session && !extra) throw new HttpError(400, "session (id and label) or extra is required");
  const difficulty = s(input.difficulty, 20).trim().toLowerCase();
  if (difficulty && !(DIFFICULTY as readonly string[]).includes(difficulty)) throw new HttpError(400, "difficulty must be too easy, about right or too hard");
  const tempo = (v: unknown, name: string) => {
    const t = s(v, 20).trim();
    if (!t) return "";
    const n = Number(t);
    if (!Number.isFinite(n) || n < 20 || n > 400) throw new HttpError(400, `${name} must be a number of beats per minute, 20 to 400, or empty`);
    return String(Math.round(n));
  };
  const minutes = Number(input.minutes ?? 0);
  if (!Number.isFinite(minutes) || minutes < 0) throw new HttpError(400, "minutes must be a number, 0 or more");
  const rec = input.recording;
  // The take box calls a "weekly" take "Progress"; the log says what the player saw, and keeps their purpose.
  const label = rec && typeof rec === "object" ? s(rec.label, 40).trim() : "";
  const recording =
    typeof rec === "string"
      ? rec
      : rec && typeof rec === "object" && rec.path
        ? [s(rec.path, 500), label === "weekly" ? "progress" : label, s(rec.purpose, 500).trim() || "no purpose given"].filter(Boolean).join(" — ")
        : "";
  return {
    planId: s(input.planId, 100),
    planTitle: s(input.planTitle, 300),
    phase: s(input.phase, 300),
    session: extra ? null : session,
    extra,
    minutes: Math.min(600, Math.round(minutes)),
    material: s(input.material),
    target: s(input.target),
    startTempo: tempo(input.startTempo, "startTempo"),
    cleanTempo: tempo(input.cleanTempo, "cleanTempo"),
    subdivision: s(input.subdivision, 50),
    difficulty: difficulty as Difficulty | "",
    wentWell: s(input.wentWell),
    struggled: s(input.struggled),
    pain: input.pain === true,
    recording: recording.slice(0, 1100),
    notes: s(input.notes, 4000),
    next: s(input.next, 4000),
  };
}

/** One line of text; empty becomes `fallback`. */
function one(v: string, fallback = BLANK): string {
  return v.replace(/\s+/g, " ").trim() || fallback;
}

function tempoLine(bpm: string, subdivision: string): string {
  if (!bpm) return "not used";
  const sub = one(subdivision, "");
  return `${bpm} BPM${sub ? `, ${sub}` : ""}`;
}

export function renderGenericLog(r: GenericReview, date: string, created: string): string {
  const session = r.session ? `${r.session.id} (${one(r.session.label, r.session.id)})` : `extra (${one(r.extra)})`;
  return `---
created: ${created}
date: ${date}
plan: ${one(r.planId, "none")}
---

# Practice log: ${date}

- **Plan:** ${one(r.planTitle)} (\`${one(r.planId, "none")}\`)
- **Phase:** ${one(r.phase)}
- **Session:** ${session}
- **Minutes practised:** ${r.minutes}
- **Material:** ${one(r.material)}
- **Target:** ${one(r.target)}
- **Starting tempo:** ${tempoLine(r.startTempo, r.subdivision)}
- **Clean tempo:** ${tempoLine(r.cleanTempo, r.subdivision)}
- **Difficulty:** ${r.difficulty || BLANK}
- **What went well:** ${one(r.wentWell)}
- **What was hard:** ${one(r.struggled)}
- **Pain or tension:** ${r.pain ? "yes" : "no"}
- **Recording:** ${one(r.recording, "none")}
- **Notes:** ${one(r.notes, "none")}

## Next instruction

${r.next.trim() || BLANK}
`;
}

export function parseGenericLog(file: string, text: string): GenericLog {
  const { data, body } = parseFrontMatter(text);
  const field = (label: string) => {
    const v = value(body, label);
    return v === BLANK ? "" : v;
  };
  const created = Date.parse(str(data, "created"));
  const sessionLine = value(body, "Session");
  const m = /^([a-z][a-z0-9-]*)\s*(?:\((.*)\))?\s*$/i.exec(sessionLine);
  const session = (m?.[1] ?? "").toLowerCase();
  const tempo = /^(\d+)/.exec(value(body, "Clean tempo"))?.[1];
  const difficulty = value(body, "Difficulty").toLowerCase();
  // The app writes this section last, so it runs to the end: a "## " line inside the instruction stays part of it.
  const heading = /^##\s+Next instruction\s*$/im.exec(body);
  const next = heading ? body.slice(heading.index + heading[0].length).trim() : "";
  return {
    file,
    date: LOG_NAME.exec(file)?.[1] ?? "",
    created: Number.isNaN(created) ? null : created,
    planId: str(data, "plan"),
    phase: field("Phase"),
    session,
    sessionLabel: m?.[2]?.trim() || session,
    extra: session === "extra",
    minutes: Math.max(0, Number(/^(\d+)/.exec(value(body, "Minutes practised"))?.[1] ?? 0)),
    material: field("Material"),
    cleanTempo: tempo && Number(tempo) > 0 ? Number(tempo) : null,
    difficulty: (DIFFICULTY as readonly string[]).includes(difficulty) ? (difficulty as Difficulty) : null,
    wentWell: field("What went well"),
    struggled: field("What was hard"),
    pain: /^yes\b/i.test(value(body, "Pain or tension")),
    next: next && next !== BLANK ? next : null,
  };
}

/** Every log under `<home>/logs/`, oldest first; a day's second log follows its first. */
export async function readLogs(home: string): Promise<GenericLog[]> {
  const dir = join(home, "logs");
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => LOG_NAME.test(n));
  const logs = await Promise.all(names.map(async (n) => parseGenericLog(n, await readFile(join(dir, n), "utf8"))));
  const seq = (l: GenericLog) => Number(LOG_NAME.exec(l.file)?.[2] ?? 1);
  return logs.sort((a, b) => a.date.localeCompare(b.date) || seq(a) - seq(b));
}

/**
 * Write a new log under `<home>/logs/`. Never opens an existing file: each candidate
 * name is created with `wx`, so a second session that day becomes `-2`, then `-3`…
 */
export async function writeGenericLog(home: string, review: GenericReview, now: Date, timeZone: string): Promise<{ file: string }> {
  const date = localDate(now, timeZone);
  const dir = join(home, "logs");
  await mkdir(dir, { recursive: true });
  const body = renderGenericLog(review, date, now.toISOString());
  for (let n = 1; n < 1000; n++) {
    const file = n === 1 ? `${date}.md` : `${date}-${n}.md`;
    try {
      const fh = await open(join(dir, file), "wx", 0o664);
      try {
        await fh.writeFile(body);
      } finally {
        await fh.close();
      }
      return { file };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  throw new HttpError(409, "too many logs for one day");
}
