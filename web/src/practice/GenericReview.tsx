import { privateSession } from "../api.ts";
import { ConfirmDiscard } from "./ConfirmDiscard.tsx";
import { hasIncompleteTiming, playedMinutes } from "./sessionTimer.ts";
import { sessionChecklist } from "./sessionScope.ts";
import { useEffect, useState } from "react";

import { api } from "../api.ts";
import { coachAction } from "../chat/actions.tsx";
import { sessionKind, type Today } from "../types.ts";
import { coachReady } from "../chat/Chat.tsx";
import { type Difficulty, nextDraft, REVIEW_DRAFT_KEY, restoreReviewDraft, reviewMeasurements } from "./genericLogic.ts";
import { Choice, Text } from "./Review.tsx";
import type { SessionState } from "./Session.tsx";

/** The studio mode's review: a short form, nothing required, that writes the session log. */
export function GenericReview({ today, session, material, onWritten, onBack, onDiscard, onReflection }: {
  onReflection?: ((text: string) => void) | undefined;
  today: Today;
  session: SessionState;
  bpm: number;
  material: string;
  onWritten: (file: string, warnings?: string[]) => void;
  onBack: () => void;
  onDiscard: () => void;
}) {
  const b = today.block!;
  const kind = sessionKind(today, session.kind);
  const stages = session.stages ?? kind.stages;
  const activities = sessionChecklist(stages, session.addedActivities).map((a) => ({
    ...a,
    attempted: session.attemptedActivities?.includes(a.key) === true || (session.checkpoints ?? []).some((c) => c.stageKey === a.key || c.materialKey === a.key),
  }));
  const draft = (x: { material: string; difficulty: Difficulty; pain: string }) =>
    nextDraft({ material: x.material, bpm: null, difficulty: x.difficulty, pain: x.pain === "yes", fallback: today.next.text });
  const [f, setF] = useState(() => {
    const first = {
      material,
      target: "",
      minutes: String(playedMinutes(session, Date.now())),
      measurements: reviewMeasurements(stages, session),
      difficulty: "about right" as Difficulty,
      wentWell: "",
      struggled: "",
      pain: session.pain ? "yes" : "no",
      notes: "",
    };
    const fresh = { ...first, next: draft(first), nextEdited: false };
    // After a reload, what the player had typed for this session comes back.
    let stored: string | null = null;
    try {
      stored = privateSession.getItem(REVIEW_DRAFT_KEY);
    } catch {
      /* storage unavailable */
    }
    const restored = restoreReviewDraft(stored, session.startedAt, fresh);
    return { ...restored, pain: session.pain ? "yes" : restored.pain, measurements: reviewMeasurements(stages, session, restored.measurements) };
  });
  useEffect(() => {
    try {
      privateSession.setItem(REVIEW_DRAFT_KEY, JSON.stringify({ startedAt: session.startedAt, partial: session.partial === true, form: f }));
    } catch {
      /* storage unavailable */
    }
  }, [f, session.startedAt]);
  useEffect(() => {
    const reflection = [`It felt: ${f.difficulty}`, `Pain or tension: ${f.pain}`, f.wentWell && `Went well: ${f.wentWell}`, f.struggled && `Hard: ${f.struggled}`, f.notes && `Notes: ${f.notes}`].filter(Boolean).join("\n").slice(0, 6000);
    onReflection?.(reflection);
  }, [f, onReflection]);
  // Whether a coach is signed in, so the pain note does not promise a lighter plan nobody will write.
  const [coach, setCoach] = useState<boolean | null>(null);
  useEffect(() => {
    if (!session.pain) return;
    let live = true;
    void coachReady().then((r) => live && setCoach(r.ok));
    return () => {
      live = false;
    };
  }, [session.pain]);
  const [discarding, setDiscarding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Sets a field; the next instruction follows along until the player writes their own. */
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) =>
    setF((x) => {
      const n = { ...x, [k]: v };
      if (k === "next") n.nextEdited = true;
      else if (!n.nextEdited) n.next = draft(n);
      return n;
    });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const pain = f.pain === "yes";
      const measurements = f.measurements.map((m) => {
        const bpm = m.bpm.trim() ? Number(m.bpm) : null;
        if (bpm !== null && (!Number.isInteger(bpm) || bpm < 20 || bpm > 400)) throw new Error(`${m.materialLabel}: enter a whole BPM from 20 to 400, or leave it blank.`);
        return { ...m, bpm };
      });
      const minutes = Number(f.minutes);
      const { file, warnings } = await api.post<{ file: string; warnings?: string[] }>("/api/sessions", {
        submissionId: session.submissionId,
        planId: b.id,
        planTitle: b.title,
        phase: today.phase ? `${today.phase.n} of ${today.phase.of}: ${today.phase.title}` : "",
        session: { id: kind.id, label: kind.label },
        ...(session.cross ? { extra: session.cross } : {}),
        minutes: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0,
        material: f.material,
        target: f.target,
        activities,
        measurements,
        difficulty: f.difficulty,
        wentWell: f.wentWell,
        struggled: f.struggled,
        pain,
        partial: session.partial === true,
        ...(session.recording ? { recording: session.recording } : {}),
        notes: f.notes,
        next: f.next,
      });
      onWritten(file, warnings);
      const summary = [f.struggled.trim(), f.notes.trim()].filter(Boolean).join(" ") || "no details given";
      // An off-day extra is not counted and must not move the plan's next instruction; a pain stop is still reported.
      if (pain || (!session.cross && !session.partial)) void coachAction(pain ? "pain" : "session-logged", { log: file, summary: `${summary} (log: ${file})` });
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="review greview" onSubmit={submit}>
      {discarding && <ConfirmDiscard onCancel={() => setDiscarding(false)} onDiscard={onDiscard} />}
      {session.partial && <p className="notice">Partial session · does not count toward plan progress. Minutes reflect active playing time.</p>}
      <h1>{session.partial ? "Partial session review" : session.pain ? "Stopped: pain or tension" : "How did it go?"}</h1>
      <p className="instr">{session.pain ? painNote(coach) : "A short reflection is enough. Clean passes below are player-confirmed; the app did not assess your audio."}</p>
      <div className="field">
        <p className="grp">This session included</p>
        <ul>{activities.map((a) => <li key={a.key}>{a.title}{a.attempted ? " — attempted" : " — unmeasured"}</li>)}</ul>
      </div>
      {hasIncompleteTiming(session) && <p className="notice" role="status">Earlier stage times were not recorded in this older session. Minutes played includes only recovered timing; adjust it if you know the total.</p>}
      <Text label="What you worked on" value={f.material} onChange={set("material")} placeholder="A song, an exercise, a page" />
      <Text label="Minutes played" value={f.minutes} onChange={set("minutes")} num />
      {f.measurements.length > 0 && <fieldset className="review-measurements">
        <legend>Clean BPM by material (optional)</legend>
        <p className="srcnote">Only confirmed clean passes are prefilled. Leave skipped or unmeasured materials blank. Log values can be 20–400 BPM; suggestions use 30–300 BPM.</p>
        {f.measurements.map((m, i) => <Text key={m.materialKey} label={`${m.materialLabel} clean BPM (optional)`} value={m.bpm} num placeholder="Unmeasured" onChange={(bpm) => set("measurements")(f.measurements.map((row, j) => j === i ? { ...row, bpm } : row))} />)}
      </fieldset>}
      <Choice label="It felt" value={f.difficulty} options={[["too easy", "Too easy"], ["about right", "About right"], ["too hard", "Too hard"]]} onChange={set("difficulty")} />
      <Choice label="Pain, numbness or lasting tension" value={f.pain} options={[["no", "No"], ["yes", "Yes, stop"]]} onChange={set("pain")} />
      <div className="field">
        <p className="grp">Recording</p>
        {session.recording?.src && <audio controls src={session.recording.src} preload="none" />}
        <p className="fieldval">{session.recording ? `${session.recording.path} (${session.recording.label === "weekly" ? "progress" : session.recording.label})` : "No take recorded"}</p>
      </div>
      <details className="optional-notes">
        <summary>Optional notes</summary>
        <Text label="Target (optional)" value={f.target} onChange={set("target")} placeholder="What you were aiming for today" />
        <Text label="What went well" value={f.wentWell} onChange={set("wentWell")} />
        <Text label="What was hard" value={f.struggled} onChange={set("struggled")} />
        <Text label="What to do first next time" value={f.next} onChange={set("next")} area />
        <Text label="Notes (optional)" value={f.notes} onChange={set("notes")} area />
      </details>
      <p className={error ? "notice" : "srcnote"} role="status" aria-atomic="true">{busy ? "Saving session log" : error ? `The save was not confirmed. Retry uses the same session and cannot create a second log. ${error}` : "Session log not saved yet"}</p>
      <button className="btn primary full" disabled={busy}>{busy ? "Writing the log" : "Write the log"}</button>
      <div className="row2 reviewfoot">
        <button type="button" className="btn quiet" onClick={onBack}>Back to the session</button>
        <button type="button" className="btn quiet" onClick={() => setDiscarding(true)}>Discard session</button>
      </div>
    </form>
  );
}

/** What the review says after a pain stop: a lighter plan is promised only when a coach can write one. */
export function painNote(coach: boolean | null): string {
  const base = "Stop playing and rest. Note what you felt; this session will not count.";
  if (coach) return `${base} The coach can lighten the plan.`;
  if (coach === false) return `${base} No coach is signed in, so the plan will not be lightened: keep the next session short and easy, and see a doctor or physiotherapist if it persists.`;
  return base;
}
