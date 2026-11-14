import { useEffect, useRef, useState } from "react";

import { api } from "../api.ts";
import { ChatPanel } from "../chat/Chat.tsx";
import { type LibItem, paneItem } from "../library/item.ts";
import { VideoView } from "../library/VideoView.tsx";
import type { PaneItem } from "../practice/Material.tsx";
import { PdfView } from "../practice/PdfView.tsx";
import { TabPlayer } from "../tabs/TabPlayer.tsx";
import { Finder, libraryContent } from "./Finder.tsx";

export type PaneContent =
  | { type: "file"; item: PaneItem }
  | { type: "coach" }
  | { type: "tab"; tabId: string; title: string; artist: string };
export type PaneState = { id: string; content: PaneContent };

export const MAX_PANES = 4;
const newId = () => Math.random().toString(36).slice(2, 10);
export const pane = (content: PaneContent): PaneState => ({ id: newId(), content });

export function paneTitle(c: PaneContent): string {
  return c.type === "coach" ? "Coach" : c.type === "tab" ? `${c.title}, ${c.artist}` : c.item.label;
}

/** How many panes fit side by side in this width. */
function slotsFor(width: number): number {
  return width >= 1180 ? 3 : width >= 720 ? 2 : 1;
}

function FileBody({ item, onOpen }: { item: PaneItem; onOpen: (c: PaneContent) => void }) {
  if (item.missing) return <p className="matnote">Material missing: {item.note ?? item.label}. Check the link in the block note.</p>;
  if (item.kind === "tg") return <p className="matnote">Export to Guitar Pro to view here. This is a TuxGuitar file ({item.note ?? item.label}).</p>;
  if (item.kind === "pdf" && item.src) return <PdfView src={item.src} storageKey={item.key} />;
  if ((item.kind === "video" || item.kind === "audio") && item.src) {
    return (
      <div className="panescroll">
        <VideoView src={item.src} storageKey={item.libId ?? item.key} audioOnly={item.kind === "audio"} poster={item.libId ? `/api/media/${item.libId}/thumb` : undefined} />
        {item.libId && <Companions libId={item.libId} onOpen={onOpen} />}
      </div>
    );
  }
  return (
    <p className="matnote">
      This file cannot be shown here.{item.src ? <> <a href={item.src}>Download it</a>.</> : null}
    </p>
  );
}

