import { useEffect, useRef, useState } from "react";

import { api } from "../api.ts";
import { codeParts, countdown, type Preset, type ProviderRow, type ProviderStatus } from "./providers.ts";

/**
 * Said to the rest of the app after a coach was set up, changed or removed, so the coach panel and any
 * other copy of these settings ask again. `detail` is the copy that said it, which has already updated.
 */
export const PROVIDERS_CHANGED = "struna:providers-changed";

type Login = { state: "idle" | "waiting" | "done" | "failed"; url?: string; code?: string; expiresAt?: string; detail?: string };

const POLL_MS = 3000;
/** Model names the Claude CLI knows on its own, offered as suggestions. */
const CLAUDE_MODELS = ["sonnet", "opus", "haiku"];

/** Text with `code` between backticks shown as code. */
function Note({ text }: { text: string }) {
  return <p className="srcnote">{codeParts(text).map((t, i) => (i % 2 ? <code key={i}>{t}</code> : t))}</p>;
}

const message = (e: unknown) => String((e as Error)?.message ?? e);
const sameOrigin = (a: string, b: string) => {
  try {
    return new URL(a.trim()).origin === new URL(b).origin;
  } catch {
    return false;
  }
};

/**
 * The coaches this instance offers (studio mode), one row each: whether it is ready, and how to set it up.
 * Host logins show the terminal command; ChatGPT signs in with a code; keys and endpoints are typed here
 * and only ever come back as their last four characters.
 */
export function CoachProviders() {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const self = useRef({});
  const changed = () => dispatchEvent(new CustomEvent(PROVIDERS_CHANGED, { detail: self.current }));

  const load = async () => {
    setChecking(true);
    try {
      setStatus(await api.get<ProviderStatus>("/api/providers"));
      setError("");
    } catch (e) {
      setError(message(e));
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    void load();
    // Another copy (the start page's and the coach panel's can both be open) changed a coach: show it here too.
    const on = (e: Event) => {
      if ((e as CustomEvent).detail !== self.current) void load();
    };
    addEventListener(PROVIDERS_CHANGED, on);
    return () => removeEventListener(PROVIDERS_CHANGED, on);
  }, []);

  /** A row came back from a save or removal: show it, and tell the coach panel. */
  const replace = (row: ProviderRow) => {
    setStatus((s) => (s?.list ? { ...s, list: s.list.map((r) => (r.id === row.id ? row : r)) } : s));
    changed();
  };

  if (!status) return <div className="coachprov">{error ? <p className="notice" role="alert">The coaches could not be loaded: {error}</p> : <p className="srcnote">Checking the coaches…</p>}</div>;
  const list = status.list ?? [];
  return (
    <div className="coachprov">
      <p className="srcnote">Sending stages plan proposals for review. Only Apply changes the active plan; materials, notes and profile edits still take effect directly. Providers are unavailable when their plan-write sandbox cannot be qualified.</p>
      <p className="grp">Coach</p>
      {list.length === 0 && <p className="notice">Every coach is turned off on this instance. Ask whoever runs it to turn one on.</p>}
      <ul className="provlist">
        {list.map((r) => (
          <li key={r.id} className={`provrow${r.ok ? " ok" : ""}`} aria-labelledby={`prov-${r.id}`}>
            <div className="provhd">
              <span className="provname" id={`prov-${r.id}`}>{r.label}</span>
              {r.experimental && <span className="provtag">Experimental</span>}
            </div>
            <p className="provstate" aria-live="polite"><span className="provdot" aria-hidden="true" /><span className="sr">{r.ok ? "Ready: " : "Not ready: "}</span>{r.detail}</p>
            {r.unavailable ? null : r.setup === "host" ? <HostRow row={r} host={status.host ?? "this computer"} checking={checking} onCheck={() => void load().then(changed)} /> : r.setup === "device" ? <DeviceRow row={r} onRow={replace} onDone={() => void load().then(changed)} /> : r.setup === "key" ? <KeyRow row={r} onRow={replace} /> : <EndpointRow row={r} onRow={replace} />}
            {r.notes.map((n) => <Note key={n} text={n} />)}
          </li>
        ))}
      </ul>
      {error && <p className="notice" role="alert">{error}</p>}
    </div>
  );
}

