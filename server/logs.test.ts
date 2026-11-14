import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { type SessionReview, writeSessionLog } from "./logs.ts";
import { parseLog } from "./sessions.ts";

const now = new Date("2026-11-14T03:30:00Z");
const tz = "America/Chicago";
const review: SessionReview = {
  blockTitle: "G Vocabulary and Nine Pound Hammer — Block 01",
  blockId: "g-vocabulary-nine-pound-hammer-01",
  type: "decode",
  length: "full",
  material: "Aaron Jaxon — Blues Scales, pattern 1",
  target: "pattern 1 from memory at an even 72",
  startTempo: "60",
  cleanTempo: "72",
  subdivision: "eighth notes",
  threePass: "met",
  recall: "page-dependent",
  recording: { path: "Recordings/g-vocabulary-nine-pound-hammer-01/2026-11-13-baseline.webm", label: "baseline", purpose: "first baseline" },
  pain: false,
  improvement: "even pick direction on the string change",
  failure: "the flat 5th slide rushes",
  next: "Start at 72 BPM, eighth notes, with pattern 1; listen for the flat 5th.",
};

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "guitar-logs-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("names the log by the Chicago date and fills the template", async () => {
  const { file } = await writeSessionLog(dir, review, now, tz);
  assert.equal(file, "Practice Log - 2026-11-13.md");
  const text = await readFile(join(dir, "Logs", file), "utf8");
  for (const line of [
    "title: practice-log-2026-11-13",
    "type: thread-note",
    "status: active",
    "created: 2026-11-13",
    "updated: 2026-11-13",
    'threads:\n- "[[Guitar]]"',
    "tags:\n- method/practice-log\n- topic/guitar-practice",
    "# Practice Log — 2026-11-13",
    "Current block: [[001 Projects/Threads/Guitar/Practice/Current Practice Block|Current Practice Block]]",
    "- **Session:** decode, full",
    "- **Starting tempo:** 60 BPM, eighth notes",
    "- **Clean working tempo:** 72 BPM, eighth notes",
    "- **Three-clean-pass rule:** met",
    "- **Recall:** page-dependent",
    "- **Recording:** Recordings/g-vocabulary-nine-pound-hammer-01/2026-11-13-baseline.webm — baseline — first baseline",
    "- **Agent audio assessment:** not assessed",
    "- **Pain, numbness, or persistent tension:** no",
    "- **One improvement:** even pick direction on the string change",
    "- **One limiting failure:** the flat 5th slide rushes",
    "## Next instruction\n\nStart at 72 BPM, eighth notes, with pattern 1; listen for the flat 5th.",
  ]) {
    assert.ok(text.includes(line), `missing: ${line}`);
  }
  // Every labelled line of the template is filled.
  const template = await readFile(join(import.meta.dirname, "fixtures/vault/001 Projects/Threads/Guitar/Practice/Practice Log Template.md"), "utf8");
  for (const m of template.matchAll(/^- \*\*(.+?):\*\*/gm)) {
    const filled = new RegExp(`^- \\*\\*${m[1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\*\\* \\S`, "m");
    assert.match(text, filled, m[1] ?? "");
  }
  // The app's own reader counts it.
  const facts = parseLog(file, text);
  assert.equal(facts.cleanTempo, 72);
  assert.equal(facts.kind, "full");
  assert.equal(facts.nextInstruction, review.next);
});

test("logs are created mode 664, like the owner's, so the shared group can edit them", async () => {
  const old = process.umask(0);
  try {
    const { file } = await writeSessionLog(dir, review, now, tz);
    const { stat } = await import("node:fs/promises");
    assert.equal((await stat(join(dir, "Logs", file))).mode & 0o777, 0o664);
  } finally {
    process.umask(old);
  }
});

test("a second save on the same date gets a suffix", async () => {
  await writeSessionLog(dir, review, now, tz);
  const { file } = await writeSessionLog(dir, review, now, tz);
  assert.equal(file, "Practice Log - 2026-11-13 (2).md");
});

test("concurrent saves never collide", async () => {
  const files = (await Promise.all([1, 2, 3].map(() => writeSessionLog(dir, review, now, tz)))).map((r) => r.file).sort();
  assert.deepEqual(files, ["Practice Log - 2026-11-13 (2).md", "Practice Log - 2026-11-13 (3).md", "Practice Log - 2026-11-13.md"]);
});

test("an existing file is never overwritten", async () => {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(dir, "Logs"));
  await writeFile(join(dir, "Logs", "Practice Log - 2026-11-13.md"), "owner's note");
  const { file } = await writeSessionLog(dir, { ...review, pain: true }, now, tz);
  assert.equal(file, "Practice Log - 2026-11-13 (2).md");
  assert.equal(await readFile(join(dir, "Logs", "Practice Log - 2026-11-13.md"), "utf8"), "owner's note");
  assert.match(await readFile(join(dir, "Logs", file), "utf8"), /persistent tension:\*\* yes — stop/);
  assert.equal((await readdir(join(dir, "Logs"))).length, 2);
});
