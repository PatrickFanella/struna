import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const home = homedir();
const env = process.env;

if (env.GUITAR_MODE && env.GUITAR_MODE !== "personal" && env.GUITAR_MODE !== "generic") throw new Error(`GUITAR_MODE must be "personal" or "generic", not "${env.GUITAR_MODE}"`);
const mode: "personal" | "generic" = env.GUITAR_MODE === "generic" ? "generic" : "personal";
/** The generic mode keeps its own state and cache, so both modes can run on one machine. */
const suffix = mode === "generic" ? "guitar-room-generic" : "guitar-room";
const path = (p: string) => resolve(p === "~" || p.startsWith("~/") ? join(home, p.slice(1)) : p);

function timeZone(): string {
  const zone = env.GUITAR_TIMEZONE || (mode === "generic" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "America/Chicago");
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
  } catch {
    throw new Error(`GUITAR_TIMEZONE is not a time zone name: "${zone}"`);
  }
  return zone;
}

const vaultRoot = resolve(env.GUITAR_VAULT_ROOT ?? join(home, "Work/Vaults/Ars Malefica"));
const threadRel = env.GUITAR_THREAD ?? "001 Projects/Threads/Guitar";
const threadDir = join(vaultRoot, threadRel);

export const config = {
  mode,
  host: env.HOST ?? "127.0.0.1",
  port: Number(env.PORT ?? 5182),
  production: env.NODE_ENV === "production",
  allowedHosts: new Set(
    ["localhost", "127.0.0.1", "[::1]", ...(env.ALLOWED_HOSTS?.split(",") ?? [])].map((h) => h.trim()).filter(Boolean),
  ),
  requireUser: env.REQUIRE_USER || undefined,
  /** Shared with the Almaz Caddy site, which sends it as X-Edge-Secret after Authelia. */
  edgeSecret: env.EDGE_SECRET_FILE ? readFileSync(env.EDGE_SECRET_FILE, "utf8").trim() || undefined : undefined,
  /** A Unix socket path; when set the server listens there instead of HOST:PORT. */
  socket: env.SOCKET_PATH || undefined,
  vaultRoot,
  threadRel,
  threadDir,
  practiceDir: join(threadDir, "Practice"),
  mediaRoot: resolve(env.GUITAR_MEDIA_ROOT ?? join(home, "Documents/Reference Library/Ars Malefica/Guitar")),
  stateDir: resolve(env.GUITAR_STATE_DIR ?? join(env.XDG_STATE_HOME ?? join(home, ".local/state"), suffix)),
  cacheDir: resolve(env.GUITAR_CACHE_DIR ?? join(env.XDG_CACHE_HOME ?? join(home, ".cache"), suffix)),
  calibreReceipt: env.GUITAR_CALIBRE_RECEIPT ?? join(home, ".local/state/guitar-books-from-calibre-20261114.json"),
  timeZone: timeZone(),
  /** Generic mode: the studio folder, extra read-only folders, an optional Guitar Pro collection. */
  home: path(env.GUITAR_HOME || "~/Guitar Room"),
  libraryDirs: (env.GUITAR_LIBRARY_DIRS ?? "").split(":").map((d) => d.trim()).filter(Boolean).map(path),
  tabsDir: env.GUITAR_TABS_DIR ? path(env.GUITAR_TABS_DIR) : undefined,
  coachWeb: env.GUITAR_COACH_WEB !== "0",
  appName: env.GUITAR_APP_NAME?.trim().slice(0, 60) || "Guitar Room",
  claudeBin: env.CLAUDE_BIN ?? "claude",
  codexBin: env.CODEX_BIN ?? "codex",
  claudeModel: env.CLAUDE_MODEL || undefined,
  codexModel: env.CODEX_MODEL || undefined,
  chatTimeoutMs: 300_000,
  /**
   * Generic mode: coaching on this computer's own `claude` and `codex` logins. Unset, they are offered only
   * when the instance is locally hosted (loopback TCP with the access token); "1" offers them anywhere
   * (the operator's own use), "0" nowhere.
   */
  coachHostLogins: triState("GUITAR_COACH_HOST_LOGINS", env.GUITAR_COACH_HOST_LOGINS),
  /** Generic mode: offer the ChatGPT device-code sign-in on an instance that is not locally hosted. */
  coachDeviceSignIn: env.GUITAR_COACH_DEVICE_SIGNIN === "1",
  /** Generic mode: allow endpoint addresses on loopback and private networks on an instance that is not locally hosted. */
  coachPrivateEndpoints: env.GUITAR_COACH_PRIVATE_ENDPOINTS === "1",
  /** Generic mode: `--max-budget-usd` for one turn on an Anthropic key or Bedrock. */
  coachMaxBudgetUsd: budget(env.GUITAR_COACH_MAX_BUDGET_USD),
};

/**
 * "1" on, "0" off, unset or empty the default. Anything else stops the server: for a switch that keeps the
 * operator's own subscriptions from others, a typo such as "false" must not leave them on.
 */
export function triState(name: string, raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (raw === "1") return true;
  if (raw === "0") return false;
  throw new Error(`${name} must be "1" or "0", not "${raw}"`);
}

function budget(raw: string | undefined): number {
  if (!raw) return 2;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 1000) throw new Error(`GUITAR_COACH_MAX_BUDGET_USD must be a positive number of dollars, not "${raw}"`);
  return n;
}

export type Config = typeof config;
