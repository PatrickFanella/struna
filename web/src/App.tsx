import { useEffect, useState } from "react";

import { CoachToasts } from "./chat/actions.tsx";
import { Chat } from "./chat/Chat.tsx";
import type { AppInfo } from "./generic.ts";
import { Icon, IconSprite } from "./icons.tsx";
import { Library } from "./library/Library.tsx";
import { Materials } from "./materials/Materials.tsx";
import { useAppLoaded } from "./mode.ts";
import { Practice } from "./practice/Practice.tsx";
import { Tabs } from "./tabs/Tabs.tsx";
import { ToolsSheet } from "./tools/ToolsSheet.tsx";

type Section = AppInfo["sections"][number];
const SECTION: Record<Section, { label: string; icon: "i-stand" | "i-books" | "i-tab" }> = {
  practice: { label: "Practice", icon: "i-stand" },
  library: { label: "Library", icon: "i-books" },
  materials: { label: "Materials", icon: "i-books" },
  tabs: { label: "Tabs", icon: "i-tab" },
};

/** The section the address names, when this server has it; Practice otherwise. */
function sectionFromHash(hash: string, sections: readonly Section[]): Section {
  const h = hash.replace(/^#\/?/, "").split("/")[0];
  return sections.find((s) => s === h) ?? "practice";
}

export type Tool = "tuner" | "metronome";

export function App() {
  const info = useAppLoaded();
  const [hash, setHash] = useState(() => location.hash);
  const [tool, setTool] = useState<Tool | null>(null);
  const [chat, setChat] = useState(false);
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  // The coach panel asks to be opened (a prompt was sent from another screen) and reports replies that finished unseen.
  useEffect(() => {
    const open = () => setChat(true);
    const mark = (e: Event) => {
      const d = (e as CustomEvent<unknown>).detail;
      setUnread(!(d === false || (typeof d === "object" && d !== null && (d as { unread?: unknown }).unread === false)));
    };
    addEventListener("struna:coach-open", open);
    addEventListener("struna:coach-unread", mark);
    return () => {
      removeEventListener("struna:coach-open", open);
      removeEventListener("struna:coach-unread", mark);
    };
  }, []);
  useEffect(() => {
    if (chat) setUnread(false);
  }, [chat]);
  useEffect(() => {
    if (info) document.title = info.name;
  }, [info]);
  // Studio mode takes file drops: one that lands outside the Materials list must not open the file in
  // the tab and leave the app. Materials handles its own drops first (on the document).
  const takesDrops = info?.mode === "studio";
  useEffect(() => {
    if (!takesDrops) return;
    const stray = (e: DragEvent) => {
      if (e.defaultPrevented || ![...(e.dataTransfer?.types ?? [])].includes("Files")) return;
      if ((e.target as Element | null)?.closest?.('input[type="file"]')) return;
      e.preventDefault();
      if (e.type === "dragover") e.dataTransfer!.dropEffect = "none";
    };
    addEventListener("dragover", stray);
    addEventListener("drop", stray);
    return () => {
      removeEventListener("dragover", stray);
      removeEventListener("drop", stray);
    };
  }, [takesDrops]);

  // Nothing is drawn until the server says which app this is, so the wrong sections never flash.
  if (!info) return <div className="app"><IconSprite /></div>;
  const generic = info.mode === "studio";
  const section = sectionFromHash(hash, info.sections);
  const SECTIONS = info.sections.map((id) => ({ id, ...SECTION[id] }));
  const has = (s: Section) => info.sections.includes(s);
  const tabs = (
    <nav className="tabs" aria-label="Sections">
      <div className={SECTIONS.length === 3 ? "wrap" : `wrap n${SECTIONS.length}`}>
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} {...(section === s.id ? { "aria-current": "page" as const } : {})}>
            <Icon id={s.icon} />
            {s.label}
          </a>
        ))}
      </div>
    </nav>
  );

  return (
    <div className={`app${tool ? " tools" : ""}`}>
      <IconSprite />
      <header className="top">
        <div className="wrap">
          <span className="name">
            <span className="brandmark" aria-hidden="true">
              <img className="mark-light" src="/brand/mark-primary.svg" width="28" height="28" alt="" />
              <img className="mark-dark" src="/brand/mark-dark.svg" width="28" height="28" alt="" />
            </span>
            {info.name.toLowerCase() === "struna" ? "struna" : info.name}
          </span>
          <nav className="topnav" aria-label="Sections">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} {...(section === s.id ? { "aria-current": "page" as const } : {})}>
                <Icon id={s.icon} />
                {s.label}
              </a>
            ))}
          </nav>
          <span className="acts">
            <button className="ib" aria-pressed={tool !== null} onClick={() => setTool("tuner")}>
              <Icon id="i-fork" />
              Tuner
            </button>
            <button className="ib" aria-pressed={chat} onClick={() => setChat((c) => !c)}>
              <Icon id="i-chat" />
              Coach
              {generic && unread && !chat && <span className="unread" role="status" aria-label="New reply from the coach" />}
            </button>
          </span>
        </div>
      </header>

      <main>
        <div className="wrap">
          <section className={`view${section === "practice" && !tool ? " on" : ""}`} aria-label="Practice">
            <Practice openTool={setTool} closeTools={() => setTool(null)} openChat={() => setChat(true)} />
          </section>
          {has("library") && (
            <section className={`view${section === "library" && !tool ? " on" : ""}`} aria-label="Library">
              <Library active={section === "library"} />
            </section>
          )}
          {has("materials") && (
            <section className={`view${section === "materials" && !tool ? " on" : ""}`} aria-label="Materials">
              <Materials active={section === "materials"} hash={hash} />
            </section>
          )}
          {has("tabs") && (
            <section className={`view${section === "tabs" && !tool ? " on" : ""}`} aria-label="Tabs">
              <Tabs active={section === "tabs"} />
            </section>
          )}
          {tool && <ToolsSheet tool={tool} onSwitch={setTool} onClose={() => setTool(null)} />}
        </div>
      </main>

      <Chat open={chat} onClose={() => setChat(false)} />

      {generic ? (
        <>
          {/* The toasts sit in the page above the tab bar, taking real space, so they never cover the
              session bar or the end of a page. The tools sheet hides the bar; there they float. */}
          <div className="dock">
            {!tool && <CoachToasts />}
            {tabs}
          </div>
          {tool && <CoachToasts />}
        </>
      ) : (
        tabs
      )}
    </div>
  );
}

export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <h1>{title}</h1>
      <p className="instr">{text}</p>
    </div>
  );
}
