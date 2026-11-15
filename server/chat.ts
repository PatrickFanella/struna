import { execFile } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

import { config } from "./config.ts";
import type { Conversations, HostProvider, MessageMeta, Provider } from "./conversations.ts";
import { getSetting, setSetting } from "./db.ts";
import { HttpError, readJson, route, send } from "./http.ts";
import { type Paths, today } from "./practice.ts";
import { type ClaudeOptions, claudeChat, personalClaude } from "./providers/claude.ts";
import { type CodexOptions, codexChat } from "./providers/codex.ts";
import { type ChatEvent, type ChatRequest, subscriptionEnv } from "./providers/process.ts";
import type { Block } from "./vault.ts";

const run = promisify(execFile);
export type Run = (req: ChatRequest) => AsyncGenerator<ChatEvent>;
export const PROVIDERS: Record<HostProvider, (coach: CoachProfile) => Run> = {
  claude: (coach) => (req) => claudeChat(req, coach.claude),
  codex: (coach) => (req) => codexChat(req, coach.codex),
};

/** `fragment` is what is on the stand: the personal block's fragment, or the studio mode's material. */
export type Screen = { view: string; stage?: string; fragment?: string; bpm?: number; subdivision?: string };

/** What a turn changed in the studio folder; sent to the web as the SSE event `changed`. */
export type Changed = { plan: boolean; materials: boolean; profile: boolean };
export type AfterTurn = { changed?: Changed; notices?: string[]; followUp?: string };

/** What a mode gives the chat: the instructions, the context block and what each CLI may touch. */
export type CoachProfile = {
  providerId?: string;
  system: string | (() => Promise<string>);
  /** The [Struna] block that prefixes each message. */
  context: (screen: Screen) => Promise<string>;
  claude: ClaudeOptions;
  codex: CodexOptions;
  /** Where the CLIs are signed in, for the web's "not signed in on …" notice. */
  host?: string;
  beforeTurn?: () => Promise<unknown>;
  /**
   * Runs after the provider finishes; may ask for one follow-up turn on the same thread.
   * `final` is set when no follow-up can run (one already did, or the turn failed), so
   * anything still wrong must come back as a notice.
   */
  afterTurn?: (before: unknown, pass?: { final: boolean; successful?: boolean }) => Promise<AfterTurn>;
  /**
   * Studio mode with its coach list: the profile and run for one coach id, built for each request so a
   * new key applies at once. Null for an id it does not know; throws an HttpError for one turned off here.
   * Without it, the two host providers in `PROVIDERS` are the only coaches.
   */
  forProvider?: (id: Provider) => { profile: CoachProfile; run: Run } | null;
  /** Studio mode with its coach list: what `/api/providers` adds to the host statuses. */
  providerList?: () => Promise<ProviderList>;
};

export type HostStatus = { ok: boolean; detail: string };
export type ProviderList = { claude: HostStatus; codex: HostStatus; deviceSignIn: boolean; list: object[] };
/** Said once when a conversation's coach lost its session because its setup changed. */
export const FRESH_NOTICE = "The coach setup changed, so the coach starts fresh and does not see the earlier messages.";

const ACTIONS = new Set(["onboarding", "material-added", "session-logged", "plan-complete", "pain", "back-after-break", "profile-changed"]);
type TodayLike = { block: Block | null; position: { week: number; sessionInWeek: number; type: string }; next: { text: string } };

export const SYSTEM = `You are the owner's guitar practice coach in Ars Malefica, their Obsidian vault.
Read AGENTS.md at the vault root for the vault's rules. When reviewing or planning practice, read and follow .agents/skills/guitar-practice-coach/SKILL.md.
The practice notes are in 001 Projects/Threads/Guitar/Practice/: the practice system, the current block pointer, block notes, the progress ledger and session logs. Only evidence in logs and recordings advances the plan.
Write only inside 001 Projects/Threads/Guitar/. Never commit or push, and never change files elsewhere.
Super Productivity is unavailable here: list any task changes for the owner instead of making them.
The owner is usually at the music stand with a guitar: keep answers short and concrete, with tempos, bars and what to listen for.
Each message starts with a [Struna] block describing what the owner is looking at. It is context only: never repeat or imitate it in your reply.`;

