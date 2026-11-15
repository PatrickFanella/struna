import { exportRoutes } from "./export.ts";
import { guestImportRoutes } from "./guest.ts";
import { accountCredentials } from "./credentials.ts";
import { accountCoach, type HostedReply } from "./coach.ts";
import { hostedRecordingRoutes } from "../recordings.ts";
import { materialsRoutes } from "../generic/materials.ts";
import { chmodSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve, sep } from "node:path";
import { openDb } from "../db.ts";
import { createRouter, HttpError, readJson, send } from "../http.ts";
import { genericAppInfo, genericRoutes } from "../generic/routes.ts";
import { ensureStudio, type Studio } from "../generic/studio.ts";
import { planCandidates } from "../generic/planCandidates.ts";
import type { AppInfo } from "../generic/types.ts";

export type PracticeIdentity = { account: string; session: string; csrf: string; assertActive?: () => void };

/** Only server-verified opaque ids reach this resolver. No owner defaults or cached handles. */
export function hostedPractice(root: string, excluded: string[], timeZone: string, options: { run?: HostedReply; transport?: typeof fetch } = {}) {
  root = resolve(root);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  root = realpathSync(root);
  for (const value of excluded) {
    const path = resolve(value);
    const other = (() => { try { return realpathSync(path); } catch { return path; } })();
    if (root === other || root.startsWith(other + sep) || other.startsWith(root + sep)) throw new Error("Hosted root must be separate from owner data");
  }
  const coach = accountCoach(options.run, options.transport);
  const credentials = accountCredentials(root, coach.revokeAccount, options.transport, coach.isBusy);
  const deleting = new Set<string>();
  const running = new Map<string, Set<{ done: Promise<void>; stop?: () => void }>>();
  const contexts = new WeakMap<IncomingMessage, Studio>();
  const router = createRouter();
  genericRoutes((req) => {
    const studio = contexts.get(req);
    if (!studio) throw new HttpError(401, "Missing private workspace");
    return studio;
  }, {}, router.route);
  router.route("PUT", "/api/practice-state", async (req, res) => {
    const body = await readJson(req);
    if (typeof body.active !== "boolean" || typeof body.client !== "string") throw new HttpError(400, "Practice state is required");
    send(res, 200, await planCandidates(contexts.get(req)!).practice(body.client, body.active));
  });
  function directory(path: string) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    if (realpathSync(path) !== path || !lstatSync(path).isDirectory()) throw new HttpError(503, "Private workspace unavailable");
    chmodSync(path, 0o700);
  }
  // Reject linked files as well as directory escapes before opening SQLite or a profile/plan.
  function regularTree(path: string) {
    for (const name of readdirSync(path)) {
      const file = join(path, name), stat = lstatSync(file);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))) throw new HttpError(503, "Private workspace unavailable");
      if (stat.isDirectory()) regularTree(file);
    }
  }
  async function withStudio<T>(identity: PracticeIdentity, fn: (s: Studio) => Promise<T>, stop?: () => void): Promise<T> {
    if (!/^[0-9a-f-]{36}$/.test(identity.account)) throw new HttpError(401, "Invalid account");
    if (deleting.has(identity.account)) throw new HttpError(401, "Account unavailable");
    identity.assertActive?.();
    let complete!: () => void;
    const work = { done: new Promise<void>(r => { complete = r; }), ...(stop ? { stop } : {}) };
    const jobs = running.get(identity.account) ?? new Set();
    running.set(identity.account, jobs); jobs.add(work);
    try {
    const account = join(root, "accounts", identity.account);
    for (const path of [join(root, "accounts"), account, join(account, "workspace"), join(account, "state"), join(account, "private"), join(account, "cache")]) directory(path);
    regularTree(account);
    const home = join(account, "workspace");
    await ensureStudio(home);
    identity.assertActive?.();
    const db = openDb(join(account, "state"));
    chmodSync(join(account, "state", "struna.sqlite"), 0o600);
    try { return await fn({ home, db, timeZone, libraryDirs: [], web: false, appName: "Struna" }); }
    finally { db.close(); }
    } finally { jobs.delete(work); if (!jobs.size) running.delete(identity.account); complete(); }
  }
  function privateRoutes(s: Studio, identity: PracticeIdentity) {
    const privateRouter = createRouter();
    guestImportRoutes(s, identity, privateRouter.route);
    exportRoutes(s, identity, privateRouter.route);
    const connection = credentials.register(s, identity, privateRouter.route);
    coach.register(s, identity, privateRouter.route, connection.connection);
    hostedRecordingRoutes({ mediaRoot: s.home, db: s.db, assertActive: identity.assertActive }, privateRouter.route);
    materialsRoutes(s, { cacheDir: join(root, "accounts", identity.account, "cache"), assertActive: identity.assertActive }, privateRouter.route);
    return privateRouter;
  }
  const info = (identity: PracticeIdentity): Promise<AppInfo> => withStudio(identity, async (s) => ({ ...await genericAppInfo(s, {}), mode: "hosted", sections: ["practice", "materials"], account: identity.account, session: identity.session, csrf: identity.csrf }));
  return {
    info,
    async removeAccount(account: string) {
      if (!/^[0-9a-f-]{36}$/.test(account)) throw new Error("Invalid deletion account");
      deleting.add(account);
      coach.revokeAccount(account);
      const jobs = [...(running.get(account) ?? [])];
      for (const job of jobs) job.stop?.();
      await Promise.all(jobs.map(job => job.done));
      // rm does not follow symlinks; verify the shared parent before touching the opaque child.
      const parent = join(root, "accounts");
      try { if (realpathSync(parent) !== parent) throw new Error("Account parent unavailable"); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      rmSync(join(parent, account), { recursive: true, force: true });
      deleting.delete(account);
    },
    inventory: (identity: PracticeIdentity) => withStudio(identity, async s => [...router.inventory(), ...privateRoutes(s, identity).inventory()]),
    revoke: (session: string) => { coach.revoke(session); credentials.revoke(session); },
    async handle(req: IncomingMessage, res: ServerResponse, url: URL, identity: PracticeIdentity) {
      // Registrations close over this request’s verified workspace, never a global owner.
      if (url.pathname.startsWith("/api/materials") || url.pathname.startsWith("/api/recordings") || /^\/api\/(?:account|conversations|prompts|chat|providers|guest-import)(?:\/|$)/.test(url.pathname)) {
        return await withStudio(identity, async (s) => {
          const privateRouter = privateRoutes(s, identity);
          const found = privateRouter.match(req.method === "HEAD" ? "GET" : req.method ?? "GET", url.pathname);
          if (!found) return false;
          await found.handler(req, res, { url, params: found.params });
          return true;
        }, () => { res.destroy(); req.destroy(); });
      }
      const found = router.match(req.method === "HEAD" ? "GET" : req.method ?? "GET", url.pathname);
      if (!found) return false;
      if (url.pathname === "/api/app") { send(res, 200, await info(identity)); return true; }
      await withStudio(identity, async (s) => {
        contexts.set(req, s);
        try { await found.handler(req, res, { url, params: found.params }); }
        finally { contexts.delete(req); }
      }, () => { res.destroy(); req.destroy(); });
      return true;
    },
  };
}
