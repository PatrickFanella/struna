import { stageControls } from "./stageControls.ts";
import type { Tool } from "../App.tsx";
import { activeElapsed, hasIncompleteTiming, moveStage, pauseTimer, startStageBreak, finishStageBreak, type StageBreak } from "./sessionTimer.ts";
import { sessionChecklist, type Activity } from "./sessionScope.ts";
import { useEffect, useRef, useState } from "react";

import { api, store } from "../api.ts";
import { audio } from "../audio/context.ts";
import { MicDenied } from "../audio/mic.ts";
import { metronome, type Subdivision } from "../audio/metronome.ts";
import { type Take, TakeRecorder } from "../audio/record.ts";
import { type HelperState, type Suggestion } from "../audio/tempo.ts";
import { useMetronome } from "../audio/useMetronome.ts";
import { useApp } from "../mode.ts";
import { blockName, sessionKind, type Stage, type Today, todayLine } from "../types.ts";
import type { PaneItem } from "./Material.tsx";
import { type PaneState, pane, Workspace } from "../workspace/Workspace.tsx";
import { StageBar, stageShort } from "./StageBar.tsx";
import { SessionStatus } from "./SessionStatus.tsx";
import { resolveStageTempo, validBpm, type StageTempo, type TempoRecord } from "./stageTempo.ts";
import { refPaneItem } from "../materials/item.ts";
import { recordPass, emptyPasses, measurementChoices, selectedMeasurement, type Checkpoint, type PassState } from "./checkpoints.ts";
import { SessionDialog, ConfirmDiscard } from "./ConfirmDiscard.tsx";
import { stopTimer } from "./sessionTimer.ts";
import { StageMaterialLink } from "./StageMaterialLink.tsx";
import { setStageSuggestion } from "../tools/stageSuggestion.ts";
import { TempoRow } from "./TempoRow.tsx";