export function buildContext(screen: Screen, t: TodayLike): string {
  const lines = ["[Struna]", `Screen: ${screen.view}`];
  if (t.block) lines.push(`Block: ${t.block.title} (${t.block.id})`);
  lines.push(`Week ${t.position.week}, session ${t.position.sessionInWeek}: ${t.position.type}`);
  if (screen.stage) lines.push(`Stage: ${screen.stage}`);
  if (screen.fragment) lines.push(`Fragment: ${screen.fragment}`);
  if (screen.bpm) lines.push(`Metronome: ${screen.bpm} BPM${screen.subdivision ? `, ${screen.subdivision}` : ""}`);
  if (t.next.text) lines.push(`Next instruction: ${t.next.text}`);
  return `${lines.join("\n")}\n[/Struna]`;
}

function screenOf(v: any): Screen {
  const s = (x: unknown) => (typeof x === "string" ? x.slice(0, 300) : undefined);
  const out: Screen = { view: s(v?.view) ?? "unknown" };
  const stage = s(v?.stage);
  const fragment = s(v?.fragment) ?? s(v?.material);
  const subdivision = s(v?.subdivision);
  if (stage) out.stage = stage;
  if (fragment) out.fragment = fragment;
  if (subdivision) out.subdivision = subdivision;
  if (Number.isFinite(v?.bpm)) out.bpm = Number(v.bpm);
  return out;
}

/** Why a status command failed, in words for the player: never the command line itself. */
function whyFailed(e: any): string {
  if (e?.code === "ENOENT") return "not installed";
  if (e?.killed || e?.signal) return "did not answer";
  return "could not check";
}

/**
 * Whether the host's own `claude` and `codex` CLIs are signed in to a subscription. Both exit 1 when
 * signed out; `plain` (the studio mode) then reads what they printed instead of the error, whose text
 * names the binary's path. The personal mode keeps the text it always had.
 */
export async function providerStatus(o: { plain?: boolean } = {}): Promise<{ claude: HostStatus; codex: HostStatus }> {
  const env = subscriptionEnv();
  const fromClaude = (stdout: string): HostStatus => {
    const s = JSON.parse(stdout);
    return { ok: Boolean(s.loggedIn), detail: s.loggedIn ? `${s.authMethod} ${s.subscriptionType ?? ""}`.trim() : "not signed in" };
  };
  const claude = await run(config.claudeBin, ["auth", "status"], { env, timeout: 15_000 })
    .then(({ stdout }) => fromClaude(stdout))
    .catch((e): HostStatus => {
      if (!o.plain) return { ok: false, detail: String(e.message ?? e).slice(0, 200) };
      try {
        return fromClaude(String(e.stdout ?? ""));
      } catch {
        return { ok: false, detail: whyFailed(e) };
      }
    });
  const codex = await run(config.codexBin, ["login", "status"], { env, timeout: 15_000 })
    .then(({ stdout, stderr }) => {
      const text = `${stdout}${stderr}`.trim().split("\n").pop() ?? "";
      return { ok: /ChatGPT/i.test(text), detail: text.slice(0, 200) };
    })
    .catch((e): HostStatus => {
      if (!o.plain) return { ok: false, detail: String(e.message ?? e).slice(0, 200) };
      const last = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim().split("\n").pop()?.trim() ?? "";
      return { ok: false, detail: last && e.code !== "ENOENT" && !e.killed ? last.slice(0, 200) : whyFailed(e) };
    });
  return { claude, codex };
}

