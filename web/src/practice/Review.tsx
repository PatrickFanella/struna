import { REVIEW_DRAFT_KEY, restoreReviewDraft } from "./genericLogic.ts";
import { ConfirmDiscard } from "./ConfirmDiscard.tsx";
import { useEffect, useState } from "react";

import { api } from "../api.ts";
import { SUBDIVISIONS } from "../audio/metronome.ts";
import { blockLogName, firstSentence, sessionKind, type Today } from "../types.ts";
import type { SessionState } from "./Session.tsx";

type Recall = "memory" | "cue map" | "page-dependent";

export function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="field">
      <p className="grp">{label}</p>
      <div className="seg mini words" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button type="button" key={v} role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{l}</button>
        ))}
      </div>
    </div>
  );
}

export function Text({ label, value, onChange, area, num, placeholder }: { label: string; value: string; onChange: (v: string) => void; area?: boolean; num?: boolean; placeholder?: string }) {
  return (
    <label className="field">
      <span className="grp">{label}</span>
      {area ? (
        <textarea className="input" rows={3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={`input${num ? " num" : ""}`} inputMode={num ? "numeric" : "text"} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

export function Review({ today, session, bpm, material, onWritten, onBack, onDiscard }: {
  today: Today;
  session: SessionState;
  bpm: number;
  material: string;
  onWritten: (file: string) => void;
  onBack: () => void;
  onDiscard: () => void;
}) {
  const b = today.block!;
  const week = b.weeks[today.position.week - 1];
  const subLog = (v: number) => SUBDIVISIONS.find((s) => s.value === v)!.log;
  const [f, setF] = useState(() => {
    const fresh = {
    material,
    target: "",
    startTempo: String(session.startBpm),
    cleanTempo: session.checkpoints?.filter((c) => c.materialLabel === material).at(-1)?.bpm?.toString() ?? "",
    subdivision: session.subdivision as number,
    threePass: (session.metThree ? "met" : "not met") as "met" | "not met",
    recall: "page-dependent" as Recall,
    pain: session.pain ? "yes" : "no",
    improvement: "",
    failure: "",
    next: today.next.text,
    observation: "",
    };
    try { const restored = restoreReviewDraft(sessionStorage.getItem(REVIEW_DRAFT_KEY), session.startedAt, fresh); return { ...restored, pain: session.pain ? "yes" : restored.pain }; } catch { return fresh; }
  });
  useEffect(() => {
    try { sessionStorage.setItem(REVIEW_DRAFT_KEY, JSON.stringify({ startedAt: session.startedAt, form: f })); } catch { /* unavailable storage */ }
  }, [f, session.startedAt]);
  const [discarding, setDiscarding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const defaultNext = `Start at ${bpm} BPM, ${subLog(session.subdivision)}, with ${material}; listen for `;
  const askCoach = async () => {
    setDrafting(true);
    setError("");
    try {
      const stages = sessionKind(today, session.kind).stages.slice(0, Math.max(session.furthest ?? session.stage, session.stage) + 1).map((s) => s.title);
      const { draft } = await api.post<{ draft: Partial<Record<"target" | "improvement" | "failure" | "next" | "observation", string>> }>("/api/coach/review", {
        facts: {
          material: f.material,
          startTempo: Number(f.startTempo) || session.startBpm,
          endTempo: Number(f.cleanTempo) || bpm,
          subdivision: subLog(f.subdivision),
          cleanPasses: session.cleanTotal ?? 0,
          misses: session.missTotal ?? 0,
          metThree: session.metThree,
          stages,
          recording: session.recording ? `${session.recording.path} (${session.recording.label})` : null,
          pain: f.pain === "yes",
          notes: [f.observation, f.improvement, f.failure].filter(Boolean).join(" / "),
        },
      });
      // The coach fills what you left blank; anything you typed stays.
      setF((x) => ({
        ...x,
        target: x.target || draft.target || "",
        improvement: x.improvement || draft.improvement || "",
        failure: x.failure || draft.failure || "",
        observation: x.observation || draft.observation || "",
        next: x.next && x.next !== defaultNext ? x.next : draft.next || x.next,
      }));
    } catch (err) {
      setError(`The coach could not draft the sheet: ${(err as Error).message ?? err}`);
    } finally {
      setDrafting(false);
    }
  };
  const [error, setError] = useState("");
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const pain = f.pain === "yes";
      const { file, replayed } = await api.post<{ file: string; replayed?: boolean }>("/api/sessions", {
        submissionId: session.submissionId,
        blockTitle: blockLogName(b),
        blockId: b.id,
        type: session.cross ? "cross-training" : today.position.type,
        length: session.kind,
        material: f.material,
        target: f.target,
        startTempo: f.startTempo,
        cleanTempo: f.cleanTempo,
        subdivision: subLog(f.subdivision),
        threePass: f.threePass,
        recall: f.recall,
        ...(session.recording ? { recording: session.recording } : {}),
        pain,
        partial: session.partial === true,
        improvement: f.improvement,
        failure: f.failure,
        next: f.next,
        ...(f.observation ? { observation: f.observation } : {}),
        ...(session.cross
          ? { vocabulary: session.cross, application: session.cross }
          : week
            ? { vocabulary: firstSentence(week.vocabulary), mechanism: firstSentence(week.mechanism), application: firstSentence(week.music) }
            : {}),
      });
      const clean = Number(f.cleanTempo);
      if (!replayed && f.material && clean >= 30 && clean <= 300 && !pain) {
        await api.put("/api/tempos", { fragment: f.material, bpm: clean, subdivision: subLog(f.subdivision) }).catch(() => {});
      }
      onWritten(file);
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="review" onSubmit={submit}>
      {discarding && <ConfirmDiscard onCancel={() => setDiscarding(false)} onDiscard={onDiscard} />}
      {session.partial && <p className="notice">Partial session · does not count toward plan progress. Minutes reflect active playing time.</p>}
      <h1>{session.partial ? "Partial session review" : session.pain ? "Stopped: pain or tension" : "Session review"}</h1>
      <p className="instr">{session.pain ? "Stop playing. Note what you felt; the log flags it and this session will not count." : "Your reflection is optional. Confirm clean tempo only if you measured it; audio has not been assessed."}</p>
      <div className="draftrow">
        <button type="button" className="btn outline" disabled={drafting} onClick={() => void askCoach()}>{drafting ? "The coach is drafting" : "Ask the coach to fill this in"}</button>
        <span className="srcnote">It fills the blank fields from this session's tempos, passes and notes. It did not hear you play, so check it.</span>
      </div>
      <Text label="Material and exact fragment" value={f.material} onChange={set("material")} />
      <Text label="Target" value={f.target} onChange={set("target")} placeholder="One sentence: fragment, tempo, quality" />
      <div className="row2">
        <Text label="Starting tempo" value={f.startTempo} onChange={set("startTempo")} num />
        <Text label="Clean tempo" value={f.cleanTempo} onChange={set("cleanTempo")} num />
      </div>
      <Choice label="Subdivision" value={String(f.subdivision)} options={SUBDIVISIONS.map((s) => [String(s.value), s.label] as [string, string])} onChange={(v) => set("subdivision")(Number(v))} />
      <Choice label="Three clean passes" value={f.threePass} options={[["met", "Met"], ["not met", "Not met"]]} onChange={set("threePass")} />
      <Choice label="Recall" value={f.recall} options={[["memory", "Memory"], ["cue map", "Cue map"], ["page-dependent", "Page"]]} onChange={set("recall")} />
      <div className="field">
        <p className="grp">Recording</p>
        <p className="fieldval">{session.recording ? `${session.recording.path} (${session.recording.label})` : "No take recorded"}</p>
      </div>
      <Choice label="Pain, numbness or persistent tension" value={f.pain} options={[["no", "No"], ["yes", "Yes, stop"]]} onChange={set("pain")} />
      <Text label="What felt better (your reflection)" value={f.improvement} onChange={set("improvement")} />
      <Text label="One limiting failure" value={f.failure} onChange={set("failure")} />
      <Text label="Next instruction" value={f.next} onChange={set("next")} area />
      <Text label="My observation (optional)" value={f.observation} onChange={set("observation")} area />
      {error && <p className="notice" role="alert">{error}</p>}
      <button className="btn primary full" disabled={busy}>{busy ? "Writing the log" : "Write the log"}</button>
      <div className="row2 reviewfoot">
        <button type="button" className="btn quiet" onClick={onBack}>Back to the session</button>
        <button type="button" className="btn quiet" onClick={() => setDiscarding(true)}>Discard session</button>
      </div>
    </form>
  );
}
