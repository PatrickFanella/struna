import { homedir } from "node:os";
import { join, resolve } from "node:path";

const home = homedir();
const env = process.env;

const vaultRoot = resolve(env.GUITAR_VAULT_ROOT ?? join(home, "Work/Vaults/Ars Malefica"));
const threadRel = env.GUITAR_THREAD ?? "001 Projects/Threads/Guitar";
const threadDir = join(vaultRoot, threadRel);

export const config = {
  host: env.HOST ?? "127.0.0.1",
  port: Number(env.PORT ?? 5182),
  production: env.NODE_ENV === "production",
  allowedHosts: new Set(
    ["localhost", "127.0.0.1", "[::1]", ...(env.ALLOWED_HOSTS?.split(",") ?? [])].map((h) => h.trim()).filter(Boolean),
  ),
  requireUser: env.REQUIRE_USER || undefined,
  vaultRoot,
  threadRel,
  threadDir,
  practiceDir: join(threadDir, "Practice"),
  mediaRoot: resolve(env.GUITAR_MEDIA_ROOT ?? join(home, "Documents/Reference Library/Ars Malefica/Guitar")),
  stateDir: resolve(env.GUITAR_STATE_DIR ?? join(env.XDG_STATE_HOME ?? join(home, ".local/state"), "guitar-room")),
  cacheDir: resolve(env.GUITAR_CACHE_DIR ?? join(env.XDG_CACHE_HOME ?? join(home, ".cache"), "guitar-room")),
  calibreReceipt: env.GUITAR_CALIBRE_RECEIPT ?? join(home, ".local/state/guitar-books-from-calibre-20261114.json"),
  timeZone: "America/Chicago" as const,
  claudeBin: env.CLAUDE_BIN ?? "claude",
  codexBin: env.CODEX_BIN ?? "codex",
  claudeModel: env.CLAUDE_MODEL || undefined,
  codexModel: env.CODEX_MODEL || undefined,
  chatTimeoutMs: 300_000,
};

export type Config = typeof config;
