import { BpmInput } from "./BpmInput.tsx";
import { useStageSuggestion } from "./stageSuggestion.ts";
import { useRef } from "react";

import { metronome, SUBDIVISIONS, TIME_SIGNATURES } from "../audio/metronome.ts";
import { tapTempo } from "../audio/tempo.ts";
import { useMetronome } from "../audio/useMetronome.ts";
import { Icon } from "../icons.tsx";

export function BeatDots({ count, beat, className }: { count: number; beat: number | null; className: string }) {
  return (
    <div className={`${className}${count > 4 ? " many" : ""}`} role="img" aria-label={beat === null ? `${count} beats, beat 1 accented` : `Beat ${beat + 1} of ${count}, beat 1 accented`}>
      {Array.from({ length: count }, (_, i) => (
        <i key={i} className={[i === 0 ? "acc" : "", beat === i ? "hit" : ""].filter(Boolean).join(" ")} />
      ))}
    </div>
  );
}

export function MetronomePanel() {
  const m = useMetronome();
  const stage = useStageSuggestion();
  const taps = useRef<number[]>([]);
  const sig = TIME_SIGNATURES.find((t) => t.beats === m.beatsPerBar) ?? TIME_SIGNATURES[2]!;
  const [top, bottom] = sig.label.split("/");

  const tap = () => {
    const now = performance.now();
    taps.current = [...taps.current.filter((t) => now - t < 10_000), now].slice(-8);
    const bpm = tapTempo(taps.current);
    if (bpm) metronome.set({ bpm });
  };

  return (
    <>
      <div className="mid">
        <div className="bigrow">
          <span className="bigc">
            <span className="tsig num" aria-label={`${sig.label} time`}>
              <span>{top}</span>
              <span>{bottom}</span>
            </span>
            <BpmInput bpm={m.bpm} />
          </span>
        </div>
        <p className="bpml">BPM{m.countingIn ? <span>Count-in</span> : null}</p>
        <BeatDots className="beats" count={m.beatsPerBar} beat={m.beat} />
        <div className="r2">
          <div>
            <p className="grp" id="time-label">Time</p>
            <div className="seg mini" role="radiogroup" aria-labelledby="time-label">
              {TIME_SIGNATURES.map((t) => (
                <button key={t.label} role="radio" aria-checked={t.beats === m.beatsPerBar} className={t.beats === m.beatsPerBar ? "on" : ""} onClick={() => metronome.set({ beatsPerBar: t.beats })}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="grp" id="countin-label">Count-in</p>
            <div className="seg mini words" role="radiogroup" aria-labelledby="countin-label">
              <button role="radio" aria-checked={m.countIn} className={m.countIn ? "on" : ""} onClick={() => metronome.set({ countIn: true })}>On</button>
              <button role="radio" aria-checked={!m.countIn} className={!m.countIn ? "on" : ""} onClick={() => metronome.set({ countIn: false })}>Off</button>
            </div>
          </div>
        </div>
        {stage ? <p className="srcnote"><button className="linkbtn" onClick={stage.use}>Use stage tempo</button> · {stage.bpm} BPM · {stage.source}</p> : <p className="srcnote">No active stage suggestion. Choose a tempo below.</p>}
        <p className="grp">Tempo</p>
        <div className="r3">
          <button className="num" aria-label="2 BPM slower" onClick={() => metronome.set({ bpm: m.bpm - 2 })}>−2</button>
          <button onClick={tap}>Tap</button>
          <button className="num" aria-label="2 BPM faster" onClick={() => metronome.set({ bpm: m.bpm + 2 })}>+2</button>
        </div>
        <p className="grp" id="sub-label">Subdivision</p>
        <div className="r4" role="radiogroup" aria-labelledby="sub-label">
          {SUBDIVISIONS.map((s) => (
            <button key={s.value} role="radio" aria-checked={m.subdivision === s.value} className={m.subdivision === s.value ? "on" : ""} onClick={() => metronome.set({ subdivision: s.value })}>
              <Icon id={s.icon} />
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <button className="btn primary full" style={{ marginTop: "auto" }} onClick={() => metronome.toggle()}>
        {m.running ? "Stop" : "Start"}
      </button>
    </>
  );
}
