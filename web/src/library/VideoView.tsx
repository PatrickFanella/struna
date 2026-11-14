import { useEffect, useRef, useState } from "react";

import { store } from "../api.ts";

const SPEEDS = [0.5, 0.75, 1];

/** A video or audio player with a speed choice and the position remembered per item. */
export function VideoView({ src, storageKey, audioOnly, className }: { src: string; storageKey: string; audioOnly?: boolean; className?: string }) {
  const el = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState(false);
  const key = `guitar-room.position:${storageKey}`;

  useEffect(() => {
    const v = el.current;
    if (!v) return;
    setError(false);
    let last = 0;
    const restore = () => {
      const t = Number(store.get(key));
      if (t > 0 && t < v.duration - 3) v.currentTime = t;
    };
    const save = () => {
      if (Math.abs(v.currentTime - last) < 2) return;
      last = v.currentTime;
      store.set(key, v.ended ? null : String(Math.floor(v.currentTime)));
    };
    v.addEventListener("loadedmetadata", restore);
    v.addEventListener("timeupdate", save);
    v.addEventListener("pause", save);
    return () => {
      v.removeEventListener("loadedmetadata", restore);
      v.removeEventListener("timeupdate", save);
      v.removeEventListener("pause", save);
    };
  }, [src, key]);

  useEffect(() => {
    if (el.current) el.current.playbackRate = speed;
  }, [speed, src]);

  const Tag = audioOnly ? "audio" : "video";
  return (
    <div className={`av${className ? ` ${className}` : ""}`}>
      <Tag ref={el} src={src} controls playsInline preload="metadata" onError={() => setError(true)} />
      {error && <p className="matnote">This file could not be played. The first play of an .mkv lesson converts it, which can take up to half a minute; try again.</p>}
      <div className="speed">
        <span className="grp">Speed</span>
        <div className="seg mini" role="radiogroup" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button key={s} role="radio" aria-checked={speed === s} className={speed === s ? "on" : ""} onClick={() => setSpeed(s)}>{s === 1 ? "1×" : `${s}×`}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
