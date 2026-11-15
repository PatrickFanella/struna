import { useEffect, useState, useSyncExternalStore } from "react";

import { api } from "../api.ts";
import type { ActionId, ActionMode, AutoAction, Prompt } from "../generic.ts";
import { useApp } from "../mode.ts";
import { askCoach, coachReady, openCoach } from "./Chat.tsx";
import { CoachProviders } from "./CoachProviders.tsx";
import { unavailable } from "./providers.ts";
import { fillAction, loadPrompts, setPrompts, usePrompts } from "./prompts.ts";

type Toast = { key: number; id: ActionId; message: string; offer?: { label: string; text: string } };

/** What the toast says while the coach works on an automatic request. */
const WORKING: Record<ActionId, string> = {
  onboarding: "The coach is building your plan.",
  "material-added": "The coach is looking at what you added.",
  "session-logged": "The coach is reviewing your session.",
  "plan-complete": "The coach is reviewing your plan.",
  pain: "The coach is lightening your plan.",
  "back-after-break": "The coach is easing your plan back in.",
  "profile-changed": "The coach is adjusting your plan.",
};
/** What happened, when the coach is asked only after a tap. */
const HAPPENED: Record<ActionId, string> = {
  onboarding: "Your profile is saved.",
  "material-added": "New material is in.",
  "session-logged": "Your session is logged.",
  "plan-complete": "You have finished this plan.",
  pain: "You stopped for pain or tension.",
  "back-after-break": "Welcome back.",
  "profile-changed": "Your profile changed.",
};

const WORKING_MS = 8000;
const MAX = 3;
let toasts: Toast[] = [];
let serial = 0;
const listeners = new Set<() => void>();
const changed = () => {
  for (const l of listeners) l();
};
const dismiss = (key: number) => {
  toasts = toasts.filter((t) => t.key !== key);
  changed();
};
function show(t: Omit<Toast, "key">): void {
  const key = ++serial;
  // One toast per kind of event: a second upload replaces the first's note.
  toasts = [...toasts.filter((x) => x.id !== t.id), { ...t, key }].slice(-MAX);
  changed();
  if (!t.offer) setTimeout(() => dismiss(key), WORKING_MS);
}

const FAILED = "The coach could not do that: open the coach to see why.";

function run(a: AutoAction, text: string): void {
  const done = askCoach(text, { auto: a.id });
  show({ id: a.id, message: WORKING[a.id] ?? "The coach is working on it." });
  // A coach that is signed in can still fail (rate limits, errors): say so instead of letting "working" stand.
  void done.then((ok) => ok || show({ id: a.id, message: FAILED }));
}

/**
 * Tell the coach that something happened: a session was logged, material was added, the profile
 * was saved. What follows is the player's choice in Coach settings: the request is sent straight
 * away, offered as a button, or dropped. Does nothing where the server has no actions (the personal mode).
 */
export async function coachAction(id: ActionId, vars?: Record<string, string>): Promise<void> {
  const { actions } = await loadPrompts();
  const a = actions.find((x) => x.id === id);
  if (!a || a.mode === "off") return;
  // No signed-in coach: queuing the request would only leave an error in the conversation.
  const ready = await coachReady();
  if (!ready.ok) return show({ id, message: unavailable(id, ready.detail) });
  const text = fillAction(a.text, vars);
  if (a.mode === "auto") run(a, text);
  else show({ id, message: HAPPENED[id] ?? a.when, offer: { label: a.offer, text } });
}

/** The coach's notes about what it is doing or could do; they sit above the tab bar and never take focus. */
export function CoachToasts() {
  const list = useSyncExternalStore((fn) => (listeners.add(fn), () => listeners.delete(fn)), () => toasts);
  const { actions } = usePrompts();
  return (
    <div className="coachtoasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.key} className="coachtoast">
          <p>{t.message}</p>
          {t.offer ? (
            <button className="btn outline" onClick={() => {
              const offer = t.offer!;
              const a = actions.find((x) => x.id === t.id);
              dismiss(t.key);
              if (a) run(a, offer.text);
              else void askCoach(offer.text, { auto: t.id });
            }}>{t.offer.label}</button>
          ) : (
            <button className="btn outline" onClick={() => {
              dismiss(t.key);
              openCoach();
            }}>Open</button>
          )}
          <button className="toastx" aria-label="Dismiss" onClick={() => dismiss(t.key)}>×</button>
        </div>
      ))}
    </div>
  );
}

