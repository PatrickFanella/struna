import { api } from "../api.ts";
const KEY = "struna.practice-client";
export function practiceClient(): string {
  let id = sessionStorage.getItem(KEY);
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(KEY, id); }
  return id;
}
export function syncPractice(active = Boolean(sessionStorage.getItem("struna.session"))) {
  return api.put<{ revision: number; active: boolean; expiresAt: number }>("/api/practice-state", { client: practiceClient(), active });
}
