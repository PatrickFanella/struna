import { useEffect, useState } from "react";

import { api } from "./api.ts";
import type { AppInfo } from "./generic.ts";

/** What the app is until `/api/app` answers, and when it cannot be reached: the personal app as it always was. */
export const PERSONAL: AppInfo = { mode: "personal", name: "Guitar Room", sections: ["practice", "library", "tabs"], web: false, profile: true };

const SECTIONS = new Set(["practice", "library", "materials", "tabs"]);

/** Reads an `/api/app` answer, keeping only what the app understands. */
export function readAppInfo(v: unknown): AppInfo {
  if (!v || typeof v !== "object") return PERSONAL;
  const o = v as Record<string, unknown>;
  const sections = (Array.isArray(o.sections) ? o.sections : []).filter((s): s is AppInfo["sections"][number] => typeof s === "string" && SECTIONS.has(s));
  if (!sections.includes("practice")) sections.unshift("practice");
  return {
    mode: o.mode === "generic" ? "generic" : "personal",
    name: typeof o.name === "string" && o.name.trim() ? o.name.trim() : PERSONAL.name,
    sections,
    web: o.web === true,
    profile: o.profile !== false,
  };
}

let loaded: AppInfo | null = null;
let pending: Promise<AppInfo> | null = null;

/** The mode, name and sections of this server; asked once per page load. */
export function loadApp(): Promise<AppInfo> {
  pending ??= api.get<unknown>("/api/app").then(readAppInfo, () => PERSONAL).then((info) => (loaded = info));
  return pending;
}

/**
 * The app info. `App` renders nothing until it has loaded, so components under it always get the
 * real answer; anything rendered earlier sees the personal defaults until then.
 */
export function useApp(): AppInfo {
  const [info, setInfo] = useState<AppInfo>(loaded ?? PERSONAL);
  useEffect(() => {
    let live = true;
    void loadApp().then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, []);
  return info;
}

/** Whether `/api/app` has answered; `App` waits for it before drawing the header. */
export function useAppLoaded(): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(loaded);
  useEffect(() => {
    let live = true;
    void loadApp().then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, []);
  return info;
}
