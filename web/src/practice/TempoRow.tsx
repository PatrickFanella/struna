import { metronome, SUBDIVISIONS } from "../audio/metronome.ts";
import type { Suggestion } from "../audio/tempo.ts";
import { useMetronome } from "../audio/useMetronome.ts";
import { Icon } from "../icons.tsx";
import { BeatDots } from "../tools/Metronome.tsx";

export function TempoRow({ passes, suggestion, onClean, onMiss, onApply }: { passes: number; suggestion: Suggestion | null; onClean: () => void; onMiss: () => void; onApply: (s: Suggestion) => void }) {
  const m = useMetronome();
  const sub = SUBDIVISIONS.find((s) => s.value === m.subdivision)!;
  return (
    <>
      <div className="met">
        <button className="tempocol" onClick={() => metronome.toggle()} aria-label={`${m.bpm} BPM, ${sub.label}. ${m.running ? "Stop the click" : "Start the click"}`}>
          <span className="tempo">
            <span className="bpm num">{m.bpm}</span>
            <span className="u">BPM<br />{sub.short}</span>
          </span>
          <BeatDots className="click" count={m.beatsPerBar} beat={m.running ? m.beat : null} />
        </button>
        <span className="passrow">
          <button className="passes" onClick={onClean}>
            Log clean pass
            <span className="dots" role="img" aria-label={`${passes} of 3 clean passes`}>
              {[0, 1, 2].map((i) => (
                <i key={i} className={i < passes ? "ok" : ""}>{i < passes ? <Icon id="i-check" /> : null}</i>
              ))}
            </span>
          </button>
          <button className="miss" onClick={onMiss}>Miss</button>
        </span>
      </div>
      {suggestion && (
        <p className={`suggest ${suggestion.kind === "raise" ? "clean" : "error"}`} role="status">
          {suggestion.kind === "raise" && <>Three clean passes. Try <b className="num">{m.bpm + suggestion.delta}</b> BPM. </>}
          {suggestion.kind === "repeat" && <>One miss. Repeat at <b className="num">{m.bpm}</b> BPM.</>}
          {suggestion.kind === "lower" && <>Second miss. Lower to <b className="num">{m.bpm + suggestion.delta}</b> BPM, or shorten the loop. </>}
          {suggestion.kind !== "repeat" && <button className="linkbtn" onClick={() => onApply(suggestion)}>Set {m.bpm + suggestion.delta} BPM</button>}
        </p>
      )}
    </>
  );
}
