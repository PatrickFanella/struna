import { planSandboxCommand, type PlanSandbox } from "../generic/planSandbox.ts";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export type ChatEvent =
  | { type: "thread"; id: string }
  | { type: "delta"; text: string }
  | { type: "notice"; message: string }
  | { type: "error"; message: string };

export type ChatRequest = {
  system: string;
  prompt: string;
  threadId?: string;
  signal: AbortSignal;
};

const KEEP = new Set(["CLAUDE_CODE_OAUTH_TOKEN"]);

/**
 * Child environment without API credentials, so both CLIs fall back to their
 * stored subscription logins (Claude.ai and ChatGPT) instead of billed API keys.
 */
export function subscriptionEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (KEEP.has(k)) env[k] = v;
    else if (/^(ANTHROPIC_|CLAUDE_CODE_|OPENAI_|CODEX_API_KEY$|CLAUDECODE$)/.test(k)) continue;
    else env[k] = v;
  }
  env.NO_COLOR = "1";
  return env;
}

/** The variables a run the app manages keeps from the server's own environment; nothing else gets through. */
const ALLOW = /^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LC_[A-Z_]+|TZ|TMPDIR|HTTPS?_PROXY|https?_proxy|NO_PROXY|no_proxy|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS)$/;

/**
 * Child environment for a coach the app signs in itself (an API key, an endpoint, its own Codex login):
 * an allowlist of the server's variables plus exactly `add`. Unlike `subscriptionEnv`, a stray host token
 * (`CLAUDE_CODE_OAUTH_TOKEN`, `CODEX_ACCESS_TOKEN`, `AWS_*`) or config folder never reaches the CLI.
 */
export function appEnv(add: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (ALLOW.test(k)) env[k] = v;
  env.NO_COLOR = "1";
  return { ...env, ...add };
}

/** Spawn a CLI, write `input` to stdin and yield each stdout line parsed as JSON. */
export async function* jsonLines(
  bin: string,
  args: string[],
  opts: { cwd: string; input: string; signal: AbortSignal; timeoutMs: number; env?: NodeJS.ProcessEnv | undefined; planSandbox?: PlanSandbox | undefined },
): AsyncGenerator<Record<string, any>, { code: number | null; stderr: string }> {
  // An abort that already happened never fires its event again: do not start a CLI nothing could stop.
  if (opts.signal.aborted) return { code: null, stderr: "aborted" };
  const command = opts.planSandbox ? planSandboxCommand(bin, args, opts.planSandbox) : { bin, args };
  const child = spawn(command.bin, command.args, { cwd: opts.cwd, env: opts.env ?? subscriptionEnv(), stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (b: Buffer) => {
    stderr = (stderr + b.toString()).slice(-4000);
  });
  const kill = () => child.kill("SIGTERM");
  opts.signal.addEventListener("abort", kill, { once: true });
  const timer = setTimeout(kill, opts.timeoutMs);
  const exited = new Promise<number | null>((resolve) => {
    child.on("close", resolve);
    child.on("error", (err) => {
      stderr += String(err);
      resolve(null);
    });
  });
  child.stdin.on("error", () => {});
  child.stdin.end(opts.input);

  try {
    for await (const line of createInterface({ input: child.stdout })) {
      if (!line.startsWith("{")) continue;
      try {
        yield JSON.parse(line);
      } catch {
        // Ignore non-JSON log lines.
      }
    }
    return { code: await exited, stderr };
  } finally {
    clearTimeout(timer);
    opts.signal.removeEventListener("abort", kill);
    if (child.exitCode === null) kill();
  }
}
