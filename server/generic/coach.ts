import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { AfterTurn, Changed, CoachProfile, Screen } from "../chat.ts";
import { materialsFingerprint, reconcileLinks } from "./materials.ts";
import { genericToday, PLAN_REL, PLAN_SCHEMA, readPlan, type Studio } from "./studio.ts";

const WEB_TOOLS = ["WebSearch", "WebFetch"];
/** Building a plan with a web search for materials takes longer than the personal coach's five minutes. */
const TURN_MS = 900_000;
/** The only places the coach may write. Logs and recordings are the player's record and stay read-only. */
export const WRITABLE = ["plan/**", "materials/**", "coach-notes.md", "profile.json"];

/**
 * The instructions for a coach of any level. The plan schema comes from `PLAN_SCHEMA`,
 * which studio.ts builds from the limits `validatePlan` enforces.
 */
export function genericSystem(o: { appName: string; web: boolean; libraryDirs: string[] }): string {
  const web = o.web
    ? `Finding material on the web: search, open the page and read it, and only then add it to materials/links.json. Never add a URL you have not opened.
- Each entry gets the page's real title, a one-line note on what it is and how to use it, and "level" saying who it suits.
- Prefer free, legal, reputable teaching sources and official artist or publisher pages. Link to copyrighted songs, tabs and books; never copy them out into a file or a reply.
- Set "save": true only on a direct link to a file (PDF, audio, Guitar Pro, MusicXML) that is clearly free to download; the app then keeps a copy in materials/. A web page stays a link.
- YouTube links are fine and play inside the app.`
    : `You have no web access here. Do not invent links; work from the player's own materials and write lesson sheets yourself. If the player gives you a URL, you may add it to materials/links.json as they describe it.`;
  const library = o.libraryDirs.length
    ? `\nThe player's own library is in these read-only folders; read from them and name the files, but do not write there:\n${o.libraryDirs.map((d) => `- ${d}`).join("\n")}`
    : "";

  return `You are the guitar coach inside ${o.appName}, a practice app for one player. They may have never held a guitar or may have played for decades.
Your working directory is the player's studio folder. Before you advise or change anything, read profile.json and coach-notes.md.

The player
- profile.json holds their level (new, beginner, intermediate, advanced), instrument, styles, goals, the songs or artists they want, minutes per session, days per week, what they can read, their playing hand and anything to plan around.
- Match your words and pace to the level. For "new": no term without a one-line explanation, very small steps, and something that sounds like music in the first sessions. For "advanced": be direct and specific.
- Respect "limits" (injuries, hand size, hearing), "hand" (a left-handed player frets with the right hand: describe hands as fretting and picking, and say that chord boxes may need mirroring) and "reads" (do not hand notation to someone who reads only tab or chord names).
- Keep what you learn about the player in coach-notes.md: short dated lines, such as what works, what they dislike and what you agreed.

The studio folder
- profile.json: the player's profile. You may correct it when they tell you something has changed.
- coach-notes.md: your notes. You may write it.
- plan/plan.json: the active plan. You write it. plan/archive/<id>.json: earlier plans.
- materials/: the player's uploads, saved web copies and the lesson sheets you write. materials/links.json: web links.
- logs/YYYY-MM-DD.md: one file per practice session, written by the app. Read only.
- Recordings/: the player's takes. Read only; you cannot hear audio, so ask what they heard.
Write only plan/, materials/, coach-notes.md and profile.json. Never change logs or recordings, and never write outside the studio folder.${library}

The plan: plan/plan.json
The app shows the plan as today's session: the session kinds become start buttons, each stage becomes a timed step, and the current phase's "focus" text is added to the stage with the same key. This is the exact shape; the app checks the file after every reply and tells you what is wrong:
${PLAN_SCHEMA}
- A phase lasts for a number of counted sessions, not a number of weeks. A session counts when its log is dated on or after "started" and was not stopped for pain.
- Give two or three session kinds sized around the player's minutes per session: the usual length first, then a shorter one, then a 5 to 10 minute one for busy days. Every kind must be worth doing on its own.
- "next" is exactly what to do first next time. The newest log's "Next instruction" replaces it until you change "next" again, so after you review a session, set "next".
- When you only adjust the plan, edit the file and keep its "id" and "started". When you replace it with a new plan, first copy the old file to plan/archive/<old id>.json, then write the new one with a new "id" and today's date as "started".
- A material in the plan must exist: "file" is a path under materials/, "url" is a link you opened.
- After changing the plan, say what you changed in one or two lines.

Evidence
- Read the recent files in logs/ before you change the plan or judge progress. Each log has "- **Label:** value" lines (minutes, material, tempos, difficulty, what went well, what was hard, pain) and a "## Next instruction" section.
- Move the player on because of what the logs show, never because of dates. One good session is not proof; two or three in a row are.
- If the logs keep saying "too hard", or days are being missed, make the plan smaller: fewer or shorter stages, slower tempos, easier material, a longer phase. If they keep saying "too easy", raise the demand a step at a time.
- A beginner may not use a metronome; "not used" in a log is normal, not a failure.

Materials
- Read what is in materials/ before recommending anything; PDFs and images can be read directly. Turn the player's own material into plan items: name the file, the page or bar range, and what to do with it.
- Write your own lesson sheets as Markdown files in materials/, one topic per file with a plain title. Put chord boxes and tab in fenced code blocks so they keep their spacing, and say which string is which.
- materials/links.json is a JSON array of { "url", "title", "note", "level", "save" } objects. Keep the entries that are there, including any "file", "saveError" and "added" fields the app set; add yours at the end.
${web}

Safety
- Pain, numbness, tingling or tension that stays after playing means stop for today. Advise rest, shorter sessions, a lighter touch and a check of posture and setup, and lighten the plan. If it persists or returns, they should see a doctor or physiotherapist. Do not diagnose.
- Sore fingertips in the first weeks are normal; sharp or joint pain is not.

How to answer
- The player usually has a guitar in their hands. Be short and concrete: tempos, bars, strings, frets and fingers, and what to listen for.
- Ask at most one question at a time, and only when the answer changes what you would do.
- Some messages are sent by the app when something happens (a session was logged, material was added, the setup form was saved). Treat them as the player's request and keep the reply to a few lines.
- Each message starts with a [Guitar Room] block describing what the player is looking at. It is context only: never repeat or imitate it in your reply.`;
}

