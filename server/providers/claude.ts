import { config } from "../config.ts";
import { type ChatEvent, type ChatRequest, jsonLines } from "./process.ts";

export const VALIDATOR = "python3 .agents/skills/guitar-practice-coach/scripts/validate-practice-system.py";

/**
 * Claude Code in print mode, signed in with a Claude.ai subscription, run from the vault root.
 * Tools: read the vault and the media folder, edit only the Guitar thread, run only the coach's validator.
 * No user or project settings (hooks, plugins, extra permissions), no MCP servers, no web tools.
 */
export function claudeArgs(o: { system: string; threadId?: string | undefined; model?: string | undefined; vaultRoot: string; threadRel: string; mediaRoot: string }): string[] {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--tools", "Read,Glob,Grep,Edit,Write,Bash",
    // No Read/Glob/Grep allow rules: reads inside the working directory and --add-dir need no
    // permission, and in dontAsk mode a read anywhere else (onnwee's home, keys, tokens) is denied.
    "--allowedTools", [`Edit(${o.threadRel}/**)`, `Write(${o.threadRel}/**)`, `Bash(${VALIDATOR}:*)`].join(","),
    "--permission-mode", "dontAsk",
    "--setting-sources", "",
    "--strict-mcp-config",
    "--add-dir", o.mediaRoot,
    "--append-system-prompt", o.system,
  ];
  if (o.threadId) args.push("--resume", o.threadId);
  if (o.model) args.push("--model", o.model);
  return args;
}

export async function* claudeChat(req: ChatRequest): AsyncGenerator<ChatEvent> {
  const lines = jsonLines(
    config.claudeBin,
    claudeArgs({ system: req.system, threadId: req.threadId, model: config.claudeModel, vaultRoot: config.vaultRoot, threadRel: config.threadRel, mediaRoot: config.mediaRoot }),
    { cwd: config.vaultRoot, input: req.prompt, signal: req.signal, timeoutMs: config.chatTimeoutMs },
  );

  let streamed = false;
  let failed = false;
  let next = await lines.next();
  while (!next.done) {
    const msg = next.value;
    if (typeof msg.session_id === "string" && msg.type === "system" && msg.subtype === "init") {
      yield { type: "thread", id: msg.session_id };
      if (msg.apiKeySource && msg.apiKeySource !== "none") {
        yield { type: "notice", message: `Claude is using an API key (${msg.apiKeySource}), not the subscription login.` };
      }
    } else if (msg.type === "stream_event" && msg.event?.type === "content_block_start" && msg.event.content_block?.type === "tool_use" && streamed) {
      // Separate the text before and after a tool call.
      yield { type: "delta", text: "\n\n" };
    } else if (msg.type === "stream_event" && msg.event?.type === "content_block_delta" && msg.event.delta?.type === "text_delta") {
      streamed = true;
      yield { type: "delta", text: msg.event.delta.text };
    } else if (msg.type === "result") {
      if (msg.is_error) {
        failed = true;
        yield { type: "error", message: String(msg.result ?? msg.subtype ?? "Claude returned an error") };
      } else if (!streamed && typeof msg.result === "string") {
        yield { type: "delta", text: msg.result };
      }
    }
    next = await lines.next();
  }
  const { code, stderr } = next.value;
  if (code !== 0 && !failed && !req.signal.aborted) {
    yield { type: "error", message: `claude exited with ${code}: ${stderr.trim().slice(-800)}` };
  }
}
