export type BeatEvent = { time: number; beat: number; sub: number; accent: boolean };

/** Click times in [from, until), counted from `start` so bars stay aligned across scheduling windows. */
export function scheduleBeats(o: { start: number; bpm: number; beatsPerBar: number; subdivision: number; from: number; until: number }): BeatEvent[] {
  const step = 60 / o.bpm / o.subdivision;
  const out: BeatEvent[] = [];
  let k = Math.max(0, Math.ceil((o.from - o.start) / step - 1e-9));
  for (;; k++) {
    const time = o.start + k * step;
    if (time >= o.until - 1e-9) break;
    const sub = k % o.subdivision;
    const beat = Math.floor(k / o.subdivision) % o.beatsPerBar;
    out.push({ time, beat, sub, accent: beat === 0 && sub === 0 });
  }
  return out;
}