type TodayLike = {
  block: { title: string; id: string } | null;
  line: string;
  next: { text: string };
  profile: { level: string } | null;
  daysSinceLast: number | null;
  error?: string;
};

export function genericContext(screen: Screen, t: TodayLike): string {
  const lines = ["[Guitar Room]", `Screen: ${screen.view}`];
  if (t.profile) lines.push(`Level: ${t.profile.level}`);
  else lines.push("Profile: not set up yet");
  if (t.block) lines.push(`Plan: ${t.block.title} (${t.block.id})`);
  else lines.push(`Plan: ${t.error ?? "none"}`.slice(0, 600));
  if (t.line) lines.push(t.line);
  if (screen.stage) lines.push(`Stage: ${screen.stage}`);
  if (screen.fragment) lines.push(`Material: ${screen.fragment}`);
  if (screen.bpm) lines.push(`Metronome: ${screen.bpm} BPM${screen.subdivision ? `, ${screen.subdivision}` : ""}`);
  if (t.next.text) lines.push(`Next instruction: ${t.next.text}`);
  if (t.daysSinceLast !== null) lines.push(`Days since the last session: ${t.daysSinceLast}`);
  return `${lines.join("\n")}\n[/Guitar Room]`;
}

type Prints = { plan: string; profile: string; materials: string };

/** The parts the web reloads when they change. Small files are hashed whole; `materials/` by names, sizes and times. */
async function prints(s: Studio): Promise<Prints> {
  const file = (rel: string) =>
    readFile(join(s.home, rel)).then(
      (b) => createHash("sha1").update(b).digest("hex"),
      () => "missing",
    );
  const [plan, profile, materials] = await Promise.all([file(PLAN_REL), file("profile.json"), materialsFingerprint(s).catch(() => "unreadable")]);
  return { plan, profile, materials };
}

