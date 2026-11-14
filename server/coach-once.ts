import type { DatabaseSync } from "node:sqlite";

import { buildContext, type CoachProfile, personalCoach, PROVIDERS, type Screen, SYSTEM } from "./chat.ts";
import type { HostProvider as Provider } from "./conversations.ts";
import { getSetting } from "./db.ts";
import { HttpError, readJson, route, send } from "./http.ts";
import { type Paths, today } from "./practice.ts";

export type StageInfo = { title: string; output: string; instruction: string };
export type SessionFacts = {
  material: string;
  startTempo: number;
  endTempo: number;
  subdivision: string;
  cleanPasses: number;
  misses: number;
  metThree: boolean;
  stages: string[];
  recording: string | null;
  pain: boolean;
  notes: string;
};
export const DRAFT_FIELDS = ["target", "improvement", "failure", "next", "observation"] as const;
export type Draft = Partial<Record<(typeof DRAFT_FIELDS)[number], string>>;

export function guidePrompt(stage: StageInfo): string {
  return `The owner has just reached this stage of today's practice session and is holding the guitar.
Stage: ${stage.title}
Required output: ${stage.output}
What the plan says for this stage: ${stage.instruction}

Guide them through it in at most 4 short sentences: what to play first, the tempo and subdivision to start at when the notes give one, and what to listen or watch for. Use the block note, the progress ledger and the latest log if you need them; do not edit any file. Plain sentences only: no heading, no list, no preamble.`;
}

export function reviewPrompt(f: SessionFacts): string {
  return `Draft the end-of-session review sheet from these facts. You could not hear the playing, so claim nothing you cannot know: describe only what the facts support, and leave a field as an empty string when they say nothing about it.
Material: ${f.material || "not recorded"}
Tempo at the start: ${f.startTempo} BPM. Tempo at the end: ${f.endTempo} BPM, ${f.subdivision}.
Clean passes logged: ${f.cleanPasses}. Misses logged: ${f.misses}. Three clean passes in a row: ${f.metThree ? "yes" : "no"}.
Stages reached: ${f.stages.join(", ") || "none"}.
Recording: ${f.recording ?? "none"}.
Stopped for pain or tension: ${f.pain ? "yes" : "no"}.
The owner's own notes: ${f.notes || "none"}

Reply with only a JSON object, no prose and no code fence, with these string fields:
"target": one sentence naming the fragment, tempo and quality aimed for.
"improvement": one improvement the facts support.
"failure": one limiting failure the facts support.
"next": the next instruction, in the form "Start at N BPM, <subdivision>, with <fragment>; listen for <one thing>."
"observation": one neutral sentence summarising the session.
Do not edit any file.`;
}

/** The first balanced JSON object in a reply, ignoring braces inside strings. */
export function extractJson(text: string): Record<string, unknown> | null {
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try {
          const v = JSON.parse(text.slice(start, i + 1));
          if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
        } catch {
          /* not JSON from here; try the next brace */
        }
        break;
      }
    }
  }
  return null;
}

export function sanitizeDraft(v: Record<string, unknown>): Draft {
  const out: Draft = {};
  for (const k of DRAFT_FIELDS) {
    const s = v[k];
    if (typeof s === "string" && s.trim()) out[k] = s.replace(/\s+/g, " ").trim().slice(0, 600);
  }
  return out;
}

/** One question to the coach outside any saved conversation; throws with the CLI's own error text. */
async function askCoach(coach: CoachProfile, provider: Provider, prompt: string, signal: AbortSignal): Promise<string> {
  let text = "";
  for await (const ev of PROVIDERS[provider](coach)({ system: SYSTEM, prompt, signal })) {
    if (ev.type === "delta") text += ev.text;
    else if (ev.type === "error") throw new HttpError(502, ev.message);
  }
  if (!text.trim()) throw new HttpError(502, "the coach returned nothing");
  return text.trim();
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

export function coachOnceRoutes(paths: Paths & { mediaRoot: string }, db: DatabaseSync): void {
  const coach = personalCoach(paths, db);
  const providerOf = (v: unknown): Provider => (v === "codex" || v === "claude" ? v : getSetting(db, "provider") === "codex" ? "codex" : "claude");
  const withAbort = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
    const abort = new AbortController();
    res.on("close", () => !res.writableEnded && abort.abort());
    void req;
    return abort;
  };

  route("POST", "/api/coach/guide", async (req, res) => {
    const input = await readJson(req);
    const stage: StageInfo = { title: str(input.stage?.title, 200), output: str(input.stage?.output, 400), instruction: str(input.stage?.instruction, 2000) };
    if (!stage.title) throw new HttpError(400, "stage required");
    const screen: Screen = { view: "practice session", stage: stage.title, ...(str(input.fragment, 300) ? { fragment: str(input.fragment, 300) } : {}), ...(Number.isFinite(input.bpm) ? { bpm: Number(input.bpm) } : {}), ...(str(input.subdivision, 60) ? { subdivision: str(input.subdivision, 60) } : {}) };
    const context = buildContext(screen, await today(paths, db));
    const text = await askCoach(coach, providerOf(input.provider), `${context}\n\n${guidePrompt(stage)}`, withAbort(req, res).signal);
    send(res, 200, { text: text.slice(0, 1200) });
  });

  route("POST", "/api/coach/review", async (req, res) => {
    const input = await readJson(req);
    const f = input.facts ?? {};
    const facts: SessionFacts = {
      material: str(f.material, 300),
      startTempo: Number(f.startTempo) || 0,
      endTempo: Number(f.endTempo) || 0,
      subdivision: str(f.subdivision, 60),
      cleanPasses: Number(f.cleanPasses) || 0,
      misses: Number(f.misses) || 0,
      metThree: f.metThree === true,
      stages: Array.isArray(f.stages) ? f.stages.map((s: unknown) => str(s, 80)).slice(0, 8) : [],
      recording: str(f.recording, 300) || null,
      pain: f.pain === true,
      notes: str(f.notes, 2000),
    };
    const context = buildContext({ view: "session review", ...(facts.material ? { fragment: facts.material } : {}) }, await today(paths, db));
    const reply = await askCoach(coach, providerOf(input.provider), `${context}\n\n${reviewPrompt(facts)}`, withAbort(req, res).signal);
    const json = extractJson(reply);
    if (!json) throw new HttpError(502, "the coach did not return a review sheet");
    send(res, 200, { draft: sanitizeDraft(json) });
  });
}
