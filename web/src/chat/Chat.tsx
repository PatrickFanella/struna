import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import Markdown from "react-markdown";

import { api } from "../api.ts";
import type { ActionId, Prompt } from "../generic.ts";
import { useApp } from "../mode.ts";
import { screenContext } from "../screen.ts";
import { CoachProviders, PROVIDERS_CHANGED } from "./CoachProviders.tsx";
import { fillPrompt, GROUPS, promptAction, promptPurpose, promptsFor, screenId, usePrompts } from "./prompts.ts";
import { pickProvider, providerSummary, shortName, type ProviderId, type ProviderStatus, readiness } from "./providers.ts";
import { GENERIC_REPLY_MARKDOWN, REPLY_MARKDOWN } from "./reply.ts";
import { applyEvent, type Msg } from "./stream.ts";

type Provider = ProviderId;
type Conv = { id: string; provider: Provider; title: string; updated: string };
type Status = ProviderStatus;
/** `done` hears whether the turn ran to its end; a message dropped from the queue hears false. */
type Queued = { text: string; auto?: ActionId; done?: (ok: boolean) => void };
const NAMES: Record<string, string> = { claude: "Claude", codex: "ChatGPT" };
/** The studio mode's names for the host logins, also when they are turned off and not in the list (as in server/generic/providers.ts CATALOG). */
const HOST_LABELS: Record<string, string> = { claude: "Claude plan (this computer)", codex: "ChatGPT plan (this computer)" };
/** A coach's name: the personal mode's short names, or its label in the studio mode's list. */
const nameOf = (id: string, status: Status | null) => (status?.list ? (status.list.find((r) => r.id === id)?.label ?? HOST_LABELS[id] ?? id) : (NAMES[id] ?? id));

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
  /** Studio mode: the coach settings are showing instead of the conversation. */
  settings: false,
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
      const fresh = !state.conversation && !state.messages.length && !state.busy;
      if (!loadedLast && fresh) {
        state.provider = pickProvider(p);
        emit();
      } else if (p.list && fresh && !p.list.find((r) => r.id === state.provider)?.ok) {
        // Studio mode: a coach was set up (or the one in use removed) before anything was said.
        state.provider = pickProvider(p);
        emit();
      }
      loadedLast = true;
      return p;
    }, () => null);
  }
  return providers;
}

// A coach was set up, changed or removed in the settings: ask again next time.
if (typeof addEventListener === "function") addEventListener(PROVIDERS_CHANGED, () => void loadProviders(true));

/** Whether a coach can answer at all; asked before the app sends a message by itself. */
export async function coachReady(): Promise<{ ok: boolean; detail: string }> {
  return readiness(await loadProviders(), state.provider);
}

/** Empty the queue; each message waiting in it hears that it was not sent. */
function dropQueue() {
  const dropped = state.queue;
  state.queue = [];
  for (const q of dropped) q.done?.(false);
}

/** Returns whether the turn ran to its end without an error or a stop. */
async function send(text: string, auto?: ActionId): Promise<boolean> {
  const abort = new AbortController();
  state.busy = abort;
  let ok = true;
  update((m) => [...m, { role: "user", text, ...(auto ? { auto } : {}) }, { role: "assistant", text: "", streaming: true }]);
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "x-struna": "1", "content-type": "application/json" },
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
        else if (ev === "delta" || ev === "notice" || ev === "error") {
          if (ev === "error") ok = false;
          update((m) => applyEvent(m, ev, d));
        }
        // The coach changed the plan, the materials or the profile: the screens showing them reload.
        else if (ev === "changed") dispatchEvent(new CustomEvent("struna:changed", { detail: d }));
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
      next.done?.(ok);
      if (!ok && state.queue.length) {
        dropQueue();
        emit();
      }
    }
    // A reply that finished with no panel on screen: the header's Coach button shows a dot.
    if (!visible) dispatchEvent(new CustomEvent("struna:coach-unread", { detail: { unread: true } }));
  } finally {
    pumping = false;
  }
}

/** Open the coach, unless a workspace pane already shows it. */
export function openCoach(): void {
  if (!panes) dispatchEvent(new Event("struna:coach-open"));
}

/**
 * Send a message to the coach from anywhere in the app. It joins the current conversation and
 * waits its turn behind a running reply. `auto` marks a message the app sent because something happened.
 */
