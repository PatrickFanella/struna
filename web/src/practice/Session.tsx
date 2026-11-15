import { sessionChecklist, type Activity } from "./sessionScope.ts";
import { useEffect, useRef, useState } from "react";

import { api, store } from "../api.ts";
import { audio } from "../audio/context.ts";
import { MicDenied, micUsers } from "../audio/mic.ts";
import { metronome, type Subdivision } from "../audio/metronome.ts";
import { type Take, TakeRecorder } from "../audio/record.ts";
import { type HelperState, type Suggestion, tempoHelper } from "../audio/tempo.ts";
import { useMetronome } from "../audio/useMetronome.ts";
import { useApp } from "../mode.ts";
import { blockName, sessionKind, type Stage, type Today, todayLine } from "../types.ts";
import type { PaneItem } from "./Material.tsx";
import { type PaneState, pane, Workspace } from "../workspace/Workspace.tsx";
import { StageBar, stageShort } from "./StageBar.tsx";
import { resolveStageTempo, validBpm, type StageTempo, type TempoRecord } from "./stageTempo.ts";
import { refPaneItem } from "../materials/item.ts";
import { TempoRow } from "./TempoRow.tsx";

export type RecordingRef = { path: string; label: "baseline" | "weekly" | "midpoint" | "final"; purpose: string };
export type SessionState = {
  /** The session kind's id: `full` or `floor` in personal mode, the plan's own ids in studio mode. */
  kind: string;
  stages?: Stage[];
  addedActivities?: Activity[];
  attemptedActivities?: string[];
  stageTempos?: Record<string, StageTempo>;
  tempoRecords?: TempoRecord[];
  cross: string | null;
  /** Epoch ms when the session began, for the minutes in the generic review. */
  startedAt?: number;
  stage: number;
  /** Milliseconds spent on the current stage before the last resume. */
  elapsedBefore: number;
  /** Epoch ms of the last resume, or null while paused. */
  resumedAt: number | null;
  startBpm: number;
  subdivision: Subdivision;
  helper: HelperState;
  passes: number;
  suggestion: Suggestion | null;
  metThree: boolean;
  recording: RecordingRef | null;
  pain: boolean;
  /** What the session shows, side by side: the lesson, its sheet music or a tab, the coach. */
  panes: PaneState[];
  /** Studio mode: the review form is open, so a reload returns to it rather than to the session. */
  reviewing?: true;
  /** Totals for the review sheet. */
  cleanTotal?: number;
  missTotal?: number;
  furthest?: number;
  /** The coach's note for each stage, by stage index. */
  guides?: Record<number, string>;
};

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function chime() {
  const ctx = audio();
  const t = ctx.currentTime;
  for (const [f, d] of [[880, 0], [1320, 0.18]] as const) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t + d);
    g.gain.linearRampToValueAtTime(0.18, t + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 1.2);
    o.connect(g).connect(ctx.destination);
    o.start(t + d);
    o.stop(t + d + 1.3);
  }
}

/** Keep the screen on during a session; re-acquire after the tab returns. */
function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const get = async () => {
      try {
        if (document.visibilityState === "visible" && "wakeLock" in navigator) lock = await navigator.wakeLock.request("screen");
      } catch {
        /* not allowed here */
      }
    };
    void get();
    const vis = () => void get();
    document.addEventListener("visibilitychange", vis);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      void lock?.release().catch(() => {});
    };
  }, []);
}

function instruction(stage: Stage, today: Today, cross: string | null): string {
  // Studio mode: the server sends the instruction whole. An extra session keeps the stage's own task.
  if (stage.instruction !== undefined) return cross ? `${cross.replace(/[.;]$/, "")}. ${stage.output}` : stage.instruction;
  const week = today.block?.weeks[today.position.week - 1];
  if (stage.key === "target") return today.next.text;
  if (cross && stage.weekField) return cross;
  if (week && stage.weekField === "music") return `${week.music} Improvisation constraint: ${week.improvisation}`;
  if (week && stage.weekField) return week[stage.weekField];
  if (week && stage.key === "prepare") return `${stage.output}. ${week.mechanism}`;
  return stage.output;
}

