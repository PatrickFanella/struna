import { chmodSync, rmSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { extname, join, normalize, sep } from "node:path";

import { type Access, checkAccess, loadAccess, TOKEN_FILE } from "./access.ts";
import { chatRoutes } from "./chat.ts";
import { coachOnceRoutes } from "./coach-once.ts";
import { config } from "./config.ts";
import { conversations } from "./conversations.ts";
import { openDb } from "./db.ts";
import { fail, guard, HttpError, match, NOINDEX, route, send } from "./http.ts";
import { candidateRoutes, planCandidates } from "./generic/planCandidates.ts";
import { probePlanSandbox } from "./generic/planSandbox.ts";
import { genericCoach } from "./generic/coach.ts";
import { chatImageRoutes } from "./generic/chat-images.ts";
import { credentialStore, placementProblem } from "./generic/credentials.ts";
import { coachPolicy, locallyHosted, providerRoutes } from "./generic/providers.ts";
import { materialsRoutes } from "./generic/materials.ts";
import { promptRoutes } from "./generic/prompts.ts";
import { genericAppInfo, genericRoutes } from "./generic/routes.ts";
import { ensureStudio, type Studio } from "./generic/studio.ts";
import type { AppInfo } from "./generic/types.ts";
import { practiceRoutes } from "./practice.ts";
import { mediaRoutes } from "./library/media.ts";
import { libraryRoutes } from "./library/routes.ts";
import { recordingRoutes } from "./recordings.ts";
import { codexInstallDir } from "./providers/codex.ts";
import { tabsRoutes } from "./tabs.ts";

export const db = openDb(config.stateDir);
/**
 * The studio mode on loopback TCP with no edge secret has no login in front of it: other local
 * accounts and host-network containers could reach the port. It then needs its access token.
 * The personal mode, a Unix socket (owner-only directory) and the edge-secret deployment do not.
 */
export const access: Access | null = config.mode === "studio" && !config.edgeSecret && !config.socket ? loadAccess(config.stateDir, config.port) : null;

route("GET", "/api/health", (_req, res) => send(res, 200, { ok: true }));
/** What `/api/app` answers; also written into index.html, so the first paint needs no extra round trip. */
let appInfo: () => Promise<AppInfo>;
if (config.mode === "studio") {
  // One studio folder instead of the vault: the profile, the plan, logs, materials and recordings.
  await ensureStudio(config.home);
  // The coach reads the studio and the library folders: the saved keys and the coaches' own logins must be elsewhere.
  const misplaced = placementProblem({ stateDir: config.stateDir, studio: config.home, libraryDirs: config.libraryDirs, home: homedir() });
  if (misplaced) throw new Error(misplaced);
  const studio: Studio = { home: config.home, db, timeZone: config.timeZone, libraryDirs: config.libraryDirs, web: config.coachWeb, appName: config.appName };
  const candidates = planCandidates(studio);
  await candidates.recover();
  candidateRoutes(candidates);
  genericRoutes(studio, { tabs: Boolean(config.tabsDir) });
  appInfo = () => genericAppInfo(studio, { tabs: Boolean(config.tabsDir) });
  materialsRoutes(studio, { cacheDir: config.cacheDir });
  chatImageRoutes(config.cacheDir);
  recordingRoutes({ mediaRoot: config.home, timeZone: config.timeZone });
  // Codex's sandbox must read its own install folder; with it known, commands cannot read outside the studio.
  const codexInstall = await codexInstallDir(config.codexBin).catch(() => null);
  if (!codexInstall) console.warn(`Could not find where ${config.codexBin} is installed, so Codex's sandbox could not keep it from reading the saved keys and logins: every Codex coach is turned off. Set CODEX_BIN to the Codex binary's full path.`);
  const store = credentialStore(config.stateDir);
  // Locally hosted: loopback TCP with the access token and no sign of a proxy in front, so the player is whoever runs the server.
  const policy = coachPolicy({
    local: locallyHosted({ access: access !== null, host: config.host, allowedHosts: config.allowedHosts, requireUser: config.requireUser }),
    codexSandboxed: Boolean(codexInstall),
    hostLogins: config.coachHostLogins,
    deviceSignIn: config.coachDeviceSignIn,
    requireUser: Boolean(config.requireUser),
    privateEndpoints: config.coachPrivateEndpoints,
    budgetUsd: config.coachMaxBudgetUsd,
  });
  const probes = await Promise.all([probePlanSandbox(config.claudeBin), probePlanSandbox(config.codexBin)]);
  policy.planSandbox = { claude: probes[0]!, codex: probes[1]! };
  const convs = conversations(db);
  chatRoutes(genericCoach(studio, {}, { codexInstall, store, policy, candidates }), db, convs);
  const coaches = providerRoutes({ store, policy, web: studio.web }, convs);
  // A running ChatGPT sign-in must not outlive the server.
  process.on("exit", coaches.stop);
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => process.exit(sig === "SIGINT" ? 130 : 143));
  if (config.tabsDir) tabsRoutes({ root: config.tabsDir, autoScan: !config.noScan }, db);
} else {
  const info: AppInfo = { mode: "personal", name: config.appName, sections: ["practice", "library", "tabs"], web: false, profile: true };
  route("GET", "/api/app", (_req, res) => send(res, 200, info));
  appInfo = async () => info;
  practiceRoutes(config, db);
  recordingRoutes(config);
  chatRoutes(config, db, conversations(db));
  coachOnceRoutes(config, db);
  const tabs = tabsRoutes({ ...config, autoScan: !config.noScan }, db);
  libraryRoutes({ ...config, autoScan: !config.noScan, onScan: () => tabs.rescan() }, db);
  mediaRoutes(config, db);
}
promptRoutes(db, config.mode);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".otf": "font/otf",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".sf2": "application/octet-stream",
};