export type RecordingRef = { path: string; label: "baseline" | "weekly" | "midpoint" | "final"; purpose: string };
export type SessionState = {
  submissionId?: string;
  /** The session kind's id: `full` or `floor` in personal mode, the plan's own ids in studio mode. */
  kind: string;
  today?: Today;
  stages?: Stage[];
  addedActivities?: Activity[];
  attemptedActivities?: string[];
  stageTempos?: Record<string, StageTempo>;
  tempoRecords?: TempoRecord[];
  checkpoints?: Checkpoint[];
  materialPasses?: Record<string, PassState>;
  measurementMaterials?: Record<string, { key: string; label: string }>;
  focusRequest?: { itemKey: string; stageKey: string };
  cross: string | null;
  /** Epoch ms when the session began, for the minutes in the generic review. */
  startedAt?: number;
  stage: number;
  /** Milliseconds spent on the current stage before the last resume. */
  elapsedBefore: number;
  /** Total active time before the current resume, across all stages. */
  activeBefore?: number;
  timingIncomplete?: true;
  stageBreak?: StageBreak;
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
  partial?: true;
  ending?: { running: boolean; pain: boolean };
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

export function Session({ today, state, setState, items, material, onFinish, onDiscard, closeTools, openTool }: {
  today: Today;
  state: SessionState;
  setState: (fn: (s: SessionState) => SessionState) => void;
  items: PaneItem[];
  /** The lesson material's name, for the coach. */
  material: string;
  onFinish: (partial?: boolean) => void;
  onDiscard: () => void;
  closeTools: () => void;
  openTool: (tool: Tool) => void;
}) {
  useWakeLock();
  const m = useMetronome();
  const generic = useApp().mode === "studio";
  const kind = sessionKind(today, state.kind);
  const stages = state.stages ?? kind.stages;
  // The coach may shorten the plan while a session runs; stay on its last stage then.
  const at = Math.min(state.stage, stages.length - 1);
  const stage = stages[at]!;
  const controls = stageControls(stage, generic);
  const tempoKey = `${kind.id}:${stage.key}:${stage.material?.key ?? "unassigned"}`;
  const stageTempo = state.stageTempos?.[tempoKey];
  const measurementItems = measurementChoices(stage.material ? refPaneItem(stage.material) : undefined, state.panes.map((p) => p.content), items);
  const measured = selectedMeasurement(measurementItems, state.measurementMaterials?.[tempoKey]);
  const passKey = `${kind.id}:${stage.key}:${measured?.key ?? "unassigned"}`;
  const passState = state.materialPasses?.[passKey] ?? emptyPasses();
  useEffect(() => {
    if (!generic) return; // Personal plans keep their existing material-based click across stages.
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const enter = (records: TempoRecord[]) => {
      if (!active) return;
      const suggestion = stageTempo && validBpm(stageTempo.bpm) ? stageTempo : resolveStageTempo(stage, records, [...(today.materials ?? []), ...(today.sessions ?? []).flatMap((k) => k.stages.flatMap((st) => st.material ? [st.material] : []))]);
      const bpm = suggestion.override !== undefined && validBpm(suggestion.override) ? suggestion.override : suggestion.bpm;
      metronome.set({ bpm });
      setState((s) => ({ ...s, tempoRecords: records, stageTempos: { ...s.stageTempos, [tempoKey]: suggestion } }));
      if (stage.material) {
        const item = refPaneItem(stage.material);
        setState((s) => ({ ...s, focusRequest: { itemKey: item.key, stageKey: tempoKey }, panes: s.panes.some((p) => p.content.type === "file" && p.content.item.key === item.key) ? s.panes : [pane({ type: "file", item }), ...s.panes.filter((p) => p.content.type !== "file")].slice(0, 4) }));
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
  const restoreTempo = () => {
    if (!stageTempo) return;
    metronome.set({ bpm: stageTempo.bpm });
    setState((s) => ({ ...s, stageTempos: { ...s.stageTempos, [tempoKey]: { bpm: stageTempo.bpm, source: stageTempo.source } } }));
  };
  useEffect(() => {
    setStageSuggestion(stageTempo && (controls === "play" || controls === "general") ? { bpm: stageTempo.bpm, source: stageTempo.source, use: restoreTempo } : null);
    return () => setStageSuggestion(null);
  }, [tempoKey, stageTempo?.bpm, stageTempo?.source, controls]);
  const total = stage.minutes * 60_000;
  const [now, setNow] = useState(Date.now());
  const elapsed = state.elapsedBefore + (state.resumedAt ? now - state.resumedAt : 0);
  const chimed = useRef(-1);
  const clock = useRef<HTMLButtonElement>(null);
  const wasBreaking = useRef(false);
  const completeBreak = () => setState((s) => finishStageBreak(s, Date.now()));
  useEffect(() => {
    if (!state.stageBreak && wasBreaking.current) clock.current?.focus();
    wasBreaking.current = Boolean(state.stageBreak);
  }, [Boolean(state.stageBreak)]);
  useEffect(() => {
    if (state.stageBreak && now >= state.stageBreak.until) completeBreak();
  }, [now, state.stageBreak?.until]);

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
  const [requesting, setRequesting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  useEffect(() => () => { const pending = rec.current; rec.current = null; pending?.cancel(); }, []);

  const startTake = async () => {
    if (rec.current) return;
    setRecError("");
    closeTools(); // The tuner and the recorder never share the microphone.
    const r = new TakeRecorder();
    rec.current = r;
    setRequesting(true);
    try {
      await r.start();
      if (rec.current !== r) { r.cancel(); return; }
      setRecording(Date.now());
    } catch (e) {
      if (rec.current !== r) return;
      rec.current = null; r.cancel();
      setRecError(e instanceof MicDenied ? "Microphone access is off. Allow it in the browser settings and try again." : String((e as Error).message ?? e));
    } finally { if (!rec.current || rec.current === r) setRequesting(false); }
  };
  const stopTake = async () => {
    const r = rec.current;
    rec.current = null;
    setRecording(null);
    if (r && recording === null) { r.cancel(); setRequesting(false); return; }
    if (r) {
      setFinalizing(true);
      try { setTake(await r.stop()); } finally { setFinalizing(false); }
    }
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

  const requestEnd = async (pain = false) => {
    metronome.stop();
    setState((s) => ({ ...stopTimer(s, Date.now()), ending: { running: s.resumedAt !== null, pain } }));
    if (rec.current) await stopTake();
  };
  const resume = () => setState(({ ending, ...s }) => ({ ...s, resumedAt: ending?.running ? Date.now() : null }));
  const next = () => {
    if (state.stage + 1 >= stages.length) return onFinish();
    metronome.stop();
    setState((s) => startStageBreak(s, s.stage + 1, Date.now()));
  };
  // Going back restarts the earlier stage clock, retaining the current pause state.
  const back = () => setState((s) => (s.stage > 0 ? moveStage(s, s.stage - 1, Date.now()) : s));
  const pause = () =>
    setState((s) => pauseTimer(s, Date.now()));
  const log = (event: "clean" | "miss") => {
    const bpm = metronome.get().bpm; // Capture the played tempo before any suggested increment.
    setState((s) => {
      const result = recordPass(s.materialPasses?.[passKey] ?? emptyPasses(), event);
      return { ...s, helper: result.helper, passes: result.passes, suggestion: result.suggestion,
        materialPasses: { ...s.materialPasses, [passKey]: result },
        checkpoints: event === "clean" && measured ? [...(s.checkpoints ?? []), { materialKey: measured.key, materialLabel: measured.label, stageKey: stage.key, sessionKind: kind.id, bpm, confirmedAt: new Date().toISOString(), context: "clean-pass" as const, pass: result.passes }] : (s.checkpoints ?? []),
        metThree: s.metThree || result.suggestion?.kind === "raise", cleanTotal: (s.cleanTotal ?? 0) + (event === "clean" ? 1 : 0), missTotal: (s.missTotal ?? 0) + (event === "miss" ? 1 : 0) };
    });
  };
  const apply = (sg: Suggestion) => {
    metronome.set({ bpm: m.bpm + sg.delta });
    setState((s) => ({ ...s, suggestion: null, passes: 0, materialPasses: { ...s.materialPasses, [passKey]: { ...(s.materialPasses?.[passKey] ?? emptyPasses()), suggestion: null, passes: 0 } } }));
  };

  const [showTools, setShowTools] = useState(false);
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
    <div className="session" data-intent={controls}>
      {state.stageBreak && <SessionDialog title="Take a short break" onClose={completeBreak}>
        <p role="status">Relax your hands. Practice time is paused during this break.</p>
        <p className="break-clock num" role="timer" aria-label="Break time remaining" aria-live="off">{Math.max(0, Math.ceil((state.stageBreak.until - Date.now()) / 1000))}<span>seconds</span></p>
        <p>Up next: <strong>{stages[state.stageBreak.nextStage]?.title ?? "Next stage"}</strong>. {state.stageBreak.running ? "The stage timer will resume when the break ends." : "The stage timer will wait for you to start it."}</p>
        <p className="srcnote">The click stays stopped until you start it again.</p>
        <button type="button" className="btn primary full" autoFocus onClick={completeBreak}>Skip break</button>
      </SessionDialog>}
      {state.ending && !discarding && <SessionDialog title={state.ending.pain ? "Stop: pain or tension" : "End session?"} onClose={resume}>
        <p>{state.ending.pain ? "Stop playing and rest. A pain stop does not count toward plan progress." : "The timer is paused. Ending alone writes no log."}</p>
        {(take || recording !== null || finalizing) && <div>
          <p>{finalizing ? "Finishing the recording. Exit choices will be available when the take is ready." : "Choose what to do with your unsaved recording before leaving."}</p>
          <button className="btn outline" disabled={saving || finalizing || recording !== null} onClick={() => void saveTake()}>Keep take in Recordings</button>
          <button className="btn quiet danger" disabled={saving || finalizing} onClick={() => { rec.current?.cancel(); rec.current = null; setRecording(null); setTake(null); }}>Discard unsaved take</button>
          {recError && <p role="alert">{recError}</p>}
        </div>}
        <p>Already saved recordings stay in Recordings, even if you discard this session.</p>
        <div className="exit-actions">
          <button className="btn outline" autoFocus onClick={resume}>Resume session</button>
          <button className="btn primary" disabled={saving || finalizing || Boolean(take) || recording !== null} onClick={() => {
            const pain = state.ending!.pain;
            setState(({ ending: _, ...s }) => ({ ...s, pain }));
            onFinish(!pain);
          }}>{state.ending.pain ? "Review pain stop" : "Review partial session"}</button>
          <button className="btn quiet danger" disabled={saving || finalizing || Boolean(take) || recording !== null} onClick={() => setDiscarding(true)}>Discard session</button>
        </div>
      </SessionDialog>}
      {discarding && <ConfirmDiscard onCancel={() => setDiscarding(false)} onDiscard={onDiscard} />}
      <div className="sessiontop">
        <div className="session-actions">
          <details className="session-details">
            <summary>Session outline and details</summary>
            <p>{generic ? b.title : blockName(b)} — {state.cross ? "Extra session (not counted)" : (today.line ?? todayLine(today))} — {kind.label}</p>
            {stage.material && <StageMaterialLink material={stage.material} />}
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
            <StageBar stages={stages} current={at} progress={elapsed / total} />
            <ol>{stages.map((s, i) => <li key={s.key} aria-current={i === at ? "step" : undefined}>{s.title}: {s.minutes} min</li>)}</ol>
            <p className="srcnote session-time">Stage elapsed {fmt(elapsed)} · Active practice {fmt(activeElapsed(state, now))}</p>
            {hasIncompleteTiming(state) && <p className="srcnote">Earlier stage times were not recorded in this older session. Active time includes only recovered timing.</p>}
          </details>
          <span className="addslot" ref={setAddSlot} />
          <button className="linkbtn session-end" onClick={() => void requestEnd()}>End session</button>
        </div>
        <div className="stagerow">
          <div className="stagetext">
            <h1><span className="stagecount num">{at + 1}/{stages.length}</span> {stage.title}</h1>
            <Instruction key={state.stage} text={stageText} />

            {stageTempo && (controls === "play" || controls === "general") && <p className="srcnote stage-tempo">Suggested {stageTempo.bpm} BPM · {stageTempo.source}{stageTempo.override !== undefined ? ` · Your tempo: ${m.bpm} BPM` : ""} <button className="linkbtn" onClick={restoreTempo}>Use stage tempo</button></p>}
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
          <button ref={clock} className={`clock${state.resumedAt ? "" : " waiting"}`} onClick={pause} aria-label={state.resumedAt ? "Pause the stage timer" : elapsed ? "Resume the stage timer" : "Start the stage timer"}>
            <span className="clock-action">{state.resumedAt ? "Pause" : elapsed ? "Resume" : "Start"}</span>
            <span className="t num">{left >= 0 ? fmt(left) : `+${fmt(-left)}`}</span>
            <span className="s">{state.resumedAt ? (left >= 0 ? `left of ${stage.minutes} min` : `over ${stage.minutes} min`) : elapsed ? "paused, tap to resume" : "tap to start the timer"}</span>
          </button>
          {state.stage > 0 && <button className="btn quiet backb" onClick={back} title="Restart the previous stage timer; keep running or paused" disabled={requesting || finalizing || Boolean(take) || recording !== null}>Back</button>}
          <button className="btn outline nextb" onClick={next} disabled={requesting || finalizing || Boolean(take) || recording !== null} title={take || recording !== null ? "Save or discard the take first" : undefined}>
            <span>{nextStage ? "Next stage" : "Finish"}</span>
            <small>{nextStage ? `Up next: ${stageShort(nextStage)}` : "Write the log"}</small>
          </button>
        </div>
      </div>

      <details className="measurement-details"><summary>Material and confirmed tempos</summary>
        {(controls === "play" || controls === "general" || showTools) && measurementItems.length > 0 && <label className="measurement-pick">Measure material
          <select aria-label="Measure material" className="input" value={measured?.key} onChange={(e) => {
            const item = measurementItems.find((i) => i.key === e.target.value)!;
            setState((s) => ({ ...s, measurementMaterials: { ...s.measurementMaterials, [tempoKey]: { key: item.key, label: item.label } } }));
          }}>{measurementItems.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}</select>
        </label>}

      {!!state.checkpoints?.length && <div className="srcnote measurements" aria-label="Confirmed material tempos">
        <b>Confirmed clean passes</b>
        <ul>{[...new Map(state.checkpoints.map((c) => [c.materialKey, c])).values()].map((c) => <li key={c.materialKey}>{c.materialLabel}: {c.bpm} BPM · {c.stageKey}</li>)}</ul>
      </div>}
      </details>
      <Workspace onOpenContent={(content) => {
        const activity = content.type === "file" ? { key: content.item.key, title: content.item.label } : content.type === "tab" ? { key: `tab:${content.tabId}`, title: content.title } : null;
        if (activity) setState((s) => ({ ...s, addedActivities: [...(s.addedActivities ?? []).filter((a) => a.key !== activity.key), activity] }));
      }} focusRequest={state.focusRequest} panes={state.panes} setPanes={(fn) => setState((s) => ({ ...s, panes: fn(s.panes) }))} materials={items} addSlot={addSlot} />

      <div className={`sessionbar${showTools || recording !== null || take ? " tools-visible" : ""}`}>
        <button className="btn outline session-tools-toggle" aria-expanded={showTools} onClick={() => setShowTools(!showTools)}>Tools</button>
        {(controls === "tune" || showTools) && <button className="btn outline" onClick={() => openTool("tuner")}>Open tuner</button>}
        {(controls === "play" || controls === "general" || showTools) && <>
        <TempoRow passes={passState.passes} suggestion={passState.suggestion} onClean={() => log("clean")} onMiss={() => log("miss")} onApply={apply} />
        <button className="linkbtn" onClick={() => openTool("metronome")}>Adjust tempo</button>
        </>}
        {showTools && controls !== "play" && controls !== "general" && <button className="linkbtn" onClick={() => openTool("metronome")}>Open click settings</button>}
        <span className="barsp" />
        {(controls === "record" || controls === "general" || showTools || recording !== null || finalizing || take) && <span className="record-controls">
        {recording ? (
          <button className="btn quiet recording" onClick={stopTake}>
            <span className="rec now" aria-hidden="true" />Stop take <span className="num">{fmt(now - recording)}</span>
          </button>
        ) : (
          <button className="btn quiet" disabled={requesting || finalizing || saving} onClick={startTake}><span className="rec" aria-hidden="true" />Record take</button>
        )}
        </span>}
        <button className="linkbtn stoppain" onClick={() => void requestEnd(true)}>Stop: pain or tension</button>
      </div>
      {requesting && <p role="status">Waiting for microphone permission. <button className="linkbtn" onClick={() => void stopTake()}>Cancel microphone request</button></p>}
      {finalizing && <p role="status">Finishing the recording…</p>}
      <SessionStatus timerRunning={state.resumedAt !== null} recording={recording !== null} take={take !== null} saving={saving} saved={state.recording !== null} error={recError} />
      {state.recording && !take && <p className="srcnote takesaved">Saved take: {state.recording.path}</p>}
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
            <button className="btn quiet" disabled={saving} onClick={() => setTake(null)}>Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}