/** The sheet music and audio that came with a lesson video. */
function Companions({ libId, onOpen }: { libId: string; onOpen: (c: PaneContent) => void }) {
  const [items, setItems] = useState<LibItem[] | null>(null);
  useEffect(() => {
    let live = true;
    api.get<LibItem[]>(`/api/library/${libId}/companions`).then((r) => live && setItems(r), () => live && setItems([]));
    return () => {
      live = false;
    };
  }, [libId]);
  if (!items?.length) return null;
  return (
    <div className="companions">
      <p className="grp">With this lesson</p>
      <div className="chips">
        {items.map((c) => (
          <button key={c.id} onClick={() => onOpen(libraryContent(c))}>
            <span className="kindbadge">{c.kind === "audio" ? "Audio" : "PDF"}</span>
            {c.title}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Opens a video's first sheet beside it when the lesson has one. */
export async function withCompanion(c: PaneContent): Promise<PaneContent[]> {
  if (c.type !== "file" || c.item.kind !== "video" || !c.item.libId) return [c];
  const items = await api.get<LibItem[]>(`/api/library/${c.item.libId}/companions`).catch(() => [] as LibItem[]);
  const sheet = items.find((i) => paneItem(i)?.kind === "pdf");
  return sheet ? [c, libraryContent(sheet)] : [c];
}

type Menu = { at: number | "add" } | null;

/**
 * Side-by-side panes: the lesson, its sheet music or a tab, and the coach. Up to three show at
 * once on a wide screen, two on an iPad, one on a phone, with a switcher for the rest.
 */
export function Workspace({ panes, setPanes, materials, empty }: {
  panes: PaneState[];
  setPanes: (fn: (p: PaneState[]) => PaneState[]) => void;
  materials: PaneItem[];
  empty?: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState(1);
  const [focus, setFocus] = useState(0);
  const [menu, setMenu] = useState<Menu>(null);
  const [finder, setFinder] = useState<{ mode: "library" | "tabs"; at: number | "add" } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSlots(slotsFor(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => setFocus((f) => Math.min(f, Math.max(0, panes.length - 1))), [panes.length]);

  const place = (contents: PaneContent[], at: number | "add") =>
    setPanes((ps) => {
      const next = [...ps];
      const [first, ...rest] = contents;
      if (!first) return ps;
      if (at === "add") next.push(pane(first));
      else next[at] = { id: next[at]?.id ?? newId(), content: first };
      for (const r of rest) {
        const dup = next.some((p) => p.content.type === "file" && r.type === "file" && p.content.item.key === r.item.key);
        if (!dup && next.length < MAX_PANES) next.push(pane(r));
      }
      setFocus(at === "add" ? next.length - 1 - rest.length : at);
      return next.slice(0, MAX_PANES);
    });
  const open = async (c: PaneContent, at: number | "add") => {
    setMenu(null);
    setFinder(null);
    place(await withCompanion(c), at);
  };
  const close = (i: number) => setPanes((ps) => ps.filter((_, j) => j !== i));

  const start = Math.max(0, Math.min(focus - slots + 1, panes.length - slots, focus));
  const shown = panes.slice(start, start + slots);
  const weight = (c: PaneContent) => (c.type === "coach" ? 2 : 3);

  const menuBody = (at: number | "add") => (
    <div className="panemenu" role="menu">
      <button role="menuitem" onClick={() => open({ type: "coach" }, at)}>Coach</button>
      {materials.length > 0 && <p className="grp">Block material</p>}
      {materials.map((m) => (
        <button key={m.key} role="menuitem" onClick={() => open({ type: "file", item: m }, at)}>{m.label}{m.missing ? " (missing)" : ""}</button>
      ))}
      <p className="grp">Find</p>
      <button role="menuitem" onClick={() => (setMenu(null), setFinder({ mode: "library", at }))}>A lesson, sheet or book…</button>
      <button role="menuitem" onClick={() => (setMenu(null), setFinder({ mode: "tabs", at }))}>A Guitar Pro tab…</button>
    </div>
  );

  return (
    <div className="workspace" ref={box}>
      {panes.length > slots && (
        <div className="panetabs" role="tablist" aria-label="Open panes">
          {panes.map((p, i) => (
            <button key={p.id} role="tab" aria-selected={i >= start && i < start + slots} className={i >= start && i < start + slots ? "on" : ""} onClick={() => setFocus(i)}>{paneTitle(p.content)}</button>
          ))}
        </div>
      )}
      <div className="panes" style={{ gridTemplateColumns: shown.map((p) => `minmax(0, ${weight(p.content)}fr)`).join(" ") || "1fr" }}>
        {shown.length === 0 && <div className="pane emptypane">{empty ?? <p className="matnote">Nothing open.</p>}</div>}
        {shown.map((p, k) => {
          const i = start + k;
          return (
            <section key={p.id} className={`pane pane-${p.content.type}`} aria-label={paneTitle(p.content)}>
              <header className="panehd">
                <span className="panetitle">{paneTitle(p.content)}</span>
                <span className="paneacts">
                  <button className="tool" aria-haspopup="menu" aria-expanded={menu?.at === i} onClick={() => setMenu(menu?.at === i ? null : { at: i })}>Open…</button>
                  {k === shown.length - 1 && panes.length < MAX_PANES && (
                    <button className="tool" aria-haspopup="menu" aria-expanded={menu?.at === "add"} onClick={() => setMenu(menu?.at === "add" ? null : { at: "add" })} aria-label="Add a pane">+ Pane</button>
                  )}
                  <button className="tool" onClick={() => close(i)} aria-label={`Close ${paneTitle(p.content)}`}>×</button>
                </span>
                {menu && (menu.at === i || (menu.at === "add" && k === shown.length - 1)) && menuBody(menu.at)}
              </header>
              <div className="panebody">
                {p.content.type === "coach" ? (
                  <ChatPanel open />
                ) : p.content.type === "tab" ? (
                  <TabPlayer src={`/api/tabs/${p.content.tabId}/file`} title={paneTitle(p.content)} />
                ) : (
                  <FileBody item={p.content.item} onOpen={(c) => void open(c, "add")} />
                )}
              </div>
            </section>
          );
        })}
      </div>
      {shown.length === 0 && (
        <div className="paneadd">
          <button className="btn outline" onClick={() => setMenu({ at: "add" })}>Open a pane</button>
          {menu?.at === "add" && menuBody("add")}
        </div>
      )}
      {finder && <Finder mode={finder.mode} onClose={() => setFinder(null)} onPick={(c) => void open(c, finder.at)} />}
    </div>
  );
}
