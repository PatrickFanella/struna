import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { api } from "../api.ts";
import { ChatPanel } from "../chat/Chat.tsx";
import { EpubView } from "../library/EpubView.tsx";
import { type LibItem, paneItem } from "../library/item.ts";
import { VideoView } from "../library/VideoView.tsx";
import { hostOf, webUrl, youtubeEmbed, youtubeId } from "../materials/item.ts";
import { TextView } from "../materials/TextView.tsx";
import { useApp } from "../mode.ts";
import type { PaneItem } from "../practice/Material.tsx";
import { PdfView } from "../practice/PdfView.tsx";
import { TabPlayer } from "../tabs/TabPlayer.tsx";
import { Finder, type FinderMode, libraryContent } from "./Finder.tsx";

export { materialPane } from "../materials/item.ts";

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
  const k = c.item.kind;
  if (k === "tabfile") return "Tab";
  if (k === "link") return c.item.youtube ? "Video" : "Link";
  return k === "pdf" ? "Sheet music" : k === "video" ? "Video" : k === "audio" ? "Audio" : c.item.label;
}

export function paneTitle(c: PaneContent): string {
  return c.type === "coach" ? "Coach" : c.type === "tab" ? `${c.title}, ${c.artist}` : c.item.label;
}

/** How many panes fit side by side in this width. */
function slotsFor(width: number): number {
  return width >= 1240 ? 3 : width >= 680 ? 2 : 1;
}

/** A web link: a YouTube video plays here, from the address that sets no cookies; anything else opens in a new tab. */
function LinkBody({ item }: { item: PaneItem }) {
  const url = webUrl(item.url);
  const yt = youtubeId(item.youtube);
  if (!url && !yt) return <p className="matnote">This link has no web address.</p>;
  return (
    <div className="panescroll linkpane">
      {yt && (
        <div className="ytframe">
          <iframe src={youtubeEmbed(yt)} title={item.label} loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
        </div>
      )}
      <div className="linkcard">
        {!yt && <p className="linktitle">{item.label}</p>}
        {item.note && <p className="matnote">{item.note}</p>}
        {url && (
          <p className="linkacts">
            <a className={yt ? "linkbtn" : "btn outline"} href={url} target="_blank" rel="noreferrer noopener">{yt ? "Open on YouTube" : "Open in a new tab"}</a>
            <span className="linkhost">{hostOf(url)}</span>
          </p>
        )}
      </div>
    </div>
  );
}

/** An image, or a note when it cannot be shown (deleted since the pane was opened, or not an image). */
function ImageBody({ src, label }: { src: string; label: string }) {
  const [bad, setBad] = useState(false);
  if (bad) return <p className="matnote">The image could not be shown. The file may have been removed.</p>;
  return (
    <div className="panescroll imgpane">
      <img src={src} alt={label} onError={() => setBad(true)} />
    </div>
  );
}

