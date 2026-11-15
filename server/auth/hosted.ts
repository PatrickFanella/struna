import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as oidc from "openid-client";
import type { Config } from "../config.ts";
import { HttpError, readJson, send } from "../http.ts";
import type { AppInfo } from "../generic/types.ts";

export const hostedInfo: AppInfo = { mode: "hosted", name: "Struna", sections: ["practice"], web: false, profile: false };
const SESSION = "__Host-struna-session", FLOW = "__Host-struna-login";
const DAY = 86_400_000;
const random = () => randomBytes(32).toString("base64url");
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const csrf = (token: string) => createHmac("sha256", token).update("struna-csrf-v1").digest("base64url");
const equal = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
function cookie(req: IncomingMessage, key: string): string {
  const values = (req.headers.cookie ?? "").split(";").map((s) => s.trim()).filter((s) => s.startsWith(`${key}=`));
  return values.length === 1 ? values[0]!.slice(key.length + 1) : "";
}
function setCookie(name: string, value: string, seconds: number) {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
}
/** Return only app-owned hash destinations. Never redirect to a browser-supplied host/path. */
export function returnTo(v: unknown): string {
  return typeof v === "string" && /^#(?:practice|materials|coach)$/.test(v) ? `/${v}` : "/#practice";
}
export type IdentityAdapter = {
  issuer: string;
  begin: (state: string, nonce: string, verifier: string) => Promise<string>;
  finish: (url: URL, state: string, nonce: string, verifier: string) => Promise<{ subject: string }>;
};
export async function oidcAdapter(issuer: string, clientId: string, secret: string, origin: string): Promise<IdentityAdapter> {
  const config = await oidc.discovery(new URL(issuer), clientId, secret);
  const redirect_uri = `${origin}/auth/callback`;
  return {
    issuer,
    async begin(state, nonce, verifier) {
      return oidc.buildAuthorizationUrl(config, { redirect_uri, scope: "openid", response_type: "code", state, nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256", prompt: "select_account" }).href;
    },
    async finish(url, state, nonce, verifier) {
      const tokens = await oidc.authorizationCodeGrant(config, url, { expectedState: state, expectedNonce: nonce, pkceCodeVerifier: verifier, idTokenExpected: true });
      const subject = tokens.claims()?.sub;
      if (!subject) throw new Error("Missing verified subject");
      return { subject };
    },
  };
}

/** No owner routes are registered in hosted mode. This boundary handles auth and denies all private APIs. */
export function createHostedAuth({ stateDir, origin, adapter, now = Date.now }: {
  stateDir: string; origin: string; adapter: IdentityAdapter; now?: () => number;
}) {
  if (new URL(origin).origin !== origin || !origin.startsWith("https://")) throw new Error("Hosted origin must be an exact HTTPS origin");
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const file = join(stateDir, "identity.sqlite");
  const db = new DatabaseSync(file); chmodSync(file, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, UNIQUE(issuer, subject));
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, account TEXT NOT NULL, created INTEGER NOT NULL, touched INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS attempts(hash TEXT PRIMARY KEY, state TEXT NOT NULL, nonce TEXT NOT NULL, verifier TEXT NOT NULL, destination TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS rate(hash TEXT PRIMARY KEY, started INTEGER NOT NULL, count INTEGER NOT NULL);`);
  function session(req: IncomingMessage) {
    const token = cookie(req, SESSION);
    const row = db.prepare(`SELECT s.*, a.disabled FROM sessions s JOIN accounts a ON a.id=s.account WHERE s.hash=?`).get(hash(token)) as
      { hash: string; account: string; created: number; touched: number; revoked: number; disabled: number } | undefined;
    if (!row || row.revoked || row.disabled || now() - row.created >= 30 * DAY || now() - row.touched >= 7 * DAY) return null;
    db.prepare("UPDATE sessions SET touched=? WHERE hash=?").run(now(), row.hash);
    return { account: row.account, token, hash: row.hash };
  }
  function mutation(req: IncomingMessage) {
    if (req.headers.origin !== origin || req.headers["x-struna"] !== "1") throw new HttpError(403, "Use this app on its own origin");
  }
  function rate(req: IncomingMessage) {
    // Ignore forwarded client headers; proxy deployments need an edge limiter as well.
    const key = hash(req.socket.remoteAddress ?? "unknown");
    db.prepare("DELETE FROM rate WHERE started < ?").run(now() - 600_000);
    db.prepare("INSERT INTO rate VALUES(?, ?, 1) ON CONFLICT(hash) DO UPDATE SET count=count+1").run(key, now());
    const row = db.prepare("SELECT count FROM rate WHERE hash=?").get(key) as { count: number };
    if (row.count > 30) throw new HttpError(429, "Too many sign-in attempts. Try again in ten minutes.");
  }
  return {
    close: () => db.close(),
    async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
      res.setHeader("cache-control", "no-store");
      res.setHeader("referrer-policy", "no-referrer");
      const method = req.method ?? "GET", path = url.pathname;
      if (method === "GET" && path === "/api/account") {
        const current = session(req);
        send(res, 200, current ? { signedIn: true, account: current.account, csrf: csrf(current.token) } : { signedIn: false }); return true;
      }
      if (method === "POST" && path === "/auth/login") {
        mutation(req); rate(req);
        const body = await readJson(req);
        db.prepare("DELETE FROM attempts WHERE created < ?").run(now() - 600_000);
        const count = db.prepare("SELECT count(*) AS n FROM attempts").get() as { n: number };
        if (count.n >= 1000) throw new HttpError(429, "Sign-in is busy. Try again later.");
        const token = random(), state = random(), nonce = random(), verifier = oidc.randomPKCECodeVerifier();
        const destination = returnTo(body.returnTo);
        const redirect = await adapter.begin(state, nonce, verifier);
        db.prepare("INSERT INTO attempts VALUES(?, ?, ?, ?, ?, ?)").run(hash(token), state, nonce, verifier, destination, now());
        res.setHeader("set-cookie", setCookie(FLOW, token, 600));
        send(res, 200, { redirect }); return true;
      }
      if (method === "GET" && path === "/auth/callback") {
        rate(req);
        const flow = hash(cookie(req, FLOW));
        const attempt = db.prepare("SELECT * FROM attempts WHERE hash=?").get(flow) as
          { state: string; nonce: string; verifier: string; destination: string; created: number } | undefined;
        db.prepare("DELETE FROM attempts WHERE hash=?").run(flow);
        res.setHeader("set-cookie", setCookie(FLOW, "", 0));
        if (!attempt || now() - attempt.created >= 600_000 || url.searchParams.get("state") !== attempt.state) throw new HttpError(400, "Sign-in expired or did not match this browser. Try again.");
        let identity: { subject: string };
        try { identity = await adapter.finish(new URL(url.pathname + url.search, origin), attempt.state, attempt.nonce, attempt.verifier); }
        catch { res.writeHead(303, { location: "/?signin=failed" }); res.end(); return true; }
        if (!identity.subject) throw new HttpError(400, "Sign-in failed");
        db.prepare("INSERT OR IGNORE INTO accounts(id, issuer, subject) VALUES(?, ?, ?)").run(randomUUID(), adapter.issuer, identity.subject);
        const account = db.prepare("SELECT id, disabled FROM accounts WHERE issuer=? AND subject=?").get(adapter.issuer, identity.subject) as { id: string; disabled: number };
        if (account.disabled) throw new HttpError(403, "Account unavailable");
        db.prepare("UPDATE sessions SET revoked=1 WHERE hash=?").run(hash(cookie(req, SESSION)));
        const token = random();
        db.prepare("INSERT INTO sessions VALUES(?, ?, ?, ?, 0)").run(hash(token), account.id, now(), now());
        res.setHeader("set-cookie", [setCookie(FLOW, "", 0), setCookie(SESSION, token, 30 * 86400)]);
        res.writeHead(303, { location: attempt.destination }); res.end(); return true;
      }
      if (method === "POST" && path === "/auth/logout") {
        mutation(req);
        const current = session(req);
        if (!current) throw new HttpError(401, "Your session expired. Sign in again.");
        if (!equal(String(req.headers["x-csrf-token"] ?? ""), csrf(current.token))) throw new HttpError(403, "Invalid CSRF token");
        db.prepare("UPDATE sessions SET revoked=1 WHERE hash=?").run(current.hash);
        res.setHeader("set-cookie", setCookie(SESSION, "", 0)); send(res, 200, { signedIn: false }); return true;
      }
      if ((method === "GET" || method === "HEAD") && path === "/api/app") { send(res, 200, hostedInfo); return true; }
      if ((method === "GET" || method === "HEAD") && path === "/api/health") { send(res, 200, { ok: true }); return true; }
      // Only the public shell and build-owned assets pass to the static server.
      if ((method === "GET" || method === "HEAD") && (path === "/" || /^\/(?:assets|brand|starter)\/[a-zA-Z0-9_./-]+$/.test(path) || path === "/manifest.webmanifest")) return false;
      if (!session(req)) throw new HttpError(401, "Sign in to your private account");
      throw new HttpError(503, "Private practice is not enabled yet");
    },
  };
}
export async function hostedAuth(config: Config) {
  if (!config.hostedOrigin || !config.oidcIssuer || !config.oidcClientId || !config.oidcSecretFile) throw new Error("Hosted mode requires an HTTPS origin and a configured OIDC issuer, client id and secret file; public practice remains disabled");
  const adapter = await oidcAdapter(config.oidcIssuer, config.oidcClientId, readFileSync(config.oidcSecretFile, "utf8").trim(), config.hostedOrigin);
  return createHostedAuth({ stateDir: config.stateDir, origin: config.hostedOrigin, adapter });
}
