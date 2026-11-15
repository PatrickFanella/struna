import { useEffect, useRef } from "react";
import type { Tool } from "../App.tsx";
import { MetronomePanel } from "./Metronome.tsx";
import { TunerPanel } from "./Tuner.tsx";

/** The tools open as their own sheet: grabber, Tuner/Metronome switch and Done, without the app header or tabs. */
export function ToolsSheet({ tool, onSwitch, onClose }: { tool: Tool; onSwitch: (t: Tool) => void; onClose: () => void }) {
  const sheet = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    sheet.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") { event.preventDefault(); close.current(); }
      if (event.key !== "Tab") return;
      const controls = [...sheet.current?.querySelectorAll<HTMLElement>('button, input, select, a[href], textarea') ?? []].filter((el) => !el.matches(":disabled") && el.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); if (opener?.isConnected) requestAnimationFrame(() => opener.focus({ preventScroll: true })); };
  }, []);
  return (
    <section ref={sheet} role="dialog" aria-modal="true" className="view on tool-sheet" id={tool} aria-label={tool === "tuner" ? "Tuner" : "Metronome"}>
      <div className="grab" aria-hidden="true" />
      <div className="sheethd">
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={tool === "tuner"} className={tool === "tuner" ? "on" : ""} onClick={() => onSwitch("tuner")}>Tuner</button>
          <button role="tab" aria-selected={tool === "metronome"} className={tool === "metronome" ? "on" : ""} onClick={() => onSwitch("metronome")}>Metronome</button>
        </div>
        <button className="sheetdone" onClick={onClose}>Done</button>
      </div>
      {tool === "tuner" ? <TunerPanel onMetronome={() => onSwitch("metronome")} /> : <MetronomePanel />}
    </section>
  );
}
