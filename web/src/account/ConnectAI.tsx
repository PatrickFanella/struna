import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { PROVIDERS_CHANGED } from "../chat/CoachProviders.tsx";

type ConnectionStatus = { connected: boolean; model: string | null; tested: string | null; detail: string };
/** Secrets exist only in this password input until saved; status never returns them. */
export function ConnectAI({ onDone, onSkip }: { onDone?: (() => void) | undefined; onSkip?: (() => void) | undefined }) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const actions = useRef<HTMLDivElement>(null);
  const load = () => api.get<ConnectionStatus>("/api/providers/openai").then(s => { setStatus(s); setModel(s.model ?? ""); }, () => setError("Could not load your AI connection. Retry, or keep practicing."));
  useEffect(() => { void load(); }, []);
  async function change(run: () => Promise<ConnectionStatus>) {
    setBusy(true); setError("");
    try { const s = await run(); setStatus(s); dispatchEvent(new Event(PROVIDERS_CHANGED)); requestAnimationFrame(() => actions.current?.querySelector<HTMLButtonElement>("button")?.focus()); }
    catch (e) { setError((e as Error).message); }
    finally { setKey(""); setBusy(false); }
  }
  return <div className="coachprov">
    <h3>Connect your OpenAI API key</h3>
    <p>AI coaching is optional. Your OpenAI API account pays for model usage; a ChatGPT subscription alone does not supply this API key. Your practice tools work without it.</p>
    <p className="srcnote">Only OpenAI API keys are supported here. Subscription sign-in, other providers and custom endpoints are unavailable.</p>
    <p className="srcnote">When you choose Send, OpenAI receives your question and recent messages in this private conversation. Coach cannot read your files or change your plan. Practice context is not sent automatically. Saving a key makes no provider request.</p>
    <p role="status">{status?.detail ?? "Checking your connection…"}</p>
    <form className="provform" onSubmit={e => { e.preventDefault(); void change(() => api.put("/api/providers/openai", { ...(key ? { key } : {}), model: model.trim() })); }}>
      <label className="field">{status?.connected ? "Replace API key (leave blank to keep it)" : "OpenAI API key"}
        <input type="password" className="input" autoComplete="off" value={key} disabled={busy} required={!status?.connected} onChange={e => setKey(e.target.value)} />
      </label>
      <label className="field">OpenAI model
        <input aria-label="OpenAI model" className="input" autoComplete="off" value={model} disabled={busy} required onChange={e => setModel(e.target.value)} />
        <span className="srcnote">Use a Responses API model available to your OpenAI project.</span>
      </label>
      <button className="btn outline" disabled={busy}>{busy ? "Please wait…" : "Save connection"}</button>
    </form>
    <div className="provacts" ref={actions}>
      {status?.connected && <>
        <button className="btn outline" disabled={busy} onClick={() => void change(() => api.post("/api/providers/openai/test", { confirm: true }))}>Test connection (uses your API account)</button>
        <button className="btn quiet" disabled={busy} onClick={() => void change(() => api.del("/api/providers/openai"))}>Disconnect</button>
      </>}
      {status?.tested && <button className="btn outline" disabled={busy} onClick={onDone}>Return to my question</button>}
      <button className="btn quiet" disabled={busy} onClick={onSkip}>Keep practicing without AI</button>
      {error && <button className="btn quiet" disabled={busy} onClick={() => void load()}>Reload connection</button>}
    </div>
    <p className="srcnote">Testing sends a small request billed by OpenAI. Each reply has an output limit; this is not a money cap. Disconnect stops active requests and removes Struna’s saved connection. To revoke the key everywhere, revoke it in your OpenAI account.</p>
    {error && <p className="notice" role="alert">{error}</p>}
  </div>;
}
