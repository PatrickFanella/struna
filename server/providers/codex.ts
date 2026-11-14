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
  timeoutMs?: number | undefined;
};

/**
 * Codex CLI `exec`, signed in with a ChatGPT subscription: a workspace-write sandbox makes the
 * working directory (and temp) the only writable place, with the network off. The user's
 * config (MCP servers, profiles) and command rules are ignored.
 */
export function codexArgs(o: { system: string; threadId?: string | undefined; model?: string | undefined; options?: Pick<CodexOptions, "search" | "skipGitCheck"> }): string[] {
  const shared = [
    "--json",
    "--ignore-user-config",
    "--ignore-rules",
    ...(o.options?.skipGitCheck ? ["--skip-git-repo-check"] : []),
    ...(o.options?.search === undefined ? [] : ["--disable", "apps"]),
    "-c", 'sandbox_mode="workspace-write"',
    "-c", "sandbox_workspace_write.network_access=false",
    "-c", 'approval_policy="never"',
    ...(o.options?.search === undefined ? [] : ["-c", `web_search="${o.options.search ? "live" : "disabled"}"`]),
    "-c", `developer_instructions=${JSON.stringify(o.system)}`,
  ];
  if (o.model) shared.push("-m", o.model);
  return o.threadId ? ["exec", "resume", o.threadId, ...shared, "-"] : ["exec", ...shared, "-"];
}

export async function* codexChat(req: ChatRequest, options: CodexOptions): AsyncGenerator<ChatEvent> {
  const lines = jsonLines(config.codexBin, codexArgs({ system: req.system, threadId: req.threadId, model: config.codexModel, options }), {
    cwd: options.cwd,
    input: req.prompt,
    signal: req.signal,
    timeoutMs: options.timeoutMs ?? config.chatTimeoutMs,
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
