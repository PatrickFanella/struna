import type { CoachContext, CoachSelection } from "../../shared/coach-context.ts";
import { readPlan, type Studio } from "../generic/studio.ts";
import { readLogs } from "../generic/logs.ts";
import { listMaterials } from "../generic/materials.ts";
import { HttpError } from "../http.ts";

export function parseSelection(value: unknown): CoachSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Practice context must be a selection");
  const o = value as Record<string, unknown>;
  if (Object.keys(o).some(k => !["view", "planId", "sessionKind", "stageKey", "materialKey", "clickBpm", "confirmedBpm", "reflection"].includes(k))) throw new HttpError(400, "Unknown practice context field");
  if (!["Today", "Playing", "Review", "Materials"].includes(String(o.view))) throw new HttpError(400, "Unknown practice context view");
  for (const key of ["planId", "sessionKind", "stageKey", "materialKey", "reflection"]) {
    if (o[key] !== undefined && (typeof o[key] !== "string" || o[key].length > (key === "reflection" ? 6000 : 2500))) throw new HttpError(400, "Practice context text is too long or invalid");
  }
  for (const key of ["clickBpm", "confirmedBpm"]) if (o[key] !== undefined && (!Number.isInteger(o[key]) || Number(o[key]) < 20 || Number(o[key]) > 400)) throw new HttpError(400, "Practice context BPM must be a whole number from 20 to 400");
  return o as CoachSelection;
}

/** Metadata only: no media bytes, arbitrary file reads, profile/credential/config lookup or owner fallback. */
export async function practiceContext(s: Studio, value: unknown): Promise<CoachContext> {
  try { return await resolveContext(s, value); }
  catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(503, "Practice context is unavailable. Retry or return to Today; your draft is unchanged.");
  }
}

async function resolveContext(s: Studio, value: unknown): Promise<CoachContext> {
  const selection = parseSelection(value);
  const { plan } = await readPlan(s);
  if (selection.planId && selection.planId !== plan?.id) throw new HttpError(409, "Your plan changed. Return to Today and reload before asking Coach.");
  const kind = selection.sessionKind ? plan?.sessions.find(k => k.id === selection.sessionKind) : undefined;
  const stage = selection.stageKey ? kind?.stages.find(st => st.key === selection.stageKey) : undefined;
  if ((selection.sessionKind && !kind) || (selection.stageKey && !stage)) throw new HttpError(409, "This stage changed. Return to Today and reload before asking Coach.");
  let material = "";
  if (selection.materialKey) {
    const key = selection.materialKey.replace(/^plan:/, "");
    const ref = [...(plan?.materials ?? []), ...(plan?.sessions.flatMap(k => k.stages.flatMap(st => st.material ? [{ ...st.material, label: "" }] : [])) ?? [])].find(m => (m.file ?? m.url) === key);
    if (ref) material = ref.label || key.split("/").at(-1)!;
    else {
      const listing = await listMaterials(s, { limit: 40000 });
      const found = listing.items.find(m => `mat:${m.id}` === selection.materialKey);
      if (!found) throw new HttpError(404, "This material is not in your private collection");
      material = found.shortTitle || found.title;
    }
  }
  const latest = selection.view === "Today" && plan ? (await readLogs(s.home)).filter(log => log.planId === plan.id).at(-1) : undefined;
  const reflection = selection.reflection?.trim() || (latest ? [`Latest saved reflection (${latest.date})`, latest.wentWell && `Went well: ${latest.wentWell}`, latest.struggled && `Hard: ${latest.struggled}`, latest.pain ? "Stopped for pain or tension" : "", latest.next && `Next: ${latest.next}`].filter(Boolean).join("; ") : "");
  const summary = [
    `From: ${selection.view}`,
    ...(plan ? [`Plan: ${plan.title}`, `Practice goal: ${plan.goal}`] : []),
    ...(stage ? [`Stage: ${stage.title}`, `Task: ${stage.task}`] : ["Stage: none active"]),
    `Material: ${material || "none selected"} (name only; content not read)`,
    `Click setting: ${selection.clickBpm ? `${selection.clickBpm} BPM (not a clean-pass measurement)` : "not supplied"}`,
    `Player-confirmed clean tempo: ${selection.confirmedBpm ? `${selection.confirmedBpm} BPM (player report, not audio analysis)` : "unmeasured"}`,
    `Player reflection: ${reflection || "none supplied"}`,
  ].join("\n");
  if (summary.length > 12000) throw new HttpError(400, "Practice context is too long. Shorten your reflection and retry.");
  return { summary };
}
