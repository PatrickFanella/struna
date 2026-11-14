/**
 * A Claude Code PreToolUse hook for the generic coach's WebFetch. WebFetch makes its request from
 * this machine, so without a check a page the coach reads could send it to a LAN or tailnet service
 * and have the answer read back. This applies the downloader's rule (public addresses only) before
 * the fetch: https only, a dotted host name (no IP literals), and every address the name resolves to
 * must be public. WebFetch resolves the name again by itself, so a DNS answer that changes between
 * the two lookups (rebinding) can still get through; the README says so.
 *
 * Run as a hook it reads the tool call as JSON on stdin and prints a deny decision, or nothing.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { isPublicAddress } from "./fetch.ts";

export type Resolve = (host: string) => Promise<string[]>;
const dns: Resolve = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Why WebFetch may not open `raw`, or null when it may. */
export async function webFetchRefusal(raw: unknown, resolve: Resolve = dns): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(String(raw ?? ""));
  } catch {
    return "that is not a web address";
  }
  if (u.protocol !== "https:") return "only https pages can be opened; use the https address";
  if (u.username || u.password) return "addresses with a user name or password are not opened";
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (isIP(host)) return "addresses given as an IP number are not opened; use the site's name";
  if (!host.includes(".") || /\.(local|localhost|internal|lan|home|arpa|ts\.net)$/.test(host)) return "that is a local or private host name; it is not opened";
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return `${host} was not found`;
  }
  if (!addresses.length) return `${host} was not found`;
  if (!addresses.every(isPublicAddress)) return `${host} is on a private or local network; it is not opened`;
  return null;
}

/** The hook's answer for one PreToolUse event (the JSON Claude Code sends on stdin). */
export async function hookAnswer(input: unknown, resolve: Resolve = dns): Promise<Record<string, unknown> | null> {
  const ev = input as { tool_name?: unknown; tool_input?: { url?: unknown } } | null;
  if (ev?.tool_name !== "WebFetch") return null;
  const why = await webFetchRefusal(ev.tool_input?.url, resolve);
  if (!why) return null;
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `Guitar Room: ${why}.` } };
}

/** The `--settings` JSON that runs this file as the WebFetch hook. */
export function webFetchSettings(node = process.execPath, script = import.meta.filename): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  return JSON.stringify({
    hooks: { PreToolUse: [{ matcher: "WebFetch", hooks: [{ type: "command", command: `${q(node)} ${q(script)}`, timeout: 20 }] }] },
  });
}

if (import.meta.main) {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  let answer: Record<string, unknown> | null;
  try {
    answer = await hookAnswer(JSON.parse(text));
  } catch {
    // A call the hook cannot read is refused rather than let through.
    answer = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Guitar Room: the request could not be checked." } };
  }
  if (answer) process.stdout.write(JSON.stringify(answer));
}
