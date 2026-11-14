import type { DatabaseSync } from "node:sqlite";

import { getSetting, setSetting } from "../db.ts";
import { HttpError, readJson, route, send } from "../http.ts";
import type { ActionId, ActionMode, AutoAction, Prompt, PromptGroup } from "./types.ts";

const p = (id: string, group: PromptGroup, screens: string[], label: string, text: string): Prompt => ({ id, label, text, group, screens });

/**
 * The prompts the player can pick. They say nothing about level: the coach reads the profile.
 * Within a screen they are offered in this order, so the most useful come first.
 * `{material}`, `{stage}` and `{bpm}` are filled from the screen; a text ending in `{input}` waits for the player.
 */
export const PROMPTS: Prompt[] = [
  // plan
  p("ten-minutes", "plan", ["start", "session"], "I only have 10 minutes", "I only have 10 minutes today. Tell me exactly what to do with them, step by step with times. Do not change my plan."),
  p("easier", "plan", ["start", "session", "review"], "Make today easier", "Today's session is too much for me. Tell me exactly how to play it easier today: fewer or shorter steps, slower tempos or simpler material. Do not change the plan's phases for one day; set the plan's \"next\" if that helps. Only make the plan itself lighter if my recent logs also say it is too hard, and tell me if you do."),
  p("harder", "plan", ["start", "session", "review"], "Make today harder", "Today's session is too easy. Tell me exactly how to raise it one step today, not three. Do not change the plan's phases for one day; set the plan's \"next\" if that helps. Only raise the plan itself if two or three of my recent logs also say \"too easy\", and tell me if you do."),
  // Not first: a mis-tap here should not be the easiest one on the start screen.
  p("build-plan", "plan", ["start"], "Build my plan", "Build me a practice plan. Read my profile, your notes and my recent logs first. If I already have a plan that is not the starter plan, do not replace it yet: tell me in a few lines what you would change and why, and wait for my answer. If you only adjust it, keep its id and started. Otherwise write the plan and tell me in a few lines what it covers and why."),
  p("missed-week", "plan", ["start"], "I missed a week", "I have not practised for about a week. Ease me back in: tell me what to do today, and adjust the plan if I should repeat anything."),
  p("fit-week", "plan", ["start"], "Fit the plan to my week", "My time has changed. Fit the plan to this and tell me what you changed: {input}"),
  p("next-plan", "plan", ["start", "review"], "What comes after this plan?", "Look at my logs for this plan. What have I got out of it, what is still weak, and what should the next plan be? Propose it in a few lines before you write anything."),

  // session
  p("listen-for", "session", ["session"], "What should I listen for?", "I am on the stage \"{stage}\". What should I listen for and feel for right now? Three things at most."),
  p("stuck", "session", ["session"], "I'm stuck on this", "I am stuck on the stage \"{stage}\". Give me one smaller step to try right now, and tell me how I will know it is working."),
  p("tempo", "session", ["session"], "Is this tempo right?", "The metronome is at {bpm} BPM. Is that a sensible tempo for what I am working on, and what has to be true before I raise it?"),
  p("warm-up", "session", ["start", "session"], "Warm-up for today", "Give me a warm-up for today: three to five minutes, easy on the hands, and matched to what today's session works on."),
  p("hand-hurts", "session", ["session", "review", "start"], "My hand hurts", "My hand, wrist or arm hurts or feels tense when I play. If it could be sharp pain, numbness or tingling, tell me to stop for today first. Then ask me the one thing you most need to know. Once I answer, tell me what to change and lighten my plan if it calls for it."),

  // material
  p("explain-material", "material", ["session", "materials"], "Explain this simply", "Explain \"{material}\" simply: what it is, what it is for, and the first thing I should do with it."),
  p("steps-material", "material", ["session", "materials"], "Break this into steps", "Break \"{material}\" into small steps I can practise one at a time, in order. Say what \"done\" sounds like for each step."),
  p("read-tab", "material", ["session", "materials", "tabs"], "How do I read this tab?", "Show me how to read tab and chord boxes, using what I am looking at where you can. Keep it to what I need today."),
  p("new-material", "material", ["materials", "start"], "Turn my materials into lessons", "Look through what is in my materials, especially anything new. Work the pieces that fit me into my plan as lessons, and tell me what you added and what you left out."),
  p("order-materials", "material", ["materials"], "What should I use next?", "Look through my materials. Which fit where I am now, and in what order should I use them? Add the best one or two to my plan."),
  p("exercise", "material", ["session", "materials", "any"], "Make me an exercise for…", "Make me a short exercise I can play right now, written out in a form I can read (tab, chord boxes or notation, as my profile says), with a starting tempo, for: {input}"),
  p("lesson-sheet", "material", ["materials", "any"], "Write me a lesson sheet on…", "Write a one-page lesson sheet at my level and save it in my materials. The topic: {input}"),

  // find
  p("find-lessons", "find", ["materials", "start", "any"], "Find lessons for…", "Find two or three free lessons from reputable teachers that suit my level, and add them to my materials with a note on each. I want to learn: {input}"),
  p("find-song", "find", ["start", "materials", "any"], "Find a song at my level", "Find me two or three songs I could play at my level and in the styles I like. For each, say what makes it playable for me, and link a legal lesson, chart or tab. Add the best one to my materials."),
  p("backing-track", "find", ["session", "materials"], "Find a backing track for this", "Find a backing track I can play \"{material}\" over: the right key and a tempo I can manage. Add it to my materials and tell me how to use it."),
  p("find-chart", "find", ["materials", "any"], "Find chords or tab for…", "Find a legal, accurate chord chart or tab and add the link to my materials. Use official or licensed sources and link to them; do not copy the song out. The song: {input}"),

  // learn
  p("teach", "learn", ["start", "session", "any"], "Teach me a chord, scale…", "Teach me this step by step at my level, with a diagram, tab or notation I can read and one thing to practise today: {input}"),
  p("metronome", "learn", ["session", "any"], "How do I use the metronome?", "Show me how to practise with a metronome at my level: what tempo to start at, what to count, and when to speed up."),
  p("practise-well", "learn", ["start", "any"], "How should I practise?", "Give me the few habits that will make my practice work at my level and with the time I have. Keep it to five lines."),
  p("quiz-fretboard", "learn", ["any"], "Quiz me on the fretboard", "Quiz me on the fretboard, one question at a time, starting where I am. Tell me if I am right, then ask the next. Stop after five."),
  p("quiz-theory", "learn", ["any"], "Quiz me on theory", "Quiz me on the music theory I need for what I am playing, one question at a time. Tell me if I am right, then ask the next. Stop after five."),
  p("tune", "learn", ["start", "any"], "How do I tune my instrument?", "Walk me through tuning my instrument with the app's tuner, and what to do when a string will not settle."),
  p("setup", "learn", ["any"], "Strings, setup and care", "Help me with setting up, restringing or looking after my guitar. What I want to know: {input}"),

  // review
  p("review-week", "review", ["start", "review"], "Review my last week", "Review my logs from the last seven days: what improved, what did not, and the one thing to change this week. Adjust the plan if the logs call for it."),
  p("last-session", "review", ["review", "start"], "What did my last session show?", "Read my most recent log. What does it show, and what exactly should I do first next time? Set that as the plan's next instruction."),
  p("progress", "review", ["start", "any"], "Am I making progress?", "Look at all my logs. Am I making progress toward my goal? Show me the evidence in two or three lines and be honest."),
];

