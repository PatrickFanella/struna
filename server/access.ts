import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";

import { HttpError, NOINDEX } from "./http.ts";

/**
 * An access token for a server on loopback TCP with no login in front of it (the generic mode run
 * by hand or by its example unit). Any local account, and any container on the host network, can
 * reach such a port, so the Host check alone does not keep them out. The token is created once in
 * the state folder (mode 600); opening the printed `/?token=…` address stores it in an HttpOnly,
 * SameSite=Strict cookie, and every request after that must carry the cookie (or the
 * `x-guitar-room-token` header, for scripts).
 */
export type Access = { token: string; cookie: string };

export const TOKEN_FILE = "access-token";

/** The token in `stateDir`, created on first use. */
export function loadAccess(stateDir: string, port: number): Access {
  const file = join(stateDir, TOKEN_FILE);
  let token = "";
  try {
    token = readFileSync(file, "utf8").trim();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  if (!/^[0-9a-f]{64}$/.test(token)) {
    token = randomBytes(32).toString("hex");
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    writeFileSync(file, `${token}\n`, { mode: 0o600 });
  }
  chmodSync(file, 0o600);
  // Cookies are kept per host, not per port: name it by the port so two servers do not overwrite each other's.
  return { token, cookie: `guitar_room_${port}` };
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function cookieValue(req: IncomingMessage, name: string): string {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

const attr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const page = (res: ServerResponse, status: number, headers: Record<string, string>, html: string) => {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": NOINDEX, "referrer-policy": "no-referrer", ...headers });
  res.end(html);
};

/**
 * Let the request through (false), answer it here (true: the token was just stored), or refuse it.
 * The health check stays open, so start-up scripts can wait for the server without the token.
 */
export function checkAccess(req: IncomingMessage, res: ServerResponse, url: URL, a: Access): boolean {
  if (url.pathname === "/api/health") return false;
  const header = req.headers["x-guitar-room-token"];
  if (same(cookieValue(req, a.cookie), a.token) || (typeof header === "string" && same(header, a.token))) return false;
  const given = url.searchParams.get("token");
  const method = req.method ?? "GET";
  if (given !== null && (method === "GET" || method === "HEAD") && !url.pathname.startsWith("/api/")) {
    if (!same(given, a.token)) throw new HttpError(403, "that access link is not valid for this server");
    url.searchParams.delete("token");
    const to = `${url.pathname}${url.search}${url.hash}`;
    // A page, not a redirect: a SameSite=Strict cookie is not sent on a redirect that began on another
    // site, but it is on a navigation this page starts.
    page(
      res,
      200,
      { "set-cookie": `${a.cookie}=${a.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000` },
      `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${attr(to)}"><title>Guitar Room</title><script>location.replace(${JSON.stringify(to).replace(/</g, "\\u003c")})</script><p>Opening the app…</p>`,
    );
    return true;
  }
  if (url.pathname.startsWith("/api/") || (method !== "GET" && method !== "HEAD")) throw new HttpError(403, "this server needs its access link: open the address it printed when it started");
  page(
    res,
    403,
    {},
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Guitar Room</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 16px"><h1>Open the access link</h1><p>This server only answers browsers that have opened its access link once. The link was printed when the server started; it ends in <code>?token=</code> followed by the contents of the <code>${TOKEN_FILE}</code> file in the app's state folder.</p></body>`,
  );
  return true;
}
