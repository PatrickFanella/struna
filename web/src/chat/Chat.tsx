import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { api } from "../api.ts";
import type { ActionId, Prompt } from "../generic.ts";
import { useApp } from "../mode.ts";
import { screenContext } from "../screen.ts";
import { fillPrompt, GROUPS, promptsFor, screenId, usePrompts } from "./prompts.ts";

type Provider = "claude" | "codex";
/** `auto` names the automatic action that sent a user message. */
type Msg = { role: "user" | "assistant" | "error" | "notice"; text: string; streaming?: boolean; auto?: string };
type Conv = { id: string; provider: Provider; title: string; updated: string };
type Status = Record<Provider, { ok: boolean; detail: string }> & { last: Provider; host?: string };
type Queued = { text: string; auto?: ActionId };
const NAMES: Record<Provider, string> = { claude: "Claude", codex: "ChatGPT" };

/**
 * Chat state lives outside the panel, so a reply keeps streaming while the panel
 * is closed and is there when it opens again.
 */
const state = {
  conversation: null as string | null,
  provider: "claude" as Provider,
  messages: [] as Msg[],
  busy: null as AbortController | null,
  /** Messages waiting behind the running reply: automatic ones, and prompts picked meanwhile. */
  queue: [] as Queued[],
  /** Text another screen put in the message box; the next open panel takes it. */
  draft: null as string | null,
  /** The prompt list is showing instead of the conversation. */
  more: false,
  version: 0,
};
const listeners = new Set<() => void>();
const emit = () => {
  state.version++;
  for (const l of listeners) l();
};
const useChat = () => useSyncExternalStore((fn) => (listeners.add(fn), () => listeners.delete(fn)), () => state.version);

function update(fn: (m: Msg[]) => Msg[]) {
  state.messages = fn(state.messages);
  emit();
}

/** How many panels are on screen (the slide-over when open, a workspace pane always). */
let visible = 0;
/** Workspace panes showing the coach: with one on screen the slide-over stays shut. */
let panes = 0;

let providers: Promise<Status | null> | null = null;
let loadedLast = false;
/** Which CLI is signed in and which was used last; the first answer picks the provider for a fresh page. */
function loadProviders(fresh = false): Promise<Status | null> {
  if (fresh || !providers) {
    providers = api.get<Status>("/api/providers").then((p) => {
      if (!loadedLast && !state.conversation && !state.messages.length && !state.busy) {
        state.provider = p.last === "codex" ? "codex" : "claude";
        emit();
      }
      loadedLast = true;
      return p;
    }, () => null);
  }
  return providers;
}

/** Returns whether the turn ran to its end without an error or a stop. */
async function send(text: string, auto?: ActionId): Promise<boolean> {
  const abort = new AbortController();
  state.busy = abort;
  let ok = true;
  update((m) => [...m, { role: "user", text, ...(auto ? { auto } : {}) }, { role: "assistant", text: "", streaming: true }]);
  const append = (t: string) => update((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, text: x.text + t } : x)));
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "x-guitar-room": "1", "content-type": "application/json" },
      body: JSON.stringify({ provider: state.provider, message: text, ...(state.conversation ? { conversation: state.conversation } : {}), ...(auto ? { auto } : {}), screen: screenContext.get() }),
      signal: abort.signal,
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? res.statusText);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (\w+)/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (!ev || !data) continue;
        const d = JSON.parse(data);
        if (ev === "conversation") state.conversation = d.id;
        else if (ev === "delta") append(d.text);
        else if (ev === "error") {
          ok = false;
          update((m) => [...m.slice(0, -1), m.at(-1)!, { role: "error", text: d.message }]);
        } else if (ev === "notice") update((m) => [...m, { role: "notice", text: d.message }]);
        // The coach changed the plan, the materials or the profile: the screens showing them reload.
        else if (ev === "changed") dispatchEvent(new CustomEvent("guitar-room:changed", { detail: d }));
      }
    }
  } catch (e) {
    ok = false;
    if ((e as Error).name !== "AbortError") update((m) => [...m, { role: "error", text: String((e as Error).message ?? e) }]);
  } finally {
    state.busy = null;
    update((m) =>
      m
        .map((x) => (x.streaming ? { ...x, streaming: false, text: x.text || (abort.signal.aborted ? "Stopped." : "") } : x))
        .filter((x) => !(x.role === "assistant" && !x.text)),
    );
  }
  return ok && !abort.signal.aborted;
}

let pumping = false;
/** Send what is waiting, one turn at a time. A stopped or failed turn drops the rest: they would fail the same way. */
async function pump() {
  if (pumping || state.busy) return;
  pumping = true;
  try {
    // Before the panel has ever opened, find out which provider was used last. A request the panel
    // already started is not waited for, so a typed message goes out as promptly as it always did.
    if (!providers) await loadProviders();
    for (let next = state.queue.shift(); next; next = state.queue.shift()) {
      emit();
      const ok = await send(next.text, next.auto);
      if (!ok && state.queue.length) {
        state.queue = [];
        emit();
      }
    }
    // A reply that finished with no panel on screen: the header's Coach button shows a dot.
    if (!visible) dispatchEvent(new CustomEvent("guitar-room:coach-unread", { detail: { unread: true } }));
  } finally {
    pumping = false;
  }
}

