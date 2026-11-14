/**
 * Offline gate for the Codex key coaches (`endpoint`, `openai`): can a command the model runs read the
 * key Codex was given? No real key and no model call. A stub Responses API on 127.0.0.1 answers the first
 * request with one shell tool call that prints the environment (its own, PID 1's, the parent's and every
 * other process it can see) and tries to read the saved key file; the real `codex exec` runs it as the
 * app's coach, through the app's own arguments, environment and permission profile, with a dummy key.
 * Codex sends the command's output back in its next request: the gate passes when the dummy key is not
 * in it, and the output shows the command really ran.
 *
 *   node scripts/codex-env-leak-gate.ts <scratch-dir> [endpoint|openai|redirect|all]
 *
 * `endpoint` runs exactly the app's arguments. `openai` cannot reach the stub with them, since Codex's
 * built-in OpenAI provider goes to api.openai.com: the gate runs Codex through a wrapper that adds one
 * `-c openai_base_url=<stub>` and changes nothing else. `redirect` checks the endpoint's address rules:
 * the stub answers every request with a 302 to a second stub on GATE_PORT+1 (another origin, as a hostile
 * provider would send the coach to a LAN or metadata address), and the gate passes when that one gets no
 * request at all, so neither the prompt, the `api-key` header nor its answer travelled. The default is `all`.
 *
 * Uses CODEX_BIN, else `mise which codex`, else `codex` on PATH; without one it says so and exits 0.
 * GATE_PORT picks the stub's port (default 5197). Exits 1 when the key leaks or the check cannot run.
 * GATE_DROP_ENV_POLICY=1 is the negative control: the wrapper leaves out the app's two
 * `shell_environment_policy` settings, and the gate is expected to fail.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { join, resolve } from "node:path";

const dir = process.argv[2] ? resolve(process.argv[2]) : "";
const which = process.argv[3] ?? "all";
if (!dir || !["endpoint", "openai", "redirect", "all"].includes(which)) {
  console.error("usage: node scripts/codex-env-leak-gate.ts <scratch-dir> [endpoint|openai|redirect|all]");
  process.exit(2);
}
const port = Number(process.env.GATE_PORT ?? 5197);
/** Negative control: leave out the app's `shell_environment_policy` settings; the gate should then fail. */
const dropPolicy = process.env.GATE_DROP_ENV_POLICY === "1";
const DUMMY = `sk-gate-${Date.now().toString(36)}-DUMMYKEY-not-real`;
const mask = (s: string) => s.replaceAll(DUMMY, "[the dummy key]");
/**
 * The shell command the stub asks for: environments and the key file (whose path is filled in per run).
 * Codex shortens long tool output in the middle, so the command also counts, inside the sandbox, the lines
 * that hold the dummy key's fixed part (the command itself never holds the whole key) and prints the count
 * at the end, where it survives any shortening.
 */
const command = (storeFile: string) => {
  const reads = [
    "env",
    "cat /proc/1/environ 2>/dev/null | tr '\\0' '\\n'",
    "cat /proc/$PPID/environ 2>/dev/null | tr '\\0' '\\n'",
    "for f in /proc/[0-9]*/environ; do tr '\\0' '\\n' < \"$f\"; done 2>/dev/null",
    `cat ${JSON.stringify(storeFile)} 2>&1 | head -c 2000; echo`,
  ].join("; ");
  return `${reads}; echo GATE-PROCS $(ls -d /proc/[0-9]* | wc -l); echo GATE-HITS $( { ${reads}; } 2>&1 | grep -c DUMMYKEY); echo GATE-RAN`;
};

function findCodex(): string | null {
  const tries: (() => string)[] = [() => process.env.CODEX_BIN ?? "", () => execFileSync("mise", ["which", "codex"], { encoding: "utf8" }).trim(), () => execFileSync("sh", ["-c", "command -v codex"], { encoding: "utf8" }).trim()];
  for (const t of tries) {
    try {
      const p = t();
      if (p) {
        execFileSync(p, ["--version"], { stdio: "ignore", timeout: 15_000 });
        return p;
      }
    } catch {}
  }
  return null;
}

const found = findCodex();
if (!found) {
  console.log("SKIP: no codex binary found (set CODEX_BIN); the env-leak gate did not run.");
  process.exit(0);
}
const codex: string = found;
process.env.CODEX_BIN = codex;

rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

// ---- The stub Responses API.
type Seen = { method: string; path: string; body: string; keyed: boolean };
let seen: Seen[] = [];
let COMMAND = "";
const read = (req: IncomingMessage) =>
  new Promise<string>((r) => {
    let b = "";
    req.on("data", (c: Buffer) => (b += c.toString()));
    req.on("end", () => r(b));
  });
const sse = (events: Record<string, unknown>[]) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const usage = { input_tokens: 1, input_tokens_details: null, output_tokens: 1, output_tokens_details: null, total_tokens: 2 };

/** One shell call in whatever form this Codex offers: `shell`, `exec_command` or `local_shell`. */
function toolCall(tools: { type?: string; name?: string }[]): Record<string, unknown> | null {
  const names = tools.map((t) => t.name ?? t.type ?? "");
  if (names.includes("shell")) return { type: "function_call", id: "fc_1", call_id: "call_1", name: "shell", arguments: JSON.stringify({ command: ["bash", "-c", COMMAND] }) };
  if (names.includes("exec_command")) return { type: "function_call", id: "fc_1", call_id: "call_1", name: "exec_command", arguments: JSON.stringify({ cmd: COMMAND }) };
  if (names.includes("shell_command")) return { type: "function_call", id: "fc_1", call_id: "call_1", name: "shell_command", arguments: JSON.stringify({ command: COMMAND }) };
  if (tools.some((t) => t.type === "local_shell")) return { type: "local_shell_call", id: "ls_1", call_id: "call_1", status: "completed", action: { type: "exec", command: ["bash", "-c", COMMAND], env: {} } };
  return null;
}

let toolNames: string[] = [];
/** The redirect check: every request to the stub is sent on to the second stub, which must never be asked. */
let redirecting = false;
const elsewhere: string[] = [];
const second = createServer(async (req, res) => {
  await read(req);
  elsewhere.push(`${req.method} ${req.url}${req.headers["api-key"] ? " (with the api-key header)" : ""}`);
  res.writeHead(403, { "content-type": "application/json" });
  res.end('{"AccessKeyId":"GATE-INTERNAL-SECRET"}');
});
await new Promise<void>((r, j) => second.once("error", j).listen(port + 1, "127.0.0.1", r));
const stub = createServer(async (req, res) => {
  const body = await read(req);
  if (redirecting) {
    seen.push({ method: req.method ?? "", path: req.url ?? "", body, keyed: false });
    res.writeHead(302, { location: `http://127.0.0.1:${port + 1}/latest/meta-data/iam/security-credentials/role` });
    res.end();
    return;
  }
  // Only whether the dummy key arrived as the Bearer token: the gate proves nothing if Codex never had it.
  seen.push({ method: req.method ?? "", path: req.url ?? "", body, keyed: req.headers.authorization === `Bearer ${DUMMY}` });
  if (req.method !== "POST" || !(req.url ?? "").endsWith("/responses")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"error":{"message":"not here"}}');
    return;
  }
  let json: { tools?: { type?: string; name?: string }[]; input?: unknown[] } = {};
  try {
    json = JSON.parse(body);
  } catch {}
  const answered = JSON.stringify(json.input ?? []).includes("call_1");
  res.writeHead(200, { "content-type": "text/event-stream" });
  if (!answered) {
    toolNames = (json.tools ?? []).map((t) => t.name ?? t.type ?? "?");
    const call = toolCall(json.tools ?? []);
    const item = call ?? { type: "message", id: "m_0", role: "assistant", content: [{ type: "output_text", text: "no shell tool offered" }] };
    res.end(sse([{ type: "response.created", response: { id: "resp_1" } }, { type: "response.output_item.done", output_index: 0, item }, { type: "response.completed", response: { id: "resp_1", usage } }]));
    return;
  }
  res.end(sse([{ type: "response.created", response: { id: "resp_2" } }, { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "m_1", role: "assistant", content: [{ type: "output_text", text: "Checked." }] } }, { type: "response.completed", response: { id: "resp_2", usage } }]));
});
await new Promise<void>((r, j) => stub.once("error", j).listen(port, "127.0.0.1", r));

