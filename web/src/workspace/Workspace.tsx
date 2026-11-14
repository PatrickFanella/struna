import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

/** A short name for the pane switcher. */
export function paneShort(c: PaneContent): string {
  if (c.type === "coach") return "Coach";
  if (c.type === "tab") return "Tab";
  return c.item.kind === "pdf" ? "Sheet music" : c.item.kind === "video" ? "Video" : c.item.kind === "audio" ? "Audio" : c.item.label;
}

export function paneTitle(c: PaneContent): string {
  return c.type === "coach" ? "Coach" : c.type === "tab" ? `${c.title}, ${c.artist}` : c.item.label;
}

/** How many panes fit side by side in this width. */
function slotsFor(width: number): number {
  return width >= 1240 ? 3 : width >= 680 ? 2 : 1;
}

function FileBody({ item, onOpen, open }: { item: PaneItem; onOpen: (c: PaneContent) => void; open: Set<string> }) {
  if (item.missing) return <p className="matnote">Material missing: {item.note ?? item.label}. Check the link in the block note.</p>;
  if (item.kind === "tg") return <p className="matnote">Export to Guitar Pro to view here. This is a TuxGuitar file ({item.note ?? item.label}).</p>;
  if (item.kind === "pdf" && item.src) return <PdfView src={item.src} storageKey={item.key} />;
  if ((item.kind === "video" || item.kind === "audio") && item.src) {
    return (
      <div className="panescroll">
        <VideoView src={item.src} storageKey={item.libId ?? item.key} audioOnly={item.kind === "audio"} poster={item.libId ? `/api/media/${item.libId}/thumb` : undefined}>
          {item.libId && <Companions libId={item.libId} onOpen={onOpen} open={open} />}
        </VideoView>
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
function Companions({ libId, onOpen, open }: { libId: string; onOpen: (c: PaneContent) => void; open: Set<string> }) {
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
        {items.map((c) =>
          open.has(`lib:${c.id}`) ? (
            <span key={c.id} className="chipopen">
              <span className="kindbadge">{c.kind === "audio" ? "Audio" : "PDF"}</span>
              {c.title} (open)
            </span>
          ) : (
            <button key={c.id} onClick={() => onOpen(libraryContent(c))}>
              <span className="kindbadge">{c.kind === "audio" ? "Audio" : "PDF"}</span>
              Open {c.title}
            </button>
          ),
        )}
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
export function Workspace({ panes, setPanes, materials, empty, addSlot }: {
  panes: PaneState[];
  setPanes: (fn: (p: PaneState[]) => PaneState[]) => void;
  materials: PaneItem[];
  empty?: React.ReactNode;
  /** Where the Add pane control goes (for example the session's stage line); defaults to a bar above the panes. */
  addSlot?: HTMLElement | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState(1);
  const [tall, setTall] = useState(false);
  const [focus, setFocus] = useState(0);
  const [menu, setMenu] = useState<Menu>(null);
  const [finder, setFinder] = useState<{ mode: "library" | "tabs"; at: number | "add" } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSlots(slotsFor(el.clientWidth));
      // A portrait iPad stacks two panes, video above and sheet below, instead of two thin columns.
      setTall(el.clientWidth < 1000 && el.clientHeight > el.clientWidth * 1.1);
    });
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
  // The coach is a narrow fixed column; the sheet or tab gets the largest share, the video less.
  const column = (c: PaneContent) =>
    slots === 1 ? "minmax(0, 1fr)" : c.type === "coach" ? "minmax(260px, 300px)" : c.type === "file" && (c.item.kind === "video" || c.item.kind === "audio") ? "minmax(0, 0.85fr)" : "minmax(0, 1.4fr)";
  const stacked = tall && shown.length === 2;
  const openKeys = new Set(panes.flatMap((p) => (p.content.type === "file" ? [p.content.item.key] : [])));

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
        <div className="wsbar">
          <div className="panetabs" role="tablist" aria-label="Open panes">
            {panes.map((p, i) => (
              <button key={p.id} role="tab" title={paneTitle(p.content)} aria-selected={i >= start && i < start + slots} className={i >= start && i < start + slots ? "on" : ""} onClick={() => setFocus(i)}>{paneShort(p.content)}</button>
            ))}
          </div>
        </div>
      )}
      {panes.length > 0 && panes.length < MAX_PANES && (() => {
        const add = (
          <span className="wsadd">
            <button className="tool" aria-haspopup="menu" aria-expanded={menu?.at === "add"} onClick={() => setMenu(menu?.at === "add" ? null : { at: "add" })}>Add pane</button>
            {menu?.at === "add" && menuBody("add")}
          </span>
        );
        return addSlot ? createPortal(add, addSlot) : <div className="wsbar">{add}</div>;
      })()}
      <div className={`panes${stacked ? " stacked" : ""}`} style={stacked ? { gridTemplateRows: shown.map((p) => column(p.content)).join(" ") } : { gridTemplateColumns: shown.map((p) => column(p.content)).join(" ") || "1fr" }}>
        {shown.length === 0 && <div className="pane emptypane">{empty ?? <p className="matnote">Nothing open.</p>}</div>}
        {shown.map((p, k) => {
          const i = start + k;
          return (
            <section key={p.id} className={`pane pane-${p.content.type}`} aria-label={paneTitle(p.content)}>
              <header className="panehd">
                <span className="panetitle">{paneTitle(p.content)}</span>
                <span className="paneacts">
                  <button className="tool" aria-haspopup="menu" aria-expanded={menu?.at === i} onClick={() => setMenu(menu?.at === i ? null : { at: i })} aria-label={`Change what ${paneShort(p.content)} shows`}>Change</button>
                  <button className="tool iconbtn" onClick={() => close(i)} aria-label={`Close ${paneTitle(p.content)}`}>
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                  </button>
                </span>
                {menu && menu.at === i && menuBody(menu.at)}
              </header>
              <div className="panebody">
                {p.content.type === "coach" ? (
                  <ChatPanel open />
                ) : p.content.type === "tab" ? (
                  <TabPlayer src={`/api/tabs/${p.content.tabId}/file`} title={paneTitle(p.content)} />
                ) : (
                  <FileBody item={p.content.item} onOpen={(c) => void open(c, "add")} open={openKeys} />
                )}
              </div>
            </section>
          );
        })}
      </div>
      {shown.length === 0 && (
        <div className="paneadd">
          <button className="btn outline" onClick={() => setMenu({ at: "add" })}>Open a pane</button>
          {menu?.at === "add" && panes.length === 0 && menuBody("add")}
        </div>
      )}
      {finder && <Finder mode={finder.mode} onClose={() => setFinder(null)} onPick={(c) => void open(c, finder.at)} />}
    </div>
  );
}
