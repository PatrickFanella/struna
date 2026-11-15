import { practiceContext } from "./context.ts";
import { responses } from "./responses.ts";
import type { Connection } from "./responses.ts";
import type { Studio } from "../generic/studio.ts";
import { conversations } from "../conversations.ts";
import { promptRoutes } from "../generic/prompts.ts";
import { HttpError, readJson, send, type route } from "../http.ts";
import type { PracticeIdentity } from "./practice.ts";

/** Optional offline runner for ownership tests; normal hosted inference uses the direct Responses adapter. */
export type HostedReply = (input: { message: string; signal: AbortSignal }) => AsyncGenerator<string>;
export function accountCoach(run?: HostedReply, transport?: typeof fetch) {
  const infer = responses(transport);
  const active = new Map<string, { session: string; abort: AbortController }>();
  const revoke = (session: string) => { for (const work of active.values()) if (work.session === session) work.abort.abort(); };
  const revokeAccount = (account: string) => { for (const [id, work] of active) if (id.startsWith(account + ":")) work.abort.abort(); };
  return { revoke, revokeAccount, isBusy: (account: string) => [...active.keys()].some(id => id.startsWith(account + ":")), register(s: Studio, identity: PracticeIdentity, register: typeof route, connection: () => Connection) {
    const store = conversations(s.db);
    promptRoutes(s.db, "studio", register);
    const find = (id: string) => { const c = store.get(id); if (!c) throw new HttpError(404, "Conversation not found"); return c; };
    register("GET", "/api/conversations", (_req, res) => send(res, 200, store.list()));
    register("GET", "/api/conversations/:id", (_req, res, { params }) => send(res, 200, find(params.id!)));
    register("PATCH", "/api/conversations/:id", async (req, res, { params }) => {
      find(params.id!); const body = await readJson(req);
      store.rename(params.id!, typeof body.title === "string" ? body.title : "Untitled"); send(res, 200, { ok: true });
    });
    register("DELETE", "/api/conversations/:id", (_req, res, { params }) => {
      find(params.id!); active.get(`${identity.account}:${params.id}`)?.abort.abort();
      store.remove(params.id!); send(res, 200, { ok: true });
    });
    register("POST", "/api/chat/context", async (req, res) => {
      const context = await practiceContext(s, await readJson(req));
      identity.assertActive?.(); send(res, 200, context);
    });
    register("POST", "/api/chat", async (req, res) => {
      const body = await readJson(req);
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
      const abort = new AbortController();
      active.set(key, { session: identity.session, abort });
      const emit = (event: string, data: unknown) => { if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
      const stop = () => abort.abort();
      res.on("close", stop);
      // Expiry/disabled-account checks also stop work without a subsequent browser request.
      const validity = setInterval(() => { try { identity.assertActive?.(); } catch { abort.abort(); } }, 250);
      const ended = new Promise<null>((resolve) => abort.signal.addEventListener("abort", () => resolve(null), { once: true }));
      let iterator: AsyncGenerator<string> | undefined;
      try {
        identity.assertActive?.();
        store.append(id, "user", providerMessage);
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" });
        emit("conversation", { id });
        if (context) emit("context", context);
        let reply = "";
        const history = (previous?.messages ?? []).filter(m => m.role === "user" || m.role === "assistant").slice(-20).map(m => ({ role: m.role as "user" | "assistant", content: m.text.slice(0, 20000) }));
        iterator = run ? run({ message: providerMessage, signal: abort.signal }) : infer({ ...credential!, message: providerMessage, history, signal: abort.signal });
        for (;;) {
          const next = await Promise.race([iterator.next(), ended]);
          if (!next || abort.signal.aborted) break;
          identity.assertActive?.();
          if (next.done) break;
          reply += next.value; emit("delta", { text: next.value });
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
        const stopped = abort.signal.aborted;
        abort.abort(); clearInterval(validity); active.delete(key); res.off("close", stop);
        // A misbehaving stand-in cannot keep its database lease or stream alive.
        void iterator?.return("").catch(() => {});
        emit("done", { aborted: stopped }); res.end();
      }
    });
  } };
}
