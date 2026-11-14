import assert from "node:assert/strict";
import { test } from "node:test";

import { codexArgs } from "./codex.ts";

// Checked against codex-cli 0.167.2: `codex exec --search` is rejected; `-c web_search="live"` gives
// the model its web_search tool on `exec` and `exec resume`; with web_search="disabled" alone the
// ChatGPT apps connector still searched the web, and `--disable apps` removed that.
test("codex: a coach with a web setting gets the native search or none, never the apps connector", () => {
  for (const [search, value] of [[true, "live"], [false, "disabled"]] as const) {
    for (const threadId of [undefined, "t-1"]) {
      const a = codexArgs({ system: "s", threadId, options: { search, skipGitCheck: true } });
      assert.ok(a.includes(`web_search="${value}"`));
      assert.equal(a[a.indexOf("--disable") + 1], "apps");
      assert.ok(a.includes("--skip-git-repo-check"));
      assert.ok(!a.includes("--search"));
      assert.ok(a.includes("sandbox_workspace_write.network_access=false"));
      assert.equal(a.at(-1), "-");
    }
  }
});

test("codex: without a web setting the arguments are the personal coach's", () => {
  assert.deepEqual(codexArgs({ system: "s", options: {} }), codexArgs({ system: "s" }));
  assert.ok(!codexArgs({ system: "s" }).some((x) => /web_search|apps|skip-git/.test(x)));
});
