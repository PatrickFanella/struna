import { type ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { type CoachProfile, type HostStatus, type ProviderList, providerStatus, type Run } from "../chat.ts";
import { config } from "../config.ts";
import type { Conversations } from "../conversations.ts";
import { HttpError, readJson, route, send } from "../http.ts";
import { type ClaudeOptions, claudeChat } from "../providers/claude.ts";
import { type CodexOptions, codexChat, ENDPOINT_KEY_ENV } from "../providers/codex.ts";
import { appEnv, type ChatEvent, type ChatRequest } from "../providers/process.ts";
import { type CredentialStore, checkBaseUrl, type Entry, hint, type Lookup, PRESETS, setupChanged, type Stored, type StoredId, validateInput } from "./credentials.ts";
import { endpointProxy, PROXY_VARS, proxyEnv, upstreamProxy } from "./egress.ts";

const execFileP = promisify(execFile);

/**
 * Which coaches this instance offers (studio mode). "Locally hosted" means loopback TCP with the access
 * token: the player is whoever runs the server. Elsewhere the operator decides:
 * - host logins (this computer's `claude` and `codex`): on when locally hosted, else STRUNA_COACH_HOST_LOGINS=1; "0" turns them off;
 * - ChatGPT sign-in from the web: when locally hosted, or STRUNA_COACH_DEVICE_SIGNIN=1;
 * - keys and endpoints: when locally hosted, or with REQUIRE_USER, since anyone who can open the instance spends them;
 * - endpoints on loopback or a private network: when locally hosted, or STRUNA_COACH_PRIVATE_ENDPOINTS=1.
 * `codexSandboxed` says whether Codex runs under the permission profile that keeps it out of the state
 * folder (its install folder was found). Without it every Codex coach is off: the workspace-write
 * sandbox limits only writes, so a command could read the saved keys and the ChatGPT login.
 */
export type CoachPolicy = { planSandbox?: { claude: { ok: boolean; detail: string }; codex: { ok: boolean; detail: string } }; local: boolean; hostLogins: boolean; deviceSignIn: boolean; keys: boolean; privateEndpoints: boolean; codexSandboxed: boolean; budgetUsd: number; hostName: string; lookup?: Lookup | undefined };

export function coachPolicy(o: { local: boolean; hostLogins?: boolean | undefined; deviceSignIn?: boolean; requireUser?: boolean; privateEndpoints?: boolean; codexSandboxed?: boolean; budgetUsd?: number; hostName?: string; lookup?: Lookup }): CoachPolicy {
  return {
    local: o.local,
    hostLogins: o.hostLogins ?? o.local,
    deviceSignIn: o.local || Boolean(o.deviceSignIn),
    keys: o.local || Boolean(o.requireUser),
    privateEndpoints: o.local || Boolean(o.privateEndpoints),
    codexSandboxed: Boolean(o.codexSandboxed),
    budgetUsd: o.budgetUsd ?? 2,
    hostName: o.hostName ?? hostname(),
    lookup: o.lookup,
  };
}

/** A loopback listen address: the instance is locally hosted when it also uses the access token. */
export const isLoopback = (host: string) => host === "localhost" || host === "::1" || host === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(host);

/**
 * Locally hosted: loopback TCP with the access token, and nothing that says it is reached from elsewhere.
 * A non-loopback name in ALLOWED_HOSTS only arrives through a proxy or a tunnel, and REQUIRE_USER only
 * means anything behind Authelia: either one gives the remote defaults, even on loopback TCP.
 */
export function locallyHosted(o: { access: boolean; host: string; allowedHosts: Iterable<string>; requireUser?: string | undefined }): boolean {
  return o.access && isLoopback(o.host) && [...o.allowedHosts].every((h) => isLoopback(h.replace(/:\d+$/, ""))) && !o.requireUser;
}

export type ProviderId = "claude" | "codex" | "chatgpt" | "anthropic" | "openai" | "bedrock" | "endpoint";
type Setup = "host" | "device" | "key" | "endpoint";
type Catalog = { id: ProviderId; label: string; via: "Claude Code" | "Codex"; setup: Setup; web: boolean; missing?: string };

/** The coaches, in the order the settings show them. Each id has at most one saved credential. */
export const CATALOG: Catalog[] = [
  { id: "claude", label: "Claude plan (this computer)", via: "Claude Code", setup: "host", web: true },
  { id: "codex", label: "ChatGPT plan (this computer)", via: "Codex", setup: "host", web: true },
  { id: "chatgpt", label: "ChatGPT plan (signed in here)", via: "Codex", setup: "device", web: true, missing: "ChatGPT is not signed in here. Sign in under Coach settings." },
  { id: "anthropic", label: "Anthropic API key", via: "Claude Code", setup: "key", web: true, missing: "No Anthropic API key is saved. Add one under Coach settings." },
  { id: "openai", label: "OpenAI API key", via: "Codex", setup: "key", web: true, missing: "No OpenAI API key is saved. Add one under Coach settings." },
  { id: "bedrock", label: "Amazon Bedrock (Claude)", via: "Claude Code", setup: "key", web: false, missing: "No Amazon Bedrock key is saved. Add one under Coach settings." },
  { id: "endpoint", label: "Other provider (Responses API)", via: "Codex", setup: "endpoint", web: false, missing: "No provider is set up. Add one under Coach settings." },
];
const entryOf = (id: string) => CATALOG.find((c) => c.id === id);

/** Whether this instance offers the coach at all; one it does not is left out of the list and refused. */
export function offered(id: ProviderId, p: CoachPolicy): boolean {
  if (id === "claude" || id === "codex") return p.hostLogins;
  if (id === "chatgpt") return p.deviceSignIn;
  return p.keys;
}

/** Why a Codex coach is off whatever the policy says: its sandbox could not keep it out of the saved keys. */
export const CODEX_UNSANDBOXED = "Codex's install folder was not found, so its sandbox cannot keep it from reading the saved keys and logins. Set CODEX_BIN to the real Codex binary's full path.";
/** Offered, but unusable here: the reason, or null. */
const blocked = (id: ProviderId, p: CoachPolicy): string | null => {
  if (entryOf(id)?.via === "Codex" && !p.codexSandboxed) return CODEX_UNSANDBOXED;
  const probe = p.planSandbox?.[entryOf(id)?.via === "Codex" ? "codex" : "claude"];
  return probe && !probe.ok ? probe.detail : null;
};

function refusal(id: ProviderId, p: CoachPolicy): string {
  if (id === "claude" || id === "codex") return "Coaching on this computer's own Claude and ChatGPT logins is turned off here. Start a new conversation with another coach.";
  if (id === "chatgpt") return "Signing in to ChatGPT from the app is turned off here. Start a new conversation with another coach.";
  return p.local ? "This coach is turned off here." : "API keys and provider endpoints are turned off here: the operator must set REQUIRE_USER, so only one signed-in person spends them.";
}

/** Each saved secret replaced by its hint, longest first, so no part of one is left. */
export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of [...secrets].filter((x) => x.length >= 4).sort((a, b) => b.length - a.length)) out = out.split(s).join(hint(s));
  return out;
}

