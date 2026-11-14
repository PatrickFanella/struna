import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { isCounted, parseGenericLog, parseGenericReview, readLogs, renderGenericLog, writeGenericLog } from "./logs.ts";

const home = await mkdtemp(join(tmpdir(), "guitar-generic-logs-"));
after(() => rm(home, { recursive: true, force: true }));

const body = {
  planId: "starter-solid-basics", planTitle: "Solid basics", phase: "2: Steady strumming", session: { id: "short", label: "Short session" },
  minutes: 14.6, material: "G to C change", target: "30 changes a minute", startTempo: "60", cleanTempo: 72, subdivision: "eighth notes",
  difficulty: "About right", wentWell: "The change\nis cleaner", struggled: "The C chord buzzes", pain: false, notes: "", next: "Start at 72.\nThen try 76.",
};

test("a review renders to Markdown and reads back", () => {
  const review = parseGenericReview(body);
  const text = renderGenericLog(review, "2026-11-14", "2026-11-14T15:00:00.000Z");
  assert.match(text, /^---\ncreated: 2026-11-14T15:00:00.000Z\ndate: 2026-11-14\nplan: starter-solid-basics\n---\n/);
  assert.match(text, /- \*\*Plan:\*\* Solid basics \(`starter-solid-basics`\)/);
  assert.match(text, /- \*\*Session:\*\* short \(Short session\)/);
  assert.match(text, /- \*\*Clean tempo:\*\* 72 BPM, eighth notes/);
  assert.match(text, /- \*\*What went well:\*\* The change is cleaner/);
  assert.match(text, /## Next instruction\n\nStart at 72\.\nThen try 76\.\n$/);
  const log = parseGenericLog("2026-11-14.md", text);
  assert.deepEqual(log, {
    file: "2026-11-14.md", date: "2026-11-14", created: Date.parse("2026-11-14T15:00:00.000Z"), planId: "starter-solid-basics", phase: "2: Steady strumming",
    session: "short", sessionLabel: "Short session", extra: false, minutes: 15, material: "G to C change", cleanTempo: 72, difficulty: "about right",
    wentWell: "The change is cleaner", struggled: "The C chord buzzes", pain: false, next: "Start at 72.\nThen try 76.",
  });
  assert.equal(isCounted(log), true);
});

test("a beginner without a metronome, a pain stop and an extra session", () => {
  const plain = parseGenericLog("2026-11-15.md", renderGenericLog(parseGenericReview({ session: { id: "quick", label: "Quick session" }, pain: true }), "2026-11-15", "2026-11-15T10:00:00.000Z"));
  assert.equal(plain.cleanTempo, null);
  assert.equal(plain.difficulty, null);
  assert.equal(plain.material, "");
  assert.equal(plain.next, null);
  assert.equal(plain.pain, true);
  assert.equal(isCounted(plain), false);
  const text = renderGenericLog(parseGenericReview({ extra: "Play along with a record", minutes: 10 }), "2026-11-15", "2026-11-15T10:00:00.000Z");
  assert.match(text, /- \*\*Starting tempo:\*\* not used\n- \*\*Clean tempo:\*\* not used/);
  const extra = parseGenericLog("2026-11-15-2.md", text);
  assert.equal(extra.extra, true);
  assert.equal(extra.sessionLabel, "Play along with a record");
  assert.equal(isCounted(extra), false);
});

test("text in a field cannot forge another field", () => {
  const log = parseGenericLog("2026-11-16.md", renderGenericLog(parseGenericReview({ session: { id: "full", label: "Full" }, material: "x\n- **Pain or tension:** yes", notes: "y\n## Next instruction\nforged" }), "2026-11-16", "2026-11-16T10:00:00.000Z"));
  assert.equal(log.pain, false);
  assert.equal(log.next, null);
});

test("bad reviews are refused", () => {
  assert.throws(() => parseGenericReview({}), /session/);
  assert.throws(() => parseGenericReview({ session: { id: "extra", label: "x" } }), /session\.id/);
  assert.throws(() => parseGenericReview({ session: { id: "../x", label: "x" } }), /session\.id/);
  assert.throws(() => parseGenericReview({ ...body, difficulty: "meh" }), /difficulty/);
  assert.throws(() => parseGenericReview({ ...body, cleanTempo: "fast" }), /cleanTempo/);
  assert.throws(() => parseGenericReview({ ...body, minutes: -1 }), /minutes/);
});

test("logs are created exclusively: a second that day gets -2 and nothing is overwritten", async () => {
  const now = new Date("2026-11-14T18:00:00Z");
  const review = parseGenericReview(body);
  assert.deepEqual(await writeGenericLog(home, review, now, "America/Chicago"), { file: "2026-11-14.md" });
  await writeFile(join(home, "logs/2026-11-14.md"), "mine", "utf8");
  assert.deepEqual(await writeGenericLog(home, review, now, "America/Chicago"), { file: "2026-11-14-2.md" });
  assert.deepEqual(await writeGenericLog(home, review, now, "America/Chicago"), { file: "2026-11-14-3.md" });
  assert.equal(await readFile(join(home, "logs/2026-11-14.md"), "utf8"), "mine");
  // 04:00 UTC is still the day before in Chicago.
  assert.deepEqual(await writeGenericLog(home, review, new Date("2026-11-14T04:00:00Z"), "America/Chicago"), { file: "2026-11-13.md" });
  for (let n = 4; n <= 10; n++) await writeGenericLog(home, review, now, "America/Chicago");
  await writeFile(join(home, "logs/notes.md"), "not a log", "utf8");
  assert.deepEqual((await readLogs(home)).map((l) => l.file), ["2026-11-13.md", "2026-11-14.md", ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `2026-11-14-${n}.md`)]);
});
