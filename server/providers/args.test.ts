import assert from "node:assert/strict";
import { test } from "node:test";

import { claudeArgs } from "./claude.ts";
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { codexArgs, codexInstallDir } from "./codex.ts";

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
  // No bare Read/Glob/Grep allow rule: reads outside the vault and the media folder must be denied.
  assert.deepEqual(allowed.split(",").filter((r) => /^(Read|Glob|Grep)$/.test(r)), []);
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

test("codex's install folder is the one above its bin/, never one holding the home folder", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-install-"));
  const install = join(root, "installs", "codex", "1.0.0");
  mkdirSync(join(install, "bin"), { recursive: true });
  writeFileSync(join(install, "bin", "codex"), "#!/bin/sh\n");
  chmodSync(join(install, "bin", "codex"), 0o755);
  const home = join(root, "home");
  mkdirSync(join(home, "bin"), { recursive: true });
  symlinkSync(join(install, "bin", "codex"), join(home, "bin", "link"));
  assert.equal(await codexInstallDir(join(home, "bin", "link"), {}, home), install);
  assert.equal(await codexInstallDir("codex", { PATH: join(install, "bin") }, home), install);
  // A wrapper script in ~/bin would make the home folder the "install folder": refused.
  writeFileSync(join(home, "bin", "codex"), "#!/bin/sh\n");
  chmodSync(join(home, "bin", "codex"), 0o755);
  assert.equal(await codexInstallDir(join(home, "bin", "codex"), {}, home), null);
  assert.equal(await codexInstallDir("nothing-here", { PATH: join(root, "none") }, home), null);
});