const AUTH = /\b40[13]\b|unauthori[sz]ed|forbidden|invalid[^\n]{0,40}\b(api[ _-]?)?key\b|authenticat/i;
const LIMIT = /\b429\b|rate.?limit|quota|credit balance|usage limit|too many requests/i;

/** An error from a coach the app signs in, for the player: its label in front, and one hint for a refused key or a used-up limit. */
export function plainError(text: string, o: { label: string; chatgpt?: boolean }): string {
  const t = text.trim().slice(0, 800);
  // The app's own endpoint proxy refused a hop: a 403 that says nothing about the key.
  const hintText = /Struna refused/.test(t) ? "" : AUTH.test(t)
    ? o.chatgpt
      ? "The ChatGPT sign-in has expired or was revoked. Sign in again under Coach settings."
      : "Check or replace the key under Coach settings."
    : LIMIT.test(t)
      ? "The usage limit or credit is used up. Try again later, or check the account's billing."
      : "";
  return `${o.label}: ${t}${hintText ? ` ${hintText}` : ""}`;
}

/** How much of `text`'s end could be the start of a secret, so it is held until the next piece comes. */
function heldBack(text: string, secrets: string[]): number {
  let n = 0;
  for (const s of secrets) {
    for (let k = Math.min(text.length, s.length - 1); k > n; k--) {
      if (text.endsWith(s.slice(0, k))) {
        n = k;
        break;
      }
    }
  }
  return n;
}

