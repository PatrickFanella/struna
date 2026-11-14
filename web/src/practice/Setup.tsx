import { useState } from "react";

import { api, store } from "../api.ts";
import { coachAction } from "../chat/actions.tsx";
import type { Profile, ProfileInput } from "../generic.ts";
import { defaultProfile, fromForm, INSTRUMENTS, LEVELS, MINUTES, profileAction, READS, type SetupForm, STYLES, toForm } from "./genericLogic.ts";

/** Set when the player skipped the form, so the first real save still gets the coach's onboarding. */
const SKIPPED_KEY = "guitar-room.setup-skipped";

function Pick<T extends string | number>({ label, value, options, onChange, words }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; words?: boolean }) {
  return (
    <div className="field">
      <p className="grp">{label}</p>
      <div className={`seg mini${words ? " words" : ""}${words && options.length > 3 ? " many" : ""}`} role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button type="button" key={v} role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{l}</button>
        ))}
      </div>
    </div>
  );
}

function Many({ label, hint, value, options, onChange }: { label: string; hint?: string; value: string[]; options: [string, string][]; onChange: (v: string[]) => void }) {
  return (
    <div className="field" role="group" aria-label={label}>
      <p className="grp">{label}{hint ? <span className="hint"> {hint}</span> : null}</p>
      <div className="chips">
        {options.map(([v, l]) => {
          const on = value.includes(v);
          return <button type="button" key={v} aria-pressed={on} className={on ? "on" : ""} onClick={() => onChange(on ? value.filter((x) => x !== v) : [...value, v])}>{l}</button>;
        })}
      </div>
    </div>
  );
}

function Text({ label, hint, value, onChange, area, placeholder, max }: { label: string; hint?: string; value: string; onChange: (v: string) => void; area?: boolean; placeholder?: string; max: number }) {
  return (
    <label className="field">
      <span className="grp">{label}{hint ? <span className="hint"> {hint}</span> : null}</span>
      {area ? (
        <textarea className="input" rows={2} maxLength={max} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="input" maxLength={max} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

/**
 * The profile form: shown first when there is no profile, and later as "Edit profile".
 * Everything has a default, so saving straight away is fine.
 */
export function Setup({ profile, appName, onSaved, onCancel }: {
  profile: Profile | null;
  appName: string;
  /** Called after the profile is written; the caller reloads today. */
  onSaved: () => void;
  /** Present when editing an existing profile. */
  onCancel?: () => void;
}) {
  const [f, setF] = useState<SetupForm>(() => toForm(profile));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof SetupForm>(k: K) => (v: SetupForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const first = profile === null;

  const save = async (input: ProfileInput, skipped: boolean) => {
    setBusy(true);
    setError("");
    try {
      const res = await api.put<{ profile: Profile; plan: "created" | "kept" }>("/api/profile", input);
      const action = profileAction({ before: profile ? fromForm(toForm(profile)) : null, after: input, plan: res.plan, skipped, skippedBefore: store.get(SKIPPED_KEY) === "1" });
      store.set(SKIPPED_KEY, skipped ? "1" : null);
      onSaved();
      if (action) void coachAction(action);
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(false);
    }
  };

  return (
    <form
      className="review setup"
      onSubmit={(e) => {
        e.preventDefault();
        void save(fromForm(f), false);
      }}
    >
      <h1>{first ? `Welcome to ${appName}` : "Your profile"}</h1>
      <p className="instr">
        {first
          ? "Tell the coach about your playing. Every answer can be changed later, and none is required."
          : "The coach reads this before it plans. Change what is out of date."}
      </p>

      <div className="field">
        <p className="grp" id="setup-level">Where are you now?</p>
        <div className="levels" role="radiogroup" aria-labelledby="setup-level">
          {LEVELS.map((l) => (
            <button type="button" key={l.id} role="radio" aria-checked={f.level === l.id} className={f.level === l.id ? "on" : ""} onClick={() => set("level")(l.id)}>
              <b>{l.title}</b>
              <span>{l.text}</span>
            </button>
          ))}
        </div>
      </div>

      <Pick label="Instrument" words value={f.instrument} options={[...INSTRUMENTS, ["other", "Other"]]} onChange={set("instrument")} />
      {f.instrument === "other" && <Text label="Which instrument?" value={f.instrumentOther} onChange={set("instrumentOther")} placeholder="12-string, baritone, resonator" max={60} />}

      <Many label="Styles you like" hint="(any number)" value={f.styles} options={STYLES.map((s) => [s, s] as [string, string])} onChange={set("styles")} />
      <Text label="Other styles" value={f.stylesOther} onChange={set("stylesOther")} placeholder="Separate with commas" max={200} />

      <Text label="Songs or artists you want to play" value={f.wants} onChange={set("wants")} area placeholder="The coach picks material from these" max={1000} />
      <Text label="What you want from playing" value={f.goals} onChange={set("goals")} area placeholder="Play along with friends, write songs, a solo you love" max={1000} />

      <Pick label="Minutes in a usual session" value={f.minutesPerSession} options={MINUTES.map((m) => [m, String(m)] as [number, string])} onChange={set("minutesPerSession")} />
      <Pick label="Days a week you can play" value={f.daysPerWeek} options={[1, 2, 3, 4, 5, 6, 7].map((d) => [d, String(d)] as [number, string])} onChange={set("daysPerWeek")} />

      <Many label="What you can read" hint="(none is fine)" value={f.reads} options={READS} onChange={set("reads")} />
      <Pick label="Which hand presses the strings?" words value={f.hand} options={[["right", "Left hand (standard guitar)"], ["left", "Right hand (left-handed guitar)"]]} onChange={set("hand")} />

      <Text label="Anything to plan around" value={f.limits} onChange={set("limits")} area placeholder="An injury, small hands, hearing, a shared room" max={1000} />
      <Text label="Your name" hint="(optional)" value={f.name} onChange={set("name")} max={80} />
      <Text label="Anything else the coach should know" value={f.notes} onChange={set("notes")} area max={2000} />

      {error && <p className="notice" role="alert"><b>The profile was not saved.</b> {error}</p>}
      <button className="btn primary full" disabled={busy}>{busy ? "Saving" : first ? "Save and build my plan" : "Save"}</button>
      <div className="row2 reviewfoot">
        {first ? (
          <button type="button" className="btn quiet" disabled={busy} onClick={() => void save(defaultProfile(), true)}>Skip for now</button>
        ) : (
          <button type="button" className="btn quiet" disabled={busy} onClick={onCancel}>Cancel</button>
        )}
        <span className="srcnote setupnote">{first ? "Skipping starts you on a beginner plan." : "The coach offers to adjust your plan."}</span>
      </div>
    </form>
  );
}
