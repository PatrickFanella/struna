import assert from "node:assert/strict";
import { test } from "node:test";

import { applyEvent, type Msg } from "./stream.ts";

const start: Msg[] = [{ role: "user", text: "hello" }, { role: "assistant", text: "", streaming: true }];
const run = (events: [("delta" | "notice" | "error"), { text?: string; message?: string }][]) => events.reduce((m, [ev, d]) => applyEvent(m, ev, d), start);

test("a notice before the reply reads above it, and the reply stays the coach's", () => {
  const m = run([["notice", { message: "The coach starts fresh." }], ["delta", { text: "Done." }]]);
  assert.deepEqual(m, [{ role: "user", text: "hello" }, { role: "notice", text: "The coach starts fresh." }, { role: "assistant", text: "Done.", streaming: true }]);
});

test("a notice after reply text, and an error, go at the end; later reply text still reaches the reply", () => {
  const m = run([["delta", { text: "Done" }], ["notice", { message: "Saved a copy." }], ["error", { message: "Oops" }], ["delta", { text: "." }]]);
  assert.deepEqual(m.map((x) => [x.role, x.text]), [["user", "hello"], ["assistant", "Done."], ["notice", "Saved a copy."], ["error", "Oops"]]);
});
