import type { CoachContext, CoachSelection } from "../../../shared/coach-context.ts";
import { PlanCandidates } from "./PlanCandidates.tsx";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import Markdown from "react-markdown";

import { accountHeaders, api, invalidateAccount } from "../api.ts";
import type { ActionId, Prompt } from "../generic.ts";
import { useApp } from "../mode.ts";
import { addedMaterials, type FindTurn, type MaterialsSnapshot } from "../materials/find.ts";
import { screenContext } from "../screen.ts";
import { CoachProviders, PROVIDERS_CHANGED } from "./CoachProviders.tsx";
import { fillPrompt, GROUPS, promptAction, promptPurpose, promptsFor, screenId, usePrompts } from "./prompts.ts";
import { pickProvider, providerSummary, shortName, type ProviderId, type ProviderStatus, readiness } from "./providers.ts";
import { GENERIC_REPLY_MARKDOWN, REPLY_MARKDOWN } from "./reply.ts";
import { applyEvent, type Msg } from "./stream.ts";

type Provider = ProviderId;
type Conv = { id: string; provider: Provider; title: string; updated: string };
type Status = ProviderStatus;
/** Each queued request resolves its own outcome, including requests dropped before sending. */
type Queued = { text: string; context?: CoachSelection | undefined; auto?: ActionId; find?: boolean; proposePlan?: boolean; done: (result: FindTurn) => void };
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
/** A typed message belongs to the conversation, not a particular mounted panel. */
let draftText = "";
let accountChanged = false;
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

if (typeof addEventListener === "function") addEventListener("struna:account-changed", () => {
  accountChanged = true;
  state.busy?.abort(); dropQueue(); state.messages = []; state.conversation = null;
  state.draft = null; draftText = ""; state.more = false; state.settings = false; providers = null; emit();
});

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
  for (const q of dropped) q.done({ ok: false, complete: true, additions: null, problem: "The queued request was cancelled" });
}

