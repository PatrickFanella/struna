import { PracticeChoice } from "./PracticeChoice.tsx";
import { useEffect, useState } from "react";

import { api, store } from "../api.ts";
import { CoachSettings, coachAction } from "../chat/actions.tsx";
import { askCoach } from "../chat/Chat.tsx";
import type { LogSummary } from "../generic.ts";
import { Icon } from "../icons.tsx";
import { getTheme, setTheme, type ThemeChoice } from "../theme.ts";
import { sessionKinds, type Today } from "../types.ts";
import { breakDue, breakKey, logFacts, shortDate, statsFacts } from "./genericLogic.ts";
import { cap } from "./Session.tsx";

const BREAK_KEY = "struna.break-offered";
const COMPLETE_KEY = "struna.plan-complete-offered";
/** What was offered in this page load, for browsers where localStorage is off. */
const offered = new Set<string>();

function once(key: string, value: string): boolean {
  const id = `${key}=${value}`;
  if (offered.has(id) || store.get(key) === value) return false;
  offered.add(id);
  store.set(key, value);
  return true;
}

const NO_PLAN = "No plan yet";

/** The studio mode's start screen: the plan, what to do next, one button per session kind, and the history. */
export function GenericStart({ today, onStart, onTune, onCoach, onEditProfile, onStarter }: {
  today: Today;
  onStart: (kind: string, extra?: string) => void;
  onTune: () => void;
  onCoach: () => void;
  onEditProfile: () => void;
  /** Writes a starter plan for the profile; rejects with the server's reason. */
  onStarter: () => Promise<void>;
}) {
  const [extras, setExtras] = useState(false);
  const [settings, setSettings] = useState(false);
  const [theme, setThemeState] = useState<ThemeChoice>(getTheme);
  const [logs, setLogs] = useState<LogSummary[]>([]);
  const [starter, setStarter] = useState<{ busy: boolean; error: string }>({ busy: false, error: "" });
  const b = today.block;
  const kinds = sessionKinds(today);
  const days = today.daysSinceLast ?? null;
  const away = typeof days === "number" && days >= 7;
  const facts = statsFacts(today.stats);

  useEffect(() => {
    let live = true;
    api.get<LogSummary[] | { logs: LogSummary[] }>("/api/logs?limit=5").then(
      (r) => live && setLogs(Array.isArray(r) ? r : (r?.logs ?? [])),
      () => live && setLogs([]),
    );
    return () => {
      live = false;
    };
  }, [today]);

  // Things the coach should hear about, each offered once: a week away first, then a finished plan.
  useEffect(() => {
    if (breakDue(days, today.stats, store.get(BREAK_KEY))) {
      if (once(BREAK_KEY, breakKey(today.stats))) void coachAction("back-after-break", { days: String(days) });
    } else if (b && today.overDue) {
      if (once(COMPLETE_KEY, `${b.id}:${b.targetSessions}`)) void coachAction("plan-complete");
    }
  }, [b, days, today.overDue, today.stats]);

  const chooseTheme = (t: ThemeChoice) => {
    setTheme(t);
    setThemeState(t);
  };
  const writeStarter = async () => {
    if (today.error !== NO_PLAN && !confirm("Replace the plan file that could not be read with a starter plan?")) return;
    setStarter({ busy: true, error: "" });
    try {
      await onStarter();
      setStarter({ busy: false, error: "" });
    } catch (e) {
      setStarter({ busy: false, error: String((e as Error).message ?? e) });
    }
  };

  return (
    <div className="start gstart">
      <details className="plan-details"><summary>Current plan</summary><dl className="meta">
        <dt>Plan</dt>
        <dd>{b ? b.title : "None yet"}</dd>
        {b && (
          <>
            <dt>Today</dt>
            <dd>{today.line ?? ""}</dd>
          </>
        )}
      </dl><p>{b?.goal}</p><p>{today.next.text}</p><p className="srcnote">{today.next.source === "log" ? "From your last practice log" : "From your plan"}{today.phase?.summary ? `. This phase: ${today.phase.summary}` : ""}</p></details>

      {today.error && (
        <div className="notice" role="alert">
          {today.error === NO_PLAN ? (
            <p><b>There is no practice plan yet.</b> The coach can build one from your profile, or you can begin with a starter plan and let the coach adjust it later.</p>
          ) : (
            <p><b>The practice plan could not be read.</b> {today.error}</p>
          )}
          <div className="noticeacts">
            <button
              className="btn outline"
              onClick={() =>
                askCoach(
                  today.error === NO_PLAN
                    ? "Build my practice plan. Read my profile and any logs first, stage a proposed plan for my review, then tell me in a few lines what is in it."
                    : `${today.error}. Fix the file, keeping what it was trying to say, and tell me what you changed.`,
                  { open: true },
                )
              }
            >
              <Icon id="i-chat" />{today.error === NO_PLAN ? "Ask the coach to build a plan" : "Ask the coach to fix it"}
            </button>
            <button className="btn quiet" disabled={starter.busy} onClick={() => void writeStarter()}>{starter.busy ? "Writing the plan" : "Use a starter plan"}</button>
          </div>
          {starter.error && <p>The starter plan was not written: {starter.error}</p>}
          <p>You can still use the tuner and metronome.</p>
        </div>
      )}

      {away && (
        <div className="notice">
          <p><b>{days} days since your last session.</b> A short, easy session today counts. The coach can ease the plan back in.</p>
        </div>
      )}

      {today.overDue && b && (
        <div className="notice">
          <p><b>You have finished this plan.</b> The coach can review your sessions and propose what comes next.</p>
          <button className="btn outline" onClick={onCoach}><Icon id="i-chat" />Open the coach</button>
        </div>
      )}

      {b && (
        <>
          <h1>Today</h1>
          <p className="today-task">{today.next.text ? cap(today.next.text.split(/\n/)[0]!) : "Play a little, listen closely, and leave one note for next time."}</p>
        </>
      )}

      <div className="startacts">
        <PracticeChoice today={today} onStart={onStart} />
        <button className="btn quiet full" onClick={onTune}><Icon id="i-fork" />Tune first</button>
        {b && b.crossTraining.length > 0 && kinds[0] && (
          <div className="cross">
            <button className="linkbtn" aria-expanded={extras} onClick={() => setExtras(!extras)}>Something else today (optional, not counted)</button>
            {extras && (
              <ul className="crosslist">
                {b.crossTraining.map((c) => (
                  <li key={c}><button className="btn quiet full" onClick={() => onStart(kinds[0]!.id, c)}>{c.replace(/;$/, "")}</button></li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="startfoot">
          {facts.length > 0 && <p className="counts statline">{facts.join(" · ")}</p>}
          {logs.length > 0 && (
            <div className="recent">
              <p className="grp">Recent sessions</p>
              <ul>
                {logs.map((l) => (
                  <li key={l.file}>
                    <span className="num">{shortDate(l.date)}</span>
                    <span>{logFacts(l) || "Logged"}</span>
                  </li>
                ))}
              </ul>
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
          <div className="startlinks">
            <button className="linkbtn" onClick={onEditProfile}>Edit profile</button>
            <button className="linkbtn" aria-expanded={settings} onClick={() => setSettings(!settings)}>Coach settings</button>
          </div>
          {settings && <CoachSettings />}
        </div>
      </div>
    </div>
  );
}
