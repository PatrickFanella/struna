import type { DatabaseSync } from "node:sqlite";

import { getSetting, setSetting } from "./db.ts";
import { resolveThreadFile, streamFile } from "./files.ts";
import { HttpError, readJson, route, send } from "./http.ts";
import { type SessionReview, writeSessionLog } from "./logs.ts";
import { countSessions, nextInstruction, placeSession, readLogs } from "./sessions.ts";
import { type Block, readActiveBlock, readLedger, VaultError, type Week } from "./vault.ts";

export type StageKey = "target" | "prepare" | "vocabulary" | "mechanism" | "music" | "review";
export type Stage = { key: StageKey; title: string; minutes: number; output: string; weekField?: keyof Week };

/** The "Required output" column of the practice system's session table, verbatim. */
const OUTPUT: Record<StageKey, string> = {
  target: "One sentence: material, measure or pattern, tempo, and quality criterion",
  prepare: "A relaxed, easy version of the week's picking or fretting motion",
  vocabulary: "One pattern from memory, then one variation or connection",
  mechanism: "Short loops with a clean-repetition gate",
  music: "A named phrase plus one improvised or recomposed use",
  review: "One representative take and one next-session instruction",
};

const stage = (key: StageKey, title: string, minutes: number): Stage => ({
  key,
  title,
  minutes,
  output: OUTPUT[key],
  ...(key === "vocabulary" || key === "mechanism" || key === "music" ? { weekField: key } : {}),
});

export const STAGES = {
  full: [
    stage("target", "Set the target", 2),
    stage("prepare", "Prepare the motion", 5),
    stage("vocabulary", "Build vocabulary", 8),
    stage("mechanism", "Train the mechanism", 10),
    stage("music", "Apply it to music", 15),
    stage("review", "Record and review", 5),
  ],
  floor: [
    stage("target", "Target and relaxed motion", 2),
    stage("vocabulary", "Vocabulary", 4),
    stage("music", "Musical phrase", 6),
    stage("review", "Record and next instruction", 3),
  ],
};

export type Paths = { vaultRoot: string; threadRel: string; practiceDir: string };

function weekOverride(db: DatabaseSync): number | undefined {
  const v = Number(getSetting(db, "weekOverride"));
  return v >= 1 && v <= 4 ? v : undefined;
}

export async function today(paths: Paths, db: DatabaseSync) {
  const override = weekOverride(db);
  const logs = await readLogs(paths.practiceDir);
  let block: Block | null = null;
  let error: string | undefined;
  try {
    block = await readActiveBlock(paths.vaultRoot, paths.threadRel);
  } catch (e) {
    if (!(e instanceof VaultError)) throw e;
    error = e.message;
  }
  const ledger = await readLedger(paths.vaultRoot, paths.threadRel).catch((e) => {
    if (!(e instanceof VaultError)) throw e;
    error = error ? `${error}; ${e.message}` : e.message;
    return { nextEvidence: "", lastReview: null };
  });
  const { full, floor, counted } = countSessions(logs, block?.started ?? "9999-12-31");
  const position = placeSession(counted.length, override);
  return {
    block,
    position,
    weekOverride: override ?? null,
    counts: { full, floor },
    next: nextInstruction(counted, ledger),
    stages: STAGES,
    overDue: Boolean(block && block.targetSessions > 0 && counted.length >= block.targetSessions),
    ...(error ? { error } : {}),
  };
}

const TYPES = new Set(["decode", "connect", "vary", "prove", "cross-training"]);
const LABELS = new Set(["baseline", "weekly", "midpoint", "final"]);
const RECALL = new Set(["memory", "cue map", "page-dependent"]);

export function parseReview(input: any): SessionReview {
  const s = (v: unknown, max = 2000) => String(v ?? "").slice(0, max);
  if (!TYPES.has(input?.type)) throw new HttpError(400, "unknown session type");
  if (input.length !== "full" && input.length !== "floor") throw new HttpError(400, "length must be full or floor");
  if (input.threePass !== "met" && input.threePass !== "not met") throw new HttpError(400, "threePass must be met or not met");
  if (!RECALL.has(input.recall)) throw new HttpError(400, "unknown recall");
  const r: SessionReview = {
    blockTitle: s(input.blockTitle, 300),
    blockId: s(input.blockId, 200),
    type: input.type,
    length: input.length,
    material: s(input.material),
    target: s(input.target),
    startTempo: s(input.startTempo, 20),
    cleanTempo: s(input.cleanTempo, 20),
    subdivision: s(input.subdivision, 50),
    threePass: input.threePass,
    recall: input.recall,
    pain: input.pain === true,
    improvement: s(input.improvement),
    failure: s(input.failure),
    next: s(input.next, 4000),
  };
  if (input.recording?.path) {
    if (!LABELS.has(input.recording.label)) throw new HttpError(400, "unknown recording label");
    r.recording = { path: s(input.recording.path, 500), label: input.recording.label, purpose: s(input.recording.purpose, 500) };
  }
  for (const k of ["observation", "vocabulary", "mechanism", "gesture", "application", "timing", "tension", "harmony"] as const) {
    if (input[k]) r[k] = s(input[k]);
  }
  return r;
}

export function practiceRoutes(paths: Paths & { threadDir: string; timeZone: string }, db: DatabaseSync): void {
  route("GET", "/api/today", async (_req, res) => send(res, 200, await today(paths, db)));

  route("PUT", "/api/week-override", async (req, res) => {
    const { week } = await readJson(req);
    if (week !== null && !(Number.isInteger(week) && week >= 1 && week <= 4)) throw new HttpError(400, "week must be 1 to 4 or null");
    setSetting(db, "weekOverride", week === null ? null : String(week));
    send(res, 200, { ok: true });
  });

  route("GET", "/api/tempos", (_req, res) => send(res, 200, db.prepare("SELECT fragment, bpm, subdivision, updated FROM tempos ORDER BY updated DESC").all()));

  route("PUT", "/api/tempos", async (req, res) => {
    const { fragment, bpm, subdivision } = await readJson(req);
    const f = String(fragment ?? "").trim().slice(0, 200);
    const b = Number(bpm);
    if (!f || !Number.isInteger(b) || b < 30 || b > 300) throw new HttpError(400, "fragment and bpm 30–300 required");
    db.prepare(
      "INSERT INTO tempos (fragment, bpm, subdivision, updated) VALUES (?, ?, ?, ?) ON CONFLICT(fragment) DO UPDATE SET bpm = excluded.bpm, subdivision = excluded.subdivision, updated = excluded.updated",
    ).run(f, b, String(subdivision ?? "").slice(0, 50), new Date().toISOString());
    send(res, 200, { ok: true });
  });

  route("POST", "/api/sessions", async (req, res) => {
    const review = parseReview(await readJson(req));
    send(res, 200, await writeSessionLog(paths.practiceDir, review, new Date(), paths.timeZone));
  });

  route("GET", "/api/vault-file", async (req, res, { url }) => {
    const rel = url.searchParams.get("path") ?? "";
    const prefix = `${paths.threadRel}/`;
    if (!rel.startsWith(prefix)) throw new HttpError(404, "not found");
    await streamFile(req, res, await resolveThreadFile(paths.threadDir, rel.slice(prefix.length)));
  });
}
