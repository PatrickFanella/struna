import { store } from "../api.ts";
import { scheduleBeats } from "./beats.ts";
import { audio } from "./context.ts";
import { clampBpm } from "./tempo.ts";

export type Subdivision = 1 | 2 | 3 | 4;
export type MetronomeSettings = { bpm: number; beatsPerBar: number; subdivision: Subdivision; countIn: boolean };
export type MetronomeState = MetronomeSettings & { running: boolean; beat: number | null; countingIn: boolean };

export const SUBDIVISIONS: { value: Subdivision; label: string; short: string; log: string; icon: "n-q" | "n-8" | "n-3" | "n-16" }[] = [
  { value: 1, label: "Quarters", short: "Quarters", log: "quarter notes", icon: "n-q" },
  { value: 2, label: "Eighths", short: "Eighths", log: "eighth notes", icon: "n-8" },
  { value: 3, label: "Triplets", short: "Triplets", log: "eighth-note triplets", icon: "n-3" },
  { value: 4, label: "Sixteenths", short: "Sixteenths", log: "sixteenth notes", icon: "n-16" },
];
export const TIME_SIGNATURES = [
  { label: "2/4", beats: 2 },
  { label: "3/4", beats: 3 },
  { label: "4/4", beats: 4 },
  { label: "6/8", beats: 6 },
];

const KEY = "guitar-room.metronome";
const LOOKAHEAD_MS = 25;
const AHEAD_S = 0.1;

function load(): MetronomeSettings {
  const d: MetronomeSettings = { bpm: 72, beatsPerBar: 4, subdivision: 2, countIn: true };
  try {
    const s = JSON.parse(store.get(KEY) ?? "{}");
    return {
      bpm: Number.isFinite(s.bpm) ? clampBpm(s.bpm) : d.bpm,
      beatsPerBar: TIME_SIGNATURES.some((t) => t.beats === s.beatsPerBar) ? s.beatsPerBar : d.beatsPerBar,
      subdivision: [1, 2, 3, 4].includes(s.subdivision) ? s.subdivision : d.subdivision,
      countIn: typeof s.countIn === "boolean" ? s.countIn : d.countIn,
    };
  } catch {
    return d;
  }
}

/**
 * Lookahead scheduler: every 25 ms, queue clicks up to 100 ms ahead on the
 * AudioContext clock, so timing stays steady when the page is busy.
 */
export class Metronome {
  private state: MetronomeState = { ...load(), running: false, beat: null, countingIn: false };
  private listeners = new Set<() => void>();
  private beatListeners = new Set<(beat: number) => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private start0 = 0;
  private scheduledUntil = 0;
  private countInUntil = 0;
  private visual: ReturnType<typeof setTimeout>[] = [];

  get = (): MetronomeState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  onBeat(cb: (beat: number) => void): () => void {
    this.beatListeners.add(cb);
    return () => this.beatListeners.delete(cb);
  }

  private emit(patch: Partial<MetronomeState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  set(opts: Partial<MetronomeSettings>): void {
    const next = { ...this.state, ...opts };
    next.bpm = clampBpm(next.bpm);
    const { bpm, beatsPerBar, subdivision, countIn } = next;
    store.set(KEY, JSON.stringify({ bpm, beatsPerBar, subdivision, countIn }));
    const restart = this.state.running && (bpm !== this.state.bpm || beatsPerBar !== this.state.beatsPerBar || subdivision !== this.state.subdivision);
    this.emit({ bpm, beatsPerBar, subdivision, countIn });
    if (restart) this.realign();
  }

  start(): void {
    if (this.state.running) return;
    const ctx = audio();
    this.start0 = ctx.currentTime + 0.08;
    this.scheduledUntil = this.start0;
    this.countInUntil = this.state.countIn ? this.start0 + (60 / this.state.bpm) * this.state.beatsPerBar : this.start0;
    this.emit({ running: true, beat: null, countingIn: this.state.countIn });
    this.tick();
    this.timer = setInterval(() => this.tick(), LOOKAHEAD_MS);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    for (const t of this.visual) clearTimeout(t);
    this.visual = [];
    this.emit({ running: false, beat: null, countingIn: false });
  }

  toggle(): void {
    if (this.state.running) this.stop();
    else this.start();
  }

  /** Keep playing after a tempo change, restarting the bar at the next scheduled point. */
  private realign() {
    this.start0 = this.scheduledUntil;
    this.countInUntil = this.start0;
  }

  private tick() {
    const ctx = audio();
    const until = ctx.currentTime + AHEAD_S;
    if (until <= this.scheduledUntil) return;
    const s = this.state;
    for (const ev of scheduleBeats({ start: this.start0, bpm: s.bpm, beatsPerBar: s.beatsPerBar, subdivision: s.subdivision, from: this.scheduledUntil, until })) {
      const countIn = ev.time < this.countInUntil - 1e-6;
      if (countIn && ev.sub !== 0) continue;
      this.click(ctx, ev.time, countIn ? 800 : ev.accent ? 1500 : ev.sub === 0 ? 1000 : 700, ev.sub === 0 ? 0.6 : 0.3);
      if (ev.sub === 0) {
        const delay = Math.max(0, (ev.time - ctx.currentTime) * 1000);
        const t = setTimeout(() => {
          this.visual = this.visual.filter((x) => x !== t);
          if (!this.state.running) return;
          this.emit({ beat: ev.beat, countingIn: countIn });
          if (!countIn) for (const cb of this.beatListeners) cb(ev.beat);
        }, delay);
        this.visual.push(t);
      }
    }
    this.scheduledUntil = until;
  }

  private click(ctx: AudioContext, time: number, freq: number, gain: number) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(gain, time + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
    osc.connect(env).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.05);
  }
}

/** Shared by the practice tempo row and the tools sheet, so a tempo set in one carries to the other. */
export const metronome = new Metronome();
