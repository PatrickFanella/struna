import { chmodSync, rmSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";

import { chatRoutes } from "./chat.ts";
import { coachOnceRoutes } from "./coach-once.ts";
import { config } from "./config.ts";
import { conversations } from "./conversations.ts";
import { openDb } from "./db.ts";
import { fail, guard, HttpError, match, NOINDEX, route, send } from "./http.ts";
import { genericCoach } from "./generic/coach.ts";
import { materialsRoutes } from "./generic/materials.ts";
import { promptRoutes } from "./generic/prompts.ts";
import { genericRoutes } from "./generic/routes.ts";
import { ensureStudio, type Studio } from "./generic/studio.ts";
import type { AppInfo } from "./generic/types.ts";
import { practiceRoutes } from "./practice.ts";
import { mediaRoutes } from "./library/media.ts";
import { libraryRoutes } from "./library/routes.ts";
import { recordingRoutes } from "./recordings.ts";
import { tabsRoutes } from "./tabs.ts";

export const db = openDb(config.stateDir);

route("GET", "/api/health", (_req, res) => send(res, 200, { ok: true }));
if (config.mode === "generic") {
  // One studio folder instead of the vault: the profile, the plan, logs, materials and recordings.
  await ensureStudio(config.home);
  const studio: Studio = { home: config.home, db, timeZone: config.timeZone, libraryDirs: config.libraryDirs, web: config.coachWeb, appName: config.appName };
  genericRoutes(studio, { tabs: Boolean(config.tabsDir) });
  materialsRoutes(studio, { cacheDir: config.cacheDir });
  recordingRoutes({ mediaRoot: config.home, timeZone: config.timeZone });
  chatRoutes(genericCoach(studio), db, conversations(db));
  if (config.tabsDir) tabsRoutes({ root: config.tabsDir, autoScan: !process.env.GUITAR_NO_SCAN }, db);
} else {
  const info: AppInfo = { mode: "personal", name: config.appName, sections: ["practice", "library", "tabs"], web: false, profile: true };
  route("GET", "/api/app", (_req, res) => send(res, 200, info));
  practiceRoutes(config, db);
  recordingRoutes(config);
  chatRoutes(config, db, conversations(db));
  coachOnceRoutes(config, db);
  const tabs = tabsRoutes({ ...config, autoScan: !process.env.GUITAR_NO_SCAN }, db);
  libraryRoutes({ ...config, autoScan: !process.env.GUITAR_NO_SCAN, onScan: () => tabs.rescan() }, db);
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
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".otf": "font/otf",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".sf2": "application/octet-stream",
};

const dist = join(import.meta.dirname, "..", "dist");

async function serveStatic(path: string, res: ServerResponse) {
  let file = normalize(join(dist, decodeURIComponent(path)));
  if (file !== dist && !file.startsWith(dist + sep)) throw new HttpError(404, "not found");
  if (!(await stat(file).catch(() => undefined))?.isFile()) file = join(dist, "index.html");
  const data = await readFile(file).catch(() => undefined);
  if (!data) throw new HttpError(404, "build the web app first: pnpm build");
  const immutable = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "x-robots-tag": NOINDEX,
  });
  res.end(data);
}

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    guard(req, config);
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    // A custom header forces a CORS preflight, which this server never answers.
    if (method !== "GET" && method !== "HEAD" && req.headers["x-guitar-room"] !== "1") throw new HttpError(403, "missing app header");
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
    console.log(`guitar-room on ${where}`);
    if (config.mode === "generic") {
      console.log(`  studio ${config.home}`);
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