/**
 * A run whose errors and notices are redacted and made plain, and whose reply has every saved secret
 * replaced by its hint before it reaches the browser or the database (a streamed reply can split a
 * secret across pieces, so a piece's end that could start one waits for the next). A run that throws
 * becomes one such error.
 */
export async function* guardedRun(inner: AsyncGenerator<ChatEvent>, o: { label: string; secrets: string[]; chatgpt?: boolean }): AsyncGenerator<ChatEvent> {
  const secrets = o.secrets.filter((x) => x.length >= 4);
  const plain = (m: string) => plainError(redact(m, secrets), o);
  let pending = "";
  const flush = function* (): Generator<ChatEvent> {
    if (pending) yield { type: "delta", text: redact(pending, secrets) };
    pending = "";
  };
  try {
    for await (const ev of inner) {
      if (ev.type === "delta") {
        const text = redact(pending + ev.text, secrets);
        const keep = heldBack(text, secrets);
        pending = text.slice(text.length - keep);
        if (text.length > keep) yield { type: "delta", text: text.slice(0, text.length - keep) };
        continue;
      }
      yield* flush();
      if (ev.type === "error") yield { type: "error", message: plain(ev.message) };
      else if (ev.type === "notice") yield { type: "notice", message: redact(ev.message, secrets) };
      else yield ev;
    }
    yield* flush();
  } catch (e) {
    yield* flush();
    yield { type: "error", message: plain(String((e as Error)?.message ?? e)) };
  }
}

export type ProviderCtx = { build: (web: boolean) => CoachProfile; store: CredentialStore; policy: CoachPolicy; web: boolean };
/** What the settings rows and routes need: no profile. */
export type RowCtx = Omit<ProviderCtx, "build">;

/** The model a key coach uses when none is saved: Claude Code's own default with a key is the costliest. */
export const DEFAULT_MODEL: Partial<Record<ProviderId, string>> = { anthropic: "sonnet" };

/**
 * What a coach the app signs in adds to the studio options: its own config folder, its credential (in
 * the environment only, never in argv), its model and, for Codex, the shell's environment policy.
 * Null when nothing is saved for it.
 */
function launch(id: ProviderId, stored: Stored, ctx: ProviderCtx): { claude?: Partial<ClaudeOptions>; codex?: Partial<CodexOptions> } | null {
  const dir = ctx.store.dir(id);
  const budgetUsd = ctx.policy.budgetUsd;
  if (id === "anthropic") {
    const e = stored.anthropic;
    if (!e) return null;
    return { claude: { env: appEnv({ CLAUDE_CONFIG_DIR: dir, ANTHROPIC_API_KEY: e.key }), model: e.model ?? DEFAULT_MODEL.anthropic, keySource: "ANTHROPIC_API_KEY", budgetUsd } };
  }
  if (id === "bedrock") {
    const e = stored.bedrock;
    if (!e) return null;
    // The host's AWS profile or instance metadata must never stand in for the player's key.
    const env = appEnv({ CLAUDE_CONFIG_DIR: dir, CLAUDE_CODE_USE_BEDROCK: "1", AWS_REGION: e.region, AWS_BEARER_TOKEN_BEDROCK: e.key, AWS_CONFIG_FILE: "/dev/null", AWS_SHARED_CREDENTIALS_FILE: "/dev/null", AWS_EC2_METADATA_DISABLED: "true" });
    return { claude: { env, model: e.model ?? undefined, budgetUsd } };
  }
  if (id === "openai") {
    const e = stored.openai;
    if (!e) return null;
    return { codex: { env: appEnv({ CODEX_HOME: dir, CODEX_API_KEY: e.key }), model: e.model ?? undefined, hideEnv: true } };
  }
  if (id === "chatgpt") {
    if (!existsSync(join(dir, "auth.json"))) return null;
    return { codex: { env: appEnv({ CODEX_HOME: dir }), model: stored.chatgpt?.model ?? undefined, hideEnv: true } };
  }
  if (id === "endpoint") {
    const e = stored.endpoint;
    if (!e) return null;
    const env = appEnv({ CODEX_HOME: dir, ...(e.key ? { [ENDPOINT_KEY_ENV]: e.key } : {}) });
    return { codex: { env, model: e.model, hideEnv: true, endpoint: { baseUrl: e.baseUrl, header: e.header, key: Boolean(e.key) } } };
  }
  return null;
}

/**
 * The profile and run for one coach id. The host rows run exactly as before; the others read the store
 * on every turn, so a new key applies at once, and their errors are redacted and labelled.
 */
