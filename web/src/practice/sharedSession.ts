import { privateSession } from "../api.ts";
import { api } from "../api.ts";
const KEY = "struna.practice-client";
export function practiceClient(): string {
  let id = privateSession.getItem(KEY);
  if (!id) { id = crypto.randomUUID(); privateSession.setItem(KEY, id); }
  return id;
}
export function syncPractice(active = Boolean(privateSession.getItem("struna.session"))) {
  return api.put<{ revision: number; active: boolean; expiresAt: number }>("/api/practice-state", { client: practiceClient(), active });
}
