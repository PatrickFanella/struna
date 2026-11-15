import { useState } from "react";

import { Icon } from "../icons.tsx";
import { getTheme, setTheme, type ThemeChoice } from "../theme.ts";
import { blockName, firstSentence, sessionKinds, type Today, todayLine } from "../types.ts";
import { cap } from "./Session.tsx";
import { durationSummary } from "./sessionScope.ts";

const durationPreview = (stages: Today["stages"]["full"]) => {
  const shown = stages.slice(0, 2).map((stage) => stage.title);
  const more = stages.length - shown.length;
  return `${shown.join(" · ")}${more > 0 ? ` · +${more} ${more === 1 ? "stage" : "stages"}` : ""}`;
};

export function Start({ today, onStart, onTune, onCoach, onWeek }: {
  today: Today;
  onStart: (kind: string, cross?: string) => void;
  onTune: () => void;
  onCoach: () => void;
  onWeek: (week: number | null) => void;
}) {
  const [cross, setCross] = useState(false);
  const [theme, setThemeState] = useState<ThemeChoice>(getTheme);
  const [weekOpen, setWeekOpen] = useState(false);
  const b = today.block;
  const kinds = sessionKinds(today);
  const [selectedKind, setSelectedKind] = useState<string>("");
  const selected = kinds.find((kind) => kind.id === selectedKind) ?? kinds[0];
  const direction = firstSentence(today.next.text || "No instruction recorded yet.");
  const moveDuration = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const movement = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    const target = event.key === "Home" ? 0 : event.key === "End" ? kinds.length - 1 : movement ? (index + movement + kinds.length) % kinds.length : null;
    if (target === null) return;
    event.preventDefault();
    setSelectedKind(kinds[target]!.id);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=radio]")[target]?.focus();
  };
  const chooseTheme = (t: ThemeChoice) => {
    setTheme(t);
    setThemeState(t);
  };
  return (
    <div className="start">
      <dl className="meta">
        <dt>Block</dt>
        <dd>{b ? blockName(b) : "Not found"}</dd>
        <dt>Today</dt>
        <dd>{todayLine(today)}{today.weekOverride ? " (week set by hand)" : ""}</dd>
      </dl>

      {today.error && (
        <div className="notice" role="alert">
          <p><b>The practice plan could not be read.</b> {today.error}</p>
          <p>Check <code>Current Practice Block.md</code> in the vault. You can still use the tuner and metronome.</p>
        </div>
      )}

      {today.overDue && (
        <div className="notice">
          <p><b>This block has reached its {b?.targetSessions} sessions.</b> Run a block review with the coach before choosing what comes next.</p>
          <button className="btn outline" onClick={onCoach}><Icon id="i-chat" />Open the coach</button>
        </div>
      )}

      <h1>Today’s practice</h1>
      <p className="instr">{cap(direction)}</p>
      <details className="plan-details">
        <summary>Plan details</summary>
        <p>{today.next.text}</p>
        <p className="srcnote">{today.next.source === "log" ? "From your last practice log" : "From the progress ledger"}</p>
        <ul>{kinds.map((kind) => <li key={kind.id}><b>{kind.label}</b>: {durationSummary(kind.stages)}</li>)}</ul>
      </details>

      <div className="startacts">
        {selected && (
          <section className="session-picker" aria-labelledby="duration-heading">
            <h2 id="duration-heading">Choose a duration</h2>
            <div className="duration-options" role="radiogroup" aria-label="Practice duration">
              {kinds.map((kind, index) => (
                <button key={kind.id} type="button" role="radio" aria-checked={selected.id === kind.id} tabIndex={selected.id === kind.id ? 0 : -1} className={selected.id === kind.id ? "on" : ""} onClick={() => setSelectedKind(kind.id)} onKeyDown={(event) => moveDuration(event, index)}>
                  <span>{kind.label.replace(/ \(\d+ min\)$/, "")}</span>
                  <span>{kind.minutes} min</span>
                </button>
              ))}
            </div>
            <p className="srcnote" id={`scope-${selected.id}`}>{durationPreview(selected.stages)}</p>
            <button className="btn primary full start-selected" disabled={!b} onClick={() => onStart(selected.id)}>Start {selected.minutes} min</button>
          </section>
        )}
        <button className="btn quiet full" onClick={onTune}><Icon id="i-fork" />Tune first</button>
        {b && b.crossTraining.length > 0 && (
          <div className="cross">
            <button className="linkbtn" aria-expanded={cross} onClick={() => setCross(!cross)}>Cross-training day (optional, not counted)</button>
            {cross && (
              <ul className="crosslist">
                {b.crossTraining.map((c) => (
                  <li key={c}><button className="btn quiet full" onClick={() => onStart(selected?.id ?? "full", c)}>{c.replace(/;$/, "")}</button></li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="startfoot">
          <p className="counts">Sessions in this block: <span className="num">{today.counts.full}</span> full, <span className="num">{today.counts.floor}</span> short</p>
          <button className="linkbtn" aria-expanded={weekOpen} onClick={() => setWeekOpen(!weekOpen)}>Correct the week</button>
          {weekOpen && (
            <div className="seg mini" role="radiogroup" aria-label="Week">
              <button role="radio" aria-checked={today.weekOverride === null} className={today.weekOverride === null ? "on words" : "words"} onClick={() => onWeek(null)}>Auto</button>
              {[1, 2, 3, 4].map((w) => (
                <button key={w} role="radio" aria-checked={today.weekOverride === w} className={today.weekOverride === w ? "on" : ""} onClick={() => onWeek(w)}>{w}</button>
              ))}
            </div>
          )}
          <div className="themepick">
            <span className="grp">Theme</span>
            <div className="seg mini words" role="radiogroup" aria-label="Theme">
              {([[null, "Device"], ["light", "Light"], ["dark", "Dark"]] as [ThemeChoice, string][]).map(([t, l]) => (
                <button key={l} role="radio" aria-checked={theme === t} className={theme === t ? "on" : ""} onClick={() => chooseTheme(t)}>{l}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
