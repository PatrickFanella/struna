/** How the chat's SSE events change the message list; no React, so it can be tested. */

/** `auto` names the automatic action that sent a user message. */
export type Msg = { role: "user" | "assistant" | "error" | "notice"; text: string; streaming?: boolean; auto?: string };

/**
 * The messages after one `delta`, `notice` or `error` event of a turn. Reply text goes to the message
 * that is streaming, whatever came after it. A notice that arrives before any reply text (such as "the
 * coach starts fresh") goes above the reply, so it reads first; later ones, and errors, go at the end.
 */
export function applyEvent(m: Msg[], ev: "delta" | "notice" | "error", d: { text?: string; message?: string }): Msg[] {
  if (ev === "delta") return m.map((x) => (x.streaming ? { ...x, text: x.text + (d.text ?? "") } : x));
  const msg: Msg = { role: ev, text: d.message ?? "" };
  const i = m.findIndex((x) => x.streaming);
  if (ev === "notice" && i >= 0 && !m[i]!.text) return [...m.slice(0, i), msg, ...m.slice(i)];
  return [...m, msg];
}
