import type { MaterialItem } from "../generic.ts";

export type AddedMaterial = Pick<MaterialItem, "id" | "title" | "shortTitle" | "url">;
export type MaterialsSnapshot = { items: MaterialItem[]; total?: number; truncated?: boolean; linksError?: string };
export type FindTurn = { ok: boolean; complete: boolean; additions: AddedMaterial[] | null; problem: string; unavailable?: boolean };
export type FindOutcome = { state: "added" | "empty" | "error" | "unavailable" | "unknown"; message: string; additions: AddedMaterial[] };

/** A kept copy retains URL identity, so saving an existing lesson is not an addition. */
export function addedMaterials(before: MaterialsSnapshot, after: MaterialsSnapshot): AddedMaterial[] {
  for (const list of [before, after]) {
    if (list.linksError || list.truncated || (list.total !== undefined && list.total !== list.items.length)) throw new Error("The complete Materials list could not be checked.");
  }
  const identity = (i: MaterialItem) => i.url || i.id;
  const seen = new Set(before.items.map(identity));
  const added: AddedMaterial[] = [];
  for (const item of after.items) {
    if (seen.has(identity(item))) continue;
    seen.add(identity(item));
    const { id, title, shortTitle, url } = item;
    added.push({ id, title, url, ...(shortTitle ? { shortTitle } : {}) });
  }
  return added;
}

export function findOutcome(turn: FindTurn): FindOutcome {
  const additions = turn.additions ?? [];
  if (turn.unavailable) return { state: "unavailable", message: `Search unavailable: ${turn.problem}. Open Coach settings, choose a coach with web access, or add a link yourself.`, additions };
  if (!turn.complete) return { state: "unknown", message: "Search completion could not be confirmed. Check the Coach conversation and Materials, then reload this page before starting another search.", additions };
  if (!turn.ok) return { state: "error", message: `Search failed: ${turn.problem || "the Coach could not finish"}.${additions.length ? ` ${additions.length} ${additions.length === 1 ? "material was" : "materials were"} added before it stopped.` : ""} Your query is kept.`, additions };
  if (turn.additions === null) return { state: "unknown", message: "The Coach finished, but additions could not be checked. Check Materials before starting another search.", additions };
  if (!additions.length) return { state: "empty", message: "Search completed with no materials added. The Coach may have found no matches or only lessons already here. Try a different song or technique.", additions };
  return { state: "added", message: `Added ${additions.length} ${additions.length === 1 ? "material" : "materials"}: ${additions.map(i => i.shortTitle || i.title).join(", ")}.`, additions };
}
