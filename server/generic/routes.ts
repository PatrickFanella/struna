import type { IncomingMessage } from "node:http";
import { submissionId } from "../session-log.ts";
import { planLock } from "./planCandidates.ts";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { HttpError, readJson, route, send } from "../http.ts";
import { localDate } from "../logs.ts";
import { tempoRoutes } from "../practice.ts";
import { parseGenericReview, readLogs, writeGenericLog } from "./logs.ts";
import { starterPlan } from "./starter.ts";
import { genericToday, LEVELS, normalizeProfile, PLAN_REL, readPlan, readProfile, type Studio, writeProfile } from "./studio.ts";
import type { AppInfo, Level, Profile } from "./types.ts";

/**
 * Write the starter plan unless a valid plan exists. An invalid file is moved to the archive
 * first; the new file is created exclusively, so a plan the coach writes meanwhile is kept.
 */
async function ensureStarterPlanUnlocked(s: Studio, profile: Profile, now = new Date()): Promise<"created" | "kept"> {
  const { plan, errors } = await readPlan(s);
  if (plan) return "kept";
  const path = join(s.home, PLAN_REL);
  await mkdir(join(s.home, "plan/archive"), { recursive: true });
  if (errors.length) await rename(path, join(s.home, "plan/archive", `invalid-${now.toISOString().replace(/[:.]/g, "-")}.json`));
  const text = `${JSON.stringify(starterPlan(profile, localDate(now, s.timeZone)), null, 2)}\n`;
  try {
    await writeFile(path, text, { flag: "wx", mode: 0o664 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return "kept";
    throw e;
  }
  return "created";
}

export async function ensureStarterPlan(s: Studio, profile: Profile, now = new Date()): Promise<"created" | "kept"> {
  return planLock(s.home, () => ensureStarterPlanUnlocked(s, profile, now));
}

/** What `/api/app` says in the studio mode; the page also carries it, so the app draws without asking. */
export async function genericAppInfo(s: Studio, opts: { tabs?: boolean }): Promise<AppInfo> {
  return {
    mode: "studio",
    name: s.appName,
    sections: ["practice", "materials", ...(opts.tabs ? (["tabs"] as const) : [])],
    web: s.web,
    profile: (await readProfile(s)) !== null,
  };
}

export function genericRoutes(studio: Studio | ((req: IncomingMessage) => Studio), opts: { tabs?: boolean } = {}, register = route): void {
  const resolve = (req: IncomingMessage) => typeof studio === "function" ? studio(req) : studio;
  register("GET", "/api/app", async (req, res) => {
    const s = resolve(req);
    send(res, 200, await genericAppInfo(s, opts));
  });

  register("GET", "/api/profile", async (req, res) => send(res, 200, { profile: await readProfile(resolve(req)) }));

  register("PUT", "/api/profile", async (req, res) => {
    const body = await readJson(req);
    const s = resolve(req);
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "profile fields are required");
    if (body.level !== undefined && !LEVELS.includes(body.level as Level)) throw new HttpError(400, `level must be one of: ${LEVELS.join(", ")}`);
    const existing = await readProfile(s);
    const now = new Date();
    const profile: Profile = { ...normalizeProfile({ ...existing, ...body }, now.toISOString()), created: existing?.created ?? now.toISOString(), updated: now.toISOString() };
    await writeProfile(s, profile);
    send(res, 200, { profile, plan: await ensureStarterPlan(s, profile, now) });
  });

  register("GET", "/api/today", async (req, res) => send(res, 200, await genericToday(resolve(req))));

  register("POST", "/api/sessions", async (req, res) => {
    const body = await readJson(req);
    const s = resolve(req);
    const review = parseGenericReview(body);
    const { file, replayed } = await writeGenericLog(s.home, review, new Date(), s.timeZone, submissionId(body.submissionId));
    // A cache failure must never turn a saved log into a failed save (and a duplicate on retry).
    const warnings: string[] = replayed ? ["This session was already saved. The original log was kept; retry edits were not applied."] : [];
    if (!replayed && !review.pain) for (const m of review.measurements ?? []) {
      if (m.bpm === null) continue;
      const fragment = `material:${m.materialKey}`;
      if (m.bpm < 30 || m.bpm > 300 || fragment.length > 200) {
        warnings.push(`${m.materialLabel}: ${m.bpm} BPM saved in the log only; ${m.bpm < 30 || m.bpm > 300 ? "tempo suggestions support 30–300 BPM" : "this material identity is too long for tempo suggestions"}.`);
        continue;
      }
      try {
        s.db.prepare("INSERT INTO tempos (fragment, bpm, subdivision, updated) VALUES (?, ?, ?, ?) ON CONFLICT(fragment) DO UPDATE SET bpm = excluded.bpm, subdivision = excluded.subdivision, updated = excluded.updated")
          .run(fragment, m.bpm, "", new Date().toISOString());
      } catch {
        warnings.push(`${m.materialLabel}: saved in the log, but the tempo suggestion cache could not be updated.`);
      }
    }
    send(res, 200, { file, warnings });
  });

  tempoRoutes((req) => resolve(req).db, register);

  register("GET", "/api/logs", async (req, res, { url }) => {
    const s = resolve(req);
    const limit = Math.min(200, Math.max(1, Math.round(Number(url.searchParams.get("limit")) || 20)));
    const logs = (await readLogs(s.home)).reverse().slice(0, limit);
    send(
      res,
      200,
      logs.map((l) => ({
        file: l.file,
        date: l.date,
        session: l.sessionLabel,
        sessionId: l.session,
        extra: l.extra,
        phase: l.phase,
        minutes: l.minutes,
        material: l.material,
        cleanTempo: l.cleanTempo,
        ...(l.measurements ? { measurements: l.measurements } : {}),
        difficulty: l.difficulty,
        pain: l.pain,
        wentWell: l.wentWell,
        struggled: l.struggled,
        next: l.next,
      })),
    );
  });
}