const MODES: [ActionMode, string][] = [["auto", "Auto"], ["ask", "Ask first"], ["off", "Off"]];
const CUSTOM_MAX = 30;
type Draft = { index: number | null; label: string; text: string };

/** The player's choices for the coach: what it does by itself, and their own saved prompts. */
export function CoachSettings() {
  const { prompts, actions } = usePrompts();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const custom = prompts.filter((p) => p.custom);
  const generic = useApp().mode === "studio";

  // Another tab or a restart may have changed them.
  useEffect(() => {
    void loadPrompts();
  }, []);

  const save = async (path: string, body: unknown): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      setPrompts(await api.put<unknown>(path, body));
      return true;
    } catch (e) {
      setError(String((e as Error).message ?? e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const saveCustom = (list: Pick<Prompt, "label" | "text">[]) => save("/api/prompts/custom", { prompts: list.map(({ label, text }) => ({ label, text })) });

  return (
    <div className="coachsettings">
      {generic && <CoachProviders />}
      <p className="grp">What the coach does by itself</p>
      <ul className="actionlist">
        {actions.map((a) => (
          <li key={a.id}>
            <span id={`act-${a.id}`}>{a.when}</span>
            <div className="seg mini words" role="radiogroup" aria-labelledby={`act-${a.id}`}>
              {MODES.map(([mode, label]) => (
                <button key={mode} role="radio" aria-checked={a.mode === mode} className={a.mode === mode ? "on" : ""} disabled={busy} onClick={() => a.mode !== mode && void save("/api/prompts/actions", { [a.id]: mode })}>{label}</button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <p className="srcnote">Auto sends the request immediately and can change the active plan, materials, notes and profile. Ask first waits for you to tap its button, then sends; it does not preview file changes. Off sends nothing. There is no Apply preview yet.</p>

      <p className="grp">Your prompts</p>
      {custom.length === 0 && !draft && <p className="srcnote">Save a request you make often, and it joins the prompts in the coach panel.</p>}
      <ul className="customlist">
        {custom.map((p, i) => (
          <li key={p.id}>
            <span className="customlabel">{p.label}</span>
            <span className="convacts">
              <button className="linkbtn" disabled={busy} onClick={() => setDraft({ index: i, label: p.label, text: p.text })}>Edit</button>
              <button className="linkbtn" disabled={busy} onClick={() => {
                if (confirm(`Delete "${p.label}"?`)) void saveCustom(custom.filter((_, j) => j !== i));
              }}>Delete</button>
            </span>
          </li>
        ))}
      </ul>
      {draft ? (
        <form className="customform" onSubmit={async (e) => {
          e.preventDefault();
          const entry = { label: draft.label.trim(), text: draft.text.trim() };
          if (!entry.text) return;
          const next = draft.index === null ? [...custom, entry] : custom.map((p, j) => (j === draft.index ? entry : p));
          if (await saveCustom(next)) setDraft(null);
        }}>
          <label className="field">
            <span className="grp">Name on the button</span>
            <input className="input" value={draft.label} maxLength={60} placeholder="Slow blues warm-up" onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          </label>
          <label className="field">
            <span className="grp">What to ask the coach</span>
            <textarea className="input" rows={3} value={draft.text} maxLength={2000} required onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
          </label>
          <p className="srcnote">End with {"{input}"} to finish the message yourself each time.</p>
          <div className="customacts">
            <button className="btn outline" disabled={busy || !draft.text.trim()}>Save</button>
            <button type="button" className="btn quiet" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </form>
      ) : (
        custom.length < CUSTOM_MAX && <button className="btn quiet" disabled={busy} onClick={() => setDraft({ index: null, label: "", text: "" })}>Add a prompt</button>
      )}
      {error && <p className="notice" role="alert">That was not saved: {error}</p>}
    </div>
  );
}
