#!/usr/bin/env node
/**
 * A stand-in for both coach CLIs, `claude` and `codex`, for tests and smoke runs: no subscription, no key
 * and no model call. It sits beside the older stand-ins in server/chat.test.ts and smoke-generic.ts, which
 * stay as they are. `writeFakeBin(dir)` writes an executable wrapper in `dir` that runs this file with
 * FAKE_DIR=dir, since the app hands a coach it signs in itself only an allowlisted environment.
 *
 * What it answers:
 *   claude -p …                 Claude stream-json (session id, apiKeySource, text, result)
 *   codex exec [resume <id>] …  Codex JSON events (thread.started, agent_message, turn.completed)
 *   claude auth status          signed in (claude.ai, or api_key when ANTHROPIC_API_KEY is set)
 *   codex login status          signed in, or "Not logged in" when CODEX_HOME has no auth.json
 *                               (with FAKE_DIR/signed-out both report signed out and exit 1, as the real CLIs do)
 *   codex login --device-auth   prints a sample link and code, waits for FAKE_DIR/device-ok, then
 *                               writes $CODEX_HOME/auth.json ("fail" in that file: exits 1 instead);
 *                               with FAKE_DIR/device-silent it prints no link and waits forever
 *   codex logout                removes $CODEX_HOME/auth.json
 * FAKE_FAIL=401 or 429 (or that text in FAKE_DIR/fail) makes a chat turn fail with a matching error; the 401
 * text quotes the key, as some servers do, so the app's redaction is tested. A prompt containing
 * "BREAK THE PLAN" writes an invalid plan; "Fix the file" copies FAKE_DIR/good-plan.json over it.
 * A number of milliseconds in FAKE_DIR/slow holds a chat turn's answer that long after it is logged.
 *
 * Every call appends one JSON line to FAKE_DIR/calls.jsonl: argv, cwd, the names of the environment
 * variables, CLAUDE_CONFIG_DIR, CODEX_HOME, the prompt, and the SHA-256 of each variable whose name holds
 * KEY, TOKEN or SECRET. Never the values themselves.
 */
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Write `dir/<name>` (default `fake-cli`), a wrapper that runs this stand-in with FAKE_DIR set to `dir`;
 * returns its path. A name such as `codex-install/bin/codex` gives the layout the app recognises as a Codex
 * install, so it runs Codex coaches under the permission profile.
 */
export function writeFakeBin(dir: string, name = "fake-cli"): string {
  const bin = join(dir, name);
  mkdirSync(dirname(bin), { recursive: true });
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  writeFileSync(bin, `#!/bin/sh\nFAKE_DIR=${q(dir)} exec ${q(process.execPath)} ${q(import.meta.filename)} "$@"\n`);
  chmodSync(bin, 0o755);
  return bin;
}

/** The variables whose values are secrets. */
const SECRET = /KEY|TOKEN|SECRET/;
export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