export function providerFor(id: string, ctx: ProviderCtx): { profile: CoachProfile; run: Run } | null {
  const cat = entryOf(id);
  if (!cat) return null;
  if (!offered(cat.id, ctx.policy)) throw new HttpError(400, refusal(cat.id, ctx.policy));
  const why = blocked(cat.id, ctx.policy);
  if (why) throw new HttpError(400, why);
  if (cat.setup === "host") {
    const profile = ctx.build(ctx.web);
    return { profile, run: cat.id === "claude" ? (req) => claudeChat(req, profile.claude) : (req) => codexChat(req, profile.codex) };
  }
  const profile = ctx.build(ctx.web && cat.web);
  const run = async function* (req: ChatRequest): AsyncGenerator<ChatEvent> {
    let stored: Stored;
    try {
      stored = ctx.store.read();
    } catch (e) {
      yield { type: "error", message: `${cat.label}: ${(e as Error).message}` };
      return;
    }
    const extra = launch(cat.id, stored, ctx);
    if (!extra) {
      yield { type: "error", message: cat.missing! };
      return;
    }
    let proxy: { close: () => void } | null = null;
    if (extra.codex?.endpoint) {
      const { baseUrl } = extra.codex.endpoint;
      // DNS can change after the address was saved: check it again before every turn.
      try {
        await checkBaseUrl(baseUrl, { allowPrivate: ctx.policy.privateEndpoints, key: extra.codex.endpoint.key, lookup: ctx.policy.lookup });
      } catch (e) {
        yield { type: "error", message: `${cat.label}: ${(e as Error).message}` };
        return;
      }
      const upstream = upstreamProxy();
      if (upstream) {
        yield { type: "error", message: `${cat.label}: this server was started with ${upstream} set. This coach goes through the app's own proxy, which keeps it to the provider's address, and cannot pass through another one. Unset ${upstream} for the server, or use another coach.` };
        return;
      }
      // Codex makes the requests itself and follows redirects: its only way out is a proxy that lets
      // through nothing but the provider's own origin, at an address it checks itself.
      const egress = await endpointProxy(baseUrl, { allowPrivate: ctx.policy.privateEndpoints, lookup: ctx.policy.lookup });
      proxy = egress;
      const env = { ...extra.codex.env };
      for (const k of PROXY_VARS) delete env[k];
      extra.codex.env = { ...env, ...proxyEnv(egress.url) };
    }
    try {
      const inner = extra.claude ? claudeChat(req, { ...profile.claude, ...extra.claude }) : codexChat(req, { ...profile.codex, ...extra.codex });
      yield* guardedRun(inner, { label: cat.label, secrets: ctx.store.secrets(), chatgpt: cat.id === "chatgpt" });
    } finally {
      proxy?.close();
    }
  };
  return { profile, run };
}

/** One coach as the settings show it. Secrets appear only as their hint. */
export type ProviderRow = {
  id: ProviderId;
  label: string;
  via: "Claude Code" | "Codex";
  setup: Setup;
  /** Ready to chat. */
  ok: boolean;
  /** The status line. */
  detail: string;
  /** Whether this coach may use the web (also off when STRUNA_COACH_WEB=0). */
  web: boolean;
  /** The saved model, or the default; null for the CLI's own default. */
  model: string | null;
  /** Policy and help text to show with the row. */
  notes: string[];
  /** Host rows: the commands to run in a terminal. */
  command?: string;
  signOut?: string;
  /** Key and endpoint rows. */
  hint?: string | null;
  saved?: string | null;
  region?: string | null;
  preset?: string | null;
  baseUrl?: string | null;
  header?: "bearer" | "api-key" | null;
  presets?: typeof PRESETS;
  experimental?: boolean;
  /** Offered, but it cannot run here (the status line says why): the settings show no actions for it. */
  unavailable?: boolean;
};

const yes = (s: HostStatus, host: string): string => (s.ok ? `Signed in on ${host} (${s.detail})` : /^not (signed|logged) in$/i.test(s.detail) ? `Not signed in on ${host}` : `Not signed in on ${host} (${s.detail})`);

