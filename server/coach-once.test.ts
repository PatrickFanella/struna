import assert from "node:assert/strict";
import { test } from "node:test";

import { extractJson, guidePrompt, reviewPrompt, sanitizeDraft } from "./coach-once.ts";

test("guidePrompt names the stage and asks for a short spoken note", () => {
  const p = guidePrompt({ title: "Build vocabulary", output: "One pattern from memory", instruction: "G major-blues pattern 1" });
  for (const s of ["Build vocabulary", "One pattern from memory", "G major-blues pattern 1"]) assert.ok(p.includes(s), s);
  assert.match(p, /at most 4 short sentences/i);
});

test("reviewPrompt carries the session facts and asks for JSON only", () => {
  const p = reviewPrompt({ material: "Red River Valley", startTempo: 72, endTempo: 78, subdivision: "eighth notes", cleanPasses: 3, misses: 1, metThree: true, stages: ["Target", "Vocabulary"], recording: null, pain: false, notes: "rushed bar 3" });
  for (const s of ["Red River Valley", "72", "78", "eighth notes", "rushed bar 3", '"target"', '"next"']) assert.ok(p.includes(s), s);
  assert.match(p, /only a JSON object/i);
});

test("extractJson finds the object inside prose or a code fence", () => {
  assert.deepEqual(extractJson('Here you go:\n```json\n{"target":"bars 1–2 at 72","next":"Start at 72."}\n```'), { target: "bars 1–2 at 72", next: "Start at 72." });
  assert.deepEqual(extractJson('{"a":"x } y"}'), { a: "x } y" });
  assert.equal(extractJson("no json here"), null);
});

test("sanitizeDraft keeps only known text fields, trimmed and bounded", () => {
  const d = sanitizeDraft({ target: "  bars 1–2  ", next: "Start at 72.", evil: "x", improvement: 5, failure: "y".repeat(5000) });
  assert.deepEqual(Object.keys(d).sort(), ["failure", "next", "target"]);
  assert.equal(d.target, "bars 1–2");
  assert.equal(d.failure!.length, 600);
});
