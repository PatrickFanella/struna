import { useRef, useState } from "react";
import { store } from "../api.ts";
import "./help.css";

const TIPS = {
  tuner: ["Tuner", "Choose Start microphone when you want pitch detection. Play one open string at a time. If access is denied, you can tune another way and keep practising. Tuner does not record or upload audio."],
  metronome: ["Metronome", "Choose a comfortable BPM, then Start the click. Tap follows your own pace. Use stage tempo restores the current stage suggestion; a suggestion is not a measured result."],
  recording: ["Recording a take", "Record take asks for microphone access. Stop take lets you listen, save or discard. A denied microphone does not stop your session. A recording is optional and does not assess your playing."],
  reading: ["Reading this exercise", "Tab lines run from the thinnest string (e) at the top to the thickest (E) at the bottom. 0 means an open string; other numbers name a fret. Explore without a guitar whenever you like. Stop if you feel pain or persistent tension."],
} as const;

/** Local disclosure only: never changes a task, starts capture or remounts its reader. */
export function TaskHelp({ task }: { task: keyof typeof TIPS }) {
  const key = `struna.help.${task}`;
  const [open, setOpen] = useState(() => store.get(key) !== "dismissed");
  const summary = useRef<HTMLElement>(null);
  const [title, copy] = TIPS[task];
  const dismiss = () => {
    store.set(key, "dismissed");
    setOpen(false);
    summary.current?.focus({ preventScroll: true });
  };
  return <details className="task-help" open={open} onToggle={(event) => {
    const next = event.currentTarget.open;
    setOpen(next);
    if (!next) store.set(key, "dismissed");
  }}>
    <summary ref={summary}>Help: {title}</summary>
    <p>{copy}</p>
    <button className="linkbtn" type="button" onClick={dismiss}>Got it, hide tip</button>
  </details>;
}