/** What a pane shows for a file, a link or a tab file. Also the body of the Materials screen's viewer. */
export function FileBody({ item, onOpen, open }: { item: PaneItem; onOpen?: (c: PaneContent) => void; open?: Set<string> }) {
  const generic = useApp().mode === "studio";
  if (item.missing) return <p className="matnote">Material missing: {item.note ?? item.label}. {generic ? "The plan names a file that is not in your materials. Add it, or ask the coach to fix the plan." : "Check the link in the block note."}</p>;
  if (item.kind === "link") return <LinkBody item={item} />;
  if (item.kind === "image" && item.src) return <ImageBody key={item.src} src={item.src} label={item.label} />;
  if (item.kind === "text" && item.src) return <TextView src={item.src} label={item.label} />;
  if (item.kind === "tabfile" && item.src) return <TabPlayer src={item.src} title={item.label} />;
  if (item.kind === "epub" && item.src) return <EpubView src={item.src} storageKey={item.key} />;
  if (item.kind === "tg") return <p className="matnote">Export to Guitar Pro to view here. This is a TuxGuitar file ({item.note ?? item.label}).</p>;
  if (item.kind === "pdf" && item.src) return <PdfView src={item.src} storageKey={item.key} />;
  if ((item.kind === "video" || item.kind === "audio") && item.src) {
    return (
      <div className="panescroll">
        <VideoView src={item.src} storageKey={item.libId ?? item.key} audioOnly={item.kind === "audio"} poster={item.poster}>
          {item.libId && onOpen && <Companions libId={item.libId} onOpen={onOpen} open={open ?? new Set()} />}
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
export function Workspace({ panes, setPanes, materials, empty, addSlot, focusRequest, onOpenContent }: {
  panes: PaneState[];
  setPanes: (fn: (p: PaneState[]) => PaneState[]) => void;
  materials: PaneItem[];
  empty?: React.ReactNode;
  /** Where the Add pane control goes (for example the session's stage line); defaults to a bar above the panes. */
  addSlot?: HTMLElement | null;
  focusRequest?: { itemKey: string; stageKey: string } | undefined;
  onOpenContent?: (content: PaneContent) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState(1);
  const [tall, setTall] = useState(false);
  const [focus, setFocus] = useState(0);
  useEffect(() => {
    if (!focusRequest) return;
    const at = panes.findIndex((p) => p.content.type === "file" && p.content.item.key === focusRequest.itemKey);
    if (at >= 0) setFocus(at);
  }, [focusRequest?.itemKey, focusRequest?.stageKey]);
  const [menu, setMenu] = useState<Menu>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const menuBox = useRef<HTMLDivElement>(null);
  const focusAfterPick = useRef(false);
  const [menuPosition, setMenuPosition] = useState({ top: 12, left: 12, maxHeight: 300 });
  const restoreMenuFocus = () => {
    const controls = [opener.current, ...box.current?.querySelectorAll<HTMLButtonElement>("[aria-haspopup='menu']") ?? []];
    controls.find((el) => el?.isConnected && el.checkVisibility() && !el.disabled)?.focus();
  };
  const dismissMenu = () => {
    setMenu(null);
    restoreMenuFocus();
  };
  const toggleMenu = (button: HTMLButtonElement, at: number | "add") => {
    opener.current = button;
    setMenu(menu?.at === at ? null : { at });
  };
  useLayoutEffect(() => {
    if (!menu) return;
    const position = () => {
      const anchor = opener.current?.getBoundingClientRect();
      const width = Math.min(360, innerWidth - 24);
      const height = Math.min(menuBox.current?.scrollHeight ?? 300, innerHeight - 24);
      const top = Math.max(12, Math.min(anchor?.bottom ?? 12, innerHeight - height - 12));
      setMenuPosition({ top, left: Math.max(12, Math.min((anchor?.right ?? width + 12) - width, innerWidth - width - 12)), maxHeight: innerHeight - top - 12 });
    };
    position();
    menuBox.current?.querySelector<HTMLButtonElement>("button")?.focus();
    addEventListener("resize", position);
    return () => removeEventListener("resize", position);
  }, [menu]);
  const [finder, setFinder] = useState<{ mode: FinderMode; at: number | "add" } | null>(null);
  const app = useApp();
  const generic = app.mode === "studio";

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // A hidden view (tuner open, another section) measures 0: keep the panes mounted as they were.
      if (!el.clientWidth) return;
      setSlots(slotsFor(el.clientWidth));
      // A portrait iPad stacks two panes, video above and sheet below, instead of two thin columns.
      setTall(el.clientWidth < 1000 && el.clientHeight > el.clientWidth * 1.1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => setFocus((f) => Math.min(f, Math.max(0, panes.length - 1))), [panes.length]);

  const same = (x: PaneContent, y: PaneContent) =>
    x.type === "coach" ? y.type === "coach" : x.type === "tab" ? y.type === "tab" && y.tabId === x.tabId : y.type === "file" && y.item.key === x.item.key;
  const place = (contents: PaneContent[], at: number | "add") => {
    const [first, ...rest] = contents;
    if (!first) return;
    let focusAt = 0;
    setPanes((ps) => {
      const next = [...ps];
      const existing = next.findIndex((p) => same(first, p.content));
      if (existing >= 0 && existing !== at) {
        // Already open: show that pane instead of a second copy.
        focusAt = existing;
      } else if (at === "add" && next.length >= MAX_PANES) {
        // Full: the new item takes the last pane's place.
        focusAt = next.length - 1;
        next[focusAt] = pane(first);
      } else if (at === "add") {
        focusAt = next.length;
        next.push(pane(first));
      } else {
        // A fresh pane, so the viewer starts from the new file's own page, zoom and speed.
        focusAt = at;
        next[at] = pane(first);
      }
      for (const r of rest) if (!next.some((p) => same(r, p.content)) && next.length < MAX_PANES) next.push(pane(r));
      return next;
    });
    setFocus(focusAt);
  };
  const open = async (c: PaneContent, at: number | "add") => {
    setMenu(null);
    setFinder(null);
    const contents = await withCompanion(c);
    focusAfterPick.current = true;
    place(contents, at);
    onOpenContent?.(c);
  };
  useLayoutEffect(() => {
    if (!focusAfterPick.current || menu) return;
    focusAfterPick.current = false;
    restoreMenuFocus();
  }, [panes, menu]);
  const close = (i: number) => {
    setMenu(null);
    setPanes((ps) => ps.filter((_, j) => j !== i));
  };
  // Menus close on Escape or a press outside them.
  useEffect(() => {
    if (!menu) return;
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".panemenu") && !t.closest("[aria-haspopup='menu']")) {
        e.preventDefault();
        dismissMenu();
      }
    };
    addEventListener("pointerdown", down);
    return () => {
      removeEventListener("pointerdown", down);
    };
  }, [menu]);

  const start = Math.max(0, Math.min(focus - slots + 1, panes.length - slots, focus));
  const shown = panes.slice(start, start + slots);
  // The coach is a narrow fixed column; the sheet or tab gets the largest share, the video less.
  const column = (c: PaneContent) =>
    slots === 1 ? "minmax(0, 1fr)" : c.type === "coach" ? "minmax(260px, 300px)" : c.type === "file" && (c.item.kind === "video" || c.item.kind === "audio" || (c.item.kind === "link" && c.item.youtube)) ? "minmax(0, 0.85fr)" : "minmax(0, 1.4fr)";
  const stacked = tall && shown.length === 2;
  const openKeys = new Set(panes.flatMap((p) => (p.content.type === "file" ? [p.content.item.key] : [])));

  const menuBody = (at: number | "add") => createPortal(
    <div className="panemenu" role="menu" aria-label="Choose pane content" ref={menuBox} style={menuPosition} onKeyDown={(e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        dismissMenu();
        return;
      }
      if (e.key === "Tab") { dismissMenu(); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      e.preventDefault();
      buttons[next]?.focus();
    }}>
      <button role="menuitem" onClick={() => open({ type: "coach" }, at)}>Coach</button>
      {materials.length > 0 && <p className="grp">{generic ? "From your plan" : "Block material"}</p>}
      {materials.map((m) => {
        const title = m.label.split(/[\\/]/).pop()!.replace(/\.(pdf|md|txt|mp4|mp3|wav|epub|gp[345x]?)$/i, "");
        const source = [m.label !== title ? m.label : m.key.replace(/^(plan|mat|lib):/, ""), m.note].filter((x) => x && x !== title).join("; ");
        return <button key={m.key} role="menuitem" onClick={() => open({ type: "file", item: m }, at)}>
          <span>{title}{m.missing ? " (missing)" : ""}</span>
          {source && <small>{source}</small>}
        </button>;
      })}
      <p className="grp">Find</p>
      {generic ? (
        <button role="menuitem" onClick={() => (setMenu(null), setFinder({ mode: "materials", at }))}>From your materials…</button>
      ) : (
        <button role="menuitem" onClick={() => (setMenu(null), setFinder({ mode: "library", at }))}>A lesson, sheet or book…</button>
      )}
      {(!generic || app.sections.includes("tabs")) && <button role="menuitem" onClick={() => (setMenu(null), setFinder({ mode: "tabs", at }))}>A Guitar Pro tab…</button>}
    </div>, document.body,
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
            <button className="tool" aria-haspopup="menu" aria-expanded={menu?.at === "add"} onClick={(e) => toggleMenu(e.currentTarget, "add")}>Add pane</button>
            {menu?.at === "add" && menuBody("add")}
          </span>
        );
        return addSlot ? createPortal(add, addSlot) : <div className="wsbar">{add}</div>;
      })()}
      <div className={`panes${stacked ? " stacked" : ""}`} style={stacked ? { gridTemplateRows: shown.map((p) => column(p.content)).join(" ") } : { gridTemplateColumns: shown.map((p) => column(p.content)).join(" ") || "1fr" }}>
        {shown.length === 0 && <div className="pane emptypane">{empty ?? <p className="matnote">Nothing open.</p>}</div>}
        {panes.map((p, i) => {
          // Every open pane stays mounted, so a video keeps its place and loop while another pane has the room.
          const visible = i >= start && i < start + slots;
          return (
            <section key={p.id} className={`pane pane-${p.content.type}`} aria-label={paneTitle(p.content)} hidden={!visible}>
              <header className="panehd">
                <span className="panetitle">{paneTitle(p.content)}</span>
                <span className="paneacts">
                  <button className="tool" aria-haspopup="menu" aria-expanded={menu?.at === i} onClick={(e) => toggleMenu(e.currentTarget, i)} aria-label={`Change what ${paneShort(p.content)} shows`}>Change</button>
                  <button className="tool iconbtn" onClick={() => close(i)} aria-label={`Close ${paneTitle(p.content)}`}>
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                  </button>
                </span>
                {menu && menu.at === i && menuBody(menu.at)}
              </header>
              <div className="panebody">
                {p.content.type === "coach" ? (
                  <ChatPanel open={visible} />
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
          <button className="btn outline" aria-haspopup="menu" aria-expanded={menu?.at === "add"} onClick={(e) => toggleMenu(e.currentTarget, "add")}>Open a pane</button>
          {menu?.at === "add" && panes.length === 0 && menuBody("add")}
        </div>
      )}
      {finder && <Finder mode={finder.mode} onClose={() => { setFinder(null); dismissMenu(); }} onPick={(c) => void open(c, finder.at)} />}
    </div>
  );
}