/** Open the coach, unless a workspace pane already shows it. */
export function openCoach(): void {
  if (!panes) dispatchEvent(new Event("guitar-room:coach-open"));
}

/**
 * Send a message to the coach from anywhere in the app. It joins the current conversation and
 * waits its turn behind a running reply. `auto` marks a message the app sent because something happened.
 */
export function askCoach(text: string, opts: { auto?: ActionId; open?: boolean } = {}): void {
  const t = text.trim();
  if (!t) return;
  state.more = false;
  state.queue.push({ text: t, ...(opts.auto ? { auto: opts.auto } : {}) });
  emit();
  if (opts.open) openCoach();
  void pump();
}

/** Put text in the message box for the player to finish, and open the coach. */
export function fillCoach(text: string): void {
  state.draft = text;
  state.more = false;
  emit();
  openCoach();
}

function stop() {
  state.queue = [];
  state.busy?.abort();
  emit();
}

async function openConversation(id: string) {
  const c = await api.get<Conv & { messages: (Msg & { meta?: { auto?: string } })[] }>(`/api/conversations/${id}`);
  state.conversation = c.id;
  state.provider = c.provider;
  state.messages = c.messages.map(({ meta, ...m }) => (meta?.auto ? { ...m, auto: meta.auto } : m));
  emit();
}

function newConversation(provider = state.provider) {
  state.queue = [];
  state.busy?.abort();
  state.conversation = null;
  state.provider = provider;
  state.messages = [];
  emit();
}

/** Send a picked prompt, or put it in the message box when the player has to finish it. */
function usePrompt(p: Prompt): void {
  const filled = fillPrompt(p.text, screenContext.get());
  if (!filled) return;
  if (filled.input) fillCoach(filled.text);
  else askCoach(filled.text, { open: true });
}

function Chips({ prompts, more }: { prompts: Prompt[]; more?: (() => void) | undefined }) {
  return (
    <div className="chips promptchips">
      {prompts.map((p) => (
        <button key={p.id} type="button" onClick={() => usePrompt(p)}>{p.label}</button>
      ))}
      {more && <button type="button" className="morechip" onClick={more}>More</button>}
    </div>
  );
}

/**
 * A row of the prompts that help on one screen, for that screen to show. Picking one sends it to
 * the coach and opens the panel. Renders nothing when the server offers no prompts (the personal mode).
 */
export function PromptChips({ screen, compact }: { screen: string; compact?: boolean }) {
  useChat();
  const { prompts } = usePrompts();
  if (!prompts.length) return null;
  const list = promptsFor(prompts, screen, screenContext.get()).slice(0, compact ? 3 : 6);
  if (!list.length) return null;
  return (
    <div className="askcoach">
      {!compact && <p className="grp">Ask the coach</p>}
      <Chips prompts={list} more={() => {
        state.more = true;
        emit();
        openCoach();
      }} />
    </div>
  );
}

/** Every prompt that can be asked from this screen, grouped. */
function PromptSheet({ prompts, screen }: { prompts: Prompt[]; screen: string }) {
  const usable = promptsFor(prompts, screen, screenContext.get(), true);
  return (
    <div className="promptsheet">
      {GROUPS.map(([group, title]) => {
        const list = usable.filter((p) => p.group === group);
        return list.length ? (
          <section key={group}>
            <p className="grp">{title}</p>
            <Chips prompts={list} />
          </section>
        ) : null;
      })}
      <p className="srcnote">A prompt ending in "…" goes to the message box for you to finish.</p>
    </div>
  );
}

