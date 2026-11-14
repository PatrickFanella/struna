import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

import { hookAnswer, webFetchRefusal, webFetchSettings } from "./webfetch-guard.ts";

const dns: Record<string, string[]> = { "lessons.example.org": ["93.184.216.34"], "rebind.example.org": ["93.184.216.34", "10.0.0.50"], "inside.example.org": ["192.168.1.10"], "tailnet.example.org": ["100.65.164.66"] };
const resolve = async (h: string) => {
  if (!dns[h]) throw new Error("ENOTFOUND");
  return dns[h]!;
};

test("WebFetch may open public https pages only", async () => {
  assert.equal(await webFetchRefusal("https://lessons.example.org/chords", resolve), null);
  const refused: [string, RegExp][] = [
    ["http://lessons.example.org/", /only https/],
    ["https://127.0.0.1/", /IP number/],
    ["https://[::1]/", /IP number/],
    ["https://169.254.169.254/latest", /IP number/],
    ["https://localhost/", /local or private host name/],
    ["https://kvant.mooneye-mintaka.ts.net/", /local or private host name/],
    ["https://printer.local/", /local or private host name/],
    ["https://inside.example.org/", /private or local network/],
    ["https://tailnet.example.org/", /private or local network/],
    ["https://rebind.example.org/", /private or local network/],
    ["https://nowhere.example.org/", /was not found/],
    ["https://user:pw@lessons.example.org/", /user name or password/],
    ["not a url", /not a web address/],
  ];
  for (const [url, why] of refused) assert.match((await webFetchRefusal(url, resolve)) ?? "allowed", why, url);
});

test("the hook denies through Claude Code's PreToolUse answer and ignores other tools", async () => {
  assert.deepEqual(await hookAnswer({ tool_name: "WebFetch", tool_input: { url: "https://127.0.0.1/" } }, resolve), {
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Guitar Room: addresses given as an IP number are not opened; use the site's name." },
  });
  assert.equal(await hookAnswer({ tool_name: "WebFetch", tool_input: { url: "https://lessons.example.org/" } }, resolve), null);
  assert.equal(await hookAnswer({ tool_name: "Read", tool_input: {} }, resolve), null);
});

test("run as a hook it reads stdin, and refuses what it cannot read", () => {
  const [node, script] = JSON.parse(webFetchSettings()).hooks.PreToolUse[0].hooks[0].command.match(/'[^']*'/g).map((s: string) => s.slice(1, -1));
  const out = (input: string) => execFileSync(node, [script], { input, encoding: "utf8" });
  assert.match(out(JSON.stringify({ tool_name: "WebFetch", tool_input: { url: "https://10.0.0.1/" } })), /"permissionDecision":"deny"/);
  assert.match(out("{ not json"), /could not be checked/);
});