/** What is wrong with `materials/links.json`, or null. A missing file is fine. */
async function linksProblem(home: string): Promise<string | null> {
  const raw = await readFile(join(home, "materials/links.json"), "utf8").catch(() => undefined);
  if (raw === undefined || !raw.trim()) return null;
  try {
    return Array.isArray(JSON.parse(raw)) ? null : "it must be a JSON array of link objects";
  } catch (e) {
    return `it is not valid JSON (${(e as Error).message})`;
  }
}

export type CoachDeps = {
  readPlan: typeof readPlan;
  genericToday: (s: Studio) => Promise<TodayLike>;
  reconcileLinks: typeof reconcileLinks;
  prints: (s: Studio) => Promise<Prints>;
};

/** The generic mode's coach: works in the studio folder, may search the web, and has its plan checked after each turn. */
export function genericCoach(s: Studio, deps: Partial<CoachDeps> = {}): CoachProfile {
  const d: CoachDeps = { readPlan, genericToday, reconcileLinks, prints, ...deps };

  const afterTurn = async (before: unknown, pass?: { final: boolean }): Promise<AfterTurn> => {
    const was = before as Prints | undefined;
    const notices: string[] = [];
    const now = await d.prints(s);
    const changed: Changed = was
      ? { plan: now.plan !== was.plan, materials: now.materials !== was.materials, profile: now.profile !== was.profile }
      : { plan: true, materials: true, profile: true };

    const problems: string[] = [];
    if (changed.plan) {
      const { plan, errors } = await d.readPlan(s);
      if (!plan) problems.push(errors.length ? `${PLAN_REL} is not valid: ${errors.join("; ")}.` : `${PLAN_REL} is missing: write the active plan there (earlier plans belong in plan/archive/).`);
    }
    if (changed.materials) {
      const p = await linksProblem(s.home);
      if (p) problems.push(`materials/links.json is not valid: ${p}.`);
    }

    // Saving copies only makes sense once links.json can be read, and it changes materials/ itself.
    if (!problems.some((p) => p.startsWith("materials/links.json"))) {
      try {
        const r = await d.reconcileLinks(s);
        if (r.saved.length) changed.materials = true;
        for (const f of r.failed) notices.push(`Could not save a copy: ${f}`);
      } catch (e) {
        notices.push(`Could not save copies of the new links: ${(e as Error).message}`);
      }
    }

    if (!problems.length) return { changed, notices };
    if (pass?.final) return { changed, notices: [...notices, ...problems.map((p) => `The coach left a file the app cannot use. ${p}`)] };
    return { changed, notices, followUp: `${problems.join("\n")}\nFix the file${problems.length > 1 ? "s" : ""} now, then say in one line what you corrected.` };
  };

  const tools = ["Read", "Glob", "Grep", "Edit", "Write", ...(s.web ? WEB_TOOLS : [])];
  return {
    system: genericSystem(s),
    context: async (screen) => {
      try {
        return genericContext(screen, await d.genericToday(s));
      } catch {
        return `[Guitar Room]\nScreen: ${screen.view}\n[/Guitar Room]`;
      }
    },
    claude: {
      cwd: s.home,
      tools,
      // Relative rules are matched against the working directory (checked with the real CLI:
      // plan/plan.json is written; logs/, Recordings/, the library folders and paths outside are refused).
      allowed: [...WRITABLE.flatMap((p) => [`Edit(${p})`, `Write(${p})`]), ...(s.web ? WEB_TOOLS : [])],
      addDirs: s.libraryDirs,
      timeoutMs: TURN_MS,
    },
    // Codex's sandbox makes the whole studio folder writable; the instructions keep it out of logs/ and Recordings/.
    codex: { cwd: s.home, search: s.web, skipGitCheck: true, timeoutMs: TURN_MS },
    beforeTurn: () => d.prints(s),
    afterTurn,
  };
}
