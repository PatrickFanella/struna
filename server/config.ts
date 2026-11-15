import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const home = homedir();
// New names win, including an explicitly empty value. Existing installations can
// keep their environment files until their next deployment.
const env = { ...process.env };
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith("GUITAR_")) env[key.replace(/^GUITAR_/, "STRUNA_")] ??= value;
}
if (env.STRUNA_MODE === "generic") env.STRUNA_MODE = "studio";

if (env.STRUNA_MODE && env.STRUNA_MODE !== "personal" && env.STRUNA_MODE !== "studio" && env.STRUNA_MODE !== "hosted") throw new Error(`STRUNA_MODE must be "personal", "studio" or "hosted", not "${env.STRUNA_MODE}"`);
const mode: "personal" | "studio" | "hosted" = env.STRUNA_MODE === "hosted" ? "hosted" : env.STRUNA_MODE === "studio" ? "studio" : "personal";
/** The studio mode keeps its own state and cache, so both modes can run on one machine. */
const suffix = mode === "hosted" ? "struna-hosted" : mode === "studio" ? "struna-studio" : "struna";
const legacySuffix = mode === "studio" ? "guitar-room-generic" : "guitar-room";
const existingPath = (current: string, legacy: string) => existsSync(current) || !existsSync(legacy) ? current : legacy;
const stateHome = env.XDG_STATE_HOME ?? join(home, ".local/state");
const cacheHome = env.XDG_CACHE_HOME ?? join(home, ".cache");
const path = (p: string) => resolve(p === "~" || p.startsWith("~/") ? join(home, p.slice(1)) : p);

function timeZone(): string {
  const zone = env.STRUNA_TIMEZONE || (mode === "studio" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "America/Chicago");
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
  } catch {
    throw new Error(`STRUNA_TIMEZONE is not a time zone name: "${zone}"`);
  }
  return zone;
}

const vaultRoot = resolve(env.STRUNA_VAULT_ROOT ?? join(home, "Work/Vaults/Ars Malefica"));
const threadRel = env.STRUNA_THREAD ?? "001 Projects/Threads/Guitar";
const threadDir = join(vaultRoot, threadRel);

export const config = {
  mode,
  hostedOrigin: env.STRUNA_HOSTED_ORIGIN,
  oidcIssuer: env.STRUNA_OIDC_ISSUER,
  oidcClientId: env.STRUNA_OIDC_CLIENT_ID,
  oidcSecretFile: env.STRUNA_OIDC_SECRET_FILE,
  host: env.HOST ?? "127.0.0.1",
  port: Number(env.PORT ?? 5182),
  production: env.NODE_ENV === "production",
  noScan: Boolean(env.STRUNA_NO_SCAN),
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
  mediaRoot: resolve(env.STRUNA_MEDIA_ROOT ?? join(home, "Documents/Reference Library/Ars Malefica/Guitar")),
  stateDir: resolve(env.STRUNA_STATE_DIR ?? existingPath(join(stateHome, suffix), join(stateHome, legacySuffix))),
  cacheDir: resolve(env.STRUNA_CACHE_DIR ?? existingPath(join(cacheHome, suffix), join(cacheHome, legacySuffix))),
  calibreReceipt: env.STRUNA_CALIBRE_RECEIPT ?? join(home, ".local/state/guitar-books-from-calibre-20261114.json"),
  timeZone: timeZone(),
  /** Studio mode: the studio folder, extra read-only folders, an optional Guitar Pro collection. */
  home: path(env.STRUNA_HOME || existingPath(join(home, "Struna"), join(home, "Guitar Room"))),
  libraryDirs: (env.STRUNA_LIBRARY_DIRS ?? "").split(":").map((d) => d.trim()).filter(Boolean).map(path),
  tabsDir: env.STRUNA_TABS_DIR ? path(env.STRUNA_TABS_DIR) : undefined,
  coachWeb: env.STRUNA_COACH_WEB !== "0",
  appName: env.STRUNA_APP_NAME?.trim().slice(0, 60) || "Struna",
  claudeBin: env.CLAUDE_BIN ?? "claude",
  codexBin: env.CODEX_BIN ?? "codex",
  claudeModel: env.CLAUDE_MODEL || undefined,
  codexModel: env.CODEX_MODEL || undefined,
  chatTimeoutMs: 300_000,
  /**
   * Studio mode: coaching on this computer's own `claude` and `codex` logins. Unset, they are offered only
   * when the instance is locally hosted (loopback TCP with the access token); "1" offers them anywhere
   * (the operator's own use), "0" nowhere.
   */
  coachHostLogins: triState("STRUNA_COACH_HOST_LOGINS", env.STRUNA_COACH_HOST_LOGINS),
  /** Studio mode: offer the ChatGPT device-code sign-in on an instance that is not locally hosted. */
  coachDeviceSignIn: env.STRUNA_COACH_DEVICE_SIGNIN === "1",
  /** Studio mode: allow endpoint addresses on loopback and private networks on an instance that is not locally hosted. */
  coachPrivateEndpoints: env.STRUNA_COACH_PRIVATE_ENDPOINTS === "1",
  /** Studio mode: `--max-budget-usd` for one turn on an Anthropic key or Bedrock. */
  coachMaxBudgetUsd: budget(env.STRUNA_COACH_MAX_BUDGET_USD),
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
  if (!Number.isFinite(n) || n <= 0 || n > 1000) throw new Error(`STRUNA_COACH_MAX_BUDGET_USD must be a positive number of dollars, not "${raw}"`);
  return n;
}

export type Config = typeof config;