const { config } = await import("../server/config.ts");
const { openDb } = await import("../server/db.ts");
const { codexInstallDir } = await import("../server/providers/codex.ts");
const { genericCoach } = await import("../server/generic/coach.ts");
const { credentialStore, STORE_FILE } = await import("../server/generic/credentials.ts");
const { coachPolicy } = await import("../server/generic/providers.ts");
const { ensureStudio } = await import("../server/generic/studio.ts");
const codexInstall = await codexInstallDir(codex);
if (!codexInstall) console.warn("warning: Codex's install folder was not found, so the app turns the Codex coaches off and this gate cannot run them");
console.log(`codex: ${codex} (${execFileSync(codex, ["--version"], { encoding: "utf8" }).trim()})`);

/** One coach through the gate; true when it passed. */
async function gate(id: "endpoint" | "openai"): Promise<boolean> {
  const run = join(dir, id);
  const home = join(run, "home");
  const state = join(run, "state");
  mkdirSync(run, { recursive: true });
  await ensureStudio(home);
  writeFileSync(join(home, "coach-notes.md"), "gate\n");
  const db = openDb(state);
  const store = credentialStore(state);
  const saved = new Date().toISOString();
  if (id === "endpoint") store.put("endpoint", { preset: "other", baseUrl: `http://127.0.0.1:${port}/v1`, key: DUMMY, header: "bearer", model: "gate-model", saved });
  else store.put("openai", { key: DUMMY, model: "gate-model", saved });
  config.codexBin = codex;
  if (id === "openai" || dropPolicy) {
    // A wrapper that changes only this: for `openai`, the built-in provider's address goes right after
    // `exec`; for the negative control, each `-c shell_environment_policy.*` pair is left out.
    const wrapper = join(run, "codex-wrapper.sh");
    const add = id === "openai" ? ` -c 'openai_base_url="http://127.0.0.1:${port}/v1"'` : "";
    const drop = dropPolicy
      ? `held=0\nfor a do\n  shift\n  case "$a" in shell_environment_policy.*) held=0; continue ;; esac\n  [ "$held" = 1 ] && set -- "$@" "$prev"\n  prev=$a; held=1\ndone\n[ "$held" = 1 ] && set -- "$@" "$prev"\n`
      : "";
    writeFileSync(wrapper, `#!/bin/sh\nfirst="$1"; shift\n${drop}exec ${JSON.stringify(codex)} "$first"${add} "$@"\n`);
    chmodSync(wrapper, 0o700);
    config.codexBin = wrapper;
  }
  seen = [];
  toolNames = [];
  COMMAND = command(join(state, STORE_FILE));
  console.log(`\n== ${id}`);
  try {
    const coach = genericCoach({ home, db, timeZone: "UTC", libraryDirs: [], web: true, appName: "Guitar Room" }, {}, { codexInstall, store, policy: coachPolicy({ local: true, codexSandboxed: Boolean(codexInstall) }) });
    const picked = coach.forProvider!(id)!;
    const system = typeof picked.profile.system === "string" ? picked.profile.system : await picked.profile.system();
    const events: { type: string; message?: string; text?: string }[] = [];
    const signal = AbortSignal.timeout(180_000);
    for await (const ev of picked.run({ system, prompt: "Run the check.", signal })) events.push(ev as never);

    const posts = seen.filter((s) => s.method === "POST" && s.path.endsWith("/responses"));
    const second = posts.find((p) => p.body.includes("call_1"));
    console.log(`requests to the stub: ${seen.map((s) => `${s.method} ${s.path}${s.keyed ? " (Bearer = the dummy key)" : ""}`).join(", ") || "none"}`);
    console.log(`tools offered: ${toolNames.join(", ") || "none"}`);
    for (const e of events) if (e.type === "error" || e.type === "notice") console.log(`${e.type}: ${mask(e.message ?? "").slice(0, 300)}`);
    if (!posts[0]?.keyed) {
      console.error("FAIL: Codex did not send the dummy key to the stub, so the check proves nothing.");
      return false;
    }
    if (!second) {
      console.error("FAIL: Codex never sent the command's output back, so the check could not run.");
      return false;
    }
    // What the command printed, as Codex sent it back (the dummy key masked), for a look by hand.
    writeFileSync(join(run, "tool-output.json"), mask(second.body));
    let output = "";
    try {
      const items = (JSON.parse(second.body).input ?? []) as { call_id?: string; output?: unknown }[];
      output = items.filter((i) => i.call_id === "call_1" && i.output !== undefined).map((i) => (typeof i.output === "string" ? i.output : JSON.stringify(i.output))).join("\n");
    } catch {}
    const ran = output.includes("GATE-RAN");
    const procs = /GATE-PROCS (\d+)/.exec(output)?.[1] ?? "?";
    // The whole request is searched, not only the tool output.
    const leaked = second.body.includes(DUMMY);
    const sawEnv = /(^|\n)PATH=/.test(output) && /(^|\n)HOME=/.test(output);
    const storeRead = output.includes('"version"');
    const hits = /GATE-HITS (\d+)/.exec(output)?.[1];
    const shortened = /truncated/i.test(output);
    console.log(`the command ran: ${ran}; its output shows an environment: ${sawEnv}; processes it could see: ${procs}; it could read the key file: ${storeRead}; lines with the key seen inside the sandbox: ${hits ?? "?"}; output shortened by Codex: ${shortened}; the dummy key is in the request: ${leaked}`);
    if (!ran || !sawEnv || hits === undefined) {
      console.error("FAIL: the tool output does not show the command's environment, so the check proves nothing.");
      return false;
    }
    if (leaked || storeRead || hits !== "0") {
      console.error(`FAIL: a command the model ran could read the ${id} key. Keep the Codex key coaches hidden.`);
      return false;
    }
    console.log(`PASS (${id}): commands the model runs cannot read the key Codex was given.`);
    return true;
  } catch (e) {
    console.error(`FAIL: ${mask(String((e as Error)?.message ?? e))}`);
    return false;
  } finally {
    db.close();
  }
}