/** Long block paragraphs fold to a few lines so the stand view keeps the clock and controls on screen. */
function Instruction({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 140;
  return (
    <>
      <p className={`instr${long && !open ? " clamp" : ""}`}>{cap(text)}</p>
      {long && <button className="linkbtn more" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Less" : "More"}</button>}
    </>
  );
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function Session({ today, state, setState, items, material, onFinish, closeTools }: {
  today: Today;
  state: SessionState;
  setState: (fn: (s: SessionState) => SessionState) => void;
  items: PaneItem[];
  /** The lesson material's name, for the coach. */
  material: string;
  onFinish: () => void;
  closeTools: () => void;
}) {
  useWakeLock();
  const m = useMetronome();
  const generic = useApp().mode === "studio";
  const kind = sessionKind(today, state.kind);
  const stages = state.stages ?? kind.stages;
  // The coach may shorten the plan while a session runs; stay on its last stage then.
  const at = Math.min(state.stage, stages.length - 1);
  const stage = stages[at]!;
  const tempoKey = `${kind.id}:${stage.key}:${stage.material?.key ?? "unassigned"}`;
  const stageTempo = state.stageTempos?.[tempoKey];
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const enter = (records: TempoRecord[]) => {
      if (!active) return;
      const suggestion = stageTempo && validBpm(stageTempo.bpm) ? stageTempo : resolveStageTempo(stage, records, [...(today.materials ?? []), ...(stage.material && !today.materials?.some((m) => m.key === stage.material!.key) ? [stage.material] : [])]);
      const bpm = suggestion.override !== undefined && validBpm(suggestion.override) ? suggestion.override : suggestion.bpm;
      metronome.set({ bpm });
      setState((s) => ({ ...s, tempoRecords: records, stageTempos: { ...s.stageTempos, [tempoKey]: suggestion } }));
      if (stage.material) {
        const item = refPaneItem(stage.material);
        setState((s) => ({ ...s, panes: s.panes.some((p) => p.content.type === "file" && p.content.item.key === item.key) ? s.panes : [pane({ type: "file", item }), ...s.panes.filter((p) => p.content.type !== "file")].slice(0, 4) }));
      }
      let previous = bpm;
      unsubscribe = metronome.subscribe(() => {
        const value = metronome.get().bpm;
        if (value === previous) return;
        previous = value;
        setState((s) => ({ ...s, stageTempos: { ...s.stageTempos, [tempoKey]: { ...suggestion, override: value } } }));
      });
    };
    if (state.tempoRecords) enter(state.tempoRecords);
    else void api.get<TempoRecord[]>("/api/tempos").catch(() => []).then(enter);
    return () => { active = false; unsubscribe?.(); };
  }, [tempoKey]); // Per-stage entry; changes to the click are captured as a player override.
  const total = stage.minutes * 60_000;
  const [now, setNow] = useState(Date.now());
  const elapsed = state.elapsedBefore + (state.resumedAt ? now - state.resumedAt : 0);
  const chimed = useRef(-1);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (elapsed >= total && chimed.current !== state.stage && state.resumedAt) {
      chimed.current = state.stage;
      chime();
    }
  }, [elapsed, total, state.stage, state.resumedAt]);

  // Recording.
  const rec = useRef<TakeRecorder | null>(null);
  const [recording, setRecording] = useState<number | null>(null);
  const [take, setTake] = useState<Take | null>(null);
  const [takeLabel, setTakeLabel] = useState<RecordingRef["label"]>(today.position.number === 1 ? "baseline" : "weekly");
  const [purpose, setPurpose] = useState("");
  const [recError, setRecError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => () => rec.current?.cancel(), []);

  const startTake = async () => {
    setRecError("");
    closeTools(); // The tuner and the recorder never share the microphone.
    micUsers.dispatchEvent(new Event("recording"));
    const r = new TakeRecorder();
    try {
      await r.start();
      rec.current = r;
      setRecording(Date.now());
    } catch (e) {
      setRecError(e instanceof MicDenied ? "Microphone access is off. Allow it in the browser settings and try again." : String((e as Error).message ?? e));
    }
  };
  const stopTake = async () => {
    const r = rec.current;
    rec.current = null;
    setRecording(null);
    if (r) setTake(await r.stop());
  };
  const saveTake = async () => {
    if (!take || !today.block) return;
    setSaving(true);
    setRecError("");
    try {
      const res = await fetch(`/api/recordings?blockId=${encodeURIComponent(today.block.id)}&label=${takeLabel}&ext=${take.ext}`, {
        method: "POST",
        headers: { "x-struna": "1", "content-type": take.blob.type || "application/octet-stream" },
        body: take.blob,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setState((s) => ({ ...s, recording: { path: data.path, label: takeLabel, purpose } }));
      setTake(null);
      setPurpose("");
    } catch (e) {
      setRecError(`The take was not saved: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const next = () => {
    if (state.stage + 1 >= stages.length) return onFinish();
    setState((s) => ({ ...s, stage: s.stage + 1, furthest: Math.max(s.furthest ?? 0, s.stage + 1), elapsedBefore: 0, resumedAt: Date.now() }));
  };
  // Going back shows the earlier stage with its timer reset and waiting.
  const back = () => setState((s) => (s.stage > 0 ? { ...s, stage: s.stage - 1, elapsedBefore: 0, resumedAt: null } : s));
  const pause = () =>
    setState((s) => (s.resumedAt ? { ...s, elapsedBefore: s.elapsedBefore + Date.now() - s.resumedAt, resumedAt: null } : { ...s, resumedAt: Date.now() }));
  const log = (event: "clean" | "miss") =>
    setState((s) => {
      const r = tempoHelper(s.helper, event);
      const passes = event === "miss" ? 0 : s.passes >= 3 ? 1 : s.passes + 1;
      return { ...s, helper: r.state, passes, suggestion: r.suggestion, metThree: s.metThree || r.suggestion?.kind === "raise", cleanTotal: (s.cleanTotal ?? 0) + (event === "clean" ? 1 : 0), missTotal: (s.missTotal ?? 0) + (event === "miss" ? 1 : 0) };
    });
  const apply = (sg: Suggestion) => {
    metronome.set({ bpm: m.bpm + sg.delta });
    setState((s) => ({ ...s, suggestion: null, passes: 0 }));
  };

  const [addSlot, setAddSlot] = useState<HTMLElement | null>(null);

  // The coach's short note for the stage, asked once per stage and kept with the session.
  const [guideOn, setGuideOn] = useState(() => store.get("struna.guide") !== "off");
  const [guideState, setGuideState] = useState<"idle" | "loading" | { error: string }>("idle");
  const [guideTry, setGuideTry] = useState(0);
  const stageText = instruction(stage, today, state.cross);
  const guide = state.guides?.[at];
  useEffect(() => {
    if (generic || !guideOn || guide) return void setGuideState("idle");
    const abort = new AbortController();
    const stageAt = at;
    setGuideState("loading");
    fetch("/api/coach/guide", {
      method: "POST",
      headers: { "x-struna": "1", "content-type": "application/json" },
      body: JSON.stringify({ stage: { title: stage.title, output: stage.output, instruction: stageText }, bpm: metronome.get().bpm, ...(material ? { fragment: material } : {}) }),
      signal: abort.signal,
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? r.statusText);
        setState((s) => ({ ...s, guides: { ...(s.guides ?? {}), [stageAt]: d.text } }));
        setGuideState("idle");
      })
      .catch((e) => {
        if (!abort.signal.aborted) setGuideState({ error: String(e.message ?? e) });
      });
    return () => abort.abort();
  }, [state.stage, guideOn, guideTry]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleGuide = () => {
    store.set("struna.guide", guideOn ? "off" : null);
    setGuideOn(!guideOn);
  };
  const left = total - elapsed;
  const nextStage = stages[at + 1];
  const b = today.block!;
  return (
    <div className="session">
      <div className="sessiontop">
        <div className="sessionline">
          <span>{generic ? b.title : blockName(b)}</span>
          {generic ? (
            <>
              <span>{state.cross ? "Extra session (not counted)" : (today.line ?? todayLine(today))}</span>
              <span>{kind.label}</span>
            </>
          ) : (
            <>
              <span>{state.cross ? "Cross-training day (not counted)" : todayLine(today)}</span>
              <span>{state.kind === "full" ? "45-minute session" : "15-minute session"}</span>
            </>
          )}
          <span className="addslot" ref={setAddSlot} />
        </div>
        <StageBar stages={stages} current={at} progress={elapsed / total} />
        <div className="stagerow">
          <div className="stagetext">
            <h1><span className="stagecount num">{at + 1}/{stages.length}</span> {stage.title}</h1>
            <Instruction key={state.stage} text={stageText} />
            {at === stages.length - 1 && generic && <fieldset className="session-checklist">
              <legend>Session checklist (optional)</legend>
              <p className="srcnote">Check what you attempted. Unchecked work stays unmeasured.</p>
              {sessionChecklist(stages, state.addedActivities).map((activity) => <label key={activity.key}>
                <input type="checkbox" checked={state.attemptedActivities?.includes(activity.key) ?? false} onChange={(e) => {
                  const checked = e.target.checked;
                  setState((s) => ({ ...s, attemptedActivities: checked ? [...(s.attemptedActivities ?? []), activity.key] : (s.attemptedActivities ?? []).filter((k) => k !== activity.key) }));
                }} /> {activity.title}
              </label>)}
            </fieldset>}
            {stage.material && <p className="srcnote">Material: {stage.material.label}{stage.material.missing ? " — missing; choose another resource or check the plan reference." : ""}</p>}
            {stageTempo && <p className="srcnote stage-tempo">Suggested {stageTempo.bpm} BPM · {stageTempo.source}{stageTempo.override !== undefined ? ` · Your tempo: ${m.bpm} BPM` : ""} <button className="linkbtn" onClick={() => {
              metronome.set({ bpm: stageTempo.bpm });
              setState((s) => ({ ...s, stageTempos: { ...s.stageTempos, [tempoKey]: { bpm: stageTempo.bpm, source: stageTempo.source } } }));
            }}>Use suggestion</button></p>}
            {!generic && (
            <p className="coachline" aria-live="polite">
              <span className="coachtag">Coach</span>
              {!guideOn ? (
                <span className="coachmuted">guidance is off</span>
              ) : guide ? (
                <span>{guide}</span>
              ) : typeof guideState === "object" ? (
                <span className="coachmuted">could not answer ({guideState.error.slice(0, 120)}) <button className="linkbtn" onClick={() => setGuideTry((n) => n + 1)}>Try again</button></span>
              ) : (
                <span className="coachmuted">is reading your plan</span>
              )}
              <button className="linkbtn" onClick={toggleGuide}>{guideOn ? "Turn off" : "Turn on"}</button>
            </p>
            )}
          </div>
          <button className={`clock${state.resumedAt ? "" : " waiting"}`} onClick={pause} aria-label={state.resumedAt ? "Pause the stage timer" : elapsed ? "Resume the stage timer" : "Start the stage timer"}>
            <span className="t num">{left >= 0 ? fmt(left) : `+${fmt(-left)}`}</span>
            <span className="s">{state.resumedAt ? (left >= 0 ? `left of ${stage.minutes} min` : `over ${stage.minutes} min`) : elapsed ? "paused, tap to resume" : "tap to start the timer"}</span>
          </button>
          {state.stage > 0 && <button className="btn quiet backb" onClick={back} disabled={Boolean(take) || recording !== null}>Back</button>}
          <button className="btn primary nextb" onClick={next} disabled={Boolean(take) || recording !== null} title={take || recording !== null ? "Save or discard the take first" : undefined}>
            <span>{nextStage ? "Next stage" : "Finish"}</span>
            <small>{nextStage ? `Up next: ${stageShort(nextStage)}` : "Write the log"}</small>
          </button>
        </div>
      </div>

      <Workspace panes={state.panes} setPanes={(fn) => setState((s) => ({ ...s, panes: fn(s.panes) }))} materials={items} addSlot={addSlot} />

      <div className="sessionbar">
        <TempoRow passes={state.passes} suggestion={state.suggestion} onClean={() => log("clean")} onMiss={() => log("miss")} onApply={apply} />
        <span className="barsp" />
        {recording ? (
          <button className="btn quiet recording" onClick={stopTake}>
            <span className="rec now" aria-hidden="true" />Stop take <span className="num">{fmt(now - recording)}</span>
          </button>
        ) : (
          <button className="btn quiet" onClick={startTake}><span className="rec" aria-hidden="true" />Record take</button>
        )}
        <button className="linkbtn stoppain" onClick={() => {
          if (take && !confirm("Discard the unsaved take and stop?")) return;
          rec.current?.cancel();
          setState((s) => ({ ...s, pain: true }));
          onFinish();
        }}>Stop: pain or tension</button>
      </div>
      {state.recording && !take && <p className="srcnote takesaved">Saved take: {state.recording.path}</p>}
      {recError && <p className="notice" role="alert">{recError}</p>}
      {take && (
        <div className="takebox" role="dialog" aria-label="Save this take">
          <p className="grp">Save this take (<span className="num">{Math.round(take.seconds)}</span> s)</p>
          <div className="seg mini words" role="radiogroup" aria-label="Take label">
            {(generic ? (["baseline", "weekly", "final"] as const) : (["baseline", "weekly", "midpoint", "final"] as const)).map((l) => (
              <button key={l} role="radio" aria-checked={takeLabel === l} className={takeLabel === l ? "on" : ""} onClick={() => setTakeLabel(l)}>{generic && l === "weekly" ? "Progress" : l[0]!.toUpperCase() + l.slice(1)}</button>
            ))}
          </div>
          <input className="input" placeholder="Purpose, in one line" value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-label="Purpose" />
          <div className="row2">
            <button className="btn outline" disabled={saving} onClick={saveTake}>{saving ? "Saving" : "Save take"}</button>
            <button className="btn quiet" onClick={() => setTake(null)}>Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}
