import { execFile } from "node:child_process";
import { access, constants, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, sep } from "node:path";
import { promisify } from "node:util";

import { config } from "../config.ts";
import { type ChatEvent, type ChatRequest, jsonLines } from "./process.ts";

export type CodexOptions = {
  /** The working directory: with temp, the only writable place. */
  cwd: string;
  /**
   * Live web search for the model (its own `web_search` tool; the shell stays offline). Unset leaves
   * the CLI's defaults, as the personal coach always has. Set either way, the ChatGPT apps connector
   * is switched off: it carries a web search of its own that ignores `web_search="disabled"`, and
   * whatever other connectors the account has. `codex exec` has no `--search` flag (0.167); the
   * `web_search` config key and `--disable` work on `exec` and `exec resume` alike.
   */
  search?: boolean | undefined;
  /** Needed when the working directory is not inside a Git repository. */
  skipGitCheck?: boolean | undefined;
  /**
   * A permission profile (a TOML inline table, see `codexProfile` in generic/coach.ts) used instead of the
   * `workspace-write` sandbox. Unlike that sandbox, a profile can also limit what commands may read.
   * Profiles and `sandbox_mode` do not combine, so with one set `sandbox_mode` is not passed.
   */
  permissions?: string | undefined;
  timeoutMs?: number | undefined;
  /**
   * A coach the app signs in itself (studio mode): the whole child environment (see `appEnv`). With it
   * set, `CODEX_MODEL` no longer applies; `model` does, passed as `-c model=<JSON string>`.
   */
  env?: NodeJS.ProcessEnv | undefined;
  model?: string | undefined;
  /**
   * Keep the credentials in Codex's own environment out of the commands it runs: only the core variables
   * are inherited, and any name with KEY, TOKEN or SECRET in it is dropped. Set for every run with `env`.
   */
  hideEnv?: boolean | undefined;
  /** A custom model provider that speaks the Responses API; the key, if any, is in `env` as ENDPOINT_KEY_ENV. */
  endpoint?: CodexEndpoint | undefined;
};

export type CodexEndpoint = { baseUrl: string; header: "bearer" | "api-key"; key: boolean };
/** The variable the endpoint's key travels in; it keeps KEY in its name, so `hideEnv` drops it. */
export const ENDPOINT_KEY_ENV = "STRUNA_ENDPOINT_KEY";

/** The `-c` arguments for a run the app manages: its endpoint, its model and the shell's environment. */
function appArgs(o: Pick<CodexOptions, "model" | "hideEnv" | "endpoint">): string[] {
  const c = (kv: string) => ["-c", kv];
  const out: string[] = [];
  if (o.endpoint) {
    const p = "model_providers.struna";
    out.push(
      ...c('model_provider="struna"'),
      ...c(`${p}.name="Struna endpoint"`),
      ...c(`${p}.base_url=${JSON.stringify(o.endpoint.baseUrl)}`),
      ...c(`${p}.wire_api="responses"`),
      ...c(`${p}.supports_websockets=false`),
      ...c(`${p}.request_max_retries=1`),
      ...c(`${p}.stream_max_retries=1`),
    );
    if (o.endpoint.key) out.push(...c(o.endpoint.header === "api-key" ? `${p}.env_http_headers={api-key="${ENDPOINT_KEY_ENV}"}` : `${p}.env_key="${ENDPOINT_KEY_ENV}"`));
  }
  if (o.model) out.push(...c(`model=${JSON.stringify(o.model)}`));
  if (o.hideEnv) out.push(...c('shell_environment_policy.inherit="core"'), ...c('shell_environment_policy.exclude=["*KEY*","*TOKEN*","*SECRET*"]'));
  return out;
}

/**
 * Codex CLI `exec`, signed in with a ChatGPT subscription: a workspace-write sandbox makes the
 * working directory (and temp) the only writable place, with the network off. The user's
 * config (MCP servers, profiles) and command rules are ignored.
 */
