import { useSyncExternalStore } from "react";

import { api } from "../api.ts";
import type { AutoAction, Prompt, PromptGroup } from "../generic.ts";
import type { ScreenContext } from "../screen.ts";

/** What `/api/prompts` returns. Both lists are empty in the personal mode. */
export type PromptSet = { prompts: Prompt[]; actions: AutoAction[] };
const NONE: PromptSet = { prompts: [], actions: [] };

export const GROUPS: [PromptGroup, string][] = [
  ["plan", "Your plan"],
  ["session", "This session"],
  ["material", "Materials"],
  ["find", "Find online"],
  ["learn", "Learn"],
  ["review", "Review"],
  ["mine", "Your prompts"],
];

let current: PromptSet = NONE;
let pending: Promise<PromptSet> | null = null;
const listeners = new Set<() => void>();

/** Replace the cached set, after a settings change answered with the new one. */
export function setPrompts(v: unknown): PromptSet {
  const o = (v ?? {}) as Partial<PromptSet>;
  current = { prompts: Array.isArray(o.prompts) ? o.prompts : [], actions: Array.isArray(o.actions) ? o.actions : [] };
  // Later readers get this set, not the answer to the first request.
  pending = Promise.resolve(current);
  for (const l of listeners) l();
  return current;
}

/** The prompts and automatic actions; asked once, and again after `refreshPrompts`. A failed request counts as none. */
export function loadPrompts(): Promise<PromptSet> {
  pending ??= api.get<unknown>("/api/prompts").then((v) => setPrompts(v), () => {
    pending = null;
    return current;
  });
  return pending;
}

export function refreshPrompts(): Promise<PromptSet> {
  pending = null;
  return loadPrompts();
}

export function usePrompts(): PromptSet {
  const set = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      void loadPrompts();
      return () => listeners.delete(fn);
    },
    () => current,
  );
  return set;
}

/** The prompt screen a view name belongs to: the practice screens name themselves "practice start" and so on. */
export function screenId(view: string): string {
  if (/review/.test(view)) return "review";
  if (/session/.test(view)) return "session";
  if (/material/.test(view)) return "materials";
  if (/tab/.test(view)) return "tabs";
  if (/start|setup|practice/.test(view)) return "start";
  return "any";
}

const INPUT = "{input}";

/**
 * A prompt's message with the screen's values filled in, or null when it names something this
 * screen does not have (no material open, no stage running). `input` means the player finishes
 * the message: a trailing `{input}` is removed so the cursor lands where the words go.
 */
export function fillPrompt(text: string, ctx: ScreenContext): { text: string; input: boolean } | null {
  const values: Record<string, string | undefined> = {
    material: ctx.fragment,
    stage: ctx.stage,
    bpm: ctx.bpm ? String(ctx.bpm) : undefined,
    level: "my level",
  };
  let missing = false;
  let out = text.replace(/\{(material|stage|bpm|level)\}/g, (_m, key: string) => {
    const v = values[key]?.trim();
    if (!v) missing = true;
    return v ?? "";
  });
  if (missing) return null;
  const input = out.includes(INPUT);
  if (out.trimEnd().endsWith(INPUT)) out = out.trimEnd().slice(0, -INPUT.length).replace(/\s*$/, " ");
  return { text: input ? out : out.trim(), input };
}

/**
 * The prompts worth offering on a screen, best first: those written for it in their listed
 * order, then (with `all`) every other prompt that can be filled here.
 */
export function promptsFor(prompts: Prompt[], screen: string, ctx: ScreenContext, all = false): Prompt[] {
  const usable = prompts.filter((p) => fillPrompt(p.text, ctx) !== null);
  const here = usable.filter((p) => p.screens.includes(screen));
  if (!all) return here.length ? here : usable.filter((p) => p.screens.includes("any"));
  return [...here, ...usable.filter((p) => !p.screens.includes(screen))];
}

/** An automatic action's message with the caller's values; a value that was not given reads as a plain word. */
export function fillAction(text: string, vars: Record<string, string> = {}): string {
  const fallback: Record<string, string> = { names: "some new material", log: "the newest file in logs/", days: "several", summary: "no details given" };
  return text.replace(/\{(names|log|days|summary)\}/g, (_m, key: string) => vars[key]?.trim() || fallback[key]!);
}
