/** Selection is browser-reported; saved plan/material names are resolved by the authenticated server. */
export type CoachSelection = {
  view: "Today" | "Playing" | "Review" | "Materials";
  planId?: string;
  sessionKind?: string;
  stageKey?: string;
  materialKey?: string;
  clickBpm?: number;
  confirmedBpm?: number;
  reflection?: string;
};
export type CoachContext = { summary: string };
