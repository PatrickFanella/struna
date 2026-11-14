export const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const PLAIN = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const TUNINGS = {
  standard: ["E2", "A2", "D3", "G3", "B3", "E4"],
  dropD: ["D2", "A2", "D3", "G3", "B3", "E4"],
  doubleDropD: ["D2", "A2", "D3", "G3", "B3", "D4"],
} satisfies Record<string, string[]>;
export type TuningId = keyof typeof TUNINGS;
export const TUNING_LABEL: Record<TuningId, string> = { standard: "Standard", dropD: "Drop D", doubleDropD: "Double drop D" };

/** MIDI number of a name like "E2" or "F#3". */
export function midiOf(note: string): number {
  const m = /^([A-G])(#|♯)?(-?\d)$/.exec(note);
  if (!m) throw new Error(`bad note ${note}`);
  return PLAIN.indexOf(m[1]! + (m[2] ? "#" : "")) + (Number(m[3]) + 1) * 12;
}

export const freqOf = (midi: number, a4 = 440) => a4 * 2 ** ((midi - 69) / 12);

export function noteFor(freq: number, a4 = 440): { name: string; octave: number; cents: number; midi: number } {
  const exact = 69 + 12 * Math.log2(freq / a4);
  const midi = Math.round(exact);
  return { name: NOTE_NAMES[((midi % 12) + 12) % 12]!, octave: Math.floor(midi / 12) - 1, cents: (exact - midi) * 100, midi };
}

/**
 * YIN pitch detection (de Cheveigné and Kawahara): difference function,
 * cumulative mean normalization, absolute threshold and parabolic interpolation.
 * Searches 60–1100 Hz, enough for a low D and a capo at the 7th fret.
 */
export function yin(buf: Float32Array, sampleRate: number, threshold = 0.12): number | null {
  const tauMin = Math.floor(sampleRate / 1100);
  const tauMax = Math.min(Math.ceil(sampleRate / 60), Math.floor(buf.length / 2));
  const w = buf.length - tauMax;
  let energy = 0;
  for (let i = 0; i < buf.length; i++) energy += buf[i]! * buf[i]!;
  if (energy / buf.length < 1e-6) return null;

  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let i = 0; i < w; i++) {
      const x = buf[i]! - buf[i + tau]!;
      s += x * x;
    }
    d[tau] = s;
  }
  // Cumulative mean normalized difference.
  const c = new Float32Array(tauMax + 1);
  c[0] = 1;
  let sum = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    sum += d[tau]!;
    c[tau] = sum === 0 ? 1 : (d[tau]! * tau) / sum;
  }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (c[t]! < threshold) {
      while (t + 1 <= tauMax && c[t + 1]! < c[t]!) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;
  // Parabolic interpolation around the minimum.
  const a = c[tau - 1] ?? c[tau]!;
  const b = c[tau]!;
  const z = c[tau + 1] ?? c[tau]!;
  const den = a + z - 2 * b;
  const shift = den === 0 ? 0 : (a - z) / (2 * den);
  return sampleRate / (tau + shift);
}
