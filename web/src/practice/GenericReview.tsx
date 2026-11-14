import { useEffect, useState } from "react";

import { api } from "../api.ts";
import { SUBDIVISIONS } from "../audio/metronome.ts";
import { coachAction } from "../chat/actions.tsx";
import { sessionKind, type Today } from "../types.ts";
import { coachReady } from "../chat/Chat.tsx";
import { type Difficulty, elapsedMinutes, nextDraft, REVIEW_DRAFT_KEY, restoreReviewDraft, tempo } from "./genericLogic.ts";
import { Choice, Text } from "./Review.tsx";
import type { SessionState } from "./Session.tsx";

/** The generic mode's review: a short form, nothing required, that writes the session log. */
export function GenericReview({ today, session, bpm, material, onWritten, onBack, onDiscard }: {
  today: Today;
  session: SessionState;
  bpm: number;
  material: string;
  onWritten: (file: string) => void;
  onBack: () => void;
  onDiscard: () => void;
}) {
  const b = today.block!;
  const kind = sessionKind(today, session.kind);
  // The click counts as used when the session shows it: passes logged, or the tempo moved.
  const clicked = session.helper.cleans + session.helper.misses > 0 || session.passes > 0 || session.metThree || bpm !== session.startBpm;
  const draft = (x: { material: string; metronome: "used" | "not used"; cleanTempo: string; difficulty: Difficulty; pain: string }) =>
    nextDraft({ material: x.material, bpm: x.metronome === "used" ? tempo(x.cleanTempo) : null, difficulty: x.difficulty, pain: x.pain === "yes", fallback: today.next.text });
  const [f, setF] = useState(() => {
    const first = {
      material,
      target: "",
      minutes: String(elapsedMinutes(session.startedAt, Date.now())),
      metronome: (clicked ? "used" : "not used") as "used" | "not used",
      startTempo: String(session.startBpm),
      cleanTempo: String(bpm),
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
      stored = sessionStorage.getItem(REVIEW_DRAFT_KEY);
    } catch {
      /* storage unavailable */
    }
    return restoreReviewDraft(stored, session.startedAt, fresh);
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(REVIEW_DRAFT_KEY, JSON.stringify({ startedAt: session.startedAt, form: f }));
    } catch {
      /* storage unavailable */
    }
  }, [f, session.startedAt]);
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
      const used = f.metronome === "used";
      const clean = used ? tempo(f.cleanTempo) : null;
      const start = used ? tempo(f.startTempo) : null;
      const subdivision = SUBDIVISIONS.find((s) => s.value === session.subdivision)?.log ?? "";
      const minutes = Number(f.minutes);
      const { file } = await api.post<{ file: string }>("/api/sessions", {
        planId: b.id,
        planTitle: b.title,
        phase: today.phase ? `${today.phase.n} of ${today.phase.of}: ${today.phase.title}` : "",
        session: { id: kind.id, label: kind.label },
        ...(session.cross ? { extra: session.cross } : {}),
        minutes: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0,
        material: f.material,
        target: f.target,
        startTempo: start === null ? "" : String(start),
        cleanTempo: clean === null ? "" : String(clean),
        subdivision: used && (start !== null || clean !== null) ? subdivision : "",
        difficulty: f.difficulty,
        wentWell: f.wentWell,
        struggled: f.struggled,
        pain,
        ...(session.recording ? { recording: session.recording } : {}),
        notes: f.notes,
        next: f.next,
      });
      // The same rule as the personal review: remember the clean tempo for this material, unless the session hurt.
      if (f.material && clean !== null && clean >= 30 && clean <= 300 && !pain) {
        await api.put("/api/tempos", { fragment: f.material, bpm: clean, subdivision }).catch(() => {});
      }
      onWritten(file);
      const summary = [f.struggled.trim(), f.notes.trim()].filter(Boolean).join(" ") || "no details given";
      // An off-day extra is not counted and must not move the plan's next instruction; a pain stop is still reported.
      if (pain || !session.cross) void coachAction(pain ? "pain" : "session-logged", { log: file, summary: `${summary} (log: ${file})` });
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="review greview" onSubmit={submit}>
      <h1>{session.pain ? "Stopped: pain or tension" : "How did it go?"}</h1>
      <p className="instr">{session.pain ? painNote(coach) : "Mostly taps, and nothing is required. The coach reads this before it plans your next session."}</p>
      <Text label="What you worked on" value={f.material} onChange={set("material")} placeholder="A song, an exercise, a page" />
      <Text label="Target (optional)" value={f.target} onChange={set("target")} placeholder="What you were aiming for today" />
      <div className="row2">
        <Text label="Minutes played" value={f.minutes} onChange={set("minutes")} num />
        <Choice label="Metronome" value={f.metronome} options={[["used", "Used"], ["not used", "Not used"]]} onChange={set("metronome")} />
      </div>
      {f.metronome === "used" && (
        <div className="row2">
          <Text label="Starting tempo" value={f.startTempo} onChange={set("startTempo")} num />
          <Text label="Clean tempo" value={f.cleanTempo} onChange={set("cleanTempo")} num />
        </div>
      )}
      <Choice label="It felt" value={f.difficulty} options={[["too easy", "Too easy"], ["about right", "About right"], ["too hard", "Too hard"]]} onChange={set("difficulty")} />
      <Text label="What went well" value={f.wentWell} onChange={set("wentWell")} />
      <Text label="What was hard" value={f.struggled} onChange={set("struggled")} />
      <Choice label="Pain, numbness or lasting tension" value={f.pain} options={[["no", "No"], ["yes", "Yes, stop"]]} onChange={set("pain")} />
      <div className="field">
        <p className="grp">Recording</p>
        <p className="fieldval">{session.recording ? `${session.recording.path} (${session.recording.label === "weekly" ? "progress" : session.recording.label})` : "No take recorded"}</p>
      </div>
      <Text label="What to do first next time" value={f.next} onChange={set("next")} area />
      <Text label="Notes (optional)" value={f.notes} onChange={set("notes")} area />
      {error && <p className="notice" role="alert"><b>The log was not written.</b> {error}</p>}
      <button className="btn primary full" disabled={busy}>{busy ? "Writing the log" : "Write the log"}</button>
      <div className="row2 reviewfoot">
        <button type="button" className="btn quiet" onClick={onBack}>Back to the session</button>
        <button type="button" className="btn quiet" onClick={() => confirm("Discard this session without writing a log?") && onDiscard()}>Discard session</button>
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
