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

// ---- Coaches the app signs in itself (generic mode). Without these options the arguments above are unchanged.

test("codex: an endpoint gets the custom provider's -c list, with the key named, never given", () => {
  const p = "model_providers.guitar_room";
  const common = ['model_provider="guitar_room"', `${p}.name="Guitar Room endpoint"`, `${p}.base_url="https://openrouter.ai/api/v1"`, `${p}.wire_api="responses"`, `${p}.supports_websockets=false`, `${p}.request_max_retries=1`, `${p}.stream_max_retries=1`];
  const tail = (a: string[]) => a.slice(a.indexOf("-c", a.findIndex((x) => x.startsWith("developer_instructions=")) + 1));
  for (const threadId of [undefined, "t-1"]) {
    const bearer = codexArgs({ system: "s", threadId, options: { search: false, endpoint: { baseUrl: "https://openrouter.ai/api/v1", header: "bearer", key: true }, model: "openai/gpt-5", hideEnv: true } });
    assert.deepEqual(tail(bearer).filter((x) => x !== "-c" && x !== "-"), [...common, `${p}.env_key="GUITAR_ROOM_ENDPOINT_KEY"`, 'model="openai/gpt-5"', 'shell_environment_policy.inherit="core"', 'shell_environment_policy.exclude=["*KEY*","*TOKEN*","*SECRET*"]']);
    assert.equal(bearer.at(-1), "-");
    const azure = codexArgs({ system: "s", threadId, options: { search: false, endpoint: { baseUrl: "https://openrouter.ai/api/v1", header: "api-key", key: true }, model: "gpt-5", hideEnv: true } });
    assert.ok(azure.includes(`${p}.env_http_headers={api-key="GUITAR_ROOM_ENDPOINT_KEY"}`));
    assert.ok(!azure.some((x) => x.includes(".env_key=")));
  }
  // No key (a local server): neither header setting.
  const local = codexArgs({ system: "s", options: { endpoint: { baseUrl: "http://127.0.0.1:11434/v1", header: "bearer", key: false } } });
  assert.ok(!local.some((x) => /env_key|env_http_headers/.test(x)));
});

test("codex: the model is a JSON string in -c; the host form -m is unchanged", () => {
  const a = codexArgs({ system: "s", options: { model: "--dangerous" } });
  assert.ok(a.includes('model="--dangerous"'));
  assert.ok(!a.includes("-m"));
  assert.equal(after(codexArgs({ system: "s", model: "gpt-5" }), "-m"), "gpt-5");
});

test("claude: the model is attached to its option, the budget follows; the host form is unchanged", async () => {
  const { claudeCommand } = await import("./claude.ts");
  const options = { tools: ["Read"], allowed: [], addDirs: [] };
  const plain = claudeCommand({ system: "s", options });
  const keyed = claudeCommand({ system: "s", options: { ...options, model: "sonnet", budgetUsd: 2 } });
  assert.deepEqual(keyed.slice(0, plain.length), plain);
  assert.deepEqual(keyed.slice(plain.length), ["--model=sonnet", "--max-budget-usd", "2"]);
  assert.deepEqual(claudeArgs({ ...base, model: "opus" }).slice(-2), ["--model", "opus"]);
});
