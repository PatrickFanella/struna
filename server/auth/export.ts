import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Studio } from "../generic/studio.ts";
import { normalizeProfile, validatePlan } from "../generic/studio.ts";
import { LOG_NAME } from "../generic/logs.ts";
import { HttpError, readJson, type route } from "../http.ts";
import type { PracticeIdentity } from "./practice.ts";

export const EXPORT_LIMITS = { bytes: 20 * 1024 * 1024, fileBytes: 1024 * 1024, entries: 5000 } as const;

/** Explicit data selection, never a directory archive or database dump. No async gap in the snapshot. */
export function practiceExport(s: Studio) {
  let bytes = 0, entries = 0;
  const count = (value: unknown) => {
    bytes += Buffer.byteLength(JSON.stringify(value));
    if (++entries > EXPORT_LIMITS.entries || bytes > EXPORT_LIMITS.bytes) throw new HttpError(413, "Export exceeds 20 MiB or 5000 entries. Contact the operator for a larger private export.");
  };
  const read = (relative: string, optional = false): string | null => {
    const path = join(s.home, relative);
    let size: number;
    try { size = statSync(path).size; }
    catch (e) { if (optional && (e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
    if (size > EXPORT_LIMITS.fileBytes) throw new HttpError(413, "An export text file exceeds 1 MiB. Contact the operator for a larger private export.");
    const text = readFileSync(path, "utf8"); count(text); return text;
  };
  const profileText = read("profile.json", true), planText = read("plan/plan.json", true);
  const rawProfile = profileText === null ? null : JSON.parse(profileText);
  if (rawProfile !== null && (typeof rawProfile !== "object" || Array.isArray(rawProfile))) throw new Error("Invalid profile");
  const profile = rawProfile === null ? null : normalizeProfile(rawProfile, new Date().toISOString());
  const checked = planText === null ? null : validatePlan(JSON.parse(planText));
  if (checked && !checked.plan) throw new Error("Invalid plan");
  const logs = readdirSync(join(s.home, "logs")).filter(name => LOG_NAME.test(name)).sort().map(name => ({ name, markdown: read(`logs/${name}`)! }));
  const rows = (sql: string) => {
    const result = [];
    for (const row of s.db.prepare(sql).iterate()) { count(row); result.push(row); }
    return result;
  };
  const table = (name: string) => !!s.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  const data = {
    profile, plan: checked?.plan ?? null, logs,
    tempos: rows("SELECT fragment, bpm, subdivision, updated FROM tempos ORDER BY fragment"),
    conversations: table("conversations") ? rows("SELECT id, provider, title, created, updated FROM conversations ORDER BY id") : [],
    messages: table("messages") ? rows("SELECT conversation, role, text, created FROM messages ORDER BY rowid") : [],
    customPrompts: rows("SELECT value FROM settings WHERE key='prompts.custom'").map(row => JSON.parse(String(row.value))),
  };
  const result = {
    format: "struna-practice-export", version: 1, exportedAt: new Date().toISOString(),
    inventory: {
      included: ["profile", "current plan", "complete Markdown logs", "confirmed tempos", "Coach conversations and messages", "custom prompts"],
      excluded: ["material files and links", "recordings and take metadata", "archived plans and plan candidates", "browser-only unsaved drafts and preferences", "credentials and provider settings", "sessions and identity records", "caches and operator configuration"],
      media: "Download material files from Materials and audio from each take separately. This export contains no media binaries.",
      limits: EXPORT_LIMITS,
    }, data,
  };
  if (Buffer.byteLength(JSON.stringify(result)) > EXPORT_LIMITS.bytes) throw new HttpError(413, "Export exceeds 20 MiB. Contact the operator for a larger private export.");
  return result;
}

export function exportRoutes(s: Studio, identity: PracticeIdentity, register: typeof route) {
  register("POST", "/api/account/export", async (req, res, { url }) => {
    const body = await readJson(req);
    if (url.search || !body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) throw new HttpError(400, "Export uses only your signed-in account; identity and path options are not accepted");
    try {
      identity.assertActive?.();
      const result = practiceExport(s);
      identity.assertActive?.();
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-disposition": 'attachment; filename="struna-practice-export.json"' });
      res.end(JSON.stringify(result));
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(503, "Export could not read all practice data. Nothing was changed. Retry or contact the operator.");
    }
  });
}