/** Collect terminal status and, for a find request, the actual Materials additions. */
async function send(text: string, auto?: ActionId, find = false, context?: CoachSelection, proposePlan = false): Promise<FindTurn> {
  const abort = new AbortController();
  state.busy = abort;
  let ok = true;
  let complete = false;
  let problem = "";
  let unavailable = false;
  let additions: FindTurn["additions"] = null;
  let before: MaterialsSnapshot | null = null;
  let sent = false;
  const snapshot = () => api.get<MaterialsSnapshot>("/api/materials?limit=40000");
  update((m) => [...m, { role: "user", text, ...(auto ? { auto } : {}) }, { role: "assistant", text: "", streaming: true }]);
  try {
    if (find) {
      // This happens when this request reaches the front of the queue, after earlier turns.
      const status = await loadProviders(true);
      const ready = readiness(status, state.provider);
      const current = status?.list?.find(row => row.id === state.provider);
      if (!ready.ok || (current && !current.web)) {
        unavailable = true;
        complete = true;
        throw new Error(!ready.ok ? ready.detail : "this coach has no web access");
      }
      before = await snapshot();
      addedMaterials(before, before); // Refuse an incomplete baseline before sending a turn.
    }
    if (accountChanged || abort.signal.aborted) throw new DOMException("Stopped", "AbortError");
    sent = true;
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { ...accountHeaders(), "x-struna": "1", "content-type": "application/json" },
      body: JSON.stringify({ provider: state.provider, message: text, ...(proposePlan ? { proposePlan: true } : {}), ...(state.conversation ? { conversation: state.conversation } : {}), ...(auto ? { auto } : {}), screen: screenContext.get(), ...(context ? { context } : {}) }),
      signal: abort.signal,
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      if (accountHeaders()["x-struna-session"] && [401, 409].includes(res.status) && (res.status === 401 || /account changed/.test(err.error ?? ""))) { invalidateAccount(); dispatchEvent(new Event("struna:account-changed")); }
      complete = true;
      throw new Error(err.error ?? res.statusText);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done || accountChanged || abort.signal.aborted) break;
      buf += value;
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (\w+)/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (!ev || !data) continue;
        const d = JSON.parse(data);
        if (accountChanged || abort.signal.aborted) break;
        if (ev === "context") update(m => m.map((row, index) => index === m.length - 2 && row.role === "user" ? { ...row, text: `${text}\n\nContext sent:\n${d.summary}` } : row));
        else if (ev === "conversation") state.conversation = d.id;
        else if (ev === "delta" || ev === "notice" || ev === "error") {
          if (ev === "error") { ok = false; problem = d.message ?? "The Coach reported an error"; }
          update((m) => applyEvent(m, ev, d));
        }
        // The coach changed the plan, the materials or the profile: the screens showing them reload.
        else if (ev === "changed") {
          dispatchEvent(new CustomEvent("struna:changed", { detail: d }));
        } else if (ev === "done") {
          dispatchEvent(new Event("struna:proposals"));
          complete = true;
          if (d.aborted) { ok = false; problem = "The Coach stopped"; }
        }
      }
    }
    if (find && complete && before) {
      try { additions = addedMaterials(before, await snapshot()); }
      catch (e) { problem = (e as Error).message; }
    }
  } catch (e) {
    ok = false;
    problem = String((e as Error).message ?? e);
    // No request was sent if the initial snapshot or readiness check failed.
    if (find && !sent) complete = true;
    if (!accountChanged && (e as Error).name !== "AbortError") update((m) => [...m, { role: "error", text: String((e as Error).message ?? e) }]);
  } finally {
    if (!accountChanged && (!ok || !complete) && !auto && !draftText) draftText = text;
    state.busy = null;
    update((m) =>
      m
        .map((x) => (x.streaming ? { ...x, streaming: false, text: x.text || (abort.signal.aborted ? "Stopped." : "") } : x))
        .filter((x) => !(x.role === "assistant" && !x.text)),
    );
  }
  return { ok: ok && complete && !abort.signal.aborted, complete, additions, problem, ...(unavailable ? { unavailable } : {}) };
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
      if (accountChanged) { next.done({ ok: false, complete: true, additions: null, problem: "Your account changed. Reload before continuing." }); dropQueue(); break; }
      if (accountHeaders()["x-struna-session"] && !readiness(await loadProviders(), state.provider).ok) {
        draftText = next.text; state.settings = true; openCoach(); emit();
        next.done({ ok: false, complete: true, additions: null, problem: "Connect your AI or keep practicing" }); dropQueue(); break;
      }
      const result = await send(next.text, next.auto, next.find, next.context, next.proposePlan);
      next.done(result);
      if (!result.ok && state.queue.length) {
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
  // A retained pane may be in another section, behind the tuner, or off the pane switcher.
  const shown = panes && [...document.querySelectorAll<HTMLElement>(".pane-coach .chatbody")].find((el) => el.checkVisibility());
  if (shown) {
    shown.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    return;
  }
  dispatchEvent(new Event("struna:coach-open"));
}

/**
 * Send a message to the coach from anywhere in the app. It joins the current conversation and
 * waits its turn behind a running reply. `auto` marks a message the app sent because something happened.
 */
function enqueue(text: string, opts: { auto?: ActionId; open?: boolean; find?: boolean; proposePlan?: boolean } = {}): Promise<FindTurn> {
  const t = text.trim();
  if (accountChanged) return Promise.resolve({ ok: false, complete: true, additions: null, problem: "Your account changed. Reload before continuing." });
  if (!t) return Promise.resolve({ ok: false, complete: true, additions: null, problem: "The request is blank" });
  if (accountHeaders()["x-struna-session"] && opts.auto) return Promise.resolve({ ok: false, complete: true, additions: null, problem: "Choose Send in Coach to use your API account" });
  state.more = false;
  const result = new Promise<FindTurn>((done) => state.queue.push({ text: t, ...(accountHeaders()["x-struna-session"] && screenContext.get().coach ? { context: structuredClone(screenContext.get().coach!) } : {}), ...(opts.auto ? { auto: opts.auto } : {}), ...(opts.find ? { find: true } : {}), ...(opts.proposePlan ? { proposePlan: true } : {}), done }));
  emit();
  if (opts.open) openCoach();
  void pump();
  return result;
}

export function askCoach(text: string, opts: { auto?: ActionId; open?: boolean } = {}): Promise<boolean> {
  return enqueue(text, opts).then(result => result.ok);
}

