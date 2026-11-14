import { store } from "./api.ts";

export type ThemeChoice = "light" | "dark" | null;
const KEY = "guitar-room.theme";

export function getTheme(): ThemeChoice {
  const t = store.get(KEY);
  return t === "light" || t === "dark" ? t : null;
}

/** The theme in effect: the stored choice, or the device setting. */
export function effectiveTheme(): "light" | "dark" {
  return getTheme() ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

export function setTheme(t: ThemeChoice): void {
  store.set(KEY, t);
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
