import { execFile } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

import { config } from "./config.ts";
import type { Conversations, Provider } from "./conversations.ts";
import { getSetting, setSetting } from "./db.ts";
import { HttpError, readJson, route, send } from "./http.ts";
import { type Paths, today } from "./practice.ts";
import { claudeChat } from "./providers/claude.ts";
import { codexChat } from "./providers/codex.ts";
import { type ChatEvent, type ChatRequest, subscriptionEnv } from "./providers/process.ts";
import type { Block } from "./vault.ts";

const run = promisify(execFile);
export const PROVIDERS: Record<Provider, (req: ChatRequest) => AsyncGenerator<ChatEvent>> = { claude: claudeChat, codex: codexChat };

export type Screen = { view: string; stage?: string; fragment?: string; bpm?: number; subdivision?: string };
type TodayLike = { block: Block | null; position: { week: number; sessionInWeek: number; type: string }; next: { text: string } };

export const SYSTEM = `You are the owner's guitar practice coach in Ars Malefica, their Obsidian vault.
Read AGENTS.md at the vault root for the vault's rules. When reviewing or planning practice, read and follow .agents/skills/guitar-practice-coach/SKILL.md.
The practice notes are in 001 Projects/Threads/Guitar/Practice/: the practice system, the current block pointer, block notes, the progress ledger and session logs. Only evidence in logs and recordings advances the plan.
Write only inside 001 Projects/Threads/Guitar/. Never commit or push, and never change files elsewhere.
Super Productivity is unavailable here: list any task changes for the owner instead of making them.
The owner is usually at the music stand with a guitar: keep answers short and concrete, with tempos, bars and what to listen for.
Each message starts with a [Guitar Room] block describing what the owner is looking at. It is context only: never repeat or imitate it in your reply.`;

export function buildContext(screen: Screen, t: TodayLike): string {
  const lines = ["[Guitar Room]", `Screen: ${screen.view}`];
  if (t.block) lines.push(`Block: ${t.block.title} (${t.block.id})`);
  lines.push(`Week ${t.position.week}, session ${t.position.sessionInWeek}: ${t.position.type}`);
  if (screen.stage) lines.push(`Stage: ${screen.stage}`);
  if (screen.fragment) lines.push(`Fragment: ${screen.fragment}`);
  if (screen.bpm) lines.push(`Metronome: ${screen.bpm} BPM${screen.subdivision ? `, ${screen.subdivision}` : ""}`);
  if (t.next.text) lines.push(`Next instruction: ${t.next.text}`);
  return `${lines.join("\n")}\n[/Guitar Room]`;
}

function screenOf(v: any): Screen {
  const s = (x: unknown) => (typeof x === "string" ? x.slice(0, 300) : undefined);
  const out: Screen = { view: s(v?.view) ?? "unknown" };
  const stage = s(v?.stage);
  const fragment = s(v?.fragment);
  const subdivision = s(v?.subdivision);
  if (stage) out.stage = stage;
  if (fragment) out.fragment = fragment;
  if (subdivision) out.subdivision = subdivision;
  if (Number.isFinite(v?.bpm)) out.bpm = Number(v.bpm);
  return out;
}

async function providerStatus() {
  const env = subscriptionEnv();
  const claude = await run(config.claudeBin, ["auth", "status"], { env, timeout: 15_000 })
    .then(({ stdout }) => {
      const s = JSON.parse(stdout);
      return { ok: Boolean(s.loggedIn), detail: s.loggedIn ? `${s.authMethod} ${s.subscriptionType ?? ""}`.trim() : "not signed in" };
    })
    .catch((e) => ({ ok: false, detail: String(e.message ?? e).slice(0, 200) }));
  const codex = await run(config.codexBin, ["login", "status"], { env, timeout: 15_000 })
    .then(({ stdout, stderr }) => {
      const text = `${stdout}${stderr}`.trim().split("\n").pop() ?? "";
      return { ok: /ChatGPT/i.test(text), detail: text.slice(0, 200) };
    })
    .catch((e) => ({ ok: false, detail: String(e.message ?? e).slice(0, 200) }));
  return { claude, codex };
}

async function chat(req: IncomingMessage, res: ServerResponse, store: Conversations, db: DatabaseSync, paths: Paths) {
  const input = await readJson(req);
  const provider = input.provider as Provider;
  if (!(provider in PROVIDERS)) throw new HttpError(400, "unknown provider");
  const message = String(input.message ?? "").trim();
  if (!message) throw new HttpError(400, "empty message");
  if (message.length > 20_000) throw new HttpError(413, "message too long");
  let conv = typeof input.conversation === "string" ? store.get(input.conversation) : undefined;
  if (input.conversation && !conv) throw new HttpError(404, "conversation not found");
  if (conv && conv.provider !== provider) throw new HttpError(400, "this conversation uses the other provider");
  const id = conv?.id ?? store.create(provider, message).id;
  setSetting(db, "provider", provider);

  const t = await today(paths, db);
  const prompt = `${buildContext(screenOf(input.screen), t)}\n\n${message}`;
  store.append(id, "user", message);

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-robots-tag": "noindex, nofollow", "x-accel-buffering": "no" });
  const emit = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  emit("conversation", { id });

  const abort = new AbortController();
  // Proxies drop idle responses; Codex sends nothing until its reply is complete.
  const keepalive = setInterval(() => res.write(": keepalive\n\n"), 15_000);
  res.on("close", () => {
    clearInterval(keepalive);
    abort.abort();
  });

  let reply = "";
  const errors: string[] = [];
  try {
    for await (const ev of PROVIDERS[provider]({ system: SYSTEM, prompt, ...(conv?.thread_id ? { threadId: conv.thread_id } : {}), signal: abort.signal })) {
      if (ev.type === "delta") {
        reply += ev.text;
        emit("delta", { text: ev.text });
      } else if (ev.type === "thread") {
        store.setThread(id, ev.id);
        emit("thread", { id: ev.id });
      } else if (ev.type === "notice") emit("notice", { message: ev.message });
      else {
        errors.push(ev.message);
        emit("error", { message: ev.message });
      }
    }
  } catch (e) {
    const m = String((e as Error).message ?? e);
    errors.push(m);
    emit("error", { message: m });
  }
  clearInterval(keepalive);
  if (reply) store.append(id, "assistant", reply);
  if (abort.signal.aborted && !res.writableEnded) store.append(id, "error", "Stopped.");
  for (const e of errors) store.append(id, "error", e);
  if (!res.writableEnded) {
    emit("done", { aborted: abort.signal.aborted });
    res.end();
  }
}

export function chatRoutes(paths: Paths, db: DatabaseSync, store: Conversations): void {
  route("POST", "/api/chat", (req, res) => chat(req, res, store, db, paths));
  route("GET", "/api/providers", async (_req, res) => send(res, 200, { ...(await providerStatus()), last: getSetting(db, "provider") ?? "claude" }));
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