/** The coach conversation: in the slide-over, or in a workspace pane (no Done button there). */
export function ChatPanel({ open, onClose }: { open: boolean; onClose?: (() => void) | undefined }) {
  useChat();
  const generic = useApp().mode === "generic";
  const { prompts } = usePrompts();
  const [text, setText] = useState("");
  const [list, setList] = useState<Conv[] | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    void loadProviders(true).then((p) => p && setStatus(p));
    if (onClose) setTimeout(() => input.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    visible++;
    if (!onClose) panes++;
    return () => {
      visible--;
      if (!onClose) panes--;
    };
  }, [open, onClose === undefined]);

  // Text handed over by another screen: take it, and leave the cursor at its end.
  useEffect(() => {
    if (!open || state.draft === null) return;
    const draft = state.draft;
    state.draft = null;
    setText(draft);
    setList(null);
    setTimeout(() => {
      input.current?.focus();
      input.current?.setSelectionRange(draft.length, draft.length);
    }, 60);
  }, [open, state.version]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [state.version]);

  useEffect(() => {
    if (!open || !onClose) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [open, onClose]);

  const showList = async () => setList(await api.get<Conv[]>("/api/conversations"));
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || state.busy) return;
    setText("");
    askCoach(t);
  };
  const st = status?.[state.provider];
  const screen = screenId(screenContext.get().view);
  const offered = prompts.length ? promptsFor(prompts, screen, screenContext.get()) : [];
  const showMore = state.more && prompts.length > 0 && !list;
  const setMore = (on: boolean) => {
    state.more = on;
    emit();
  };

  return (
    <div className="chatbody">
        <div className="chathd">
          <h2>Coach</h2>
          <div className="seg mini words" role="radiogroup" aria-label="Provider">
            {(["claude", "codex"] as Provider[]).map((p) => (
              <button key={p} role="radio" aria-checked={state.provider === p} className={state.provider === p ? "on" : ""} disabled={Boolean(state.busy)} onClick={() => p !== state.provider && newConversation(p)}>{NAMES[p]}</button>
            ))}
          </div>
          {onClose && <button className="sheetdone" onClick={onClose}>Done</button>}
        </div>
        <div className="chatbar">
          <button className="linkbtn" onClick={() => (showMore ? setMore(false) : list ? setList(null) : void showList())} aria-expanded={Boolean(list)}>{list || showMore ? "Back to the conversation" : "Conversations"}</button>
          <button className="linkbtn" disabled={Boolean(state.busy)} onClick={() => {
            newConversation();
            setList(null);
            setMore(false);
          }}>New</button>
        </div>
        {list ? (
          <ul className="convlist">
            {list.length === 0 && <li className="srcnote">No conversations yet.</li>}
            {list.map((c) => (
              <li key={c.id}>
                <button className="convopen" onClick={async () => {
                  await openConversation(c.id);
                  setList(null);
                }}>
                  <span>{c.title}</span>
                  <small>{NAMES[c.provider]}, {new Date(c.updated).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small>
                </button>
                <span className="convacts">
                  <button className="linkbtn" onClick={async () => {
                    const title = prompt("Rename the conversation", c.title);
                    if (title === null) return;
                    await api.patch(`/api/conversations/${c.id}`, { title });
                    void showList();
                  }}>Rename</button>
                  <button className="linkbtn" onClick={async () => {
                    if (!confirm(`Delete "${c.title}"?`)) return;
                    await api.del(`/api/conversations/${c.id}`);
                    if (state.conversation === c.id) newConversation();
                    void showList();
                  }}>Delete</button>
                </span>
              </li>
            ))}
          </ul>
        ) : showMore ? (
          <PromptSheet prompts={prompts} screen={screen} />
        ) : (
          <div className="chatlog" ref={log} aria-live="polite">
            {state.messages.length === 0 && (
              <div className="chatempty">
                <p>{generic
                  ? "Ask about today's session, a song, a chord, or what to practise next. The coach sees your plan, the stage you are on and the tempo, and can change the plan for you."
                  : "Ask about today's session, a passage, or a block review. The coach sees the current block, stage and tempo."}</p>
                {st && !st.ok && <p className="notice">{NAMES[state.provider]} is not signed in on {status?.host ?? "Kvant"}: {st.detail}</p>}
                {offered.length > 0 && <Chips prompts={offered.slice(0, 6)} more={() => setMore(true)} />}
              </div>
            )}
            {state.messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}${m.auto ? " auto" : ""}`}>
                {m.role === "assistant" ? (
                  <div className="md">
                    <Markdown remarkPlugins={[remarkGfm]}>{m.text || "…"}</Markdown>
                  </div>
                ) : (
                  <>
                    {m.auto && <small className="automark">Automatic</small>}
                    <p>{m.text}</p>
                  </>
                )}
              </div>
            ))}
            {state.busy && <p className="srcnote thinking">{NAMES[state.provider]} is working</p>}
            {state.queue.length > 0 && <p className="srcnote thinking">{state.queue.length === 1 ? "1 more message is waiting" : `${state.queue.length} more messages are waiting`}</p>}
          </div>
        )}
        {!list && !showMore && offered.length > 0 && state.messages.length > 0 && (
          <div className="promptrow">
            <Chips prompts={offered.slice(0, 4)} more={() => setMore(true)} />
          </div>
        )}
        {!list && !showMore && (
          <form className="composer" onSubmit={submit}>
            <textarea
              ref={input}
              className="input"
              rows={2}
              value={text}
              placeholder={`Message ${NAMES[state.provider]}`}
              aria-label="Message"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
              }}
            />
            {state.busy ? (
              <button type="button" className="btn outline" onClick={stop}>Stop</button>
            ) : (
              <button className="btn outline" disabled={!text.trim()}>Send</button>
            )}
          </form>
        )}
    </div>
  );
}

export function Chat({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div className={`chatwrap${open ? " open" : ""}`} aria-hidden={!open}>
      <div className="scrim" onClick={onClose} />
      <aside className="chat" role="dialog" aria-label="Coach" aria-modal="true">
        <ChatPanel open={open} onClose={onClose} />
      </aside>
    </div>
  );
}