export function askCoach(text: string, opts: { auto?: ActionId; open?: boolean } = {}): Promise<boolean> {
  const t = text.trim();
  if (!t) return Promise.resolve(false);
  state.more = false;
  const result = new Promise<boolean>((done) => state.queue.push({ text: t, ...(opts.auto ? { auto: opts.auto } : {}), done }));
  emit();
  if (opts.open) openCoach();
  void pump();
  return result;
}

/** Put text in the message box for the player to finish, and open the coach. */
export function fillCoach(text: string): void {
  state.draft = text;
  state.more = false;
  emit();
  openCoach();
}

function stop() {
  dropQueue();
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
  dropQueue();
  state.busy?.abort();
  state.conversation = null;
  state.provider = provider;
  state.messages = [];
  emit();
}

/** Draft plan/custom/incomplete requests; send advice only when the button says Send. */
function usePrompt(p: Prompt): void {
  const filled = fillPrompt(p.text, screenContext.get());
  if (!filled || state.busy || state.queue.length) return;
  if (promptAction(p) === "Draft") fillCoach(filled.text);
  else void askCoach(filled.text, { open: true });
}

function Chips({ prompts, more }: { prompts: Prompt[]; more?: (() => void) | undefined }) {
  return (
    <div className="chips promptchips">
      {prompts.map((p) => (
        <button key={p.id} type="button" disabled={Boolean(state.busy) || state.queue.length > 0} onClick={() => usePrompt(p)}>
          <small>{promptAction(p)} · {promptPurpose(p)}</small>
          <span>{p.label}</span>
        </button>
      ))}
      {more && <button type="button" className="morechip" onClick={more}>More</button>}
    </div>
  );
}

