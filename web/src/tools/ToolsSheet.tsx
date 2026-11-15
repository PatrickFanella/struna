import type { Tool } from "../App.tsx";
import { MetronomePanel } from "./Metronome.tsx";
import { TunerPanel } from "./Tuner.tsx";

/** The tools open as their own sheet: grabber, Tuner/Metronome switch and Done, without the app header or tabs. */
export function ToolsSheet({ tool, onSwitch, onClose }: { tool: Tool; onSwitch: (t: Tool) => void; onClose: () => void }) {
  return (
    <section className="view on" id={tool} aria-label={tool === "tuner" ? "Tuner" : "Metronome"}>
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
