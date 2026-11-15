import { useEffect, useState } from "react";

import { api } from "./api.ts";
import type { AppInfo } from "./generic.ts";

/** What the app is until `/api/app` answers, and when it cannot be reached: the personal app as it always was. */
export const PERSONAL: AppInfo = { mode: "personal", name: "Struna", sections: ["practice", "library", "tabs"], web: false, profile: true };

const SECTIONS = new Set(["practice", "library", "materials", "tabs"]);

/** Reads an `/api/app` answer, keeping only what the app understands. */
export function readAppInfo(v: unknown): AppInfo {
  if (!v || typeof v !== "object") return PERSONAL;
  const o = v as Record<string, unknown>;
  const sections = (Array.isArray(o.sections) ? o.sections : []).filter((s): s is AppInfo["sections"][number] => typeof s === "string" && SECTIONS.has(s));
  if (!sections.includes("practice")) sections.unshift("practice");
  return {
    ...(o.mode === "hosted" && typeof o.account === "string" && typeof o.session === "string" && typeof o.csrf === "string" ? { account: o.account, session: o.session, csrf: o.csrf } : {}),
    mode: o.mode === "guest" ? "guest" : o.mode === "hosted" ? "hosted" : o.mode === "studio" || o.mode === "generic" ? "studio" : "personal",
    name: typeof o.name === "string" && o.name.trim() ? o.name.trim() : PERSONAL.name,
    sections,
    web: o.web === true,
    profile: o.profile !== false,
  };
}

/** The app info the server wrote into the page (production), so the first paint needs no request. */
function embedded(): AppInfo | null {
  try {
    const text = typeof document === "undefined" ? null : document.getElementById("app-info")?.textContent;
    return text ? readAppInfo(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

let loaded: AppInfo | null = embedded();
let pending: Promise<AppInfo> | null = loaded ? Promise.resolve(loaded) : null;

/** The mode, name and sections of this server: from the page, or asked once per page load (the dev server). */
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
