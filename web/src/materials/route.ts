import type { MaterialKind } from "../generic.ts";
import { FILTER_KINDS } from "./item.ts";

export type MaterialRoute = { type: "list" } | { type: "item"; id: string } | { type: "missing" };
/** Only IDs belong in the hash. API access checks still apply when resolving them. */
export function materialRoute(hash: string): MaterialRoute {
  const [section, view, raw, ...rest] = hash.replace(/^#\/?/, "").split("/");
  if (section !== "materials" || view === undefined) return { type: "list" };
  if (view !== "item" || !raw || rest.length) return { type: "missing" };
  try {
    const id = decodeURIComponent(raw);
    return /^(?:l\.[a-f0-9]{16}|(?:f|d\d+)\.[A-Za-z0-9_-]+)$/.test(id) ? { type: "item", id } : { type: "missing" };
  } catch { return { type: "missing" }; }
}
export const materialHash = (id: string): string => `#materials/item/${encodeURIComponent(id)}`;
export type MaterialListState = { q: string; kind: MaterialKind | null; filters: boolean; scroll: number };
/** History can contain unrelated application state or values left by an older build. */
export function materialListState(state: unknown): MaterialListState {
  const v = (state && typeof state === "object" ? (state as { materialList?: Partial<MaterialListState> }).materialList : null);
  return { q: typeof v?.q === "string" ? v.q : "", kind: FILTER_KINDS.includes(v?.kind as MaterialKind) ? v!.kind! : null, filters: v?.filters === true, scroll: typeof v?.scroll === "number" && Number.isFinite(v.scroll) ? Math.max(0, v.scroll) : 0 };
}
