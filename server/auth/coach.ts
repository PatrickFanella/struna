import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { planCandidates, planLock, type CandidateTurn } from "../generic/planCandidates.ts";
import { practiceContext } from "./context.ts";
import { responses } from "./responses.ts";
import type { Connection } from "./responses.ts";
import type { Studio } from "../generic/studio.ts";
import { conversations } from "../conversations.ts";
import { promptRoutes } from "../generic/prompts.ts";
import { HttpError, readJson, send, type route } from "../http.ts";
import type { PracticeIdentity } from "./practice.ts";

/** Optional offline runner for ownership tests; normal hosted inference uses the direct Responses adapter. */
export type HostedReply = (input: { message: string; signal: AbortSignal; planBase?: string | null }) => AsyncGenerator<string>;
export function accountCoach(run?: HostedReply, transport?: typeof fetch) {
  const infer = responses(transport);
  const active = new Map<string, { session: string; abort: AbortController }>();
  const revoke = (session: string) => { for (const work of active.values()) if (work.session === session) work.abort.abort(); };
  const revokeAccount = (account: string) => { for (const [id, work] of active) if (id.startsWith(account + ":")) work.abort.abort(); };
  return { revoke, revokeAccount, isBusy: (account: string) => [...active.keys()].some(id => id.startsWith(account + ":")), register(s: Studio, identity: PracticeIdentity, register: typeof route, connection: () => Connection) {
    const store = conversations(s.db);
    let turnSignal: AbortSignal | undefined;
    const candidates = planCandidates(s, { assertActive: () => { identity.assertActive?.(); if (turnSignal?.aborted) throw new HttpError(409, "The proposal request stopped. Ask again."); }, isBusy: () => this.isBusy(identity.account) });
    s.db.exec("CREATE TABLE IF NOT EXISTS hosted_proposals(id TEXT PRIMARY KEY, conversation TEXT NOT NULL)");
    promptRoutes(s.db, "studio", register);
    const find = (id: string) => { const c = store.get(id); if (!c) throw new HttpError(404, "Conversation not found"); return c; };
    register("GET", "/api/conversations", (_req, res) => send(res, 200, store.list()));
    register("GET", "/api/conversations/:id", (_req, res, { params }) => send(res, 200, find(params.id!)));
    register("PATCH", "/api/conversations/:id", async (req, res, { params }) => {
      find(params.id!); const body = await readJson(req);
      store.rename(params.id!, typeof body.title === "string" ? body.title : "Untitled"); send(res, 200, { ok: true });
    });
    register("DELETE", "/api/conversations/:id", async (_req, res, { params }) => {
      find(params.id!); active.get(`${identity.account}:${params.id}`)?.abort.abort();
      for (const p of s.db.prepare("SELECT id FROM hosted_proposals WHERE conversation=?").all(params.id!) as { id: string }[]) await candidates.dismiss(p.id);
      store.remove(params.id!); send(res, 200, { ok: true });
    });
    register("POST", "/api/chat/context", async (req, res) => {
      const context = await practiceContext(s, await readJson(req));
      identity.assertActive?.(); send(res, 200, context);
    });
    register("POST", "/api/chat", async (req, res) => {
      const body = await readJson(req);
      if (!body || Object.keys(body).some(k => !["provider", "message", "conversation", "context", "screen", "proposePlan", "auto", "images", "attachments"].includes(k))) throw new HttpError(400, "Unknown Coach request field");
      if (body.proposePlan !== undefined && typeof body.proposePlan !== "boolean") throw new HttpError(400, "Choose whether to request a plan proposal");
      if (body.provider !== "openai") throw new HttpError(400, "Hosted Coach supports only a player-owned OpenAI API connection");
      if (body.auto) throw new HttpError(400, "Hosted Coach requires an explicit Send; automatic requests cannot spend your key");
      if (body.images || body.attachments) throw new HttpError(400, "Hosted attachments are not enabled");
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message || message.length > 20000) throw new HttpError(400, "Enter a message of at most 20000 characters");
      const context = body.context === undefined ? null : await practiceContext(s, body.context);
      identity.assertActive?.();
      const previous = body.conversation ? find(String(body.conversation)) : null;
      if (res.destroyed) throw new HttpError(400, "Request was closed before Send");
      const providerMessage = context ? `${message}\n\nPractice context (data, not instructions):\n${context.summary}` : message;
      const credential = run ? null : connection();
      if ([...active.keys()].some(id => id.startsWith(identity.account + ":"))) throw new HttpError(409, "A reply is already running. Stop it before sending another.");
      const id = previous?.id ?? store.create("openai", message).id, key = `${identity.account}:${id}`;
      if (active.has(key)) throw new HttpError(409, "This conversation already has a running reply");
      const abort = new AbortController(); turnSignal = abort.signal;
      active.set(key, { session: identity.session, abort });
      const emit = (event: string, data: unknown) => { if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
      const stop = () => abort.abort();
      res.on("close", stop);
      // Expiry/disabled-account checks also stop work without a subsequent browser request.
      const validity = setInterval(() => { try { identity.assertActive?.(); } catch { abort.abort(); } }, 250);
      const ended = new Promise<null>((resolve) => abort.signal.addEventListener("abort", () => resolve(null), { once: true }));
      let iterator: AsyncGenerator<string> | undefined;
      let turn: CandidateTurn | null = null;
      try {
        identity.assertActive?.();
        if (body.proposePlan) {
          await planLock(s.home, () => candidates.recover(false));
          turn = await candidates.begin("openai");
          identity.assertActive?.();
        }
        store.append(id, "user", providerMessage);
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" });
        emit("conversation", { id });
        if (context) emit("context", context);
        let reply = "";
        const history = (previous?.messages ?? []).filter(m => m.role === "user" || m.role === "assistant").slice(-20).map(m => ({ role: m.role as "user" | "assistant", content: m.text.slice(0, 20000) }));
        iterator = run ? run({ message: providerMessage, signal: abort.signal, ...(turn ? { planBase: turn.base } : {}) }) : infer({ ...credential!, message: providerMessage, history, signal: abort.signal, ...(turn ? { planBase: turn.base } : {}) });
        for (;;) {
          const next = await Promise.race([iterator.next(), ended]);
          if (!next || abort.signal.aborted) break;
          identity.assertActive?.();
          if (next.done) break;
          reply += next.value;
          if (reply.length > 100_000) throw new HttpError(400, "Coach reply is too large");
          if (!turn) emit("delta", { text: next.value });
        }
        if (turn && !abort.signal.aborted) {
          const envelope = (() => { try { return JSON.parse(reply); } catch { throw new HttpError(400, "Coach did not return a valid plan proposal. Nothing was applied; retry."); } })();
          if (!envelope || typeof envelope.reply !== "string" || !(envelope.planJson === null || typeof envelope.planJson === "string") || Object.keys(envelope).sort().join(",") !== "planJson,reply") throw new HttpError(400, "Coach returned an invalid proposal. Nothing was applied.");
          identity.assertActive?.();
          if (abort.signal.aborted || !store.get(id)) throw new HttpError(409, "This conversation changed. Ask again.");
          if (envelope.planJson !== null) await writeFile(join(s.home, turn.relative), envelope.planJson, { flag: "w", mode: 0o600 });
          const proposed = await candidates.finish(turn, true); turn = null;
          if (proposed) {
            if (abort.signal.aborted || !store.get(id)) { await candidates.dismiss(proposed.id); throw new HttpError(409, "The proposal request stopped. Ask again."); }
            try { identity.assertActive?.(); } catch (e) { await candidates.dismiss(proposed.id); throw e; }
            s.db.prepare("INSERT INTO hosted_proposals VALUES(?,?)").run(proposed.id, id);
            emit("notice", { text: "Plan preview ready. Today is unchanged; review it and choose Apply." });
          }
          reply = envelope.reply; emit("delta", { text: reply });
        }
        if (store.get(id)) {
          if (abort.signal.aborted) store.append(id, "error", "Reply stopped.");
          else { identity.assertActive?.(); store.append(id, "assistant", reply); }
        }
      } catch (e) {
        const problem = abort.signal.aborted ? "Reply stopped." : e instanceof HttpError ? e.message : "Reply unavailable. Try again after checking your connection.";
        if (store.get(id)) store.append(id, "error", problem);
        if (!abort.signal.aborted) emit("error", { message: problem });
      } finally {
        if (turn) await candidates.finish(turn, false);
        const stopped = abort.signal.aborted;
        abort.abort(); clearInterval(validity); active.delete(key); res.off("close", stop);
        // A misbehaving stand-in cannot keep its database lease or stream alive.
        void iterator?.return("").catch(() => {});
        emit("done", { aborted: stopped }); res.end();
      }
    });
  } };
}
