/** Deterministic local HTTP Responses stand-in. No environment credentials or external requests. */
import assert from "node:assert/strict";
import { createServer } from "node:http";

export async function offlineResponses(delayMs = 1000) {
  let failNext = 0;
  const requests: { authorization: string; body: any }[] = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString()), authorization = String(req.headers.authorization);
    requests.push({ authorization, body });
    const failure = failNext || (/^fail-/.test(body.model) ? Number(body.model.slice(5)) : 0); failNext = 0;
    if (failure) { res.writeHead(failure, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: authorization } })); return; }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const event = (v: unknown) => res.write(`data: ${JSON.stringify(v)}\n\n`);
    event({ type: "response.output_text.delta", delta: "Offline " });
    if (body.model === "slow-model") { await new Promise<void>(r => { const t = setTimeout(r,delayMs);res.once("close",()=>{clearTimeout(t);r();}); }); }
    if (res.destroyed) return;
    event({ type: "response.output_text.delta", delta: "answer" });
    if (body.model !== "incomplete-model") event({ type: "response.completed", response: { status: "completed" } });
    res.end();
  });
  await new Promise<void>(r => server.listen(0,"127.0.0.1",r));
  const base = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const transport: typeof fetch = (url, init) => {
    assert.equal(url,"https://api.openai.com/v1/responses");
    return fetch(base+"/v1/responses",init);
  };
  return { transport, requests, rejectNext: (status: number) => { failNext = status; }, async close() { await new Promise<void>(r=>server.close(()=>r())); } };
}
