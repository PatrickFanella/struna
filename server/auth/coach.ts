import type { Studio } from "../generic/studio.ts";
import { conversations } from "../conversations.ts";
import { promptRoutes } from "../generic/prompts.ts";
import { HttpError, readJson, send, type route } from "../http.ts";
import type { PracticeIdentity } from "./practice.ts";

/** A deliberately injected offline runner. Hosted inference is wired separately in #97. */
export type HostedReply = (input: { message: string; signal: AbortSignal }) => AsyncGenerator<string>;
export function accountCoach(run?: HostedReply) {
  const active = new Map<string, { session: string; abort: AbortController }>();
  const revoke = (session: string) => { for (const work of active.values()) if (work.session === session) work.abort.abort(); };
  const revokeAccount = (account: string) => { for (const [id, work] of active) if (id.startsWith(account + ":")) work.abort.abort(); };
  return { revoke, revokeAccount, register(s: Studio, identity: PracticeIdentity, register: typeof route) {
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
    register("POST", "/api/chat", async (req, res) => {
      const body = await readJson(req);
      if (body.provider !== "openai") throw new HttpError(400, "Hosted Coach supports only a player-owned OpenAI API connection");
      if (body.images || body.attachments) throw new HttpError(400, "Hosted attachments are not enabled");
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message || message.length > 20000) throw new HttpError(400, "Enter a message of at most 20000 characters");
      const previous = body.conversation ? find(String(body.conversation)) : null;
      if (!run) throw new HttpError(503, "Connect your AI is not enabled yet. Practice tools remain available.");
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
        store.append(id, "user", message);
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" });
        emit("conversation", { id });
        let reply = "";
        iterator = run({ message, signal: abort.signal });
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
      } catch {
        if (store.get(id)) store.append(id, "error", "Reply unavailable. Try again after checking your connection.");
        emit("error", { message: "Reply unavailable. Try again after checking your connection." });
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
