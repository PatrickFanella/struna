import { readGuest, type GuestState } from "./guest.ts";
export const HANDOFF_KEY = "struna.guest-handoff.v1";
export type Handoff = { id: string; action: "save" | "coach"; state: GuestState };
export function readHandoff(raw: string | null): Handoff | null {
 try { const v=JSON.parse(raw ?? "null"), state=readGuest(JSON.stringify(v?.state));
   return v && /^[a-f0-9-]{36}$/.test(v.id) && ["save","coach"].includes(v.action) && state?.step === "done" ? {id:v.id,action:v.action,state} : null;
 } catch { return null; }
}
