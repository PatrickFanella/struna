import { useCallback, useEffect, useRef, useState } from "react";

import { store } from "../api.ts";
import { audio } from "../audio/context.ts";
import { MicDenied, micUsers, openMic, stopMic } from "../audio/mic.ts";
import { freqOf, midiOf, noteFor, TUNING_LABEL, TUNINGS, type TuningId, yin } from "../audio/pitch.ts";
import { Icon } from "../icons.tsx";

const IN_TUNE = 5;
const HOLD_MS = 600;
const PITCHES = Array.from({ length: 15 }, (_, i) => 432 + i);

type Reading = { name: string; octave: number; cents: number; midi: number } | null;

function centsText(c: number): string {
  const r = Math.round(Math.abs(c));
  if (Math.abs(c) <= IN_TUNE) return "In tune";
  return `${r} ${r === 1 ? "cent" : "cents"} ${c < 0 ? "flat" : "sharp"}`;
}

function split(note: string): [string, string] {
  const m = /^(.*?)(-?\d)$/.exec(note)!;
  return [m[1]!.replace("#", "♯"), m[2]!];
}

function Scale({ cents }: { cents: number | null }) {
  const ticks: { c: number; cls: string }[] = [];
  for (let c = -50; c <= 50; c += 5) {
    if (c === 5 || c === -5) continue;
    ticks.push({ c, cls: c === 0 ? "tk z" : c % 25 === 0 ? "tk m" : c % 10 === 0 ? "tk" : "tk s" });
  }
  const labels: [number, string][] = [[-50, "−50"], [-25, "−25"], [0, "0"], [25, "+25"], [50, "+50"]];
  return (
    <div className="scale" aria-hidden="true">
      <i className="zone" />
      <i className="base" />
      {ticks.map((t) => <i key={t.c} className={t.cls} style={{ left: `${50 + t.c}%` }} />)}
      {labels.map(([c, l]) => <span key={c} className="lab" style={{ left: `${50 + c}%`, ...(c === 0 ? { color: "var(--ink)" } : {}) }}>{l}</span>)}
      {cents !== null && <i className="nd" style={{ left: `${50 + Math.max(-50, Math.min(50, cents))}%` }} />}
    </div>
  );
}

