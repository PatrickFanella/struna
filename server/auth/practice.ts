import { hostedRecordingRoutes } from "../recordings.ts";
import { materialsRoutes } from "../generic/materials.ts";
import { chmodSync, lstatSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
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
export function hostedPractice(root: string, excluded: string[], timeZone: string) {
  root = resolve(root);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  root = realpathSync(root);
  for (const value of excluded) {
    const path = resolve(value);
    const other = (() => { try { return realpathSync(path); } catch { return path; } })();
    if (root === other || root.startsWith(other + sep) || other.startsWith(root + sep)) throw new Error("Hosted root must be separate from owner data");
  }
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
  async function withStudio<T>(identity: PracticeIdentity, fn: (s: Studio) => Promise<T>): Promise<T> {
    if (!/^[0-9a-f-]{36}$/.test(identity.account)) throw new HttpError(401, "Invalid account");
    const account = join(root, "accounts", identity.account);
    for (const path of [join(root, "accounts"), account, join(account, "workspace"), join(account, "state"), join(account, "private"), join(account, "cache")]) directory(path);
    regularTree(account);
    const home = join(account, "workspace");
    await ensureStudio(home);
    const db = openDb(join(account, "state"));
    chmodSync(join(account, "state", "struna.sqlite"), 0o600);
    try { return await fn({ home, db, timeZone, libraryDirs: [], web: false, appName: "Struna" }); }
    finally { db.close(); }
  }
  const info = (identity: PracticeIdentity): Promise<AppInfo> => withStudio(identity, async (s) => ({ ...await genericAppInfo(s, {}), mode: "hosted", sections: ["practice", "materials"], account: identity.account, session: identity.session, csrf: identity.csrf }));
  return {
    info,
    async handle(req: IncomingMessage, res: ServerResponse, url: URL, identity: PracticeIdentity) {
      const privateRouter = createRouter();
      // Registrations close over this request’s verified workspace, never a global owner.
      if (url.pathname.startsWith("/api/materials") || url.pathname.startsWith("/api/recordings")) {
        return await withStudio(identity, async (s) => {
          hostedRecordingRoutes({ mediaRoot: s.home, db: s.db, assertActive: identity.assertActive }, privateRouter.route);
          materialsRoutes(s, { cacheDir: join(root, "accounts", identity.account, "cache"), assertActive: identity.assertActive }, privateRouter.route);
          const found = privateRouter.match(req.method === "HEAD" ? "GET" : req.method ?? "GET", url.pathname);
          if (!found) return false;
          await found.handler(req, res, { url, params: found.params });
          return true;
        });
      }
      const found = router.match(req.method === "HEAD" ? "GET" : req.method ?? "GET", url.pathname);
      if (!found) return false;
      if (url.pathname === "/api/app") { send(res, 200, await info(identity)); return true; }
      await withStudio(identity, async (s) => {
        contexts.set(req, s);
        try { await found.handler(req, res, { url, params: found.params }); }
        finally { contexts.delete(req); }
      });
      return true;
    },
  };
}
