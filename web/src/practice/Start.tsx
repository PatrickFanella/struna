import { useState } from "react";

import { Icon } from "../icons.tsx";
import { getTheme, setTheme, type ThemeChoice } from "../theme.ts";
import { blockName, type Today, todayLine } from "../types.ts";
import { cap } from "./Session.tsx";

export function Start({ today, onStart, onTune, onCoach, onWeek }: {
  today: Today;
  onStart: (kind: "full" | "floor", cross?: string) => void;
  onTune: () => void;
  onCoach: () => void;
  onWeek: (week: number | null) => void;
}) {
  const [cross, setCross] = useState(false);
  const [theme, setThemeState] = useState<ThemeChoice>(getTheme);
  const [weekOpen, setWeekOpen] = useState(false);
  const b = today.block;
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

      <h1>Next</h1>
      <p className="instr">{today.next.text ? cap(today.next.text) : "No instruction recorded yet."}</p>
      <p className="srcnote">{today.next.source === "log" ? "From your last practice log" : "From the progress ledger"}</p>

      <div className="push startacts">
        <button className="btn primary full" disabled={!b} onClick={() => onStart("full")}>Full session (45 min)</button>
        <button className="btn outline full" disabled={!b} onClick={() => onStart("floor")}>Short session (15 min)</button>
        <button className="btn quiet full" onClick={onTune}><Icon id="i-fork" />Tune first</button>
        {b && b.crossTraining.length > 0 && (
          <div className="cross">
            <button className="linkbtn" aria-expanded={cross} onClick={() => setCross(!cross)}>Cross-training day (optional, not counted)</button>
            {cross && (
              <ul className="crosslist">
                {b.crossTraining.map((c) => (
                  <li key={c}><button className="btn quiet full" onClick={() => onStart("full", c)}>{c.replace(/;$/, "")}</button></li>
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