/** What the app asks the coach when something happens. `mode` here is the default. */
export const ACTIONS: AutoAction[] = [
  {
    id: "onboarding",
    when: "After you fill in the setup form",
    offer: "Build my plan",
    mode: "auto",
    text: "I have just filled in my profile. Read profile.json, then replace the starter plan with one that fits me: archive the starter first. Find three to five good starting materials on the web for my level and what I want to play, add them to my materials and name the best ones in the plan. If you cannot search the web, write one lesson sheet for my first session instead. Then tell me in a few lines what the plan is and what to do first.",
  },
  {
    id: "material-added",
    when: "After you add material",
    offer: "Work it into my plan",
    mode: "auto",
    text: "I added {names}. Look at them and work them into my plan where they fit; tell me what you changed.",
  },
  {
    id: "session-logged",
    when: "After you log a session",
    offer: "Review this session",
    mode: "auto",
    text: "I just logged a session: {log}. Review it against my recent logs, set the next instruction in the plan, and adjust the plan if the log calls for it. Answer in two or three lines.",
  },
  {
    id: "plan-complete",
    when: "When you finish a plan",
    offer: "Plan what comes next",
    mode: "ask",
    text: "I have done every session in my plan. Review the whole plan's logs: what I can do now, what is still weak. Then propose what comes next in a few lines. Wait for my answer before you write the new plan.",
  },
  {
    id: "pain",
    when: "When you stop for pain or tension",
    offer: "Get advice",
    mode: "auto",
    text: "I stopped my session because of pain or tension ({summary}). Tell me what to do now and before I next play, and lighten the plan so it does not happen again.",
  },
  {
    id: "back-after-break",
    when: "When you come back after a break",
    offer: "Ease me back in",
    mode: "ask",
    text: "It has been {days} days since my last session. Ease me back in: tell me what to do today, and adjust the plan if I should step back.",
  },
  {
    id: "profile-changed",
    when: "After you change your profile",
    offer: "Adjust my plan",
    mode: "ask",
    text: "I changed my profile. Read profile.json and adjust the plan to fit; tell me what you changed.",
  },
];

