import type { hostedPractice } from "./practice.ts";
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
const SESSION = "__Host-struna-session", FLOW = "__Host-struna-login", RATE = "__Host-struna-rate";
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
  return typeof v === "string" && /^#(?:practice|materials|coach|guest-import)$/.test(v) ? `/${v}` : "/#practice";
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

/** No owner routes are registered in hosted mode. Only explicitly ported practice handlers can receive verified identity. */
export function createHostedAuth({ stateDir, origin, adapter, practice, now = Date.now }: {
  stateDir: string; origin: string; adapter: IdentityAdapter; practice?: ReturnType<typeof hostedPractice> | undefined; now?: () => number;
}) {
  if (new URL(origin).origin !== origin || !origin.startsWith("https://")) throw new Error("Hosted origin must be an exact HTTPS origin");
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const file = join(stateDir, "identity.sqlite");
  const db = new DatabaseSync(file); chmodSync(file, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, UNIQUE(issuer, subject));
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, account TEXT NOT NULL, created INTEGER NOT NULL, touched INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS attempts(hash TEXT PRIMARY KEY, state TEXT NOT NULL, nonce TEXT NOT NULL, verifier TEXT NOT NULL, destination TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS guest_handoffs(id TEXT PRIMARY KEY, flow TEXT NOT NULL, account TEXT, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS account_deletions(account TEXT PRIMARY KEY, receipt TEXT NOT NULL UNIQUE, requested INTEGER NOT NULL, completed INTEGER);
    CREATE TABLE IF NOT EXISTS rate(hash TEXT PRIMARY KEY, started INTEGER NOT NULL, count INTEGER NOT NULL);`);
  const deletionWork = new Map<string, Promise<void>>();
  function removeAccount(account: string): Promise<void> {
    const prior = deletionWork.get(account);
    if (prior) return prior;
    const work = (async () => {
      if (!practice) throw new HttpError(503, "Private practice is not enabled yet");
      await practice.removeAccount(account);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM sessions WHERE account=?").run(account);
        db.prepare("DELETE FROM guest_handoffs WHERE account=?").run(account);
        db.prepare("DELETE FROM accounts WHERE id=?").run(account);
        db.prepare("UPDATE account_deletions SET completed=? WHERE account=?").run(now(), account);
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    })().finally(() => deletionWork.delete(account));
    deletionWork.set(account, work); return work;
  }
  // Recovery runs before any request can create a workspace or authenticate a deleted identity.
  const recovery = Promise.allSettled((db.prepare("SELECT account FROM account_deletions WHERE completed IS NULL").all() as { account: string }[]).map(row => removeAccount(row.account)));

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
  function rate(req: IncomingMessage): string {
    // A browser gets its own quota. A separate generous aggregate bounds cookieless churn;
    // never treat a reverse proxy address as one player's identity.
    const browser = cookie(req, RATE) || random();
    db.prepare("DELETE FROM rate WHERE started < ?").run(now() - 600_000);
    for (const [key, limit] of [["aggregate", 1000], [hash(browser), 30]] as const) {
      db.prepare("INSERT INTO rate VALUES(?, ?, 1) ON CONFLICT(hash) DO UPDATE SET count=count+1").run(key, now());
      const row = db.prepare("SELECT count FROM rate WHERE hash=?").get(key) as { count: number };
      if (row.count > limit) throw new HttpError(429, "Too many sign-in attempts. Try again in ten minutes.");
    }
    return browser;
  }
  return {
    close: () => db.close(),
    async info(req: IncomingMessage) {
      await recovery;
      const current = session(req);
      return current && practice ? practice.info({ account: current.account, session: current.hash, csrf: csrf(current.token) }) : Promise.resolve(hostedInfo);
    },
    async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
      await recovery;
      db.prepare("DELETE FROM account_deletions WHERE completed IS NOT NULL AND requested<?").run(now() - DAY);
      res.setHeader("cache-control", "no-store");
      res.setHeader("referrer-policy", "no-referrer");
      const method = req.method ?? "GET", path = url.pathname;
      if (method === "GET" && path === "/api/account") {
        const current = session(req);
        const token = cookie(req, SESSION);
        const deletion = db.prepare("SELECT 1 FROM account_deletions WHERE receipt=?").get(hash(token));
        if (!current && token && deletion) { send(res, 200, { signedIn: false, deletionPending: true, session: hash(token), csrf: csrf(token) }); return true; }
        send(res, 200, current ? { signedIn: true, account: current.account, session: current.hash, csrf: csrf(current.token) } : { signedIn: false }); return true;
      }
      if (method === "POST" && path === "/auth/login") {
        mutation(req); const browser = rate(req);
        const body = await readJson(req);
        db.prepare("DELETE FROM attempts WHERE created < ?").run(now() - 600_000);
        const count = db.prepare("SELECT count(*) AS n FROM attempts").get() as { n: number };
        if (count.n >= 1000) throw new HttpError(429, "Sign-in is busy. Try again later.");
        const token = random(), state = random(), nonce = random(), verifier = oidc.randomPKCECodeVerifier();
        const destination = returnTo(body.returnTo);
        if (body.handoff !== undefined && (typeof body.handoff !== "string" || !/^[a-f0-9-]{36}$/.test(body.handoff) || destination !== "/#guest-import")) throw new HttpError(400, "Invalid guest handoff");
        const redirect = await adapter.begin(state, nonce, verifier);
        db.prepare("INSERT INTO attempts VALUES(?, ?, ?, ?, ?, ?)").run(hash(token), state, nonce, verifier, destination, now());
        if (body.handoff) {
          db.prepare("DELETE FROM guest_handoffs WHERE account IS NULL AND created<?").run(now()-600_000);
          const prior = db.prepare("SELECT account FROM guest_handoffs WHERE id=?").get(body.handoff) as { account: string | null } | undefined;
          if (prior?.account) throw new HttpError(409, "This guest handoff already belongs to a private account");
          db.prepare("INSERT INTO guest_handoffs VALUES(?,?,NULL,?) ON CONFLICT(id) DO UPDATE SET flow=excluded.flow,created=excluded.created").run(body.handoff, hash(token), now());
        }
        res.setHeader("set-cookie", [setCookie(FLOW, token, 600), setCookie(RATE, browser, 600)]);
        send(res, 200, { redirect }); return true;
      }
      if (method === "GET" && path === "/auth/callback") {
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
        const prior = hash(cookie(req, SESSION));
        db.prepare("UPDATE sessions SET revoked=1 WHERE hash=?").run(prior); practice?.revoke(prior);
        db.prepare("UPDATE guest_handoffs SET account=?, flow='' WHERE flow=? AND account IS NULL").run(account.id, flow);
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
        db.prepare("UPDATE sessions SET revoked=1 WHERE hash=?").run(current.hash); practice?.revoke(current.hash);
        res.setHeader("set-cookie", setCookie(SESSION, "", 0)); send(res, 200, { signedIn: false }); return true;
      }
      if (method === "POST" && path === "/auth/delete-account") {
        mutation(req);
        const body = await readJson(req);
        if (!body || Object.keys(body).length !== 1 || body.confirm !== "DELETE" || url.search) throw new HttpError(400, "Type DELETE to confirm removal of this account");
        const token = cookie(req, SESSION), receipt = hash(token);
        if (!token || req.headers["x-struna-session"] !== receipt) throw new HttpError(409, "Your account changed. Reload before continuing.");
        if (!equal(String(req.headers["x-csrf-token"] ?? ""), csrf(token))) throw new HttpError(403, "Invalid CSRF token");
        const prior = db.prepare("SELECT account, completed FROM account_deletions WHERE receipt=?").get(receipt) as { account: string; completed: number | null } | undefined;
        if (prior) {
          if (prior.completed === null) await removeAccount(prior.account);
        } else {
          const current = session(req);
          if (!current) throw new HttpError(401, "Your session expired. Sign in again.");
          if (!practice) throw new HttpError(503, "Private practice is not enabled yet");
          db.exec("BEGIN IMMEDIATE");
          try {
            db.prepare("INSERT INTO account_deletions VALUES(?,?,?,NULL)").run(current.account, receipt, now());
            db.prepare("UPDATE accounts SET disabled=1 WHERE id=?").run(current.account);
            db.prepare("UPDATE sessions SET revoked=1 WHERE account=?").run(current.account);
            db.exec("COMMIT");
          } catch (e) { db.exec("ROLLBACK"); throw e; }
          const sessions = db.prepare("SELECT hash FROM sessions WHERE account=?").all(current.account) as { hash: string }[];
          for (const row of sessions) practice.revoke(row.hash);
          await removeAccount(current.account);
        }
        res.setHeader("set-cookie", setCookie(SESSION, "", 0));
        send(res, 200, { deleted: true }); return true;
      }
      if ((method === "GET" || method === "HEAD") && path === "/api/app") { send(res, 200, await this.info(req)); return true; }
      if ((method === "GET" || method === "HEAD") && path === "/api/health") { send(res, 200, { ok: true }); return true; }
      // Only the public shell and build-owned assets pass to the static server.
      if ((method === "GET" || method === "HEAD") && (path === "/" || /^\/(?:assets|brand|starter)\/[a-zA-Z0-9_./-]+$/.test(path) || path === "/manifest.webmanifest")) return false;
      // Consume a mutation before resolving identity: a delayed body cannot retain a revoked session.
      if (method !== "GET" && method !== "HEAD" && path !== "/api/materials/upload" && path !== "/api/recordings") await readJson(req);
      const current = session(req);
      if (!current) throw new HttpError(401, "Sign in to your private account");
      if (practice) {
        if ((req.headers["x-struna-session"] ?? ((method === "GET" || method === "HEAD") && ["/api/materials/file", "/api/recordings/file"].includes(path) ? url.searchParams.get("session") : undefined)) !== current.hash) throw new HttpError(409, "Your account changed. Reload before continuing.");
        if (method !== "GET" && method !== "HEAD") {
          mutation(req);
          if (!equal(String(req.headers["x-csrf-token"] ?? ""), csrf(current.token))) throw new HttpError(403, "Invalid CSRF token");
        }
        if (path.startsWith("/api/guest-import")) {
          const id = (method === "GET" || method === "HEAD") ? url.searchParams.get("id") : (await readJson(req)).id;
          const handoff = db.prepare("SELECT account FROM guest_handoffs WHERE id=?").get(typeof id === "string" ? id : "") as { account: string | null } | undefined;
          if (!handoff || handoff.account !== current.account) throw new HttpError(409, "This guest handoff belongs to another sign-in. Return to guest practice to continue locally.");
        }
        if (await practice.handle(req, res, url, { account: current.account, session: current.hash, csrf: csrf(current.token), assertActive: () => { if (session(req)?.hash !== current.hash) throw new HttpError(401, "Your session expired. Sign in again."); } })) return true;
      }
      throw new HttpError(503, "Private practice is not enabled yet");
    },
  };
}
export async function hostedAuth(config: Config, practice?: ReturnType<typeof hostedPractice>) {
  if (!config.hostedOrigin || !config.oidcIssuer || !config.oidcClientId || !config.oidcSecretFile) throw new Error("Hosted mode requires an HTTPS origin and a configured OIDC issuer, client id and secret file; public practice remains disabled");
  const adapter = await oidcAdapter(config.oidcIssuer, config.oidcClientId, readFileSync(config.oidcSecretFile, "utf8").trim(), config.hostedOrigin);
  return createHostedAuth({ stateDir: config.stateDir, origin: config.hostedOrigin, adapter, practice });
}