export function codexArgs(o: { system: string; threadId?: string | undefined; model?: string | undefined; options?: Pick<CodexOptions, "search" | "skipGitCheck" | "permissions" | "model" | "hideEnv" | "endpoint"> }): string[] {
  const sandbox = o.options?.permissions
    ? ["-c", 'default_permissions="guitar"', "-c", `permissions={guitar=${o.options.permissions}}`]
    : ["-c", 'sandbox_mode="workspace-write"', "-c", "sandbox_workspace_write.network_access=false"];
  const shared = [
    "--json",
    "--ignore-user-config",
    "--ignore-rules",
    ...(o.options?.skipGitCheck ? ["--skip-git-repo-check"] : []),
    ...(o.options?.search === undefined ? [] : ["--disable", "apps"]),
    ...sandbox,
    "-c", 'approval_policy="never"',
    ...(o.options?.search === undefined ? [] : ["-c", `web_search="${o.options.search ? "live" : "disabled"}"`]),
    "-c", `developer_instructions=${JSON.stringify(o.system)}`,
  ];
  if (o.model) shared.push("-m", o.model);
  if (o.options) shared.push(...appArgs(o.options));
  return o.threadId ? ["exec", "resume", o.threadId, ...shared, "-"] : ["exec", ...shared, "-"];
}

export async function* codexChat(req: ChatRequest, options: CodexOptions): AsyncGenerator<ChatEvent> {
  // A coach the app signs in itself sits next to the saved keys: never under a sandbox that lets it read them.
  if (options.env && !options.permissions) {
    yield { type: "error", message: "This Codex coach needs its permission profile, which keeps it out of the saved keys, and has none." };
    return;
  }
  const lines = jsonLines(config.codexBin, codexArgs({ system: req.system, threadId: req.threadId, model: options.env ? undefined : config.codexModel, options }), {
    cwd: options.cwd,
    input: req.prompt,
    signal: req.signal,
    timeoutMs: options.timeoutMs ?? config.chatTimeoutMs,
    env: options.env,
  });

  let messages = 0;
  let failed = false;
  let next = await lines.next();
  while (!next.done) {
    const msg = next.value;
    if (msg.type === "thread.started" && typeof msg.thread_id === "string") {
      yield { type: "thread", id: msg.thread_id };
    } else if (msg.type === "item.completed" && msg.item?.type === "agent_message" && typeof msg.item.text === "string") {
      yield { type: "delta", text: (messages++ ? "\n\n" : "") + msg.item.text };
    } else if (msg.type === "turn.failed" || msg.type === "error") {
      failed = true;
      yield { type: "error", message: String(msg.error?.message ?? msg.message ?? "Codex turn failed") };
    }
    next = await lines.next();
  }
  const { code, stderr } = next.value;
  if (code !== 0 && !failed && !req.signal.aborted) {
    yield { type: "error", message: `codex exited with ${code}: ${stderr.trim().slice(-800)}` };
  }
}

/**
 * The folder Codex is installed in, which its sandbox must be able to read: inside the sandbox it runs
 * its own binary again for every command. That is the folder above the real binary's `bin/` (a mise or
 * npm install, whose `codex-path/` or `vendor/` sits there too). A mise shim is followed with
 * `mise which codex`. Null when the binary cannot be found or is not recognisably Codex, and when
 * that folder would hold the home folder (a wrapper script such as ~/bin/codex): granting it would
 * open the logins and keys the profile is there to hide.
 */
export async function codexInstallDir(bin: string, env: NodeJS.ProcessEnv = process.env, home = homedir()): Promise<string | null> {
  let found: string | undefined;
  if (bin.includes("/")) found = bin;
  else {
    for (const dir of (env.PATH ?? "").split(delimiter).filter(isAbsolute)) {
      const p = join(dir, bin);
      if (await access(p, constants.X_OK).then(() => true, () => false)) {
        found = p;
        break;
      }
    }
  }
  if (!found) return null;
  let real = await realpath(found).catch(() => null);
  if (real && basename(real) === "mise") {
    const out = await promisify(execFile)(real, ["which", "codex"], { env, timeout: 15_000 }).catch(() => null);
    real = out ? await realpath(out.stdout.trim()).catch(() => null) : null;
  }
  if (!real || !/^codex/.test(basename(real))) return null;
  const dir = dirname(dirname(real));
  if (home === dir || home.startsWith(dir.endsWith(sep) ? dir : dir + sep)) return null;
  return dir;
}