async function chatgptStatus(dir: string): Promise<HostStatus> {
  if (!existsSync(join(dir, "auth.json"))) return { ok: false, detail: "Not signed in" };
  return execFileP(config.codexBin, ["login", "status"], { env: appEnv({ CODEX_HOME: dir }), timeout: 15_000 })
    .then(({ stdout, stderr }) => {
      const line = `${stdout}${stderr}`.trim().split("\n").pop() ?? "";
      return /ChatGPT/i.test(line) ? { ok: true, detail: "Signed in here" } : { ok: false, detail: "Not signed in" };
    })
    .catch(() => ({ ok: false, detail: "Not signed in" }));
}

/** Said on the coaches without the web; "Save a copy" is a button under Materials. */
const NO_WEB_NOTE = 'No web search with this coach. Links it suggests are only saved when you press "Save a copy" under Materials.';

/** One row, from the store and (for host rows) the host's statuses. */
export async function rowFor(id: ProviderId, ctx: RowCtx, host?: { claude: HostStatus; codex: HostStatus }): Promise<ProviderRow> {
  const cat = entryOf(id)!;
  const h = ctx.policy.hostName;
  const base = { id, label: cat.label, via: cat.via, setup: cat.setup, web: ctx.web && cat.web };
  const why = blocked(id, ctx.policy);
  if (why) return { ...base, ok: false, detail: why, model: null, notes: [], unavailable: true };
  if (id === "claude" || id === "codex") {
    const st = (host ?? (await providerStatus({ plain: true })))[id];
    const orKey = offered("anthropic", ctx.policy) ? ", or add an Anthropic API key" : "";
    return id === "claude"
      ? { ...base, ok: st.ok, detail: yes(st, h), model: config.claudeModel ?? null, command: "claude auth login", signOut: "claude auth logout", notes: [`Anthropic does not let apps sign you in to a Claude plan. Run \`claude auth login\` yourself on ${h}${orKey}.`] }
      : { ...base, ok: st.ok, detail: yes(st, h), model: config.codexModel ?? null, command: "codex login --device-auth", signOut: "codex logout", notes: [`Run \`codex login --device-auth\` on ${h}, as the account that runs this app.`] };
  }
  let stored: Stored;
  try {
    stored = ctx.store.read();
  } catch (e) {
    return { ...base, ok: false, detail: (e as Error).message, model: null, notes: [] };
  }
  if (id === "chatgpt") {
    const st = await chatgptStatus(ctx.store.dir("chatgpt"));
    return { ...base, ok: st.ok, detail: st.detail, model: stored.chatgpt?.model ?? null, notes: ["First turn on device code sign-in in ChatGPT → Settings → Security (a workspace admin does this for Business)."] };
  }
  if (id === "endpoint") {
    const e = stored.endpoint;
    const preset = PRESETS.find((p) => p.id === e?.preset);
    const where = e ? new URL(e.baseUrl).host : "";
    return {
      ...base,
      ok: Boolean(e),
      detail: e ? [preset?.label ?? "Other", where, e.model, e.key ? `key ending ${hint(e.key)}` : "no key"].join(" · ") : "Not set up",
      model: e?.model ?? null,
      hint: e?.key ? hint(e.key) : null,
      saved: e?.saved ?? null,
      preset: e?.preset ?? null,
      baseUrl: e?.baseUrl ?? null,
      header: e?.header ?? null,
      presets: PRESETS,
      experimental: true,
      notes: ["Needs a provider that speaks the OpenAI Responses API. DeepSeek (https://api.deepseek.com) and Together (https://api.together.ai/v1) work under Other. Gemini, Mistral and others: use OpenRouter.", NO_WEB_NOTE],
    };
  }
  const e = stored[id as "anthropic" | "openai" | "bedrock"];
  const model = e?.model ?? DEFAULT_MODEL[id] ?? null;
  const notes =
    id === "anthropic"
      ? ["If your Claude plan includes API credits, create the key in the Console organisation linked to that plan."]
      : id === "bedrock"
        ? [NO_WEB_NOTE]
        : [];
  const region = id === "bedrock" ? ((e as { region?: string } | undefined)?.region ?? null) : undefined;
  return {
    ...base,
    ok: Boolean(e),
    detail: e ? [hint(e.key) === "saved" ? "Key saved" : `Key ending ${hint(e.key)}`, model ?? "default model", ...(region ? [region] : [])].join(" · ") : "No key saved",
    model,
    hint: e ? hint(e.key) : null,
    saved: e?.saved ?? null,
    ...(region !== undefined ? { region } : {}),
    notes,
  };
}