/** Resolve only this queued request, using the actual Materials changes during its turn. */
export function findMaterialsWithCoach(text: string): Promise<FindTurn> {
  return enqueue(text, { find: true });
}

export function openCoachSettings(): void {
  state.settings = true;
  emit();
  openCoach();
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

function Chips({ prompts, more, disabled = false }: { prompts: Prompt[]; more?: (() => void) | undefined; disabled?: boolean | undefined }) {
  return (
    <div className="chips promptchips">
      {prompts.map((p) => (
        <button key={p.id} type="button" aria-disabled={disabled || Boolean(state.busy) || state.queue.length > 0} onClick={() => { if (!disabled) usePrompt(p); }}>
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
  const ctx = useSyncExternalStore(screenContext.subscribe, screenContext.get);
  const { prompts } = usePrompts();
  if (!prompts.length) return null;
  const list = promptsFor(prompts, screen, ctx).slice(0, 2);
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
      <p className="srcnote">Draft fills the message box for you to review. Send submits the request immediately. Plan change requests are drafted. Hosted Coach currently gives advice only and cannot change your plan; local Studio can stage changes for Apply.</p>
    </div>
  );
}

/** The coach conversation: in the slide-over, or in a workspace pane (no Done button there). */
export function ChatPanel({ open, onClose, onPin }: { open: boolean; onClose?: (() => void) | undefined; onPin?: (() => void) | undefined }) {
  useChat();
  const hosted = useApp().mode === "hosted";
  const generic = useApp().mode === "studio" || hosted;
  const { prompts } = usePrompts();
  const ctx = useSyncExternalStore(screenContext.subscribe, screenContext.get);
  const [proposalMode, setProposalMode] = useState(false);
  const [contextRetry, setContextRetry] = useState(0);
  const [preview, setPreview] = useState<{ selection: CoachSelection; context?: CoachContext; error?: string } | null>(null);
  useEffect(() => {
    if (!hosted || !open || !ctx.coach) return;
    let live = true;
    const selection = ctx.coach;
    void api.post<CoachContext>("/api/chat/context", selection).then(context => { if (live) setPreview({ selection, context }); }, e => { if (live) setPreview({ selection, error: (e as Error).message }); });
    return () => { live = false; };
  }, [hosted, open, ctx, contextRetry]);
  const contextReady = !hosted || (!!ctx.coach && preview?.selection === ctx.coach && !!preview.context);
  const text = draftText;
  const [list, setList] = useState<Conv[] | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const shown = useRef(false);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    dispatchEvent(new Event("struna:proposals"));
    void loadProviders(true).then((p) => p && setStatus(p));
  }, [open]);
  // The settings changed a coach: the module already asked again; show its answer.
  useEffect(() => {
    if (!generic) return;
    const on = () => void loadProviders().then(setStatus);
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
    draftText = draft;
    emit();
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
    if (!t || state.busy || state.queue.length || !contextReady) return;
    if (hosted && !readiness(status, state.provider).ok) { state.settings = true; emit(); return; }
    draftText = "";
    emit();
    void enqueue(t, { proposePlan: hosted && proposalMode });
  };
  const st = status?.[state.provider as "claude" | "codex"];
  const screen = screenId(ctx.view);
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
  const settingsLink = <button className="linkbtn" onClick={() => setSettings(true)}>{hosted ? "Connect your AI" : "Coach settings"}</button>;

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
        {hosted && !state.settings && <details className="coach-context" open>
          <summary>Practice context for your next Send</summary>
          <p className="srcnote">{preview?.selection === ctx.coach ? preview?.error || preview?.context?.summary || "Preparing context…" : "Preparing context…"}</p>
          {preview?.selection === ctx.coach && preview?.error && <button className="linkbtn" onClick={() => setContextRetry(n => n + 1)}>Retry practice context</button>}
          <p className="srcnote">Only Send shares this with your provider. Clean tempos and reflections are player reports, not audio analysis.</p>
        </details>}
        <div className="chatbar">
          <button className="linkbtn" onClick={() => (showSettings ? setSettings(false) : showMore ? setMore(false) : list ? setList(null) : void showList())} aria-expanded={Boolean(list)}>{list || showMore || showSettings ? "Back to the conversation" : "Conversations"}</button>
          {onPin && <button className="linkbtn coach-pin" onClick={onPin}>Pin beside music</button>}
          {generic && !showSettings && <button className="linkbtn" onClick={() => {
            setList(null);
            setSettings(true);
          }}>{hosted ? "Connect your AI" : "Coach settings"}</button>}
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
            <CoachProviders onDone={() => setSettings(false)} onSkip={() => { setSettings(false); onClose?.(); }} />
          </div>
        ) : showMore ? (
          <PromptSheet prompts={contextReady ? prompts : []} screen={screen} sheetRef={sheet} />
        ) : (
          <div className="chatlog" ref={log} aria-live="polite">
            {generic && <PlanCandidates />}
            {state.messages.length === 0 && (
              <div className="chatempty">
                <p>{hosted ? "AI coaching is optional. Send shares your question, the displayed context and recent conversation with your OpenAI API account. Coach cannot read material contents or hear recordings. Choose Draft plan proposal to share your current plan and request a preview; only Apply changes Today. Your practice tools work without it." : generic
                  ? "Ask about today's session, a song, a chord, or what to practise next. The coach sees your plan, the stage you are on and the tempo, and can propose plan changes. Review the before/after preview and choose Apply to change Today."
                  : "Ask about today's session, a passage, or a block review. The coach sees the current block, stage and tempo."}</p>
                {!coaches && st && !st.ok && <p className="notice">{NAMES[state.provider]} is not signed in on {status?.host ?? "Kvant"}: {st.detail}</p>}
                {offered.length > 0 && !noCoach && <Chips prompts={offered.slice(0, 2)} disabled={!contextReady} more={() => setMore(true)} />}
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
          <Chips prompts={offered.slice(0, 2)} disabled={!contextReady} more={() => setMore(true)} />
          </div>
        )}
        {!list && !showMore && !showSettings && !retired && noCoach && (
          <div className="composer nocoach">
            <p className="notice">{hosted ? "AI coaching is optional. Your OpenAI API account pays for requests; a ChatGPT subscription alone does not provide an API key." : "No coach is set up."} {settingsLink}</p>
            {hosted && <button className="btn quiet" onClick={() => onClose?.()}>Keep practicing without AI</button>}
          </div>
        )}
        {!list && !showMore && !showSettings && !retired && notReady && (
          <div className="notice notready">
            <p>{notReady.label} is not ready: {notReady.detail}. {settingsLink}</p>
            <button className="btn outline" disabled={Boolean(state.busy)} onClick={() => newConversation(fallback)}>New conversation with {nameOf(fallback, status)}</button>
          </div>
        )}
        {!list && !showMore && !showSettings && !retired && (!noCoach || hosted) && (
          <><label className="proposal-option" hidden={!hosted}><input type="checkbox" checked={proposalMode} disabled={Boolean(state.busy)} onChange={e => setProposalMode(e.target.checked)} />Request plan preview (shares current plan)</label>
          <form className="composer" onSubmit={submit}>
            <textarea
              ref={input}
              className="input"
              rows={2}
              value={text}
              placeholder={`Message ${name}`}
              aria-label="Message"
              onChange={(e) => {
                draftText = e.target.value;
                emit();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
              }}
            />
            {state.busy ? (
              <button type="button" className="btn outline" onClick={stop}>Stop</button>
            ) : (
              <button className="btn outline" disabled={!contextReady || !text.trim()}>{hosted && proposalMode ? "Draft plan proposal" : "Send"}</button>
            )}
          </form></>
        )}
    </div>
  );
}

/** The native modal owns background inertness; the panel stays mounted to retain drafts and requests. */
export function Chat({ open, onClose, onPin }: { open: boolean; onClose: () => void; onPin?: (() => void) | undefined }) {
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
      const target = opener?.isConnected && opener.tabIndex >= 0 && !opener.matches(":disabled") && opener.checkVisibility() && !opener.closest("[inert]")
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
        <ChatPanel open={open} onClose={onClose} onPin={onPin} />
      </dialog>
    </div>
  );
}