/** This computer's own login: the app never signs in for the player, it only says how and checks again. */
function HostRow({ row, host, checking, onCheck }: { row: ProviderRow; host: string; checking: boolean; onCheck: () => void }) {
  return (
    <div className="provbody">
      {row.ok ? (
        row.signOut && <p className="srcnote">To sign out, run <code>{row.signOut}</code> on {host}.</p>
      ) : (
        row.command && <p className="provcmd">In a terminal on {host}: <code>{row.command}</code></p>
      )}
      <div className="provacts">
        <button className="btn quiet" disabled={checking} onClick={onCheck}>{checking ? "Checking" : "Check again"}</button>
      </div>
    </div>
  );
}

/**
 * Focus for a row whose buttons swap (Add a key, Change, Save, Cancel, Remove, Sign in): once the form or
 * panel is closed, `refocus` puts it on the row's first action, so it never falls back to the page.
 */
function useRefocus(closed: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [want, setWant] = useState(false);
  useEffect(() => {
    if (!closed || !want) return;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    setWant(false);
  }, [closed, want]);
  return { ref, refocus: () => setWant(true) };
}

/** Shared by the rows that save: one request at a time, and its error under the row. */
function useSave(onRow: (r: ProviderRow) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<ProviderRow>): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      onRow(await fn());
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, clear: () => setError("") };
}

/** A model field with the Claude aliases as suggestions; empty means the default. */
function ModelField({ id, value, onChange, claude, placeholder, required }: { id: string; value: string; onChange: (v: string) => void; claude: boolean; placeholder: string; required?: boolean }) {
  return (
    <label className="field">
      <span className="grp">Model{required ? "" : " (optional)"}</span>
      <input className="input" name={`model-${id}`} value={value} maxLength={200} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder={placeholder} required={required} {...(claude ? { list: "claude-models" } : {})} onChange={(e) => onChange(e.target.value)} />
      {claude && (
        <datalist id="claude-models">
          {CLAUDE_MODELS.map((m) => <option key={m} value={m} />)}
        </datalist>
      )}
    </label>
  );
}

/**
 * A key field: never filled in from the server, which has only the hint. It is uncontrolled, so React never
 * copies the typed key into the element's value attribute, where anything reading the page's HTML would see it.
 */
function KeyField({ id, label, hint, required, inputRef, autoFocus }: { id: string; label: string; hint: string | null | undefined; required: boolean; inputRef: React.Ref<HTMLInputElement>; autoFocus?: boolean }) {
  return (
    <label className="field">
      <span className="grp">{label}</span>
      <input
        className="input"
        type="password"
        name={`key-${id}`}
        ref={inputRef}
        autoFocus={autoFocus}
        defaultValue=""
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        maxLength={4096}
        required={required && !hint}
        placeholder={hint ? (hint === "saved" ? "Leave empty to keep the saved key" : `Leave empty to keep the key ending ${hint}`) : "Paste the key"}
      />
    </label>
  );
}

