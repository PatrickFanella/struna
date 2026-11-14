import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { countSessions, type LogFacts, nextInstruction, parseLog, placeSession, readLogs } from "./sessions.ts";

const practice = join(import.meta.dirname, "fixtures/vault/001 Projects/Threads/Guitar/Practice");
const realLog = readFileSync(join(practice, "Logs/Practice Log - 2026-08-26.md"), "utf8");

const log = (lines: string, next = "Start at 76 BPM with bars 1–2; listen for even eighths.") =>
  `---\ntitle: x\n---\n\n# Practice Log\n\n${lines}\n\n## Next instruction\n\n${next}\n`;

test("the real 2026-08-26 log has a placeholder tempo", () => {
  const f = parseLog("Practice Log - 2026-08-26.md", realLog);
  assert.equal(f.date, "2026-08-26");
  assert.equal(f.cleanTempo, null);
  assert.equal(f.pain, false);
  assert.equal(f.nextInstruction, null);
});

test("clean tempo parsing", () => {
  assert.equal(parseLog("Practice Log - 2026-11-13.md", log("- **Clean working tempo:** 84 BPM, eighth notes")).cleanTempo, 84);
  assert.equal(parseLog("Practice Log - 2026-11-13.md", log("- **Clean working tempo:** ___ BPM, ___ subdivision")).cleanTempo, null);
  assert.equal(parseLog("Practice Log - 2026-11-13.md", log("- **Clean working tempo:**")).cleanTempo, null);
  assert.equal(parseLog("Practice Log - 2026-11-13.md", log("- **Clean working tempo:** ___ BPM, 1/16 subdivision")).cleanTempo, null);
  assert.equal(parseLog("Practice Log - 2026-11-13.md", log("- **Clean working tempo:** about 80 BPM")).cleanTempo, null);
  assert.equal(parseLog("Practice Log - 2026-11-13.md", log("- **Clean working tempo:** 92bpm, 16ths")).cleanTempo, 92);
});

test("session kind and pain flag", () => {
  assert.equal(parseLog("Practice Log - 2026-11-13.md", log("- **Session:** connect, floor")).kind, "floor");
  assert.equal(parseLog("Practice Log - 2026-11-13.md", log("- **Session:** decode, full")).kind, "full");
  assert.equal(parseLog("Practice Log - 2026-11-13.md", log("- **Session:** cross-training")).kind, "cross-training");
  assert.equal(parseLog("Practice Log - 2026-11-13.md", log("- **Pain, numbness, or persistent tension:** yes — stop")).pain, true);
  assert.equal(parseLog("Practice Log - 2026-11-13.md", log("- **Pain, numbness, or persistent tension:** no / yes — stop")).pain, false);
});

test("the file name gives the date, with an optional suffix", () => {
  assert.equal(parseLog("Practice Log - 2026-11-13 (2).md", log("")).date, "2026-11-13");
});

test("countSessions keeps only evidenced sessions in the block", () => {
  const base: LogFacts = { file: "a", date: "2026-11-10", cleanTempo: 80, kind: "full", pain: false, nextInstruction: null };
  const logs: LogFacts[] = [
    base,
    { ...base, file: "b", kind: "floor" },
    { ...base, file: "c", cleanTempo: null },
    { ...base, file: "d", pain: true },
    { ...base, file: "e", kind: "cross-training" },
    { ...base, file: "f", date: "2026-08-01" },
  ];
  const r = countSessions(logs, "2026-08-06");
  assert.deepEqual(r.counted.map((l) => l.file), ["a", "b"]);
  assert.equal(r.full, 1);
  assert.equal(r.floor, 1);
});

test("placeSession maps counts to week and type", () => {
  assert.deepEqual(placeSession(0), { week: 1, sessionInWeek: 1, type: "decode", number: 1 });
  assert.equal(placeSession(2).type, "connect");
  assert.equal(placeSession(4).type, "vary");
  assert.equal(placeSession(6).type, "prove");
  assert.deepEqual(placeSession(7), { week: 2, sessionInWeek: 1, type: "decode", number: 8 });
  assert.equal(placeSession(40).week, 4);
  const o = placeSession(0, 3);
  assert.equal(o.week, 3);
  assert.equal(o.sessionInWeek, 1);
});

test("nextInstruction prefers the newer of the log and the ledger", () => {
  const ledger = { nextEvidence: "establish a clean working tempo", lastReview: "2026-08-06" };
  const l: LogFacts = { file: "a", date: "2026-11-10", cleanTempo: 80, kind: "full", pain: false, nextInstruction: "Start at 82 BPM." };
  assert.deepEqual(nextInstruction([l], ledger), { text: "Start at 82 BPM.", source: "log" });
  assert.deepEqual(nextInstruction([{ ...l, date: "2026-08-01" }], ledger), { text: "establish a clean working tempo", source: "ledger" });
  assert.deepEqual(nextInstruction([], ledger), { text: "establish a clean working tempo", source: "ledger" });
});

test("readLogs reads the fixture log folder", async () => {
  const logs = await readLogs(practice);
  assert.equal(logs.length, 1);
  assert.equal(countSessions(logs, "2026-08-06").counted.length, 0);
});
