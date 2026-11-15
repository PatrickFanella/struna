import { HttpError } from "../http.ts";

export type Connection = { key: string; model: string };
export type ResponseTurn = Connection & { message: string; signal: AbortSignal; history?: { role: "user" | "assistant"; content: string }[] };
/** Safe recovery copy only. Never echo upstream bodies, headers, keys, URLs or fetch errors. */
export function providerProblem(status: number) {
  if (status === 401) return "OpenAI refused this key. Replace it with an active API key, then test again.";
  if (status === 403 || status === 404) return "OpenAI denied this model or project. Check the key's permissions and model name, then test again.";
  if (status === 429) return "OpenAI usage or rate limit reached. Check your provider billing and limits, wait, then retry.";
  if (status === 400) return "OpenAI could not use this request. Check the model name and its Responses API support, then retry.";
  return "OpenAI is unavailable. Wait and retry, or keep practicing without Coach.";
}

/** Fixed public endpoint; no environment credentials, CLI, endpoint setting, redirects or tools. */
export function responses(transport: typeof fetch = fetch) {
  return async function* ({ key, model, message, signal, history = [] }: ResponseTurn): AsyncGenerator<string> {
    const timeout = AbortSignal.timeout(90_000), combined = AbortSignal.any([signal, timeout]);
    let response: Response;
    try {
      response = await transport("https://api.openai.com/v1/responses", {
        method: "POST", redirect: "error", signal: combined,
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, store: false, stream: true, max_output_tokens: 2048,
          instructions: "You are an optional guitar practice coach. Answer the player's question using only this conversation. You cannot access files, change plans or run tools. Do not claim you have read their practice data.",
          input: [...history, { role: "user", content: message }],
        }),
      });
    } catch { throw new HttpError(502, "Could not reach OpenAI. Check network access and retry; your practice tools still work."); }
    if (!response.ok) { await response.body?.cancel(); throw new HttpError(502, providerProblem(response.status)); }
    if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
      await response.body?.cancel(); throw new HttpError(502, "OpenAI did not return a reply stream. Retry after checking the model.");
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "", size = 0, textSize = 0, complete = false;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        if (combined.aborted) throw new Error("stopped");
        size += next.value.length;
        if (size > 2_000_000) throw new Error("reply too large");
        buffer += next.value.replace(/\r/g, "");
        let end: number;
        while ((end = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const data = block.split("\n").filter(s => s.startsWith("data:")).map(s => s.slice(5).trimStart()).join("\n");
          if (!data || data === "[DONE]") continue;
          const event = JSON.parse(data);
          if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
            textSize += event.delta.length; if (textSize > 100_000) throw new Error("reply too large");
            yield event.delta;
          } else if (event.type === "response.completed" && event.response?.status === "completed") complete = true;
          else if (["error", "response.failed", "response.incomplete"].includes(event.type)) throw new Error("provider failed");
        }
        if (complete) break;
      }
      if (!complete || !textSize) throw new Error("incomplete reply");
    } catch {
      throw new HttpError(502, "OpenAI's reply stopped or was incomplete. Check your connection and provider limits, then retry.");
    } finally { await reader.cancel().catch(() => {}); }
  };
}