const dist = join(import.meta.dirname, "..", "dist");

async function serveStatic(path: string, res: ServerResponse) {
  let file = normalize(join(dist, decodeURIComponent(path)));
  if (file !== dist && !file.startsWith(dist + sep)) throw new HttpError(404, "not found");
  if (!(await stat(file).catch(() => undefined))?.isFile()) file = join(dist, "index.html");
  let data = await readFile(file).catch(() => undefined);
  if (!data) throw new HttpError(404, "build the web app first: pnpm build");
  if (file === join(dist, "index.html")) data = Buffer.from(withAppInfo(data.toString(), await appInfo()));
  const immutable = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "x-robots-tag": NOINDEX,
  });
  res.end(data);
}

/** index.html with the app info in a JSON script tag (`<` escaped, so the text cannot end the tag). */
export function withAppInfo(html: string, info: AppInfo): string {
  const tag = `<script id="app-info" type="application/json">${JSON.stringify(info).replace(/</g, "\\u003c")}</script>`;
  return html.includes("</head>") ? html.replace("</head>", `${tag}\n</head>`) : `${tag}${html}`;
}

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    guard(req, config);
    const url = new URL(req.url ?? "/", "http://localhost");
    if (access && checkAccess(req, res, url, access)) return;
    const method = req.method ?? "GET";
    // A custom header forces a CORS preflight, which this server never answers.
    if (method !== "GET" && method !== "HEAD" && req.headers["x-struna"] !== "1" && req.headers["x-guitar-room"] !== "1") throw new HttpError(403, "missing app header");
    const found = match(method === "HEAD" ? "GET" : method, url.pathname);
    if (found) {
      await found.handler(req, res, { url, params: found.params });
      return;
    }
    if (url.pathname.startsWith("/api/")) throw new HttpError(404, "not found");
    if (config.production && (method === "GET" || method === "HEAD")) return await serveStatic(url.pathname, res);
    throw new HttpError(404, "not found");
  } catch (e) {
    fail(res, e);
  }
}

if (import.meta.main) {
  const server = createServer(handle);
  const started = (where: string) => () => {
    console.log(`struna on ${where}`);
    if (config.mode === "studio") {
      console.log(`  studio ${config.home}`);
      if (access) {
        const link = `http://${config.host === "127.0.0.1" || config.host === "::1" ? "localhost" : config.host}:${config.port}/?token=`;
        // The token is a secret: print it only to a terminal, never into a service's journal.
        if (process.stdout.isTTY) console.log(`  open ${link}${access.token}`);
        else console.log(`  open ${link}$(cat ${join(config.stateDir, TOKEN_FILE)})`);
      }
      return;
    }
    console.log(`  vault ${config.practiceDir}`);
    console.log(`  media ${config.mediaRoot}`);
  };
  if (config.socket) {
    // A Unix socket in an owner-only directory: other local accounts cannot connect,
    // unlike a loopback TCP port. The Almaz tunnel forwards to it over SSH.
    const sock = config.socket;
    rmSync(sock, { force: true });
    const old = process.umask(0o177);
    server.listen(sock, () => {
      process.umask(old);
      chmodSync(sock, 0o600);
      started(`unix:${sock}`)();
    });
  } else {
    server.listen(config.port, config.host, started(`http://${config.host}:${config.port}`));
  }
}
