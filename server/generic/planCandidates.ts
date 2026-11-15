import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HttpError, readJson, route, send } from "../http.ts";
import { resolveInside } from "../files.ts";
import { localDate } from "../logs.ts";
import { PLAN_REL, PLAN_LIMITS, validatePlan, type Studio } from "./studio.ts";

const hash = (raw: string | null) => raw === null ? "missing" : createHash("sha256").update(raw).digest("hex");
const locks = new Map<string, Promise<unknown>>();
export async function planLock<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(home) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  locks.set(home, next);
  try { return await next; } finally { if (locks.get(home) === next) locks.delete(home); }
}
export type CandidateTurn = { id: string; relative: string; base: string | null; provider: string };
type Proposal = { id: string; base: string | null; candidate: string; digest: string; created: number; provider: string; state: string; archive: string | null };
export type ProposalView = { id: string; before: unknown; after: unknown; beforeJson: string | null; afterJson: string; digest: string; provider: string; created: number; changes: { field: string; before: unknown; after: unknown }[] };

/** Private SQLite stores exact immutable candidate bytes, never a provider-supplied path. */
export function planCandidates(s: Studio, options: { assertActive?: (() => void) | undefined; isBusy?: (() => boolean) | undefined } = {}) {
  s.db.exec(`CREATE TABLE IF NOT EXISTS plan_proposals (id TEXT PRIMARY KEY, base TEXT, candidate TEXT NOT NULL, digest TEXT NOT NULL, created INTEGER NOT NULL, provider TEXT NOT NULL, state TEXT NOT NULL, archive TEXT);
    CREATE TABLE IF NOT EXISTS practice_clients (id TEXT PRIMARY KEY, active INTEGER NOT NULL, updated INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS practice_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
    INSERT OR IGNORE INTO practice_revision VALUES (1, 0);`);
  if (!(s.db.prepare("PRAGMA table_info(practice_clients)").all() as { name: string }[]).some((c) => c.name === "updated")) s.db.exec("ALTER TABLE practice_clients ADD COLUMN updated INTEGER NOT NULL DEFAULT 0");
  const leaseMs = 120_000;
  const active = join(s.home, PLAN_REL);
  const staging = join(s.home, ".coach-candidates");
  let turnBusy = false;
  const row = (id: string) => s.db.prepare("SELECT * FROM plan_proposals WHERE id=?").get(id) as Proposal | undefined;
  const state = () => {
    const expired = s.db.prepare("UPDATE practice_clients SET active=0 WHERE active=1 AND updated<?").run(Date.now() - leaseMs);
    if (expired.changes) s.db.prepare("UPDATE practice_revision SET revision=revision+1 WHERE id=1").run();
    return { revision: (s.db.prepare("SELECT revision FROM practice_revision WHERE id=1").get() as { revision: number }).revision, active: Boolean(s.db.prepare("SELECT 1 FROM practice_clients WHERE active=1 LIMIT 1").get()) };
  };
  const regular = async (path: string, missing = false): Promise<string | null> => {
    try {
      const st = await lstat(path);
      if (!st.isFile() || st.nlink !== 1 || st.size > 1_000_000) throw new HttpError(400, "Plan candidates must be regular files of at most 1 MB, without links.");
      return await readFile(path, "utf8");
    } catch (e) { if (missing && (e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  };
  const safeDirs = async () => {
    const home = await realpath(s.home);
    for (const rel of ["plan", "plan/archive"]) if (await realpath(join(s.home, rel)) !== join(home, rel)) throw new HttpError(409, "The plan directories must not be symlinks.");
  };
  const validate = async (raw: string) => {
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new HttpError(400, "The proposed plan is not valid JSON."); }
    const { plan, errors } = validatePlan(value);
    if (!plan) throw new HttpError(400, errors.join("; "));
    if (plan.started > localDate(new Date(), s.timeZone)) throw new HttpError(400, "The proposed plan starts after today.");
    const refs = [...plan.materials, ...plan.sessions.flatMap((k) => k.stages.flatMap((st) => st.material ? [st.material] : []))];
    for (const m of refs) if (m.file) await resolveInside(s.home, m.file).catch(() => { throw new HttpError(400, `Material is missing or outside the studio: ${m.file}`); });
    return plan;
  };
  const view = (p: Proposal): ProposalView => {
    let before: unknown = null;
    try { before = p.base === null ? null : JSON.parse(p.base); } catch { before = { invalidPlanFile: p.base }; }
    const after = JSON.parse(p.candidate);
    const old = before && typeof before === "object" ? before as Record<string, unknown> : {};
    const changes = [...new Set([...Object.keys(old), ...Object.keys(after)])].filter((field) => JSON.stringify(old[field]) !== JSON.stringify(after[field])).map((field) => ({ field, before: old[field] ?? null, after: after[field] ?? null }));
    return { id: p.id, before, after, beforeJson: p.base, afterJson: p.candidate, digest: p.digest, provider: p.provider, created: p.created, changes };
  };
  const expire = () => s.db.prepare("UPDATE plan_proposals SET state='expired', candidate='', base=NULL WHERE state='pending' AND created<?").run(Date.now() - 86400000);
  const receipt = (p: Proposal) => ({ id: p.id, digest: p.digest, applied: true as const });
  const syncDir = async (dir: string) => { const handle = await open(dir, "r"); try { await handle.sync(); } finally { await handle.close(); } };
  const writePrepared = async (path: string, bytes: string) => {
    const handle = await open(path, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  };
  const cleanup = async (id: string) => {
    await rm(join(s.home, "plan", `.candidate-${id}.json`), { force: true });
    await rm(join(s.home, "plan", `.archive-${id}.json`), { force: true });
  };
  const recoverOne = async (p: Proposal) => {
    const current = await regular(active, true);
    if (hash(current) === p.digest) {
      s.db.prepare("UPDATE plan_proposals SET state='applied' WHERE id=?").run(p.id);
    } else if (hash(current) === hash(p.base)) {
      // Only remove an archive created from this intent's retained hard-link source.
      if (p.archive) {
        const source = join(s.home, "plan", `.archive-${p.id}.json`);
        const dest = join(s.home, "plan/archive", p.archive);
        const [a, b] = await Promise.all([lstat(source).catch(() => null), lstat(dest).catch(() => null)]);
        if (a && b && a.ino === b.ino && a.dev === b.dev && hash(await readFile(dest, "utf8")) === hash(p.base)) await unlink(dest);
        else if (b) throw new Error("Cannot recover a changed proposal archive; retained for operator review.");
      }
      s.db.prepare("UPDATE plan_proposals SET state='pending' WHERE id=?").run(p.id);
    } else throw new Error("Cannot recover a proposal over an externally changed active plan.");
    await cleanup(p.id);
  };
  return {
    state,
    async practice(id: string, isActive: boolean) {
      if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new HttpError(400, "Invalid practice client.");
      return planLock(s.home, async () => {
        const previous = s.db.prepare("SELECT active FROM practice_clients WHERE id=?").get(id) as { active: number } | undefined;
        s.db.prepare("INSERT INTO practice_clients (id,active,updated) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET active=excluded.active,updated=excluded.updated").run(id, isActive ? 1 : 0, Date.now());
        if (Boolean(previous?.active) !== isActive) s.db.prepare("UPDATE practice_revision SET revision=revision+1 WHERE id=1").run();
        return { ...state(), expiresAt: isActive ? Date.now() + leaseMs : 0 };
      });
    },
    async recover(cleanStaging = true) {
      await safeDirs();
      for (const p of s.db.prepare("SELECT * FROM plan_proposals WHERE state='applying'").all() as Proposal[]) await recoverOne(p);
      // A crash may occur after a journal state update but before temporary-file cleanup.
      // Remove only server-named files backed by a settled journal row; keep final archives
      // and the current plan, which may already belong to a later successful operation.
      for (const name of await readdir(join(s.home, "plan"))) {
        const id = /^\.(?:candidate|archive)-([a-f0-9-]{36})\.json$/.exec(name)?.[1];
        const p = id ? row(id) : undefined;
        if (p && p.state !== "applying") await cleanup(p.id);
      }
      if (cleanStaging) await rm(staging, { recursive: true, force: true });
      expire();
    },
    async begin(provider: string): Promise<CandidateTurn> {
      return planLock(s.home, async () => {
        options.assertActive?.();
        if (turnBusy) throw new HttpError(409, "Another Coach turn is running. Try again when it finishes.");
        await safeDirs();
        const id = randomUUID();
        const base = await regular(active, true);
        const relative = `.coach-candidates/${id}/plan.json`;
        await mkdir(join(staging, id), { recursive: true, mode: 0o700 });
        await writeFile(join(s.home, relative), base ?? "{}", { mode: 0o600, flag: "wx" });
        turnBusy = true;
        return { id, relative, base, provider };
      });
    },
    async problem(turn: CandidateTurn): Promise<string | null> {
      try {
        const raw = await regular(join(s.home, turn.relative));
        if (raw !== (turn.base ?? "{}") && raw !== null) await validate(raw);
        return null;
      } catch (e) { return `Plan candidate is not valid: ${(e as Error).message}`; }
    },
    async finish(turn: CandidateTurn, success: boolean): Promise<ProposalView | null> {
      try {
        if (!success) return null;
        const raw = await regular(join(s.home, turn.relative));
        if (raw === (turn.base ?? "{}") || raw === null) return null;
        const plan = await validate(raw);
        let old: { id?: string; started?: string } | null = null;
        try { old = turn.base ? JSON.parse(turn.base) : null; } catch { /* invalid base may be repaired */ }
        if (old?.id === plan.id && old.started !== plan.started) throw new HttpError(400, "An adjustment must retain the original started date.");
        const archive = old?.id && old.id !== plan.id && PLAN_LIMITS.id.test(old.id) ? `${old.id}.json` : null;
        if (archive && await lstat(join(s.home, "plan/archive", archive)).then(() => true, () => false)) throw new HttpError(409, "The archive destination already exists. Ask for an adjustment or resolve the archive collision.");
        const p: Proposal = { id: turn.id, base: turn.base, candidate: raw, digest: hash(raw), created: Date.now(), provider: turn.provider, state: "pending", archive };
        options.assertActive?.();
        s.db.prepare("INSERT INTO plan_proposals VALUES (?,?,?,?,?,?,?,?)").run(p.id, p.base, p.candidate, p.digest, p.created, p.provider, p.state, p.archive);
        return view(p);
      } finally { turnBusy = false; await rm(join(staging, turn.id), { recursive: true, force: true }); }
    },
    list() { expire(); return (s.db.prepare("SELECT * FROM plan_proposals WHERE state='pending' ORDER BY created DESC").all() as Proposal[]).map(view); },
    async dismiss(id: string) { return planLock(s.home, async () => { s.db.prepare("UPDATE plan_proposals SET state='dismissed', candidate='', base=NULL WHERE id=? AND state='pending'").run(id); }); },
    async apply(id: string, digest: string, revision: number) {
      return planLock(s.home, async () => {
        options.assertActive?.();
        expire();
        const p = row(id);
        if (!p || p.digest !== digest) throw new HttpError(404, "Proposal unavailable. Reload the proposals.");
        if (p.state === "applied") return receipt(p);
        if (p.state !== "pending") throw new HttpError(409, "This proposal is no longer pending.");
        const practice = state();
        if (turnBusy || options.isBusy?.() || practice.active || practice.revision !== revision) throw new HttpError(409, "Finish or discard practice in all open tabs, then reload the preview before applying. Coach turns must also finish first.");
        await safeDirs();
        if (hash(p.candidate) !== p.digest) throw new HttpError(409, "The proposal digest changed.");
        await validate(p.candidate);
        if (hash(await regular(active, true)) !== hash(p.base)) throw new HttpError(409, "The active plan changed. Dismiss this proposal and ask Coach for a fresh one.");
        if (p.archive && await lstat(join(s.home, "plan/archive", p.archive)).then(() => true, () => false)) throw new HttpError(409, "The archive destination changed. Nothing was applied.");
        const next = join(s.home, "plan", `.candidate-${p.id}.json`);
        const archiveSource = join(s.home, "plan", `.archive-${p.id}.json`);
        try {
        await writePrepared(next, p.candidate);
        if (p.archive) await writePrepared(archiveSource, p.base!);
        await syncDir(join(s.home, "plan"));
        options.assertActive?.();
        s.db.prepare("UPDATE plan_proposals SET state='applying' WHERE id=?").run(p.id);
          if (p.archive) { await link(archiveSource, join(s.home, "plan/archive", p.archive)); await syncDir(join(s.home, "plan/archive")); }
          options.assertActive?.();
          await rename(next, active);
          await syncDir(join(s.home, "plan"));
          s.db.prepare("UPDATE plan_proposals SET state='applied' WHERE id=?").run(p.id);
          await cleanup(p.id);
          return receipt(p);
        } catch (e) { await recoverOne({ ...p, state: "applying" }); throw e; }
      });
    },
  };
}
export type PlanCandidates = ReturnType<typeof planCandidates>;
export function candidateRoutes(store: PlanCandidates) {
  route("GET", "/api/plan-candidates", (_req, res) => send(res, 200, { proposals: store.list(), practice: store.state() }));
  route("PUT", "/api/practice-state", async (req, res) => {
    const body = await readJson(req);
    if (typeof body.active !== "boolean" || typeof body.client !== "string") throw new HttpError(400, "Practice state is required.");
    send(res, 200, await store.practice(body.client, body.active));
  });
  route("POST", "/api/plan-candidates/:id/apply", async (req, res, { params }) => {
    const body = await readJson(req);
    if (typeof body.digest !== "string" || !Number.isInteger(body.revision) || body.active !== false) throw new HttpError(409, "A fresh idle practice assertion is required.");
    send(res, 200, await store.apply(params.id!, body.digest, body.revision));
  });
  route("DELETE", "/api/plan-candidates/:id", async (_req, res, { params }) => { await store.dismiss(params.id!); send(res, 200, { dismissed: true }); });
}