/** Anthropic, OpenAI and Bedrock: a key, a model, and for Bedrock its region. */
function KeyRow({ row, onRow }: { row: ProviderRow; onRow: (r: ProviderRow) => void }) {
  const { busy, error, run, clear } = useSave(onRow);
  const [open, setOpen] = useState(false);
  const keyRef = useRef<HTMLInputElement>(null);
  const [model, setModel] = useState("");
  const [region, setRegion] = useState("");
  const claude = row.via === "Claude Code";
  const bedrock = row.id === "bedrock";
  const saved = row.hint !== null && row.hint !== undefined;
  const { ref: actsRef, refocus } = useRefocus(!open);
  const edit = () => {
    setModel(row.model ?? "");
    setRegion(row.region ?? "");
    setOpen(true);
  };
  const remove = async () => {
    if (confirm(`Remove the saved ${row.label}?`) && (await run(() => api.del<ProviderRow>(`/api/coach/providers/${row.id}`)))) refocus();
  };

  if (!open) {
    return (
      <div className="provbody">
        <div className="provacts" ref={actsRef}>
          {saved ? (
            <>
              <button className="btn quiet" disabled={busy} onClick={edit}>Change</button>
              <button className="btn quiet" disabled={busy} onClick={() => void remove()}>Remove</button>
            </>
          ) : (
            <button className="btn outline" disabled={busy} onClick={edit}>Add a key</button>
          )}
        </div>
        {error && <p className="notice" role="alert">{error}</p>}
      </div>
    );
  }
  return (
    <form
      className="provform"
      onSubmit={async (e) => {
        e.preventDefault();
        const key = keyRef.current?.value.trim() ?? "";
        // The field starts with the model in use, which may be the default: send it only when it was changed,
        // so a new key alone stays a new key alone and keeps the conversations' history.
        const m = model.trim();
        const body = { ...(key ? { key } : {}), ...(m !== (row.model ?? "") ? { model: m } : {}), ...(bedrock ? { region: region.trim() } : {}) };
        if (await run(() => api.put<ProviderRow>(`/api/coach/providers/${row.id}`, body))) {
          if (keyRef.current) keyRef.current.value = "";
          setOpen(false);
          refocus();
        }
      }}
    >
      <KeyField id={row.id} label={bedrock ? "Bedrock API key" : "API key"} hint={row.hint} required inputRef={keyRef} autoFocus />
      {bedrock && (
        <label className="field">
          <span className="grp">AWS region</span>
          <input className="input" name="region" value={region} required autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="us-east-1" onChange={(e) => setRegion(e.target.value)} />
        </label>
      )}
      <ModelField id={row.id} value={model} onChange={setModel} claude={claude} placeholder={row.id === "anthropic" ? "sonnet" : "Empty: the default model"} />
      <div className="provacts">
        <button className="btn outline" disabled={busy}>{busy ? "Saving" : "Save"}</button>
        <button type="button" className="btn quiet" disabled={busy} onClick={() => {
          clear();
          setOpen(false);
          refocus();
        }}>Cancel</button>
      </div>
      {error && <p className="notice" role="alert">That was not saved: {error}</p>}
    </form>
  );
}

