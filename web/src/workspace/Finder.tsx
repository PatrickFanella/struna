import { useEffect, useRef, useState } from "react";

import { api } from "../api.ts";
import type { MaterialItem } from "../generic.ts";
import { type LibItem, minutes, paneItem, SOURCE_LABEL } from "../library/item.ts";
import { hostOf, KIND_LABEL, materialPane, SOURCE_LABEL as MATERIAL_SOURCE } from "../materials/item.ts";
import type { PaneContent } from "./Workspace.tsx";

export type FinderMode = "library" | "tabs" | "materials";
const LABEL: Record<FinderMode, { dialog: string; search: string }> = {
  library: { dialog: "Open from the library", search: "Search lessons, sheets and books" },
  tabs: { dialog: "Open a tab", search: "Search tabs by artist or title" },
  materials: { dialog: "Open from your materials", search: "Search your materials" },
};

type Tab = { id: string; artist: string; title: string; version: number; ext: string };

/** Search the library, the player's materials or the tab collection and open the choice in a pane. */
export function Finder({ mode, onPick, onClose }: { mode: FinderMode; onPick: (c: PaneContent) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [lib, setLib] = useState<LibItem[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [mats, setMats] = useState<MaterialItem[] | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const t = setTimeout(async () => {
      if (mode === "library") {
        const r = await api.get<{ items: LibItem[] }>(`/api/library?q=${encodeURIComponent(q)}`).catch(() => ({ items: [] }));
        setLib(r.items.filter((i) => paneItem(i) || i.kind === "audio"));
      } else if (mode === "materials") {
        const r = await api.get<{ items: MaterialItem[] }>(`/api/materials?q=${encodeURIComponent(q)}`).catch(() => ({ items: [] }));
        setMats(r.items.slice(0, 100));
      } else {
        const r = await api.get<{ items: Tab[] }>(`/api/tabs?q=${encodeURIComponent(q)}`).catch(() => ({ items: [] }));
        setTabs(r.items);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, mode]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="finderwrap" role="dialog" aria-modal="true" aria-label={LABEL[mode].dialog}>
      <div className="scrim" onClick={onClose} />
      <div className="finder">
        <div className="finderhd">
          <input ref={input} className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={LABEL[mode].search} aria-label="Search" />
          <button className="sheetdone" onClick={onClose}>Cancel</button>
        </div>
        <ul className="finderlist">
          {mode === "library"
            ? lib.map((i) => (
                <li key={i.id}>
                  <button onClick={() => onPick(libraryContent(i))}>
                    {i.kind === "video" && i.thumb ? <img src={`/api/media/${i.id}/thumb`} alt="" loading="lazy" /> : <span className="kindbadge">{i.kind === "zip-entry" ? "Sheet" : i.kind.toUpperCase()}</span>}
                    <span className="fitem">
                      <span className="itemtitle">{i.title}</span>
                      <span className="itemfacts">{SOURCE_LABEL[i.source]}{i.duration ? `, ${minutes(i.duration)}` : ""}</span>
                    </span>
                  </button>
                </li>
              ))
            : mode === "materials"
            ? (mats ?? []).map((i) => (
                <li key={i.id}>
                  <button onClick={() => onPick(materialPane(i))}>
                    <span className="kindbadge">{KIND_LABEL[i.kind]}</span>
                    <span className="fitem">
                      <span className="itemtitle">{i.title}</span>
                      <span className="itemfacts">{i.src || !i.url ? MATERIAL_SOURCE[i.source] : hostOf(i.url)}{i.inPlan ? ", in your plan" : ""}</span>
                    </span>
                  </button>
                </li>
              ))
            : tabs.map((t) => (
                <li key={t.id}>
                  <button onClick={() => onPick({ type: "tab", tabId: t.id, title: t.title, artist: t.artist })}>
                    <span className="kindbadge">{t.ext.toUpperCase()}</span>
                    <span className="fitem">
                      <span className="itemtitle">{t.title}{t.version > 1 ? ` (${t.version})` : ""}</span>
                      <span className="itemfacts">{t.artist}</span>
                    </span>
                  </button>
                </li>
              ))}
        </ul>
        {mode === "materials" && mats?.length === 0 && <p className="matnote findernone">{q.trim() ? "Nothing in your materials matches." : "You have no materials yet. Add some on the Materials screen."}</p>}
      </div>
    </div>
  );
}

export function libraryContent(i: LibItem): PaneContent {
  const p = paneItem(i);
  if (p) return { type: "file", item: { ...p, libId: i.id, ...(i.thumb && i.kind === "video" ? { poster: `/api/media/${i.id}/thumb` } : {}) } };
  return { type: "file", item: { key: `lib:${i.id}`, label: i.title, kind: i.kind === "audio" ? "audio" : "other", src: `/api/media/${i.id}`, libId: i.id } };
}
