import type { IncomingMessage, ServerResponse } from "node:http";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const NOINDEX = "noindex, nofollow";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Reject requests for unknown hosts, and, when `requireUser` is set, requests for a
 * public host that Authelia did not sign in as that user. Loopback host names are
 * only reachable on Kvant itself; the Almaz route always carries the public host.
 */
export function guard(req: IncomingMessage, opts: { allowedHosts: Set<string>; requireUser?: string | undefined }): void {
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  if (!opts.allowedHosts.has(host)) throw new HttpError(403, "host not allowed");
  if (opts.requireUser && !LOOPBACK.has(host) && req.headers["remote-user"] !== opts.requireUser) throw new HttpError(403, "user not allowed");
}

export function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": NOINDEX });
  res.end(JSON.stringify(body));
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, "request too large");
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req: IncomingMessage): Promise<any> {
  const raw = (await readBody(req, 1_000_000)).toString();
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

export type Handler = (req: IncomingMessage, res: ServerResponse, ctx: { url: URL; params: Record<string, string> }) => unknown;

type Route = { method: string; parts: string[]; handler: Handler };
const routes: Route[] = [];

/** Register a route. Path segments starting with `:` capture a parameter. */
export function route(method: string, path: string, handler: Handler): void {
  routes.push({ method, parts: path.split("/"), handler });
}

export function match(method: string, path: string): { handler: Handler; params: Record<string, string> } | undefined {
  const parts = path.split("/");
  for (const r of routes) {
    if (r.method !== method || r.parts.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const want = r.parts[i]!;
      const got = parts[i]!;
      if (want.startsWith(":")) params[want.slice(1)] = decodeURIComponent(got);
      else if (want !== got) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler: r.handler, params };
  }
  return undefined;
}

export function fail(res: ServerResponse, e: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const status = e instanceof HttpError ? e.status : typeof (e as any)?.status === "number" ? (e as any).status : 500;
  if (status === 500) console.error(e);
  send(res, status, { error: e instanceof Error ? e.message : String(e) });
}
