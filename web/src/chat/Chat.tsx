import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { api } from "../api.ts";
import { screenContext } from "../screen.ts";

type Provider = "claude" | "codex";
type Msg = { role: "user" | "assistant" | "error" | "notice"; text: string; streaming?: boolean };
type Conv = { id: string; provider: Provider; title: string; updated: string };
const NAMES: Record<Provider, string> = { claude: "Claude", codex: "ChatGPT" };

/**
 * Chat state lives outside the panel, so a reply keeps streaming while the panel
 * is closed and is there when it opens again.
 */
const state = { conversation: null as string | null, provider: "claude" as Provider, messages: [] as Msg[], busy: null as AbortController | null, version: 0 };
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

async function send(text: string) {
  const abort = new AbortController();
  state.busy = abort;
  update((m) => [...m, { role: "user", text }, { role: "assistant", text: "", streaming: true }]);
  const append = (t: string) => update((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, text: x.text + t } : x)));
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "x-guitar-room": "1", "content-type": "application/json" },
      body: JSON.stringify({ provider: state.provider, message: text, ...(state.conversation ? { conversation: state.conversation } : {}), screen: screenContext.get() }),
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
        else if (ev === "error") update((m) => [...m.slice(0, -1), m.at(-1)!, { role: "error", text: d.message }]);
        else if (ev === "notice") update((m) => [...m, { role: "notice", text: d.message }]);
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") update((m) => [...m, { role: "error", text: String((e as Error).message ?? e) }]);
  } finally {
    state.busy = null;
    update((m) =>
      m
        .map((x) => (x.streaming ? { ...x, streaming: false, text: x.text || (abort.signal.aborted ? "Stopped." : "") } : x))
        .filter((x) => !(x.role === "assistant" && !x.text)),
    );
  }
}

async function openConversation(id: string) {
  const c = await api.get<Conv & { messages: Msg[] }>(`/api/conversations/${id}`);
  state.conversation = c.id;
  state.provider = c.provider;
  state.messages = c.messages;
  emit();
}

function newConversation(provider = state.provider) {
  state.busy?.abort();
  state.conversation = null;
  state.provider = provider;
  state.messages = [];
  emit();
}

let loadedLast = false;

/** The coach conversation: in the slide-over, or in a workspace pane (no Done button there). */
export function ChatPanel({ open, onClose }: { open: boolean; onClose?: (() => void) | undefined }) {
  useChat();
  const [text, setText] = useState("");
  const [list, setList] = useState<Conv[] | null>(null);
  const [status, setStatus] = useState<Record<Provider, { ok: boolean; detail: string }> | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    api.get<Record<Provider, { ok: boolean; detail: string }> & { last: Provider }>("/api/providers").then((p) => {
      setStatus(p);
      if (!loadedLast && !state.conversation && !state.messages.length) {
        state.provider = p.last === "codex" ? "codex" : "claude";
        emit();
      }
      loadedLast = true;
    }, () => {});
    if (onClose) setTimeout(() => input.current?.focus(), 50);
  }, [open]);

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
    void send(t);
  };
  const st = status?.[state.provider];

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
          <button className="linkbtn" onClick={() => (list ? setList(null) : void showList())} aria-expanded={Boolean(list)}>{list ? "Back to the conversation" : "Conversations"}</button>
          <button className="linkbtn" disabled={Boolean(state.busy)} onClick={() => {
            newConversation();
            setList(null);
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
        ) : (
          <div className="chatlog" ref={log} aria-live="polite">
            {state.messages.length === 0 && (
              <div className="chatempty">
                <p>Ask about today's session, a passage, or a block review. The coach sees the current block, stage and tempo.</p>
                {st && !st.ok && <p className="notice">{NAMES[state.provider]} is not signed in on Kvant: {st.detail}</p>}
              </div>
            )}
            {state.messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.role === "assistant" ? (
                  <div className="md">
                    <Markdown remarkPlugins={[remarkGfm]}>{m.text || "…"}</Markdown>
                  </div>
                ) : (
                  <p>{m.text}</p>
                )}
              </div>
            ))}
            {state.busy && <p className="srcnote thinking">{NAMES[state.provider]} is working</p>}
          </div>
        )}
        {!list && (
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
              <button type="button" className="btn outline" onClick={() => state.busy?.abort()}>Stop</button>
            ) : (
              <button className="btn primary" disabled={!text.trim()}>Send</button>
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
