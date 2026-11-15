import type { Studio } from "../generic/studio.ts";
import { planCandidates, planLock } from "../generic/planCandidates.ts";
import { HttpError, readJson, send, type route } from "../http.ts";
import type { PracticeIdentity } from "./practice.ts";

/** The identity, conversation, proposal database, practice lease and filesystem share one Studio. */
export function accountCandidateRoutes(s: Studio, identity: PracticeIdentity, register: typeof route, isBusy: () => boolean) {
  const store = planCandidates(s, { assertActive: identity.assertActive, isBusy });
  s.db.exec("CREATE TABLE IF NOT EXISTS hosted_proposals(id TEXT PRIMARY KEY, conversation TEXT NOT NULL)");
  const owned = (id: string) => {
    const row = s.db.prepare("SELECT 1 FROM hosted_proposals p JOIN conversations c ON c.id=p.conversation WHERE p.id=?").get(id);
    if (!row) throw new HttpError(404, "Proposal unavailable. Reload the proposals.");
  };
  const recover = () => planLock(s.home, () => store.recover(false));
  register("GET", "/api/plan-candidates", async (_req, res, { url }) => {
    if (url.search) throw new HttpError(400, "Proposal selectors are not accepted");
    await recover(); identity.assertActive?.();
    const proposals = store.list().filter(p => Boolean(s.db.prepare("SELECT 1 FROM hosted_proposals p JOIN conversations c ON c.id=p.conversation WHERE p.id=?").get(p.id)));
    send(res, 200, { proposals, practice: store.state() });
  });
  register("POST", "/api/plan-candidates/:id/apply", async (req, res, { params, url }) => {
    const body = await readJson(req);
    if (url.search || !body || Object.keys(body).some(k => !["digest", "revision", "active"].includes(k))) throw new HttpError(400, "Only the displayed proposal and practice assertion are accepted");
    if (typeof body.digest !== "string" || !Number.isInteger(body.revision) || body.active !== false) throw new HttpError(409, "A fresh idle practice assertion is required");
    owned(params.id!); await recover();
    send(res, 200, await store.apply(params.id!, body.digest, body.revision));
  });
  register("DELETE", "/api/plan-candidates/:id", async (req, res, { params, url }) => {
    const body = await readJson(req);
    if (url.search || !body || Object.keys(body).length) throw new HttpError(400, "Proposal selectors are not accepted");
    owned(params.id!); identity.assertActive?.(); await store.dismiss(params.id!); send(res, 200, { dismissed: true });
  });
}
