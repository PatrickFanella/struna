import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDb } from "../db.ts";
import { ACTIONS, CUSTOM_MAX, listPrompts, parseActionModes, parseCustom, PROMPTS } from "./prompts.ts";

const SCREENS = new Set(["start", "session", "review", "materials", "tabs", "any"]);
const GROUPS = new Set(["plan", "session", "material", "find", "learn", "review"]);

test("the built-in prompts are well formed", () => {
  assert.ok(PROMPTS.length >= 25 && PROMPTS.length <= 35, String(PROMPTS.length));
  assert.equal(new Set(PROMPTS.map((p) => p.id)).size, PROMPTS.length);
  assert.equal(new Set(PROMPTS.map((p) => p.label)).size, PROMPTS.length);
  for (const p of PROMPTS) {
    assert.ok(p.label.length <= 32, `${p.id}: label is ${p.label.length} characters`);
    assert.ok(GROUPS.has(p.group), p.id);
    assert.ok(p.screens.length > 0 && p.screens.every((s) => SCREENS.has(s)), p.id);
    const holes = [...p.text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    // The web fills these three from the screen; anything else would be sent as written.
    assert.ok(holes.every((h) => ["material", "stage", "bpm", "input"].includes(h!)), `${p.id}: ${holes}`);
    if (holes.includes("input")) assert.ok(p.text.endsWith("{input}") && holes.filter((h) => h === "input").length === 1, `${p.id}: {input} must end the text`);
    // A prompt that needs the stage or tempo only makes sense during a session.
    if (holes.includes("stage") || holes.includes("bpm")) assert.deepEqual(p.screens, ["session"], p.id);
    if (holes.includes("material")) assert.ok(p.screens.every((s) => s === "session" || s === "materials"), p.id);
  }
});

test("every group and every screen has prompts", () => {
  for (const g of GROUPS) assert.ok(PROMPTS.some((p) => p.group === g), g);
  for (const s of ["start", "session", "review", "materials", "tabs"]) assert.ok(PROMPTS.some((p) => p.screens.includes(s)), s);
});

test("the prompts cover what the spec lists", () => {
  for (const id of ["build-plan", "easier", "harder", "ten-minutes", "missed-week", "listen-for", "explain-material", "steps-material", "exercise", "warm-up", "find-lessons", "find-song", "backing-track", "teach", "read-tab", "hand-hurts", "review-week", "next-plan", "new-material", "quiz-fretboard", "quiz-theory", "tune", "setup"]) {
    assert.ok(PROMPTS.some((p) => p.id === id), id);
  }
});

test("the automatic actions have the agreed defaults and placeholders", () => {
  const modes = Object.fromEntries(ACTIONS.map((a) => [a.id, a.mode]));
  assert.deepEqual(modes, { onboarding: "auto", "material-added": "auto", "session-logged": "auto", "plan-complete": "ask", pain: "auto", "back-after-break": "ask", "profile-changed": "ask" });
  const text = (id: string) => ACTIONS.find((a) => a.id === id)!.text;
  assert.ok(text("material-added").includes("{names}"));
  assert.ok(text("session-logged").includes("{log}"));
  assert.ok(text("pain").includes("{summary}"));
  assert.ok(text("back-after-break").includes("{days}"));
  for (const a of ACTIONS) {
    assert.ok(a.when && a.offer && a.offer.length <= 32, a.id);
    assert.ok([...a.text.matchAll(/\{(\w+)\}/g)].every((m) => ["names", "log", "days", "summary"].includes(m[1]!)), a.id);
  }
});

test("custom prompts and action modes are stored in settings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "guitar-prompts-"));
  try {
    const db = openDb(dir);
    assert.equal(listPrompts(db).prompts.length, PROMPTS.length);
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("prompts.custom", JSON.stringify(parseCustom({ prompts: [{ label: "  Travis  picking ", text: " Drill my thumb. " }, { label: "", text: "Make me a setlist for {input}" }] })));
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("prompts.actions", JSON.stringify(parseActionModes({ onboarding: "off", pain: "ask" })));
    const got = listPrompts(db);
    assert.deepEqual(got.prompts.slice(-2), [
      { id: "mine-1", label: "Travis picking", text: "Drill my thumb.", group: "mine", screens: ["any"], custom: true },
      { id: "mine-2", label: "Make me a setlist for {input}", text: "Make me a setlist for {input}", group: "mine", screens: ["any"], custom: true },
    ]);
    const mode = (id: string) => got.actions.find((a) => a.id === id)!.mode;
    assert.deepEqual([mode("onboarding"), mode("pain"), mode("session-logged")], ["off", "ask", "auto"]);

    // Junk in the settings table falls back to the defaults.
    db.prepare("UPDATE settings SET value = ? WHERE key = ?").run("{not json", "prompts.custom");
    db.prepare("UPDATE settings SET value = ? WHERE key = ?").run('{"onboarding":"sometimes"}', "prompts.actions");
    const again = listPrompts(db);
    assert.equal(again.prompts.length, PROMPTS.length);
    assert.equal(again.actions.find((a) => a.id === "onboarding")!.mode, "auto");
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bad custom prompts and action modes are refused", () => {
  assert.throws(() => parseCustom({}), /array/);
  assert.throws(() => parseCustom({ prompts: [{ label: "x", text: "  " }] }), /no text/);
  assert.throws(() => parseCustom({ prompts: [{ label: "x", text: "y".repeat(2001) }] }), /longer/);
  assert.throws(() => parseCustom({ prompts: Array.from({ length: CUSTOM_MAX + 1 }, () => ({ label: "a", text: "b" })) }), /at most/);
  assert.equal(parseCustom({ prompts: [{ label: "L".repeat(200), text: "t" }] })[0]!.label.length, 60);
  assert.throws(() => parseActionModes({ nonsense: "auto" }), /unknown action/);
  assert.throws(() => parseActionModes({ pain: "maybe" }), /auto, ask or off/);
  assert.throws(() => parseActionModes([]), /object/);
});
