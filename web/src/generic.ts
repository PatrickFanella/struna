/**
 * The studio mode's types, as the web app needs them. They mirror
 * `server/generic/types.ts`; change both together.
 */

import type { Stage } from "./types.ts";

export type Level = "new" | "beginner" | "intermediate" | "advanced";

/** `<home>/profile.json`, written by the setup form; the coach may edit it. */
export type Profile = {
  version: 1;
  name: string;
  level: Level;
  /** "acoustic", "electric", "classical" or anything else the player typed. */
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

/** What the setup form sends to `PUT /api/profile`; the server stamps the rest. */
export type ProfileInput = Omit<Profile, "version" | "created" | "updated">;

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

/** An entry of the plan's material list, resolved by `/api/today`. */
export type MaterialRef = {
  label: string;
  key: string;
  kind: MaterialKind;
  src: string | null;
  url?: string;
  youtube?: string;
  missing?: true;
  note?: string;
};

export type PromptGroup = "plan" | "session" | "material" | "find" | "learn" | "review" | "mine";

/** A prompt the player can pick in the coach panel. */
export type Prompt = {
  /** What the request asks for; this is not a file-access restriction. */
  purpose?: "advice" | "plan-change" | "session-length" | "materials";
  id: string;
  label: string;
  /**
   * The message. `{material}`, `{stage}`, `{bpm}` and `{level}` are filled from the screen.
   * A text containing `{input}`, a plan-change request or a custom prompt is drafted.
   * Other requests are sent only by a button explicitly labeled Send.
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

/** One session kind of the plan, as `/api/today` returns it. */
export type SessionKind = { id: string; label: string; minutes: number; stages: Stage[] };

/** One row of `GET /api/logs`. */
export type LogSummary = {
  file: string;
  date: string;
  session: string;
  minutes: number | null;
  material: string;
  cleanTempo: string | number | null;
  difficulty: string;
  pain: boolean | string;
  next: string;
};

/** The detail of the window event `struna:changed`, sent after a coach turn. */
export type Changed = { plan?: boolean; materials?: boolean; profile?: boolean };

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
