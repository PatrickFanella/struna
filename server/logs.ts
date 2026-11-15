import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";

import type { SessionType } from "./sessions.ts";

export type SessionReview = {
  blockTitle: string;
  blockId: string;
  type: SessionType | "cross-training";
  length: "full" | "floor";
  material: string;
  target: string;
  startTempo: string;
  cleanTempo: string;
  subdivision: string;
  threePass: "met" | "not met";
  recall: "memory" | "cue map" | "page-dependent";
  recording?: { path: string; label: "baseline" | "weekly" | "midpoint" | "final"; purpose: string };
  pain: boolean;
  partial?: boolean;
  improvement: string;
  failure: string;
  next: string;
  observation?: string;
  /** Evidence lines; prefilled from the week's block fields when the owner leaves them. */
  vocabulary?: string;
  mechanism?: string;
  gesture?: string;
  application?: string;
  timing?: string;
  tension?: string;
  harmony?: string;
};

/** YYYY-MM-DD in the given time zone. */
export function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** One line of text; empty becomes `fallback`. */
function one(v: string | undefined, fallback = "not recorded"): string {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  return s || fallback;
}

/** Mirrors `Practice Log Template.md` line for line, with every field filled. */
export function renderLog(r: SessionReview, date: string): string {
  const rec = r.recording ? `${one(r.recording.path)} — ${r.recording.label} — ${one(r.recording.purpose, "no purpose given")}` : "not recorded";
  const next = (r.next ?? "").trim() || "not recorded";
  return `---
title: practice-log-${date}
type: thread-note
status: active
created: ${date}
updated: ${date}
threads:
- "[[Guitar]]"
tags:
- method/practice-log
- topic/guitar-practice
---

# Practice Log — ${date}

Current block: [[001 Projects/Threads/Guitar/Practice/Current Practice Block|Current Practice Block]]

- **Block:** ${one(r.blockTitle)} (\`${one(r.blockId)}\`)
- **Session:** ${r.type}, ${r.length}
- **Partial session:** ${r.partial ? "yes (not counted)" : "no"}
- **Material and exact fragment:** ${one(r.material)}
- **Target:** ${one(r.target)}
- **Starting tempo:** ${one(r.startTempo, "___")} BPM, ${one(r.subdivision)}
- **Clean working tempo:** ${one(r.cleanTempo, "___")} BPM, ${one(r.subdivision)}
- **Three-clean-pass rule:** ${r.threePass}
- **Recall:** ${r.recall}

## Evidence

- **Vocabulary:** ${one(r.vocabulary)}
- **Mechanism tested:** ${one(r.mechanism)}
- **Exact failing string change or gesture:** ${one(r.gesture)}
- **Musical application:** ${one(r.application)}
- **Recording:** ${rec}

## Observations

- **My observation:** ${one(r.observation, "none")}
- **Agent audio assessment:** not assessed
- **Timing and tone:** ${one(r.timing)}
- **Tension and coordination:** ${one(r.tension)}
- **Harmony and phrasing:** ${one(r.harmony)}
- **Pain, numbness, or persistent tension:** ${r.pain ? "yes — stop" : "no"}
- **One improvement:** ${one(r.improvement)}
- **One limiting failure:** ${one(r.failure)}

## Next instruction

${next}
`;
}

/**
 * Write a new log under `<practiceDir>/Logs/`. Never opens an existing file:
 * each candidate name is created with `wx`, so a clash moves on to `(2)`, `(3)`…
 */
export async function writeSessionLog(practiceDir: string, review: SessionReview, now: Date, timeZone: string): Promise<{ file: string }> {
  const date = localDate(now, timeZone);
  const dir = join(practiceDir, "Logs");
  await mkdir(dir, { recursive: true });
  const text = renderLog(review, date);
  for (let n = 1; n < 1000; n++) {
    const file = n === 1 ? `Practice Log - ${date}.md` : `Practice Log - ${date} (${n}).md`;
    try {
      // 664 like the owner's own logs, so the shared tree's group (and its default ACL) can edit it.
      const fh = await open(join(dir, file), "wx", 0o664);
      try {
        await fh.writeFile(text);
      } finally {
        await fh.close();
      }
      return { file };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  throw new Error("too many logs for one day");
}
