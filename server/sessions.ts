import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseFrontMatter } from "./frontmatter.ts";
import { sections, type Ledger } from "./vault.ts";

export type LogFacts = {
  file: string;
  date: string;
  cleanTempo: number | null;
  kind: "full" | "floor" | "cross-training" | null;
  pain: boolean;
  nextInstruction: string | null;
};
export type SessionType = "decode" | "connect" | "vary" | "prove";

export const LOG_NAME = /^Practice Log - (\d{4}-\d{2}-\d{2})(?: \((\d+)\))?\.md$/;

function value(body: string, label: string): string {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*-\\s*\\*\\*${esc}:\\*\\*[ \\t]*(.*)$`, "mi").exec(body)?.[1]?.trim() ?? "";
}

export function parseLog(file: string, text: string): LogFacts {
  const { body } = parseFrontMatter(text);
  const date = LOG_NAME.exec(file)?.[1] ?? "";
  const tempo = /\d+/.exec(value(body, "Clean working tempo"))?.[0];
  const n = tempo ? Number(tempo) : 0;
  const session = value(body, "Session").toLowerCase();
  const kind = /cross-training/.test(session) ? "cross-training" : /\bfloor\b/.test(session) ? "floor" : /\bfull\b/.test(session) ? "full" : null;
  const next = sections(body).find((s) => /^Next instruction/i.test(s.heading))?.text.trim() ?? "";
  return {
    file,
    date,
    cleanTempo: n > 0 ? n : null,
    kind,
    pain: /^yes\b/i.test(value(body, "Pain, numbness, or persistent tension")),
    // The template's blank line ("Start at ___ BPM ...") is not an instruction.
    nextInstruction: next && !next.includes("___") ? next : null,
  };
}

/** A session counts when its log is in the block, has a clean working tempo, and was not stopped for pain. Cross-training is logged but not counted. */
export function countSessions(logs: LogFacts[], blockStarted: string): { full: number; floor: number; counted: LogFacts[] } {
  const counted = logs
    .filter((l) => l.date >= blockStarted && l.cleanTempo !== null && !l.pain && l.kind !== "cross-training")
    .sort((a, b) => a.date.localeCompare(b.date) || a.file.localeCompare(b.file, undefined, { numeric: true }));
  const floor = counted.filter((l) => l.kind === "floor").length;
  return { full: counted.length - floor, floor, counted };
}

const TYPES: SessionType[] = ["decode", "decode", "connect", "connect", "vary", "vary", "prove"];

export function placeSession(counted: number, weekOverride?: number): { week: number; sessionInWeek: number; type: SessionType; number: number } {
  const sessionInWeek = (counted % 7) + 1;
  const week = weekOverride ?? Math.min(4, Math.floor(counted / 7) + 1);
  return { week, sessionInWeek, type: TYPES[sessionInWeek - 1]!, number: counted + 1 };
}

export function nextInstruction(counted: LogFacts[], ledger: Ledger): { text: string; source: "log" | "ledger" } {
  const latest = [...counted].reverse().find((l) => l.nextInstruction);
  if (latest?.nextInstruction && (!ledger.lastReview || latest.date > ledger.lastReview)) return { text: latest.nextInstruction, source: "log" };
  return { text: ledger.nextEvidence, source: "ledger" };
}

export async function readLogs(practiceDir: string): Promise<LogFacts[]> {
  const dir = join(practiceDir, "Logs");
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => LOG_NAME.test(n));
  return Promise.all(names.map(async (n) => parseLog(n, await readFile(join(dir, n), "utf8"))));
}
