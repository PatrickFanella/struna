import { join } from "node:path";

import { config } from "../config.ts";
import { type ChatEvent, type ChatRequest, jsonLines } from "./process.ts";

/**
 * Codex CLI `exec`, signed in with a ChatGPT subscription, run with the Guitar
 * thread folder as its working directory: a workspace-write sandbox makes that
 * folder (and temp) the only writable place, with the network off. The user's
 * config (MCP servers, profiles) and command rules are ignored.
 */
export function codexArgs(o: { system: string; threadId?: string | undefined; model?: string | undefined }): string[] {
  const shared = [
    "--json",
    "--ignore-user-config",
    "--ignore-rules",
    "-c", 'sandbox_mode="workspace-write"',
    "-c", "sandbox_workspace_write.network_access=false",
    "-c", 'approval_policy="never"',
    "-c", `developer_instructions=${JSON.stringify(o.system)}`,
  ];
  if (o.model) shared.push("-m", o.model);
  return o.threadId ? ["exec", "resume", o.threadId, ...shared, "-"] : ["exec", ...shared, "-"];
}

export async function* codexChat(req: ChatRequest): AsyncGenerator<ChatEvent> {
  const lines = jsonLines(config.codexBin, codexArgs({ system: req.system, threadId: req.threadId, model: config.codexModel }), {
    cwd: join(config.vaultRoot, config.threadRel),
    input: req.prompt,
    signal: req.signal,
    timeoutMs: config.chatTimeoutMs,
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
