import assert from "node:assert/strict";
import { test } from "node:test";

import { claudeArgs } from "./claude.ts";
import { codexArgs } from "./codex.ts";

const base = { system: "be a coach", vaultRoot: "/v", threadRel: "001 Projects/Threads/Guitar", mediaRoot: "/media/Guitar" };
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

test("claude runs in print mode with streaming JSON", () => {
  const a = claudeArgs(base);
  assert.ok(a.includes("-p"));
  assert.equal(after(a, "--output-format"), "stream-json");
  assert.ok(a.includes("--include-partial-messages"));
});

test("claude's tools are limited to reading, writing the Guitar thread and the validator", () => {
  const a = claudeArgs(base);
  assert.equal(after(a, "--tools"), "Read,Glob,Grep,Edit,Write,Bash");
  const allowed = after(a, "--allowedTools")!;
  assert.ok(allowed.includes("Edit(001 Projects/Threads/Guitar/**)"));
  assert.ok(allowed.includes("Write(001 Projects/Threads/Guitar/**)"));
  assert.ok(allowed.includes("Bash(python3 .agents/skills/guitar-practice-coach/scripts/validate-practice-system.py:*)"));
  assert.ok(a.includes("--strict-mcp-config"));
  assert.equal(after(a, "--add-dir"), "/media/Guitar");
  assert.equal(after(a, "--permission-mode"), "dontAsk");
  assert.ok(!a.some((x) => /WebFetch|WebSearch/.test(x)));
});

test("claude resumes only with a thread id", () => {
  assert.ok(!claudeArgs(base).includes("--resume"));
  assert.equal(after(claudeArgs({ ...base, threadId: "abc-123" }), "--resume"), "abc-123");
  assert.equal(after(claudeArgs({ ...base, model: "opus" }), "--model"), "opus");
});

test("codex runs exec with a workspace-write sandbox and no network", () => {
  const a = codexArgs({ system: "be a coach" });
  assert.equal(a[0], "exec");
  assert.notEqual(a[1], "resume");
  for (const x of ["--json", "--ignore-user-config", 'sandbox_mode="workspace-write"', "sandbox_workspace_write.network_access=false", 'approval_policy="never"']) {
    assert.ok(a.includes(x), x);
  }
  assert.ok(a.some((x) => x.startsWith("developer_instructions=")));
  const r = codexArgs({ system: "s", threadId: "t-1" });
  assert.deepEqual(r.slice(0, 3), ["exec", "resume", "t-1"]);
  assert.equal(r.at(-1), "-");
});
