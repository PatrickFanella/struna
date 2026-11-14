import assert from "node:assert/strict";
import { test } from "node:test";

import { codeParts, countdown, pickProvider, type ProviderRow, type ProviderStatus, readiness, rows, unavailable } from "./providers.ts";

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

const row = (id: string, ok: boolean): ProviderRow => ({ id, label: id, via: "Codex", setup: "key", ok, detail: ok ? "ready" : "No key saved", web: true, model: null, notes: [] });
const generic = (last: string, ...list: ProviderRow[]): ProviderStatus => ({ ...status(false, false, "claude"), last, list });

test("with the generic mode's list, a fresh page picks the last coach when ready, else the first ready one", () => {
  assert.equal(pickProvider(generic("openai", row("anthropic", true), row("openai", true))), "openai");
  assert.equal(pickProvider(generic("openai", row("anthropic", true), row("openai", false))), "anthropic");
  assert.equal(pickProvider(generic("claude", row("anthropic", false), row("endpoint", true))), "endpoint"); // claude turned off here
  assert.equal(pickProvider(generic("openai", row("anthropic", false), row("openai", false))), "openai"); // none: keep the last
  assert.equal(pickProvider(generic("claude", row("anthropic", false))), "anthropic"); // none, and the last is not offered
  assert.equal(pickProvider(generic("claude")), "claude");
});

test("the legacy two-row shape picks and reads as it always did", () => {
  for (const [a, b, last] of [[false, true, "claude"], [true, false, "codex"], [true, true, "codex"], [false, false, "codex"]] as const) {
    const p = status(a, b, last);
    assert.equal(pickProvider({ ...p, list: rows(p).map((r) => ({ ...row(r.id, r.ok), detail: r.detail })) }), pickProvider(p));
  }
  assert.deepEqual(rows(status(true, false, "claude")).map((r) => [r.id, r.label, r.ok]), [["claude", "Claude", true], ["codex", "ChatGPT", false]]);
});

test("readiness with the list: the current coach must be ready, else say why; with none ready, say none is set up", () => {
  assert.deepEqual(readiness(generic("claude", row("anthropic", false), row("endpoint", true)), "endpoint"), { ok: true, detail: "" });
  // Another coach is ready, but the app's own message would go to this one, which cannot answer.
  assert.deepEqual(readiness(generic("claude", row("anthropic", false), row("endpoint", true)), "anthropic"), { ok: false, detail: "No key saved" });
  assert.deepEqual(readiness(generic("claude", row("endpoint", true)), "claude"), { ok: false, detail: "this conversation's coach is turned off here" });
  assert.deepEqual(readiness(generic("claude", row("anthropic", false)), "anthropic"), { ok: false, detail: "no coach is set up" });
  assert.deepEqual(readiness(generic("claude"), "claude"), { ok: false, detail: "every coach is turned off here" });
});

test("the sign-in countdown and the notes' code", () => {
  const now = Date.parse("2026-11-14T20:00:00Z");
  assert.equal(countdown("2026-11-14T20:15:00Z", now), "15:00");
  assert.equal(countdown("2026-11-14T20:00:09Z", now), "0:09");
  assert.equal(countdown("2026-11-14T19:59:00Z", now), "0:00");
  assert.deepEqual(codeParts("Run `claude auth login` on h."), ["Run ", "claude auth login", " on h."]);
});
