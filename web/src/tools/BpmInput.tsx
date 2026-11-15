import { useEffect, useState } from "react";
import { metronome } from "../audio/metronome.ts";
import { MIN_BPM, MAX_BPM, parseBpmEntry } from "../audio/tempo.ts";

export function BpmInput({ bpm }: { bpm: number }) {
  const [draft, setDraft] = useState(String(bpm));
  const [error, setError] = useState("");
  useEffect(() => { setDraft(String(bpm)); setError(""); }, [bpm]);
  const cancel = () => { setDraft(String(bpm)); setError(""); };
  const commit = () => {
    const value = parseBpmEntry(draft);
    if (value === null) { setError(`Enter a whole number from ${MIN_BPM} to ${MAX_BPM} BPM.`); return; }
    metronome.set({ bpm: value }); setDraft(String(value)); setError("");
  };
  return <span className="bpm-entry">
    <input className="big num" aria-label="BPM" inputMode="numeric" type="text" value={draft} aria-invalid={Boolean(error)} aria-describedby="bpm-limits" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); }
    }} />
    <span className="bpm-edit-actions"><button className="linkbtn" onClick={commit}>Set BPM</button><button className="linkbtn" onClick={cancel}>Cancel edit</button></span>
    <small id="bpm-limits">{MIN_BPM}–{MAX_BPM} BPM · Enter to set, Escape to cancel</small>
    {error && <small className="error" role="status">{error}</small>}
  </span>;
}
