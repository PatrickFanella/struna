import assert from "node:assert/strict";
import { test } from "node:test";

import type { Prompt } from "../generic.ts";
import { fillAction, fillPrompt, promptsFor, screenId } from "./prompts.ts";

const p = (id: string, screens: string[], text: string): Prompt => ({ id, label: id, text, group: "plan", screens });

test("view names map to prompt screens", () => {
  assert.equal(screenId("practice start"), "start");
  assert.equal(screenId("practice setup"), "start");
  assert.equal(screenId("practice session"), "session");
  assert.equal(screenId("session review"), "review");
  assert.equal(screenId("materials"), "materials");
  assert.equal(screenId("tabs"), "tabs");
  assert.equal(screenId("library"), "any");
});

test("placeholders are filled from the screen, and a missing value hides the prompt", () => {
  const ctx = { view: "practice session", stage: "Warm up", fragment: "Blues in A", bpm: 72 };
  assert.deepEqual(fillPrompt('Explain "{material}" at {bpm} BPM during {stage}.', ctx), { text: 'Explain "Blues in A" at 72 BPM during Warm up.', input: false });
  assert.equal(fillPrompt("Explain {material}", { view: "practice start" }), null);
  assert.equal(fillPrompt("At {bpm}", { view: "x", bpm: 0 }), null);
  assert.equal(fillPrompt("About {stage}", { view: "x", stage: "  " }), null);
});

test("a trailing {input} leaves the message for the player to finish", () => {
  assert.deepEqual(fillPrompt("Find lessons for: {input}", { view: "x" }), { text: "Find lessons for: ", input: true });
  assert.deepEqual(fillPrompt("Teach me {input}\n", { view: "x" }), { text: "Teach me ", input: true });
  // Elsewhere in the text it stays visible, and the message still goes to the box, not the coach.
  assert.deepEqual(fillPrompt("Play {input} slowly", { view: "x" }), { text: "Play {input} slowly", input: true });
  assert.deepEqual(fillPrompt("Leave {other} alone", { view: "x" }), { text: "Leave {other} alone", input: false });
});

test("a screen gets its own prompts first, in order, and falls back to the general ones", () => {
  const list = [p("a", ["start"], "A"), p("b", ["session"], "B {stage}"), p("c", ["any"], "C"), p("d", ["session", "any"], "D"), p("e", ["materials"], "E {material}")];
  const session = { view: "practice session", stage: "Warm up" };
  assert.deepEqual(promptsFor(list, "session", session).map((x) => x.id), ["b", "d"]);
  assert.deepEqual(promptsFor(list, "session", session, true).map((x) => x.id), ["b", "d", "a", "c"]);
  // No stage is running, so the stage prompt is hidden.
  assert.deepEqual(promptsFor(list, "session", { view: "practice session" }).map((x) => x.id), ["d"]);
  assert.deepEqual(promptsFor(list, "tabs", { view: "tabs" }).map((x) => x.id), ["c", "d"]);
});

test("action messages take the caller's values and read sensibly without them", () => {
  assert.equal(fillAction("I added {names}.", { names: "Blues in A and a link" }), "I added Blues in A and a link.");
  assert.equal(fillAction("{days} days; log {log}", { days: "9" }), "9 days; log the newest file in logs/");
  assert.equal(fillAction("Stopped ({summary}).", { summary: " " }), "Stopped (no details given).");
});