/**
 * A row of the prompts that help on one screen, for that screen to show. Each button names whether it drafts or sends
 * the request and opens the panel. Renders nothing when the server offers no prompts (the personal mode).
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
function PromptSheet({ prompts, screen, sheetRef }: { prompts: Prompt[]; screen: string; sheetRef: React.Ref<HTMLDivElement> }) {
  const usable = promptsFor(prompts, screen, screenContext.get(), true);
  return (
    <div className="promptsheet" ref={sheetRef}>
      {GROUPS.map(([group, title]) => {
        const list = usable.filter((p) => p.group === group);
        return list.length ? (
          <section key={group}>
            <p className="grp">{title}</p>
            <Chips prompts={list} />
          </section>
        ) : null;
      })}
      <p className="srcnote">Draft fills the message box for you to review. Send submits the request immediately. Plan change requests are drafted; sending them can change the active plan directly, without an Apply preview.</p>
    </div>
  );
}

/** The coach conversation: in the slide-over, or in a workspace pane (no Done button there). */
export function ChatPanel({ open, onClose }: { open: boolean; onClose?: (() => void) | undefined }) {
  useChat();
  const generic = useApp().mode === "studio";
  const { prompts } = usePrompts();
  const [text, setText] = useState("");
  const [list, setList] = useState<Conv[] | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const shown = useRef(false);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    void loadProviders(true).then((p) => p && setStatus(p));
  }, [open]);
  // The settings changed a coach: the module already asked again; show its answer.
  useEffect(() => {
    if (!generic) return;
    const on = () => void loadProviders().then((p) => p && setStatus(p));
    addEventListener(PROVIDERS_CHANGED, on);
    return () => removeEventListener(PROVIDERS_CHANGED, on);
  }, [generic]);

  // The slide-over closes on the prompt list or the settings: it opens next time on the conversation.
  useEffect(() => {
    if (open || !onClose || !(state.more || state.settings)) return;
    state.more = false;
    state.settings = false;
    emit();
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
    const timer = setTimeout(() => {
      if (!input.current?.checkVisibility() || input.current.closest("[inert]")) return;
      input.current.focus();
      input.current.setSelectionRange(draft.length, draft.length);
    }, 60);
    return () => clearTimeout(timer);
  }, [open, state.version]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [state.version]);

  const showList = async () => setList(await api.get<Conv[]>("/api/conversations"));
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || state.busy || state.queue.length) return;
    setText("");
    void askCoach(t);
  };
  const st = status?.[state.provider as "claude" | "codex"];
  const screen = screenId(screenContext.get().view);
  const offered = prompts.length ? promptsFor(prompts, screen, screenContext.get()) : [];
  const showSettings = generic && state.settings && !list;
  const showMore = state.more && prompts.length > 0 && !list && !showSettings;
  const setMore = (on: boolean) => {
    state.more = on;
    emit();
  };
  const setSettings = (on: boolean) => {
    state.settings = on;
    state.more = false;
    emit();
  };
  // Studio mode: the coaches this instance offers, the one in use, and whether it can still answer here.
  const coaches = generic ? (status?.list ?? null) : null;
  const current = coaches?.find((r) => r.id === state.provider);
  const ready = coaches?.filter((r) => r.ok) ?? [];
  /** A conversation started with a coach this instance no longer offers (host logins turned off): only a new one helps. */
  const retired = Boolean(coaches && state.conversation && !current);
  /** The coach a new conversation starts with when the current one cannot answer. */
  const fallback = ready[0]?.id ?? coaches?.[0]?.id ?? state.provider;
  /** Studio mode: no coach can answer at all, so there is nothing to send to. */
  const noCoach = Boolean(coaches && ready.length === 0);
  /** Studio mode: this conversation's coach cannot answer, but another one can. */
  const notReady = current && !current.ok && ready.length > 0 ? current : null;
  const name = generic ? "the coach" : NAMES[state.provider];
  const settingsLink = <button className="linkbtn" onClick={() => setSettings(true)}>Coach settings</button>;

  // Focus goes to what is showing: the prompt list's first button, or the message box. A workspace
  // pane that appears by itself does not take focus; one the player is using does (More unmounts the box).
  useEffect(() => {
    if (!open) {
      shown.current = false;
      return;
    }
    const first = !shown.current;
    shown.current = true;
    if (first && !onClose) return;
    const t = setTimeout(() => {
      if (!body.current?.checkVisibility() || body.current.closest("[inert]")) return;
      if (showMore) sheet.current?.querySelector<HTMLButtonElement>("button")?.focus();
      else if (showSettings || list) body.current.querySelector<HTMLButtonElement>(".chatbar button")?.focus();
      else input.current?.focus();
    }, 50);
    return () => clearTimeout(t);
  }, [open, showMore, showSettings, Boolean(list)]);

  return (
    <div className="chatbody" ref={body}>
        <div className="chathd">
          <h2>Coach</h2>
          {generic ? (
            ready.length > 0 && (
              <select className="input coachpick" aria-label="Coach" value={state.provider} disabled={Boolean(state.busy)} onChange={(e) => {
                newConversation(e.target.value);
                setList(null);
                setSettings(false);
              }}>
                {current && !current.ok && <option value={current.id}>{shortName(current.id, current.label)}</option>}
                {!current && state.conversation && <option value={state.provider}>{shortName(state.provider)}</option>}
                {ready.map((r) => <option key={r.id} value={r.id}>{shortName(r.id, r.label)}</option>)}
              </select>
            )
          ) : (
            <div className="seg mini words" role="radiogroup" aria-label="Provider">
              {(["claude", "codex"] as Provider[]).map((p) => (
                <button key={p} role="radio" aria-checked={state.provider === p} className={state.provider === p ? "on" : ""} disabled={Boolean(state.busy)} onClick={() => p !== state.provider && newConversation(p)}>{NAMES[p]}</button>
              ))}
            </div>
          )}
          {onClose && <button className="sheetdone" onClick={onClose}>Done</button>}
        </div>
        {generic && (
          <div className="coachidentity" aria-live="polite">
            <strong>{shortName(state.provider, current?.label)}</strong>
            <span>{current ? providerSummary(current, status?.host).location : `Runs on ${status?.host ?? "the server"}`}</span>
            <span>{current ? providerSummary(current, status?.host).status : status ? "Unavailable here" : "Checking readiness"}</span>
          </div>
        )}
        <div className="chatbar">
          <button className="linkbtn" onClick={() => (showSettings ? setSettings(false) : showMore ? setMore(false) : list ? setList(null) : void showList())} aria-expanded={Boolean(list)}>{list || showMore || showSettings ? "Back to the conversation" : "Conversations"}</button>
          {generic && !showSettings && <button className="linkbtn" onClick={() => {
            setList(null);
            setSettings(true);
          }}>Coach settings</button>}
          <button className="linkbtn" disabled={Boolean(state.busy)} onClick={() => {
            newConversation(coaches && !current?.ok ? fallback : state.provider);
            setList(null);
            setMore(false);
            setSettings(false);
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
                  <small>{nameOf(c.provider, status)}, {new Date(c.updated).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small>
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
        ) : showSettings ? (
          <div className="chatsettings">
            <CoachProviders />
          </div>
        ) : showMore ? (
          <PromptSheet prompts={prompts} screen={screen} sheetRef={sheet} />
        ) : (
          <div className="chatlog" ref={log} aria-live="polite">
            {state.messages.length === 0 && (
              <div className="chatempty">
                <p>{generic
                  ? "Ask about today's session, a song, a chord, or what to practise next. The coach sees your plan, the stage you are on and the tempo, and can change the active plan directly. There is no Apply preview yet."
                  : "Ask about today's session, a passage, or a block review. The coach sees the current block, stage and tempo."}</p>
                {!coaches && st && !st.ok && <p className="notice">{NAMES[state.provider]} is not signed in on {status?.host ?? "Kvant"}: {st.detail}</p>}
                {offered.length > 0 && !noCoach && <Chips prompts={offered.slice(0, 6)} more={() => setMore(true)} />}
              </div>
            )}
            {state.messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}${m.auto ? " auto" : ""}`}>
                {m.role === "assistant" ? (
                  <div className="md">
                    <Markdown {...(generic ? GENERIC_REPLY_MARKDOWN : REPLY_MARKDOWN)}>{m.text || "…"}</Markdown>
                  </div>
                ) : (
                  <>
                    {m.auto && <small className="automark">Automatic</small>}
                    <p>{m.text}</p>
                    {generic && m.role === "error" && /Coach settings/.test(m.text) && settingsLink}
                  </>
                )}
              </div>
            ))}
            {state.busy && <p className="srcnote thinking">{generic ? "The coach is working" : `${NAMES[state.provider]} is working`}</p>}
            {retired && (
              <div className="notice">
                <p>This conversation used {nameOf(state.provider, status)}, which is turned off here. Start a new conversation with another coach.</p>
                <button className="btn outline" disabled={Boolean(state.busy)} onClick={() => newConversation(fallback)}>New conversation</button>
              </div>
            )}
            {state.queue.length > 0 && <p className="srcnote thinking">{state.queue.length === 1 ? "1 more message is waiting" : `${state.queue.length} more messages are waiting`}</p>}
          </div>
        )}
        {!list && !showMore && !showSettings && !retired && !noCoach && !notReady && offered.length > 0 && state.messages.length > 0 && (
          <div className="promptrow">
            <Chips prompts={offered.slice(0, 4)} more={() => setMore(true)} />
          </div>
        )}
        {!list && !showMore && !showSettings && !retired && noCoach && (
          <div className="composer nocoach">
            <p className="notice">No coach is set up. {settingsLink}</p>
          </div>
        )}
        {!list && !showMore && !showSettings && !retired && notReady && (
          <div className="notice notready">
            <p>{notReady.label} is not ready: {notReady.detail}. {settingsLink}</p>
            <button className="btn outline" disabled={Boolean(state.busy)} onClick={() => newConversation(fallback)}>New conversation with {nameOf(fallback, status)}</button>
          </div>
        )}
        {!list && !showMore && !showSettings && !retired && !noCoach && (
          <form className="composer" onSubmit={submit}>
            <textarea
              ref={input}
              className="input"
              rows={2}
              value={text}
              placeholder={`Message ${name}`}
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

/** The native modal owns background inertness; the panel stays mounted to retain drafts and requests. */
export function Chat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const el = dialog.current;
    if (!open || !el) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    el.showModal();
    return () => {
      el.close();
      const target = opener?.isConnected && opener.checkVisibility() && !opener.closest("[inert]")
        ? opener : document.querySelector<HTMLButtonElement>(".top .acts button:last-of-type");
      target?.focus();
    };
  }, [open]);
  return (
    <div className={`chatwrap${open ? " open" : ""}`}>
      <dialog ref={dialog} className="chat" aria-label="Coach" aria-modal="true" onCancel={(e) => {
        e.preventDefault();
        close.current();
      }} onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close.current();
      }} onKeyDownCapture={(e) => {
        if (e.key !== "Tab") return;
        const controls = [...e.currentTarget.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex]")]
          .filter((x) => x.tabIndex >= 0 && !x.matches(":disabled") && x.checkVisibility() && !x.closest("[inert]"));
        const at = controls.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        controls[(at + (e.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
      }}>
        <ChatPanel open={open} onClose={onClose} />
      </dialog>
    </div>
  );
}
