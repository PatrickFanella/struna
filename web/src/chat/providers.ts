/** Which coach CLI to use, from `/api/providers`; no React, so it can be tested. */

/** The coaches on this computer's own logins: the only ones the personal mode has. */
export type HostId = "claude" | "codex";
/** A coach id: a host login, or (generic mode) one the app signs in itself, such as "anthropic". */
export type ProviderId = string;

export type Preset = { id: string; label: string; baseUrl: string; header: "bearer" | "api-key"; key: "required" | "none" | "optional" };

/** One coach as the generic mode's settings show it. Secrets only ever arrive as their hint. */
export type ProviderRow = {
  id: string;
  label: string;
  via: "Claude Code" | "Codex";
  setup: "host" | "device" | "key" | "endpoint";
  ok: boolean;
  detail: string;
  web: boolean;
  model: string | null;
  notes: string[];
  command?: string;
  signOut?: string;
  hint?: string | null;
  saved?: string | null;
  region?: string | null;
  preset?: string | null;
  baseUrl?: string | null;
  header?: "bearer" | "api-key" | null;
  presets?: Preset[];
  experimental?: boolean;
  /** Offered, but it cannot run here; the status line says why. */
  unavailable?: boolean;
};

export type ProviderStatus = Record<HostId, { ok: boolean; detail: string }> & {
  last: string;
  host?: string;
  /** Generic mode: whether ChatGPT can be signed in from the app. */
  deviceSignIn?: boolean;
  /** Generic mode: every coach this instance offers, in the settings' order. */
  list?: ProviderRow[];
};

const NAMES: Record<HostId, string> = { claude: "Claude", codex: "ChatGPT" };

/** The coaches to choose from: the generic mode's list, or the two host logins. */
export function rows(p: ProviderStatus): Pick<ProviderRow, "id" | "label" | "ok" | "detail">[] {
  if (p.list) return p.list;
  return (["claude", "codex"] as const).map((id) => ({ id, label: NAMES[id], ok: Boolean(p[id]?.ok), detail: p[id]?.detail ?? "" }));
}

/**
 * The provider for a fresh page: the one used last, unless it is not signed in and the other is
 * (a player with only Codex signed in must not have every automatic request sent to Claude).
 * With neither signed in it stays on the last one, so the "not signed in" notice names it.
 * With the generic mode's list: the last one if it is ready, else the first ready one, else the last one
 * when it is still offered, else the first offered.
 */
export function pickProvider(p: ProviderStatus): ProviderId {
  if (p.list) {
    const last = p.list.find((r) => r.id === p.last);
    if (last?.ok) return last.id;
    return (p.list.find((r) => r.ok) ?? last ?? p.list[0])?.id ?? p.last;
  }
  const last: HostId = p.last === "codex" ? "codex" : "claude";
  const other: HostId = last === "codex" ? "claude" : "codex";
  return !p[last]?.ok && p[other]?.ok ? other : last;
}

/**
 * Whether the coach in use can answer, and why not. The personal mode asks whether either login works,
 * as it always did; the generic mode's list asks about the current coach, since a message goes to it.
 */
export function readiness(p: ProviderStatus | null, current: ProviderId): { ok: boolean; detail: string } {
  if (!p) return { ok: false, detail: "the coach could not be reached" };
  if (p.list) {
    const cur = p.list.find((r) => r.id === current);
    if (cur?.ok) return { ok: true, detail: "" };
    if (!p.list.some((r) => r.ok)) return { ok: false, detail: p.list.length ? "no coach is set up" : "every coach is turned off here" };
    return { ok: false, detail: cur ? cur.detail : "this conversation's coach is turned off here" };
  }
  if (p.claude?.ok || p.codex?.ok) return { ok: true, detail: "" };
  return { ok: false, detail: p[current as HostId]?.detail || "not signed in" };
}

/** What an automatic action's note says when no coach is signed in, so the app does not claim the coach is at work. */
export function unavailable(id: string, detail: string): string {
  if (id === "pain") return `Rest. No coach is signed in (${detail}), so the plan was not lightened: keep the next session short and easy, and see a doctor or physiotherapist if it persists.`;
  return `No coach is signed in (${detail}), so the plan stays as it is.`;
}

/** Seconds left as "14:59"; "0:00" once it is over. */
export function countdown(expiresAt: string, now: number): string {
  const s = Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000));
  return Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "";
}

/** A note's text in pieces: odd pieces were between backticks and show as code. */
export const codeParts = (text: string): string[] => text.split("`");
