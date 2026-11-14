import { useEffect, useState } from "react";

import { Icon, IconSprite } from "./icons.tsx";
import { Practice } from "./practice/Practice.tsx";

type Section = "practice" | "library" | "tabs";
const SECTIONS: { id: Section; label: string; icon: "i-stand" | "i-books" | "i-tab" }[] = [
  { id: "practice", label: "Practice", icon: "i-stand" },
  { id: "library", label: "Library", icon: "i-books" },
  { id: "tabs", label: "Tabs", icon: "i-tab" },
];

function sectionFromHash(): Section {
  const h = location.hash.replace(/^#\/?/, "").split("/")[0];
  return h === "library" || h === "tabs" ? h : "practice";
}

export type Tool = "tuner" | "metronome";

export function App() {
  const [section, setSection] = useState<Section>(sectionFromHash);
  const [tool, setTool] = useState<Tool | null>(null);
  const [chat, setChat] = useState(false);

  useEffect(() => {
    const on = () => setSection(sectionFromHash());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);

  return (
    <div className={`app${tool ? " tools" : ""}`}>
      <IconSprite />
      <header className="top">
        <div className="wrap">
          <span className="name">Guitar Room</span>
          <span className="acts">
            <button className="ib" aria-pressed={tool !== null} onClick={() => setTool("tuner")}>
              <Icon id="i-fork" />
              Tuner
            </button>
            <button className="ib" aria-pressed={chat} onClick={() => setChat((c) => !c)}>
              <Icon id="i-chat" />
              Coach
            </button>
          </span>
        </div>
      </header>

      <main>
        <div className="wrap">
          <section className={`view${section === "practice" && !tool ? " on" : ""}`} aria-label="Practice">
            <Practice openTool={setTool} />
          </section>
          <section className={`view${section === "library" && !tool ? " on" : ""}`} aria-label="Library">
            <Empty title="Library" text="Coming soon: lesson videos, PDFs and books." />
          </section>
          <section className={`view${section === "tabs" && !tool ? " on" : ""}`} aria-label="Tabs">
            <Empty title="Tabs" text="Coming soon: the Guitar Pro tab collection." />
          </section>
          {tool && (
            <section className="view on" aria-label="Tools">
              <div className="grab" aria-hidden="true" />
              <div className="sheethd">
                <div className="seg" role="tablist">
                  <span className={tool === "tuner" ? "on" : ""}>Tuner</span>
                  <span className={tool === "metronome" ? "on" : ""}>Metronome</span>
                </div>
                <button className="sheetdone" onClick={() => setTool(null)}>Done</button>
              </div>
            </section>
          )}
        </div>
      </main>

      <nav className="tabs" aria-label="Sections">
        <div className="wrap">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} {...(section === s.id ? { "aria-current": "page" as const } : {})}>
              <Icon id={s.icon} />
              {s.label}
            </a>
          ))}
        </div>
      </nav>
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
