import { useState } from "react";
import { sessionKinds, type Today } from "../types.ts";
import { StageMaterialLink } from "./StageMaterialLink.tsx";
import { durationSummary } from "./sessionScope.ts";

/** Selecting a plan duration changes only this preview; Start is the single session mutation. */
export function PracticeChoice({ today, onStart }: { today: Today; onStart: (id: string) => void }) {
  const kinds = sessionKinds(today);
  const [selected, setSelected] = useState(kinds[0]?.id ?? "");
  const kind = kinds.find((k) => k.id === selected) ?? kinds[0];
  if (!today.block || !kind) return null;
  const materials = kind.stages.filter((stage) => stage.material).filter((stage, index, all) => all.findIndex((s) => s.material!.key === stage.material!.key) === index);
  return <div className="practice-choice">
    <fieldset className="duration-choices"><legend>Time for practice</legend>
      {kinds.map((k) => <label key={k.id} className={kind.id === k.id ? "on" : ""}>
        <input type="radio" name="duration" value={k.id} checked={kind.id === k.id} onChange={() => setSelected(k.id)} />
        <span><b>{k.minutes} min</b><small>{k.label.replace(/\s*\(.*?\)\s*$/, "")}</small></span>
      </label>)}
    </fieldset>
    <div className="practice-preview" aria-live="polite">
      <p className="srcnote" id={`scope-${kind.id}`}>{durationSummary(kind.stages)}</p>
      {materials.length > 0 && <ul className="stage-materials">{materials.map((st) => <li key={st.key}><StageMaterialLink material={st.material!} /></li>)}</ul>}
    </div>
    <button className="btn primary full" onClick={() => onStart(kind.id)}>Start {kind.minutes} min practice</button>
  </div>;
}
