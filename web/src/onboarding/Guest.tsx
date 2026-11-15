import { HANDOFF_KEY } from "./handoff.ts";
import { TaskHelp } from "./TaskHelp.tsx";
import { useEffect, useState } from "react";
import { freshGuest, GUEST_KEY, guestExercise, readGuest, type GuestState } from "./guest.ts";
import { getTheme, setTheme, type ThemeChoice } from "../theme.ts";

export function Guest() {
  const [initial] = useState(() => {
    try { const state = readGuest(localStorage.getItem(GUEST_KEY)); return { state: state ?? freshGuest(), storage: state ? "ready" : "incompatible" }; }
    catch { return { state: freshGuest(), storage: "unavailable" }; }
  });
  const [state, setState] = useState(initial.state);
  const [storage, setStorage] = useState(initial.storage);
  const [accountAction, setAccountAction] = useState<"save" | "coach" | null>(null);
  const [accountError, setAccountError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const connect = async () => {
    if (!accountAction) return;
    setAccountError(""); setConnecting(true);
    try {
      const handoff = { id: crypto.randomUUID(), action: accountAction, state };
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff));
      const result = await fetch("/auth/login", { method: "POST", headers: { "x-struna": "1", "content-type": "application/json" }, body: JSON.stringify({ returnTo: "#guest-import", handoff: handoff.id }) });
      const data = await result.json(); if (!result.ok) throw new Error();
      location.assign(data.redirect);
    } catch { setAccountError("Sign-in could not start. Your guest practice is still here; try again or continue locally."); setConnecting(false); }
  };
  const [theme, setThemeChoice] = useState<ThemeChoice>(getTheme);
  useEffect(() => {
    if (storage === "incompatible") return;
    try { localStorage.setItem(GUEST_KEY, JSON.stringify(state)); setStorage("ready"); }
    catch { setStorage("unavailable"); }
  }, [state, storage]);
  const exercise = guestExercise(state);
  const start = (mode: GuestState["mode"]) => setState((s) => ({ ...s, mode, step: "practice", reflection: s.step === "done" || s.mode !== mode ? "" : s.reflection }));
  const clear = () => {
    try { localStorage.removeItem(GUEST_KEY); setStorage("ready"); } catch { setStorage("unavailable"); }
    setState(freshGuest());
  };
  return <div className="app guest-app"><header className="top"><div className="wrap"><span className="name"><span className="brandmark" aria-hidden="true" />struna</span><span>Try a little practice</span></div></header>
    <main><div className="wrap guest-content">
      {storage !== "ready" && <p className="notice" role="status">{storage === "incompatible" ? "Saved guest practice could not be read. It has been left untouched; clear guest practice below to start a new saved exercise." : "Browser storage is unavailable. You can still try the exercise, but closing or reloading this page will lose it."}</p>}
      {state.step === "welcome" && <>
        <img className="guest-illustration" src="/brand/practice-illustration.svg" alt="" />
        <h1>A little music, at your pace</h1><p>Try an original two-minute exercise. No account or microphone is needed. Stop and rest if anything hurts.</p>
        <p className="srcnote">Suggested choices: first notes, new to guitar. You can start with these or change them below.</p>
        <details className="guest-choices"><summary>Choose your focus and experience (optional)</summary>
          <fieldset><legend>What would you like to work on?</legend>{([["notes", "First notes"], ["rhythm", "Steady rhythm"], ["chords", "Comfortable chords"]] as const).map(([value, label]) => <label key={value}><input type="radio" name="guest-focus" checked={state.focus === value} onChange={() => setState((s) => ({ ...s, focus: value }))} />{label}</label>)}</fieldset>
          <fieldset><legend>Your experience</legend>{([["new", "New to guitar"], ["returning", "I have played before"]] as const).map(([value, label]) => <label key={value}><input type="radio" name="guest-experience" checked={state.experience === value} onChange={() => setState((s) => ({ ...s, experience: value }))} />{label}</label>)}</fieldset>
        </details>
        <div className="guest-preview" aria-live="polite"><b>{exercise.title}</b><p>{exercise.instruction}</p></div>
        <button className="btn primary full" onClick={() => start("play")}>Try the 2-minute exercise</button>
        <button className="btn quiet full" onClick={() => start("explore")}>Explore without a guitar</button>
      </>}
      {state.step === "practice" && <>
        <p className="srcnote">{state.mode === "explore" ? "Exploring without a guitar" : "A short practice, with no timer or score to beat"}</p>
        <h1>{exercise.title}</h1><p>{state.mode === "explore" ? "Read the instruction below, trace the pattern with a finger and count slowly aloud. You are exploring the exercise; this will not be recorded as guitar practice." : "Take about two minutes, or stop sooner if you need. You decide when you are finished."}</p>
        <p>{exercise.instruction}</p><pre className="guest-music">{exercise.music}</pre>
        <TaskHelp task="reading" />
        <button className="btn primary full" onClick={() => setState((s) => ({ ...s, step: "reflection" }))}>{state.mode === "explore" ? "Finish exploring" : "Finish practice"}</button>
        <button className="btn quiet" onClick={() => setState((s) => ({ ...s, step: "welcome" }))}>Edit my choices</button>
      </>}
      {state.step === "reflection" && <>
        <h1>{state.mode === "explore" ? "What did you notice?" : "Leave yourself a small note"}</h1><p>Reflection is optional. Only you can say what felt different; Struna has not listened to or assessed your playing.</p>
        <label className="field"><span>My reflection (optional)</span><textarea className="input" rows={4} maxLength={2000} value={state.reflection} onChange={(e) => setState((s) => ({ ...s, reflection: e.target.value }))} /></label>
        <button className="btn primary full" onClick={() => setState((s) => ({ ...s, step: "done" }))}>Keep this on this device</button>
        <button className="btn quiet" onClick={() => setState((s) => ({ ...s, step: "done", reflection: "" }))}>Skip reflection</button>
        <button className="linkbtn" onClick={() => setState((s) => ({ ...s, step: "practice" }))}>Back to the exercise</button>
      </>}
      {state.step === "done" && <>
        <h1>{state.mode === "explore" ? "Exercise explored" : "Practice marked complete"}</h1><p>{storage === "ready" ? "Your choices and any reflection are kept in this browser on this device." : "Your choices and reflection are available in this open page only."} This is your report of the activity, not a measured result.</p>
        {state.reflection && <blockquote><p className="grp">Your reflection</p><p>{state.reflection}</p></blockquote>}
        <button className="btn primary full" onClick={() => start(state.mode)}>Try this exercise again</button>
        <button className="btn outline full" onClick={() => setAccountAction("save")}>Save across devices</button>
        <button className="btn quiet full" onClick={() => setAccountAction("coach")}>Ask AI Coach about this practice</button>
        {accountAction && <div className="notice"><h2>{accountAction === "save" ? "Save to a private account" : "Coaching in your private account"}</h2><p>Sign in to save your choices and reflection across devices. You will review what to import after sign-in. AI also needs your own supported connection and may have provider charges. No membership or payment starts here.</p><button className="btn primary" disabled={connecting} onClick={() => void connect()}>{connecting ? "Opening sign-in…" : "Sign in and review import"}</button> <button className="btn quiet" disabled={connecting} onClick={() => setAccountAction(null)}>Continue locally</button>{accountError && <p role="alert">{accountError}</p>}</div>}
        <button className="btn quiet" onClick={() => setState((s) => ({ ...s, step: "welcome", reflection: "" }))}>Choose a different focus</button>
      </>}
      <footer className="guest-limits"><p>Guest practice stays on this device. Clearing site data or using another browser removes access to it. Accounts and AI are optional next steps and are not needed here.</p>
        <div className="guest-theme"><label>Theme <select className="input" value={theme ?? "device"} onChange={(e) => { const choice = e.target.value === "device" ? null : e.target.value as "light" | "dark"; setTheme(choice); setThemeChoice(choice); }}><option value="device">Device</option><option value="light">Light</option><option value="dark">Dark</option></select></label></div>
        <button className="linkbtn" onClick={clear}>Clear guest practice on this device</button>
        <p><a href="/starter/struna-first-exercises.txt">Original exercise source and reuse terms</a></p>
      </footer>
    </div></main>
  </div>;
}