/** The owner's coach in the vault: the instructions, context and permissions the app has always used. */
export function personalCoach(paths: Paths & { mediaRoot: string }, db: DatabaseSync): CoachProfile {
  return {
    system: SYSTEM,
    context: async (screen) => buildContext(screen, await today(paths, db)),
    claude: personalClaude(paths),
    codex: { cwd: join(paths.vaultRoot, paths.threadRel) },
    host: "Kvant",
  };
}

type Emit = (event: string, data: unknown) => void;

/**
 * One exchange with the coach: the provider's turn, then the profile's `afterTurn`, then at most
 * one follow-up turn on the same thread (streamed into the same reply after a blank line).
 */
/**
 * `stale` says the coach's setup changed during this exchange (a new model, address or sign-in): then no
 * follow-up turn resumes the old session with the new setup, and the check's problems become notices.
 */
export async function coachTurn(o: { coach: CoachProfile; run: Run; prompt: string; threadId?: string | undefined; signal: AbortSignal; emit: Emit; onThread?: (id: string) => void; stale?: () => boolean }): Promise<{ reply: string; errors: string[] }> {
  const { coach, emit, signal } = o;
  let reply = "";
  let threadId = o.threadId;
  const errors: string[] = [];
  const fail = (e: unknown) => {
    const m = String((e as Error)?.message ?? e);
    errors.push(m);
    emit("error", { message: m });
  };
  const turn = async (system: string, prompt: string) => {
    // A reset that landed after the conversation was read: the old session must not run with the new setup.
    if (o.stale?.()) threadId = undefined;
    for await (const ev of o.run({ system, prompt, ...(threadId ? { threadId } : {}), signal })) {
      if (ev.type === "delta") {
        reply += ev.text;
        emit("delta", { text: ev.text });
      } else if (ev.type === "thread") {
        threadId = ev.id;
        o.onThread?.(ev.id);
        emit("thread", { id: ev.id });
      } else if (ev.type === "notice") emit("notice", { message: ev.message });
      else fail(ev.message);
    }
  };
  const after = async (before: unknown, final: boolean): Promise<string | undefined> => {
    const r = await coach.afterTurn!(before, { final, successful: !signal.aborted && errors.length === 0 && !o.stale?.() });
    if (r.changed && (r.changed.plan || r.changed.materials || r.changed.profile)) emit("changed", r.changed);
    for (const n of r.notices ?? []) emit("notice", { message: n });
    return final ? undefined : r.followUp;
  };

  let system = "";
  let before: unknown;
  try {
    before = await coach.beforeTurn?.();
    system = typeof coach.system === "string" ? coach.system : await coach.system();
    await turn(system, o.prompt);
  } catch (e) {
    fail(e);
  }
  if (!coach.afterTurn) return { reply, errors };
  try {
    const canFollowUp = Boolean(threadId) && !signal.aborted && errors.length === 0 && !o.stale?.();
    const followUp = await after(before, !canFollowUp);
    // The post-turn check can take a while; a Stop during it must not start the repair turn.
    if (followUp && !signal.aborted) {
      if (reply) {
        reply += "\n\n";
        emit("delta", { text: "\n\n" });
      }
      try {
        await turn(system, followUp);
      } catch (e) {
        fail(e);
      }
      await after(before, true);
    }
  } catch (e) {
    emit("notice", { message: `Could not check what the coach changed: ${String((e as Error)?.message ?? e)}` });
  }
  return { reply, errors };
}

