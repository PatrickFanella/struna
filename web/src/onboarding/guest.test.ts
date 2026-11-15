import assert from "node:assert/strict";
import { test } from "node:test";
import { freshGuest, guestExercise, readGuest } from "./guest.ts";

test("versioned guest state retains choices/reflection and refuses unknown or malformed state", () => {
  const state = { ...freshGuest(), focus: "rhythm" as const, experience: "returning" as const, step: "done" as const, reflection: "A relaxed hand felt easier" };
  assert.deepEqual(readGuest(JSON.stringify(state)), state);
  assert.deepEqual(readGuest(null), freshGuest());
  assert.equal(readGuest('{"version":2}'), null);
  assert.equal(readGuest("broken"), null);
  assert.equal(readGuest(JSON.stringify({ ...state, focus: "owner-library" })), null);
});
test("every optional focus and experience choice changes the original starter instruction", () => {
  const instructions = new Set<string>();
  for (const focus of ["notes", "rhythm", "chords"] as const) for (const experience of ["new", "returning"] as const) {
    const exercise = guestExercise({ focus, experience });
    assert(exercise.title && exercise.instruction && exercise.music);
    instructions.add(exercise.instruction);
  }
  assert.equal(instructions.size, 6);
});
