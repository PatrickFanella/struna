import type { Stage } from "../types.ts";

export const SHORT: Record<string, string> = { target: "Target", prepare: "Prepare", vocabulary: "Vocabulary", mechanism: "Mechanism", music: "Music", review: "Review" };

export function StageBar({ stages, current, progress }: { stages: Stage[]; current: number; progress: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <>
      <div className="stages" role="img" aria-label={`Stage ${current + 1} of ${stages.length}, ${pct} percent done`}>
        {stages.map((s, i) => (
          <i key={s.key} className={i < current ? "done" : i === current ? "now" : ""} style={{ flex: s.minutes, ...(i === current ? ({ "--p": `${pct}%` } as React.CSSProperties) : {}) }} />
        ))}
      </div>
      <div className="stagelabels" aria-hidden="true">
        {stages.map((s, i) => (
          <span key={s.key} className={i === current ? "cur" : ""} style={{ flex: s.minutes }}>{i < current ? "" : SHORT[s.key]}</span>
        ))}
      </div>
    </>
  );
}
