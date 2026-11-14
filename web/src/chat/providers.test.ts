import assert from "node:assert/strict";
import { test } from "node:test";

import { pickProvider, type ProviderStatus, readiness, unavailable } from "./providers.ts";

const status = (claude: boolean, codex: boolean, last: "claude" | "codex"): ProviderStatus => ({
  claude: { ok: claude, detail: claude ? "claude.ai max" : "spawn /nonexistent/claude ENOENT" },
  codex: { ok: codex, detail: codex ? "Logged in using ChatGPT" : "Not logged in" },
  last,
});

test("a fresh page uses the provider that is signed in", () => {
  assert.equal(pickProvider(status(false, true, "claude")), "codex"); // Only ChatGPT signed in.
  assert.equal(pickProvider(status(true, false, "codex")), "claude");
  assert.equal(pickProvider(status(true, true, "codex")), "codex"); // The last one, when it works.
  assert.equal(pickProvider(status(true, true, "claude")), "claude");
  assert.equal(pickProvider(status(false, false, "codex")), "codex"); // Neither: keep the last, so the notice names it.
});

test("readiness says whether any coach can answer", () => {
  assert.deepEqual(readiness(status(false, true, "claude"), "codex"), { ok: true, detail: "" });
  assert.deepEqual(readiness(status(false, false, "claude"), "claude"), { ok: false, detail: "spawn /nonexistent/claude ENOENT" });
  assert.deepEqual(readiness(null, "claude"), { ok: false, detail: "the coach could not be reached" });
});

test("with no coach, the notes say nothing will change, and the pain note still says rest", () => {
  assert.equal(unavailable("session-logged", "not signed in"), "No coach is signed in (not signed in), so the plan stays as it is.");
  assert.match(unavailable("pain", "not signed in"), /^Rest\. .*was not lightened/);
});
