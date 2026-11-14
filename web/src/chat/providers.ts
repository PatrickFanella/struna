/** Which coach CLI to use, from `/api/providers`; no React, so it can be tested. */

export type ProviderId = "claude" | "codex";
export type ProviderStatus = Record<ProviderId, { ok: boolean; detail: string }> & { last: ProviderId; host?: string };

/**
 * The provider for a fresh page: the one used last, unless it is not signed in and the other is
 * (a player with only Codex signed in must not have every automatic request sent to Claude).
 * With neither signed in it stays on the last one, so the "not signed in" notice names it.
 */
export function pickProvider(p: ProviderStatus): ProviderId {
  const last: ProviderId = p.last === "codex" ? "codex" : "claude";
  const other: ProviderId = last === "codex" ? "claude" : "codex";
  return !p[last]?.ok && p[other]?.ok ? other : last;
}

/** Whether any coach can answer, and why not when none can. */
export function readiness(p: ProviderStatus | null, current: ProviderId): { ok: boolean; detail: string } {
  if (!p) return { ok: false, detail: "the coach could not be reached" };
  if (p.claude?.ok || p.codex?.ok) return { ok: true, detail: "" };
  return { ok: false, detail: p[current]?.detail || "not signed in" };
}

/** What an automatic action's note says when no coach is signed in, so the app does not claim the coach is at work. */
export function unavailable(id: string, detail: string): string {
  if (id === "pain") return `Rest. No coach is signed in (${detail}), so the plan was not lightened: keep the next session short and easy, and see a doctor or physiotherapist if it persists.`;
  return `No coach is signed in (${detail}), so the plan stays as it is.`;
}