/** The redirect check: the endpoint 302s every request to another origin; that origin must hear nothing. */
async function redirectGate(): Promise<boolean> {
  const run = join(dir, "redirect");
  const home = join(run, "home");
  const state = join(run, "state");
  mkdirSync(run, { recursive: true });
  await ensureStudio(home);
  const db = openDb(state);
  const store = credentialStore(state);
  store.put("endpoint", { preset: "other", baseUrl: `http://127.0.0.1:${port}/v1`, key: DUMMY, header: "api-key", model: "gate-model", saved: new Date().toISOString() });
  config.codexBin = codex;
  seen = [];
  elsewhere.length = 0;
  redirecting = true;
  console.log("\n== redirect");
  try {
    const coach = genericCoach({ home, db, timeZone: "UTC", libraryDirs: [], web: false, appName: "Guitar Room" }, {}, { codexInstall, store, policy: coachPolicy({ local: true, codexSandboxed: Boolean(codexInstall) }) });
    const picked = coach.forProvider!("endpoint")!;
    const system = typeof picked.profile.system === "string" ? picked.profile.system : await picked.profile.system();
    const events: { type: string; message?: string }[] = [];
    for await (const ev of picked.run({ system, prompt: "hello", signal: AbortSignal.timeout(120_000) })) events.push(ev as never);
    const told = events.filter((e) => e.type === "error" || e.type === "notice").map((e) => mask(e.message ?? ""));
    console.log(`requests to the endpoint: ${seen.map((s) => `${s.method} ${s.path}`).join(", ") || "none"}`);
    console.log(`requests to the other origin: ${elsewhere.join(", ") || "none"}`);
    for (const t of told) console.log(`told the player: ${t.slice(0, 300)}`);
    if (!seen.some((s) => s.method === "POST" && s.path.endsWith("/responses"))) {
      console.error("FAIL: Codex never asked the endpoint, so the check proves nothing.");
      return false;
    }
    if (elsewhere.length || told.some((t) => t.includes("GATE-INTERNAL-SECRET"))) {
      console.error("FAIL: a redirect from the endpoint reached another origin.");
      return false;
    }
    console.log("PASS (redirect): a redirect from the endpoint to another origin was refused before anything was sent.");
    return true;
  } catch (e) {
    console.error(`FAIL: ${mask(String((e as Error)?.message ?? e))}`);
    return false;
  } finally {
    redirecting = false;
    db.close();
  }
}

let failed = false;
try {
  for (const id of which === "all" ? (["endpoint", "openai", "redirect"] as const) : [which as "endpoint" | "openai" | "redirect"]) {
    if (!(id === "redirect" ? await redirectGate() : await gate(id))) failed = true;
  }
} finally {
  stub.close();
  second.close();
}
process.exit(failed ? 1 : 0);