function main() {
  const env = process.env;
  const dir = env.FAKE_DIR ?? "";
  const argv = process.argv.slice(2);
  if (argv[0] === "--version") { console.log("0.0.0-offline-stand-in"); return; }
  const file = (name: string) => (dir ? join(dir, name) : "");
  const readOr = (p: string) => (p && existsSync(p) ? readFileSync(p, "utf8").trim() : "");
  const fail = env.FAKE_FAIL ?? readOr(file("fail"));
  const out = (o: unknown) => process.stdout.write(`${JSON.stringify(o)}\n`);
  const log = (input?: string) => {
    if (!dir) return;
    const names = Object.keys(env).filter((k) => k !== "FAKE_DIR").sort();
    const hashes = Object.fromEntries(names.filter((k) => SECRET.test(k)).map((k) => [k, sha256(env[k] ?? "")]));
    appendFileSync(file("calls.jsonl"), `${JSON.stringify({ argv, cwd: process.cwd(), envNames: names, CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR ?? null, CODEX_HOME: env.CODEX_HOME ?? null, sha256: hashes, ...(input === undefined ? {} : { input }) })}\n`);
  };
  const auth = env.CODEX_HOME ? join(env.CODEX_HOME, "auth.json") : "";

  const signedOut = existsSync(file("signed-out"));
  if (argv[0] === "auth" && argv[1] === "status") {
    log();
    if (signedOut) {
      out({ loggedIn: false, authMethod: "none", apiProvider: "firstParty" });
      process.exitCode = 1;
      return;
    }
    out(env.ANTHROPIC_API_KEY ? { loggedIn: true, authMethod: "api_key" } : { loggedIn: true, authMethod: "claude.ai", subscriptionType: "max" });
    return;
  }
  if (argv[0] === "login" && argv[1] === "status") {
    log();
    if (!signedOut && (!auth || existsSync(auth))) console.log("Logged in using ChatGPT");
    else {
      console.log("Not logged in");
      process.exitCode = 1;
    }
    return;
  }
  if (argv[0] === "login" && argv[1] === "--device-auth") {
    log();
    if (existsSync(file("device-silent"))) {
      // A CLI whose output changed: a code-shaped token but no link, then nothing.
      console.log("Starting device login ABCD-1234 ...");
      setInterval(() => {}, 1000);
      return;
    }
    // The shape codex-cli 0.167.2 prints, colours included.
    process.stdout.write("\nWelcome to Codex [v0.0.0-fake]\n\nFollow these steps to sign in with ChatGPT using device code authorization:\n\n1. Open this link in your browser and sign in to your account\n   \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m\n\n2. Enter this one-time code \x1b[90m(expires in 15 minutes)\x1b[0m\n   \x1b[94mFAKE-1A2B3\x1b[0m\n\n");
    const timer = setInterval(() => {
      const t = readOr(file("device-ok"));
      if (!existsSync(file("device-ok"))) return;
      clearInterval(timer);
      if (t === "fail") {
        console.error("Error logging in with device code: device code expired");
        process.exit(1);
      }
      writeFileSync(auth, JSON.stringify({ fake: true }), { mode: 0o600 });
      console.log("Successfully logged in");
      process.exit(0);
    }, 50);
    return;
  }
  if (argv[0] === "logout" || (argv[0] === "auth" && argv[1] === "logout")) {
    log();
    if (auth) rmSync(auth, { force: true });
    console.log("Successfully logged out");
    return;
  }

  const claude = argv[0] === "-p";
  const codex = argv[0] === "exec";
  if (!claude && !codex) {
    log();
    console.error(`fake-coach-cli: unknown command ${argv.slice(0, 2).join(" ")}`);
    process.exitCode = 2;
    return;
  }
  let input = "";
  process.stdin.on("data", (d) => (input += d)).on("end", async () => {
    log(input);
    const slow = Number(readOr(file("slow")) || 0);
    if (slow) await new Promise((r) => setTimeout(r, slow));
    const candidate = /This turn's plan candidate: ([^\s]+)\./.exec(argv.join(" "))?.[1] ?? "plan/plan.json";
    if (input.includes("PROPOSE PLAN") && existsSync(file("good-plan.json"))) {
      const plan = JSON.parse(readFileSync(file("good-plan.json"), "utf8"));
      plan.next = "Play the proposed slow roll";
      writeFileSync(candidate, JSON.stringify(plan, null, 2));
    }
    if (input.includes("TRY LIVE WRITE")) {
      const results: boolean[] = [];
      for (const target of ["plan/plan.json", "plan/archive/hostile.json"]) {
        try { writeFileSync(target, "hostile"); results.push(false); } catch { results.push(true); }
      }
      writeFileSync(file("denied-writes.json"), JSON.stringify(results));
    }
    if (input.includes("BREAK THE PLAN")) writeFileSync(candidate, '{"version": 2}');
    if (input.includes("Fix the file") && existsSync(file("good-plan.json"))) copyFileSync(file("good-plan.json"), candidate);
    const key = env.ANTHROPIC_API_KEY ?? env.CODEX_API_KEY ?? env.STRUNA_ENDPOINT_KEY ?? env.AWS_BEARER_TOKEN_BEDROCK ?? "";
    if (claude) {
      const resume = argv.includes("--resume") ? argv[argv.indexOf("--resume") + 1]! : "";
      out({ type: "system", subtype: "init", session_id: resume || "fake-claude-1", apiKeySource: env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY" : "none" });
      if (fail === "401" || fail === "429") {
        out({ type: "result", is_error: true, result: fail === "401" ? `API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key ${key}"}}` : "API Error: 429 rate_limit_error: Number of request tokens has exceeded your per-minute rate limit" });
        process.exitCode = 1;
        return;
      }
      out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: resume ? "Fixed." : "Done." } } });
      out({ type: "result", is_error: false, result: "unused" });
      return;
    }
    const resume = argv[1] === "resume" ? argv[2]! : "";
    out({ type: "thread.started", thread_id: resume || "fake-codex-1" });
    if (fail === "401" || fail === "429") {
      out({ type: "turn.failed", error: { message: fail === "401" ? `unexpected status 401 Unauthorized: Incorrect API key provided: ${key}` : "exceeded retry limit, last status: 429 Too Many Requests" } });
      process.exitCode = 1;
      return;
    }
    out({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: resume ? "Fixed." : "Done." } });
    out({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
  });
}

if (import.meta.main) main();