async function chat(req: IncomingMessage, res: ServerResponse, store: Conversations, db: DatabaseSync, coach: CoachProfile) {
  const input = await readJson(req);
  const provider = String(input.provider ?? "") as Provider;
  // The coach list (studio mode) refuses an id that is turned off here before anything is stored.
  const picked = coach.forProvider ? coach.forProvider(provider) : Object.hasOwn(PROVIDERS, provider) ? { profile: coach, run: PROVIDERS[provider as HostProvider](coach) } : null;
  if (!picked) throw new HttpError(400, "unknown provider");
  const message = String(input.message ?? "").trim();
  if (!message) throw new HttpError(400, "empty message");
  if (message.length > 20_000) throw new HttpError(413, "message too long");
  if (input.auto !== undefined && !ACTIONS.has(input.auto)) throw new HttpError(400, "unknown action");
  const meta: MessageMeta | undefined = input.auto ? { auto: input.auto } : undefined;
  const conv = typeof input.conversation === "string" ? store.get(input.conversation) : undefined;
  if (input.conversation && !conv) throw new HttpError(404, "conversation not found");
  // A setup change during the turn clears this coach's sessions: counted from the moment the conversation
  // was read, so a reset during any await below cannot let the old session run or be saved again.
  const gen = store.generation(provider);
  const stale = () => store.generation(provider) !== gen;
  if (conv && conv.provider !== provider) throw new HttpError(400, coach.forProvider ? "this conversation uses another coach: start a new conversation to switch" : "this conversation uses the other provider");
  const id = conv?.id ?? store.create(provider, message).id;
  setSetting(db, "provider", provider);

  const prompt = `${await picked.profile.context(screenOf(input.screen))}\n\n${message}`;
  // A conversation the coach answered before but whose session was cleared (its setup changed).
  const fresh = Boolean(coach.forProvider && conv && !conv.thread_id && store.hasReply(conv.id));
  store.append(id, "user", message, meta);

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-robots-tag": "noindex, nofollow", "x-accel-buffering": "no" });
  const emit: Emit = (event, data) => {
    if (!res.writableEnded && !res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  emit("conversation", { id });
  if (fresh) emit("notice", { message: FRESH_NOTICE });

  const abort = new AbortController();
  // Proxies drop idle responses; Codex sends nothing until its reply is complete.
  const keepalive = setInterval(() => res.write(": keepalive\n\n"), 15_000);
  res.on("close", () => {
    clearInterval(keepalive);
    abort.abort();
  });

  const onThread = (thread: string) => {
    if (!stale()) store.setThread(id, thread);
  };
  const { reply, errors } = await coachTurn({ coach: picked.profile, run: picked.run, prompt, threadId: conv?.thread_id ?? undefined, signal: abort.signal, emit, onThread, stale });
  clearInterval(keepalive);
  if (reply) store.append(id, "assistant", reply);
  if (abort.signal.aborted && !res.writableEnded) store.append(id, "error", "Stopped.");
  for (const e of errors) store.append(id, "error", e);
  if (!res.writableEnded) {
    emit("done", { aborted: abort.signal.aborted });
    res.end();
  }
}

/** `coach` is the mode's profile; the personal mode may still pass its paths, as it always did. */
export function chatRoutes(coach: CoachProfile | (Paths & { mediaRoot: string }), db: DatabaseSync, store: Conversations): void {
  const profile = "context" in coach ? coach : personalCoach(coach, db);
  route("POST", "/api/chat", (req, res) => chat(req, res, store, db, profile));
  route("GET", "/api/providers", async (_req, res) => {
    const last = getSetting(db, "provider") ?? "claude";
    const host = profile.host ?? "this computer";
    if (!profile.providerList) return send(res, 200, { ...(await providerStatus()), last, host });
    const { claude, codex, deviceSignIn, list } = await profile.providerList();
    send(res, 200, { claude, codex, last, host, deviceSignIn, list });
  });
  route("GET", "/api/conversations", (_req, res) => send(res, 200, store.list()));
  route("GET", "/api/conversations/:id", (_req, res, { params }) => {
    const c = store.get(params.id!);
    if (!c) throw new HttpError(404, "conversation not found");
    send(res, 200, c);
  });
  route("PATCH", "/api/conversations/:id", async (req, res, { params }) => {
    const { title } = await readJson(req);
    if (!store.rename(params.id!, String(title ?? ""))) throw new HttpError(404, "conversation not found");
    send(res, 200, { ok: true });
  });
  route("DELETE", "/api/conversations/:id", (_req, res, { params }) => {
    if (!store.remove(params.id!)) throw new HttpError(404, "conversation not found");
    send(res, 200, { ok: true });
  });
}