const MODES: readonly ActionMode[] = ["auto", "ask", "off"];
const CUSTOM_KEY = "prompts.custom";
const ACTIONS_KEY = "prompts.actions";
export const CUSTOM_MAX = 30;
const LABEL_MAX = 60;
const TEXT_MAX = 2000;

function stored<T>(db: DatabaseSync, key: string, fallback: T): T {
  try {
    const v = JSON.parse(getSetting(db, key) ?? "null");
    return v === null || typeof v !== "object" ? fallback : v;
  } catch {
    return fallback;
  }
}

/** Custom prompts as stored; anything malformed in the settings table is dropped. */
function customPrompts(db: DatabaseSync): Prompt[] {
  const v = stored<unknown>(db, CUSTOM_KEY, []);
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is { label: string; text: string } => typeof x?.label === "string" && typeof x?.text === "string")
    .slice(0, CUSTOM_MAX)
    .map((x, i) => ({ id: `mine-${i + 1}`, label: x.label, text: x.text, group: "mine", screens: ["any"], custom: true }));
}

export function listPrompts(db: DatabaseSync): { prompts: Prompt[]; actions: AutoAction[] } {
  const modes = stored<Record<string, unknown>>(db, ACTIONS_KEY, {});
  return {
    prompts: [...PROMPTS, ...customPrompts(db)],
    actions: ACTIONS.map((a) => {
      const m = modes[a.id];
      return { ...a, mode: MODES.includes(m as ActionMode) ? (m as ActionMode) : a.mode };
    }),
  };
}

/** The start of `text` as a button label: whole words where they fit, with "…" when it was cut. */
export function autoLabel(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= LABEL_MAX) return flat;
  const head = flat.slice(0, LABEL_MAX - 1);
  const space = head.lastIndexOf(" ");
  return `${(space > LABEL_MAX / 2 ? head.slice(0, space) : head).replace(/[\s.,;:!?-]+$/, "")}…`;
}

export function parseCustom(input: unknown): { label: string; text: string }[] {
  const list = (input as { prompts?: unknown })?.prompts;
  if (!Array.isArray(list)) throw new HttpError(400, "prompts must be an array");
  if (list.length > CUSTOM_MAX) throw new HttpError(400, `at most ${CUSTOM_MAX} prompts`);
  return list.map((x, i) => {
    const label = typeof x?.label === "string" ? x.label.replace(/\s+/g, " ").trim() : "";
    const text = typeof x?.text === "string" ? x.text.trim() : "";
    if (!text) throw new HttpError(400, `prompt ${i + 1} has no text`);
    if (text.length > TEXT_MAX) throw new HttpError(400, `prompt ${i + 1} is longer than ${TEXT_MAX} characters`);
    // A prompt saved without a label is named by how it starts.
    return { label: label ? label.slice(0, LABEL_MAX) : autoLabel(text), text };
  });
}

export function parseActionModes(input: unknown): Partial<Record<ActionId, ActionMode>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new HttpError(400, "expected an object of action modes");
  const out: Partial<Record<ActionId, ActionMode>> = {};
  for (const [id, mode] of Object.entries(input)) {
    const action = ACTIONS.find((a) => a.id === id);
    if (!action) throw new HttpError(400, `unknown action: ${id}`);
    if (!MODES.includes(mode as ActionMode)) throw new HttpError(400, `${id}: the mode must be auto, ask or off`);
    out[action.id] = mode as ActionMode;
  }
  return out;
}

/** The selectable prompts and automatic actions. The personal mode has none. */
export function promptRoutes(db: DatabaseSync, mode: "personal" | "generic"): void {
  if (mode === "personal") {
    route("GET", "/api/prompts", (_req, res) => send(res, 200, { prompts: [], actions: [] }));
    return;
  }
  route("GET", "/api/prompts", (_req, res) => send(res, 200, listPrompts(db)));
  route("PUT", "/api/prompts/custom", async (req, res) => {
    setSetting(db, CUSTOM_KEY, JSON.stringify(parseCustom(await readJson(req))));
    send(res, 200, listPrompts(db));
  });
  route("PUT", "/api/prompts/actions", async (req, res) => {
    const modes = { ...stored<Record<string, unknown>>(db, ACTIONS_KEY, {}), ...parseActionModes(await readJson(req)) };
    setSetting(db, ACTIONS_KEY, JSON.stringify(modes));
    send(res, 200, listPrompts(db));
  });
}