/** Any provider that speaks the Responses API: a preset, its address, a key when it needs one, and the model. */
function EndpointRow({ row, onRow }: { row: ProviderRow; onRow: (r: ProviderRow) => void }) {
  const { busy, error, run, clear } = useSave(onRow);
  const presets = row.presets ?? [];
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [header, setHeader] = useState<"bearer" | "api-key">("bearer");
  const keyRef = useRef<HTMLInputElement>(null);
  const [model, setModel] = useState("");
  const p: Preset | undefined = presets.find((x) => x.id === preset);
  const choose = (id: string) => {
    const next = presets.find((x) => x.id === id);
    setPreset(id);
    if (next) {
      setBaseUrl(next.baseUrl);
      setHeader(next.header);
    }
  };
  const edit = () => {
    const id = row.preset ?? presets[0]?.id ?? "other";
    setPreset(id);
    setBaseUrl(row.baseUrl ?? presets.find((x) => x.id === id)?.baseUrl ?? "");
    setHeader(row.header ?? presets.find((x) => x.id === id)?.header ?? "bearer");
    setModel(row.model ?? "");
    setOpen(true);
  };
  const keyKind = p?.key ?? "optional";
  // The server keeps a saved key only for the same address, so the field offers to keep it only then.
  const keepHint = row.baseUrl && sameOrigin(baseUrl, row.baseUrl) ? row.hint : null;
  const { ref: actsRef, refocus } = useRefocus(!open);
  const remove = async () => {
    if (confirm("Remove this provider?") && (await run(() => api.del<ProviderRow>(`/api/coach/providers/${row.id}`)))) refocus();
  };

  if (!open) {
    return (
      <div className="provbody">
        <div className="provacts" ref={actsRef}>
          {row.ok ? (
            <>
              <button className="btn quiet" disabled={busy} onClick={edit}>Change</button>
              <button className="btn quiet" disabled={busy} onClick={() => void remove()}>Remove</button>
            </>
          ) : (
            <button className="btn outline" disabled={busy} onClick={edit}>Set up a provider</button>
          )}
        </div>
        {error && <p className="notice" role="alert">{error}</p>}
      </div>
    );
  }
  return (
    <form
      className="provform"
      onSubmit={async (e) => {
        e.preventDefault();
        const key = keyKind === "none" ? "" : (keyRef.current?.value.trim() ?? "");
        const body = { preset, baseUrl: baseUrl.trim(), header, model: model.trim(), ...(key ? { key } : {}) };
        if (await run(() => api.put<ProviderRow>(`/api/coach/providers/${row.id}`, body))) {
          if (keyRef.current) keyRef.current.value = "";
          setOpen(false);
          refocus();
        }
      }}
    >
      <label className="field">
        <span className="grp">Provider</span>
        <select className="input" name="preset" autoFocus value={preset} onChange={(e) => choose(e.target.value)}>
          {presets.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </label>
      <label className="field">
        <span className="grp">Base URL</span>
        <input className="input" name="baseUrl" type="url" inputMode="url" value={baseUrl} required autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="https://example.com/v1" onChange={(e) => setBaseUrl(e.target.value)} />
      </label>
      {preset === "azure" && <p className="srcnote">Put your resource's name in place of RESOURCE.</p>}
      {preset === "other" && (
        <label className="field">
          <span className="grp">How the key is sent</span>
          <select className="input" name="header" value={header} onChange={(e) => setHeader(e.target.value as "bearer" | "api-key")}>
            <option value="bearer">Authorization: Bearer</option>
            <option value="api-key">api-key header</option>
          </select>
        </label>
      )}
      {keyKind !== "none" && <KeyField id={row.id} label={keyKind === "required" ? "API key" : "API key (optional)"} hint={keepHint} required={keyKind === "required"} inputRef={keyRef} />}
      <ModelField id={row.id} value={model} onChange={setModel} claude={false} placeholder={preset === "ollama" ? "gpt-oss:20b" : "The model name the provider uses"} required />
      <div className="provacts">
        <button className="btn outline" disabled={busy}>{busy ? "Checking" : "Save"}</button>
        <button type="button" className="btn quiet" disabled={busy} onClick={() => {
          clear();
          setOpen(false);
          refocus();
        }}>Cancel</button>
      </div>
      {error && <p className="notice" role="alert">That was not saved: {error}</p>}
    </form>
  );
}

/** ChatGPT signed in here: Codex's own device-code sign-in, with the link, the code and a countdown. */
function DeviceRow({ row, onRow, onDone }: { row: ProviderRow; onRow: (r: ProviderRow) => void; onDone: () => void }) {
  const { busy, error, run } = useSave(onRow);
  const [login, setLogin] = useState<Login>({ state: "idle" });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState<"" | "yes" | "no">("");
  const codeRef = useRef<HTMLElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [model, setModel] = useState(row.model ?? "");
  const waiting = login.state === "waiting";
  const shown = Boolean(waiting && login.url && login.code);
  const { ref: actsRef, refocus } = useRefocus(!shown);
  // The steps and the code take focus when they appear, so a screen reader reads them; when they go
  // (Cancel, done, failed), focus goes to the row's button.
  const wasShown = useRef(false);
  useEffect(() => {
    if (shown) boxRef.current?.focus();
    else if (wasShown.current) refocus();
    wasShown.current = shown;
  }, [shown]);

  // A sign-in may already be running (the settings were closed and opened again).
  useEffect(() => {
    let live = true;
    api.get<Login>("/api/coach/providers/chatgpt/login").then((l) => live && l.state === "waiting" && setLogin(l), () => {});
    return () => {
      live = false;
    };
  }, []);

  // While waiting: ask every 3 seconds whether Codex finished, and count down to the code's expiry.
  useEffect(() => {
    if (!waiting) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => {
      api.get<Login>("/api/coach/providers/chatgpt/login").then((l) => {
        setLogin(l);
        if (l.state === "done") onDone();
      }, () => {});
    }, POLL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [waiting]);

  const start = async () => {
    setStarting(true);
    setStartError("");
    setCopied("");
    try {
      setLogin(await api.post<Login>("/api/coach/providers/chatgpt/login"));
      setNow(Date.now());
    } catch (e) {
      setStartError(message(e));
    } finally {
      setStarting(false);
    }
  };
  const cancel = async () => {
    await api.del("/api/coach/providers/chatgpt/login").catch(() => {});
    setLogin({ state: "idle" });
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(login.code ?? "");
      setCopied("yes");
    } catch {
      // No clipboard (plain http on another computer): select the code so it can be copied by hand.
      const el = codeRef.current;
      if (el) getSelection()?.selectAllChildren(el);
      setCopied("no");
    }
  };

  if (waiting && login.url && login.code) {
    const left = login.expiresAt ? countdown(login.expiresAt, now) : "";
    return (
      <div className="provbody devicebox" role="group" aria-label="ChatGPT sign-in" tabIndex={-1} ref={boxRef}>
        <p className="devstep">1. Open <a href={login.url} target="_blank" rel="noopener noreferrer">{login.url.replace(/^https:\/\//, "")}</a> and sign in to ChatGPT.</p>
        <p className="devstep">2. Enter this code:</p>
        <div className="devcode">
          <code ref={codeRef} aria-label="Sign-in code">{login.code}</code>
          <button type="button" className="btn quiet" onClick={() => void copy()}>{copied === "yes" ? "Copied" : "Copy"}</button>
        </div>
        {copied === "no" && <p className="srcnote">The code is selected: copy it with your keyboard or the menu.</p>}
        {left && <p className="srcnote" aria-live="off">The code expires in {left}. This page checks every few seconds.</p>}
        <div className="provacts">
          <button type="button" className="btn quiet" onClick={() => void cancel()}>Cancel</button>
        </div>
      </div>
    );
  }
  return (
    <div className="provbody">
      {/* The status line says so once the row has caught up. */}
      {login.state === "done" && !row.ok && <p className="srcnote" role="status">Signed in.</p>}
      {login.state === "failed" && login.detail && <p className="notice" role="alert">{login.detail}</p>}
      {startError && <p className="notice" role="alert">The sign-in did not start: {startError}</p>}
      {row.ok && (
        <form className="provform inline" onSubmit={(e) => {
          e.preventDefault();
          void run(() => api.put<ProviderRow>("/api/coach/providers/chatgpt", { model: model.trim() }));
        }}>
          <ModelField id={row.id} value={model} onChange={setModel} claude={false} placeholder="Empty: the default model" />
          <button className="btn quiet" disabled={busy || model.trim() === (row.model ?? "")}>Save the model</button>
        </form>
      )}
      <div className="provacts" ref={actsRef}>
        {row.ok ? (
          <button className="btn quiet" disabled={busy} onClick={() => {
            if (!confirm("Sign out of ChatGPT here?")) return;
            setLogin({ state: "idle" });
            void run(() => api.del<ProviderRow>("/api/coach/providers/chatgpt")).then((ok) => ok && refocus());
          }}>Sign out</button>
        ) : (
          <button className="btn outline" disabled={starting} onClick={() => void start()}>{starting ? "Starting" : "Sign in with a code"}</button>
        )}
      </div>
      {error && <p className="notice" role="alert">{error}</p>}
    </div>
  );
}