export function TunerPanel({ onMetronome }: { onMetronome?: () => void }) {
  const [tuning, setTuning] = useState<TuningId>(() => (store.get("struna.tuning") as TuningId) in TUNINGS ? (store.get("struna.tuning") as TuningId) : "standard");
  const [a4, setA4] = useState<number>(() => Number(store.get("struna.a4")) || 440);
  const [target, setTarget] = useState<string | null>(null);
  const [tuned, setTuned] = useState<Set<string>>(new Set());
  const [reading, setReading] = useState<Reading>(null);
  const [cents, setCents] = useState<number | null>(null);
  const [mic, setMic] = useState<"idle" | "starting" | "on" | "denied" | "missing" | "unavailable" | "error">("idle");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const strings = TUNINGS[tuning];
  const live = useRef({ a4, target, strings, smooth: null as number | null, holdFrom: 0, holdNote: "" });
  live.current.a4 = a4;
  live.current.target = target;
  live.current.strings = strings;

  const onFreq = useCallback((freq: number | null) => {
    const l = live.current;
    if (freq === null) return;
    let note: string;
    let c: number;
    let r: Reading;
    if (l.target) {
      const midi = midiOf(l.target);
      c = 1200 * Math.log2(freq / freqOf(midi, l.a4));
      if (Math.abs(c) > 600) return; // An octave or another string; ignore it while a string is chosen.
      const [n, o] = split(l.target);
      r = { name: n, octave: Number(o), cents: c, midi };
      note = l.target;
    } else {
      r = noteFor(freq, l.a4);
      c = r.cents;
      note = `${r.name.replace("♯", "#")}${r.octave}`;
    }
    l.smooth = l.smooth === null || Math.abs(l.smooth - c) > 30 ? c : l.smooth * 0.6 + c * 0.4;
    setReading(r);
    setCents(l.smooth);
    const now = performance.now();
    if (Math.abs(l.smooth) <= IN_TUNE && l.strings.includes(note)) {
      if (l.holdNote !== note) {
        l.holdNote = note;
        l.holdFrom = now;
      } else if (now - l.holdFrom >= HOLD_MS) {
        setTuned((t) => (t.has(note) ? t : new Set(t).add(note)));
      }
    } else l.holdNote = "";
  }, []);

  useEffect(() => {
    const release = () => setEnabled(false);
    micUsers.addEventListener("recording", release);
    return () => micUsers.removeEventListener("recording", release);
  }, []);

  useEffect(() => {
    setReading(null);
    setCents(null);
    live.current.smooth = null;
    live.current.holdNote = "";
    if (!enabled) {
      setMic("idle");
      return;
    }
    let stream: MediaStream | undefined;
    let node: AudioWorkletNode | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let frame: Float32Array | null = null;
    let raf = 0;
    let closed = false;
    (async () => {
      try {
        setMic("starting");
        const ctx = audio();
        stream = await openMic("tuner");
        if (closed) return stopMic(stream);
        await ctx.audioWorklet.addModule("/pitch-worklet.js");
        if (closed) return stopMic(stream);
        source = ctx.createMediaStreamSource(stream);
        node = new AudioWorkletNode(ctx, "pitch-frames");
        node.port.onmessage = (e) => {
          frame = e.data as Float32Array;
        };
        source.connect(node);
        setMic("on");
        const loop = () => {
          if (frame) {
            const f = frame;
            frame = null;
            onFreq(yin(f, ctx.sampleRate));
          }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      } catch (e) {
        if (closed) return;
        stopMic(stream);
        source?.disconnect();
        node?.disconnect();
        if (e instanceof MicDenied) {
          setMic(e.reason);
          setError(e.message);
        }
        else {
          setMic("error");
          setError(String((e as Error).message ?? e));
        }
      }
    })();
    // Release the microphone when the sheet closes or switches to the metronome.
    return () => {
      closed = true;
      cancelAnimationFrame(raf);
      source?.disconnect();
      node?.disconnect();
      if (node) node.port.onmessage = null;
      stopMic(stream);
    };
  }, [enabled, attempt, onFreq]);

  const chooseTuning = (t: TuningId) => {
    setTuning(t);
    setTarget(null);
    setTuned(new Set());
    store.set("struna.tuning", t);
  };
  const choosePitch = (p: number) => {
    setA4(p);
    store.set("struna.a4", String(p));
  };

  const shown = reading ?? (target ? { name: split(target)[0], octave: Number(split(target)[1]) } : null);
  const current = target ?? (reading ? `${reading.name.replace("♯", "#")}${reading.octave}` : null);

  return (
    <div className="mid">
      <div className="upper">
        {mic === "idle" || mic === "denied" || mic === "missing" || mic === "unavailable" || mic === "error" ? (
          <div className="micoff" role="status">
            <p className="read">{mic === "idle" ? "Ready when you are" : mic === "denied" ? "Microphone permission denied" : mic === "missing" ? "No microphone found" : "Microphone unavailable"}</p>
            <p className="instr">{mic === "idle" ? "Use your microphone to detect pitch on this device. Tuner does not record or upload your audio." : error}</p>
            <button className="btn outline" onClick={() => { setEnabled(true); setAttempt((a) => a + 1); }}>{mic === "idle" ? "Start microphone" : "Try again"}</button>
            {onMetronome && <p><button className="linkbtn" onClick={onMetronome}>Open Metronome without a microphone</button></p>}
          </div>
        ) : (
          <>
            <div className="note" aria-live="polite">
              {shown ? (
                <span className="nl">{shown.name}<sub>{shown.octave}</sub></span>
              ) : (
                <span className="nl idle">–</span>
              )}
            </div>
            <p className="read">{cents === null ? (mic === "on" ? "Play a string" : "Starting the microphone") : centsText(cents)}</p>
            <Scale cents={cents} />
            <button className="btn outline" onClick={() => setEnabled(false)}>Stop microphone</button>
          </>
        )}
        <div className="strings" role="group" aria-label="Strings">
          {strings.map((s, i) => {
            const [n, o] = split(s);
            const ok = tuned.has(s);
            const cur = current === s;
            return (
              <button
                key={`${s}-${i}`}
                className={[ok && !cur ? "ok" : "", cur ? "cur" : ""].filter(Boolean).join(" ")}
                aria-pressed={target === s}
                aria-label={`${n}${o}${ok ? ", tuned" : ""}${target === s ? ", chosen" : ""}`}
                onClick={() => {
                  live.current.smooth = null;
                  setTarget(target === s ? null : s);
                }}
              >
                {n}<small>{o}</small>
                {ok && !cur ? <Icon id="i-check" /> : null}
              </button>
            );
          })}
        </div>
      </div>
      <div className="lower">
        <div className="foot">
          <div>
            <p className="grp">Tuning</p>
            <label className="set">
              <span><b>{TUNING_LABEL[tuning]}</b></span>
              <Icon id="i-down" />
              <select aria-label="Tuning" value={tuning} onChange={(e) => chooseTuning(e.target.value as TuningId)}>
                {(Object.keys(TUNINGS) as TuningId[]).map((t) => <option key={t} value={t}>{TUNING_LABEL[t]}</option>)}
              </select>
            </label>
          </div>
          <div>
            <p className="grp">Pitch</p>
            <label className="set">
              <span><b className="num">A4 = {a4} Hz</b></span>
              <Icon id="i-down" />
              <select aria-label="Reference pitch" value={a4} onChange={(e) => choosePitch(Number(e.target.value))}>
                {PITCHES.map((p) => <option key={p} value={p}>A4 = {p} Hz</option>)}
              </select>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