/** What `/api/providers` adds in the studio mode: the host statuses and every coach this instance offers. */
export async function providerRows(ctx: RowCtx): Promise<ProviderList> {
  const off = { ok: false, detail: "turned off" };
  const host = ctx.policy.hostLogins ? await providerStatus({ plain: true }) : { claude: off, codex: off };
  const list = await Promise.all(CATALOG.filter((c) => offered(c.id, ctx.policy)).map((c) => rowFor(c.id, ctx, host)));
  return { ...host, deviceSignIn: ctx.policy.deviceSignIn, list };
}

// ---- ChatGPT device-code sign-in, run by Codex itself in the app's own CODEX_HOME.

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g;
const URL_RE = /https:\/\/auth\.openai\.com\/\S+/;
const CODE_RE = /\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/;
const CODE_ALL = /\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/g;
const SHOW_MS = 20_000;
const LOGIN_MS = 15 * 60_000;

export type LoginView = { state: "idle" | "waiting" | "done" | "failed"; url?: string; code?: string; expiresAt?: string; detail?: string };

type Job = { state: "starting" | LoginView["state"]; child?: ChildProcess; url?: string; code?: string; expiresAt?: string; detail?: string; ready: Promise<void>; cancelled?: boolean; timer?: ReturnType<typeof setTimeout> };

/** The last thing the CLI printed, with anything shaped like a sign-in code taken out. */
const lastLine = (out: string) => (out.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "(nothing)").replace(CODE_ALL, "[code]").slice(0, 200);

/**
 * The coach routes (studio mode): save, replace and remove a coach's settings, and the ChatGPT
 * device sign-in. Every non-GET route sits behind the app's header check and the access token or edge.
 * `stop` ends a running sign-in, for the server's exit.
 */
