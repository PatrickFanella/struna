/**
 * The studio mode's shared contract: what the studio folder holds and what the
 * API returns. The web app keeps matching copies in `web/src/generic.ts`.
 */

export type Level = "new" | "beginner" | "intermediate" | "advanced";

/** `<home>/profile.json`, written by the setup form; the coach may edit it. */
export type Profile = {
  version: 1;
  name: string;
  level: Level;
  /** "acoustic", "electric", "classical", "bass" or anything else. */
  instrument: string;
  styles: string[];
  goals: string;
  /** Songs or artists the player wants to play. */
  wants: string;
  minutesPerSession: number;
  daysPerWeek: number;
  /** What the player can read: "tab", "chords", "notation". */
  reads: string[];
  hand: "right" | "left";
  /** Injuries, hand size, hearing: anything the coach must plan around. */
  limits: string;
  /** Anything else the player wants the coach to know. */
  notes: string;
  created: string;
  updated: string;
};

/** One stage of a session, as the plan defines it. */
export type PlanStage = {
  /** Lower-case key; a phase's `focus` adds its text to the stage with the same key. */
  key: string;
  title: string;
  minutes: number;
  /** What to do, in one or two sentences. */
  task: string;
  /** Optional stable reference, using exactly one file or URL. */
  material?: { file?: string; url?: string };
  targetBpm?: number;
};

export type PlanSession = {
  /** Lower-case id: "full", "short", "quick"… */
  id: string;
  label: string;
  stages: PlanStage[];
};

export type PlanPhase = {
  title: string;
  /** How many counted sessions this phase lasts. */
  sessions: number;
  /** One line on what the phase is for. */
  summary: string;
  /** Stage key → what to work on in that stage during this phase. */
  focus: Record<string, string>;
};

export type PlanMaterial = {
  label: string;
  /** Relative to the studio home, for example "materials/Blues in A.pdf". */
  file?: string;
  url?: string;
  note?: string;
};

/** `<home>/plan/plan.json`: the active plan. The coach writes it; the app only reads it. */
export type Plan = {
  version: 1;
  /** Lower-case letters, digits and dashes; also the recordings folder name. */
  id: string;
  title: string;
  goal: string;
  /** YYYY-MM-DD; only logs on or after this date count. */
  started: string;
  phases: PlanPhase[];
  sessions: PlanSession[];
  materials: PlanMaterial[];
  /** The instruction for the next session, until a newer log gives one. */
  next: string;
  /** Optional other things to do on an off day; logged but not counted. */
  extras: string[];
};

export type MaterialKind = "pdf" | "video" | "audio" | "image" | "tab" | "text" | "epub" | "link" | "other";

/** One thing the player can open: a file in the studio, a file in a library folder, or a web link. */
export type MaterialItem = {
  id: string;
  title: string;
  /** Optional musical name; title remains the original source title. */
  shortTitle?: string;
  provider?: string;
  level?: string;
  kind: MaterialKind;
  /** Where it came from: an upload, the coach's own writing, a saved web copy, a link, or a read-only library folder. */
  source: "studio" | "link" | "folder";
  /** Relative to the studio home ("materials/x.pdf") or, for `folder`, "<n>:<relative path>". */
  path: string | null;
  /** The URL the file is served from, for anything but an unsaved link. */
  src: string | null;
  url: string | null;
  /** The YouTube video id, when the link is one. */
  youtube: string | null;
  note: string;
  size: number | null;
  /** ISO time the file or link was added. */
  added: string;
  inPlan: boolean;
};

/** An entry of `<home>/materials/links.json` (an array of these). */
export type LinkEntry = {
  url: string;
  title: string;
  shortTitle?: string;
  provider?: string;
  note?: string;
  /** Who it suits, in the coach's words. */
  level?: string;
  /** Ask the app to download a copy into `materials/` (direct file links only). */
  save?: boolean;
  /** Set by the app once a copy is saved: the file's path under the home. */
  file?: string;
  /** Set by the app when a save failed. */
  saveError?: string;
  added?: string;
};

export type PromptGroup = "plan" | "session" | "material" | "find" | "learn" | "review" | "mine";

/** A prompt the player can pick in the coach panel. */
export type Prompt = {
  id: string;
  label: string;
  /**
   * The message. `{material}`, `{stage}`, `{bpm}` and `{level}` are filled from the screen.
   * A text ending in `{input}` is put in the message box for the player to finish, not sent.
   */
  text: string;
  group: PromptGroup;
  /** Screens it is offered on: "start", "session", "review", "materials", "tabs", "any". */
  screens: string[];
  custom?: boolean;
};

export type ActionId = "onboarding" | "material-added" | "session-logged" | "plan-complete" | "pain" | "back-after-break" | "profile-changed";
export type ActionMode = "auto" | "ask" | "off";

/** A prompt the app gives the coach when something happens. */
export type AutoAction = {
  id: ActionId;
  /** What happened, for the settings list: "After you add material". */
  when: string;
  /** The button text when the mode is "ask": "Work it into my plan". */
  offer: string;
  /** The message; `{names}`, `{log}`, `{days}` and `{summary}` are filled by the caller. */
  text: string;
  mode: ActionMode;
};

export type GenericStats = { total: number; thisWeek: number; streakDays: number; minutes: number; last: string | null };

/** What `/api/app` returns in either mode. */
export type AppInfo = {
  mode: "personal" | "studio";
  name: string;
  /** Sections the app shows. */
  sections: ("practice" | "library" | "materials" | "tabs")[];
  /** Whether the coach may search the web (studio mode). */
  web: boolean;
  /** Studio mode: whether `profile.json` exists yet. */
  profile: boolean;
};
