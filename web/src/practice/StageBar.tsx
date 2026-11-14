import type { Stage } from "../types.ts";

export const SHORT: Record<string, string> = { target: "Target", prepare: "Prepare", vocabulary: "Vocabulary", mechanism: "Mechanism", music: "Music", review: "Review" };

/** The short name under the bar and in "Up next": the fixed word in personal mode, the plan's own title otherwise. */
export function stageShort(s: Stage): string {
  return (s.instruction === undefined ? SHORT[s.key] : undefined) ?? s.title;
}

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
          <span key={s.key} className={i === current ? "cur" : ""} style={{ flex: s.minutes }}>{i < current ? "" : stageShort(s)}</span>
        ))}
      </div>
    </>
  );
}