export function providerRoutes(ctx: RowCtx, convs: Conversations, opts: { codexBin?: string; showMs?: number; loginMs?: number } = {}): { stop: () => void } {
  const codexBin = opts.codexBin ?? config.codexBin;
  let job: Job | null = null;

  const view = (j: Job | null): LoginView => {
    if (!j) return { state: "idle" };
    const state = j.state === "starting" ? "waiting" : j.state;
    return { state, ...(j.url ? { url: j.url } : {}), ...(j.code && state === "waiting" ? { code: j.code } : {}), ...(j.expiresAt && state === "waiting" ? { expiresAt: j.expiresAt } : {}), ...(j.detail ? { detail: j.detail } : {}) };
  };
  const end = (j: Job, state: "done" | "failed", detail?: string) => {
    if (j.timer) clearTimeout(j.timer);
    j.state = state;
    if (detail) j.detail = detail;
    if (j.child && j.child.exitCode === null && j.child.signalCode === null) j.child.kill("SIGTERM");
  };
  const cancel = () => {
    if (!job) return;
    job.cancelled = true;
    if (job.timer) clearTimeout(job.timer);
    if (job.child && job.child.exitCode === null && job.child.signalCode === null) job.child.kill("SIGTERM");
    job = null;
  };

  const start = (): Job => {
    const home = ctx.store.dir("chatgpt");
    const env = appEnv({ CODEX_HOME: home });
    let out = "";
    let resolveReady!: () => void;
    const j: Job = { state: "starting", ready: new Promise<void>((r) => (resolveReady = r)) };
    const child = spawn(codexBin, ["login", "--device-auth"], { cwd: home, env, stdio: ["ignore", "pipe", "pipe"] });
    j.child = child;
    // The output holds the one-time code: kept in memory for the player, never logged.
    const take = (b: Buffer) => {
      out = (out + b.toString().replace(ANSI, "")).slice(-8000);
      if (j.state !== "starting") return;
      const url = URL_RE.exec(out)?.[0];
      const code = CODE_RE.exec(out.replace(URL_RE, " "))?.[0];
      if (url && code) {
        j.url = url;
        j.code = code;
        j.state = "waiting";
        j.expiresAt = new Date(Date.now() + (opts.loginMs ?? LOGIN_MS)).toISOString();
        clearTimeout(j.timer);
        j.timer = setTimeout(() => end(j, "failed", "The code expired. Start the sign-in again."), opts.loginMs ?? LOGIN_MS);
        resolveReady();
      }
    };
    child.stdout!.on("data", take);
    child.stderr!.on("data", take);
    j.timer = setTimeout(() => {
      if (j.state === "starting") {
        end(j, "failed", `Codex did not show a sign-in code. Its last line: ${lastLine(out)}`);
        resolveReady();
      }
    }, opts.showMs ?? SHOW_MS);
    child.on("error", () => {
      if (j.state === "starting" || j.state === "waiting") end(j, "failed", "Codex could not be started for the sign-in.");
      resolveReady();
    });
    child.on("close", async (code) => {
      if (j.cancelled || j.state === "done" || j.state === "failed") return resolveReady();
      if (j.state === "starting") {
        end(j, "failed", `Codex did not show a sign-in code. Its last line: ${lastLine(out)}`);
        return resolveReady();
      }
      if (code !== 0) return end(j, "failed", `Codex stopped before the sign-in finished. Its last line: ${lastLine(out)}`);
      // Confirm with Codex itself that this folder now holds a ChatGPT login.
      const st = await chatgptStatus(home);
      if (j.cancelled) return;
      if (!st.ok) return end(j, "failed", "Codex finished, but its login status does not show a ChatGPT sign-in.");
      end(j, "done");
      // A new sign-in may be another account: the earlier sessions belong to the old one.
      convs.resetThreads("chatgpt");
    });
    return j;
  };

  const guardLogin = () => {
    if (!ctx.policy.deviceSignIn) throw new HttpError(403, refusal("chatgpt", ctx.policy));
    const why = blocked("chatgpt", ctx.policy);
    if (why) throw new HttpError(403, why);
  };

  route("POST", "/api/coach/providers/chatgpt/login", async (_req, res) => {
    guardLogin();
    if (!job || job.state === "done" || job.state === "failed") job = start();
    const j = job;
    await j.ready;
    if (j.state === "failed") throw new HttpError(502, j.detail ?? "The sign-in did not start.");
    send(res, 200, view(j));
  });
  route("GET", "/api/coach/providers/chatgpt/login", (_req, res) => {
    guardLogin();
    send(res, 200, view(job));
  });
  route("DELETE", "/api/coach/providers/chatgpt/login", (_req, res) => {
    guardLogin();
    cancel();
    send(res, 200, view(null));
  });

  const known = (raw: string): ProviderId => {
    const cat = entryOf(raw);
    if (!cat) throw new HttpError(404, "unknown coach");
    if (!offered(cat.id, ctx.policy)) throw new HttpError(403, refusal(cat.id, ctx.policy));
    return cat.id;
  };

  route("PUT", "/api/coach/providers/:id", async (req, res, { params }) => {
    const id = known(params.id!);
    if (id === "claude" || id === "codex") {
      throw new HttpError(400, `This coach uses the login on ${ctx.policy.hostName}: sign in there with \`${id === "claude" ? "claude auth login" : "codex login --device-auth"}\`. Its model comes from ${id === "claude" ? "CLAUDE_MODEL" : "CODEX_MODEL"}.`);
    }
    const body = await readJson(req);
    const sid = id as StoredId;
    const prev = ctx.store.get(sid) as Entry | undefined;
    const next = await validateInput(sid, body, prev, { allowPrivate: ctx.policy.privateEndpoints, lookup: ctx.policy.lookup });
    ctx.store.put(sid, next as never);
    // No saved model means the default: saving the default by name is not a new setup.
    const eff = (e: Entry | undefined) => (e && "model" in e ? { ...e, model: e.model ?? DEFAULT_MODEL[id] ?? null } : e);
    if (setupChanged(eff(prev), eff(next)!)) convs.resetThreads(id);
    send(res, 200, await rowFor(id, ctx));
  });

  route("DELETE", "/api/coach/providers/:id", async (_req, res, { params }) => {
    const id = known(params.id!);
    if (id === "claude" || id === "codex") throw new HttpError(400, `Sign out on ${ctx.policy.hostName} with \`${id === "claude" ? "claude auth logout" : "codex logout"}\`.`);
    if (id === "chatgpt") {
      cancel();
      const home = ctx.store.dir("chatgpt");
      await execFileP(codexBin, ["logout"], { cwd: home, env: appEnv({ CODEX_HOME: home }), timeout: 15_000 }).catch(() => undefined);
      rmSync(join(home, "auth.json"), { force: true });
    } else ctx.store.remove(id as StoredId);
    send(res, 200, await rowFor(id, ctx));
  });

  return { stop: cancel };
}
