import { useEffect, useRef, useState } from "react";

import { store } from "../api.ts";

const MIN = 25;
const MAX = 200;
const PRESETS = [50, 70, 85, 100];

function clock(s: number): string {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/**
 * A video or audio player for practice: speed from 25% to 200% in 5% steps (pitch kept),
 * an A–B loop, 5-second skips, and the position and speed remembered per item.
 */
export function VideoView({ src, storageKey, audioOnly, className, poster, children }: { src: string; storageKey: string; audioOnly?: boolean; className?: string; poster?: string | undefined; children?: React.ReactNode }) {
  const el = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [speed, setSpeed] = useState(() => Number(store.get(`guitar-room.speed:${storageKey}`)) || 100);
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const key = `guitar-room.position:${storageKey}`;
  const loop = useRef<{ a: number | null; b: number | null }>({ a: null, b: null });
  loop.current = { a, b };

  useEffect(() => {
    const v = el.current;
    if (!v) return;
    setError(false);
    setA(null);
    setB(null);
    let last = 0;
    const restore = () => {
      const t = Number(store.get(key));
      if (t > 0 && t < v.duration - 3) v.currentTime = t;
    };
    const tick = () => {
      const { a: la, b: lb } = loop.current;
      if (la !== null && lb !== null && v.currentTime >= lb) v.currentTime = la;
      if (Math.abs(v.currentTime - last) < 2) return;
      last = v.currentTime;
      store.set(key, v.ended ? null : String(Math.floor(v.currentTime)));
    };
    v.addEventListener("loadedmetadata", restore);
    v.addEventListener("timeupdate", tick);
    return () => {
      v.removeEventListener("loadedmetadata", restore);
      v.removeEventListener("timeupdate", tick);
    };
  }, [src, key]);

  useEffect(() => {
    const v = el.current;
    if (!v) return;
    v.playbackRate = speed / 100;
    v.preservesPitch = true;
    store.set(`guitar-room.speed:${storageKey}`, String(speed));
  }, [speed, src, storageKey]);

  const setRate = (n: number) => setSpeed(Math.min(MAX, Math.max(MIN, Math.round(n / 5) * 5)));
  const now = () => el.current?.currentTime ?? 0;
  const skip = (d: number) => {
    if (el.current) el.current.currentTime = Math.max(0, now() + d);
  };
  const markA = () => {
    setA(now());
    if (b !== null && b <= now()) setB(null);
  };
  const markB = () => {
    if (a === null || now() <= a + 0.3) return;
    setB(now());
    if (el.current) el.current.currentTime = a;
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "[") setRate(speed - 5);
    if (e.key === "]") setRate(speed + 5);
  };

  const Tag = audioOnly ? "audio" : "video";
  return (
    <div className={`av${className ? ` ${className}` : ""}`} onKeyDown={keys}>
      <Tag ref={el} src={src} controls playsInline preload="metadata" {...(poster && !audioOnly ? { poster } : {})} onError={() => setError(true)} />
      {children}
      {error && <p className="matnote">This file could not be played. The first play of an .mkv lesson converts it, which can take up to half a minute; try again.</p>}
      <div className="avbar" role="toolbar" aria-label="Practice controls">
        <div className="speedctl">
          <span className="grp">Speed</span>
          <button className="tool" onClick={() => setRate(speed - 5)} aria-label="5 percent slower">−5%</button>
          <label className="speedval">
            <span className="num">{speed}%</span>
            <input type="range" min={MIN} max={MAX} step={5} value={speed} onChange={(e) => setRate(Number(e.target.value))} aria-label="Playback speed, percent" />
          </label>
          <button className="tool" onClick={() => setRate(speed + 5)} aria-label="5 percent faster">+5%</button>
          <span className="presets">
            {PRESETS.map((p) => (
              <button key={p} className={`tool chip num${speed === p ? " on" : ""}`} aria-pressed={speed === p} onClick={() => setRate(p)}>{p}%</button>
            ))}
          </span>
        </div>
        <div className="avloop">
          <button className="tool" onClick={() => skip(-5)} aria-label="Back 5 seconds">−5 s</button>
          <button className="tool" onClick={() => skip(5)} aria-label="Forward 5 seconds">+5 s</button>
          <button className={`tool chip${a !== null ? " on" : ""}`} onClick={markA} aria-label="Set loop start">Loop A{a !== null ? <span className="num"> {clock(a)}</span> : null}</button>
          <button className={`tool chip${b !== null ? " on loopon" : ""}`} onClick={markB} disabled={a === null} aria-label="Set loop end">Loop B{b !== null ? <span className="num"> {clock(b)}</span> : null}</button>
          {(a !== null || b !== null) && <button className="tool" onClick={() => (setA(null), setB(null))}>Clear loop</button>}
        </div>
      </div>
    </div>
  );
}
