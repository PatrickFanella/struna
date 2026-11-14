import { AlphaTabApi, type model, synth } from "@coderline/alphatab";
import { useEffect, useRef, useState } from "react";

import { effectiveTheme } from "../theme.ts";

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** A Guitar Pro file rendered and played by alphaTab, in ink on the page color. */
export function TabPlayer({ src, title }: { src: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const api = useRef<AlphaTabApi | null>(null);
  const [score, setScore] = useState<model.Score | null>(null);
  const [track, setTrack] = useState(0);
  const [ready, setReady] = useState(false);
  const [loadPct, setLoadPct] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(100);
  const [loop, setLoop] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!box.current || !scroller.current) return;
    setScore(null);
    setReady(false);
    setError("");
    setPlaying(false);
    const ink = css("--ink");
    const graphite = css("--graphite");
    const edge = css("--edge");
    const a = new AlphaTabApi(box.current, {
      core: { file: src, fontDirectory: "/font/", useWorkers: true },
      display: {
        scale: window.innerWidth < 700 ? 0.8 : 1,
        resources: { mainGlyphColor: ink, secondaryGlyphColor: graphite, scoreInfoColor: ink, staffLineColor: edge, barSeparatorColor: ink, barNumberColor: graphite },
      },
      player: { enablePlayer: true, soundFont: "/soundfont/sonivox.sf2", scrollElement: scroller.current, enableUserInteraction: true },
    });
    api.current = a;
    a.scoreLoaded.on((s) => {
      setScore(s);
      setTrack(0);
      setFrom("");
      setTo("");
    });
    a.error.on((e) => setError(String(e?.message ?? e)));
    a.soundFontLoad.on((e) => setLoadPct(Math.round((e.loaded / Math.max(1, e.total)) * 100)));
    a.playerReady.on(() => setReady(true));
    a.playerStateChanged.on((e) => setPlaying(e.state === synth.PlayerState.Playing));
    // Show a range dragged on the score as bar numbers. Playback ticks follow repeats, so map them through the tick cache.
    a.playbackRangeChanged.on((e) => {
      const lookups = a.tickCache?.masterBars;
      if (!lookups || !e.playbackRange) return;
      const at = (tick: number) => lookups.find((l) => tick >= l.start && tick < l.end) ?? lookups.at(-1);
      const first = at(e.playbackRange.startTick);
      const last = at(Math.max(e.playbackRange.startTick, e.playbackRange.endTick - 1));
      if (first) setFrom(String(first.masterBar.index + 1));
      if (last) setTo(String(last.masterBar.index + 1));
    });
    return () => {
      a.destroy();
      api.current = null;
    };
  }, [src]);

  const chooseTrack = (i: number) => {
    const s = api.current?.score;
    if (!s?.tracks[i]) return;
    setTrack(i);
    api.current!.renderTracks([s.tracks[i]!]);
  };
  const applySpeed = (v: number) => {
    setSpeed(v);
    if (api.current) api.current.playbackSpeed = v / 100;
  };
  const applyRange = (f: string, t: string, on: boolean) => {
    const a = api.current;
    const bars = a?.score?.masterBars;
    if (!a || !bars) return;
    const fi = Math.max(1, Math.min(bars.length, Number(f) || 1));
    const ti = Math.max(fi, Math.min(bars.length, Number(t) || bars.length));
    if (!f && !t) {
      a.playbackRange = null;
      a.clearPlaybackRangeHighlight();
    } else {
      const cache = a.tickCache;
      if (!cache) return;
      a.playbackRange = { startTick: cache.getMasterBarStart(bars[fi - 1]!), endTick: cache.getMasterBar(bars[ti - 1]!).end };
    }
    a.isLooping = on;
  };

  const bars = score?.masterBars.length ?? 0;
  return (
    <div className="tabplayer">
      <div className="tabctl">
        <button className="btn primary" disabled={!ready} onClick={() => api.current?.playPause()}>{playing ? "Pause" : ready ? "Play" : `Loading sounds ${loadPct}%`}</button>
        <button className="btn quiet" disabled={!ready} onClick={() => api.current?.stop()}>Stop</button>
        <label className="tempoctl">
          <span className="grp">Tempo <span className="num">{speed}%</span></span>
          <input type="range" min={25} max={150} step={5} value={speed} onChange={(e) => applySpeed(Number(e.target.value))} aria-label="Playback tempo, percent" />
        </label>
      </div>
      <div className="tabctl">
        {score && score.tracks.length > 1 && (
          <label className="set trackpick">
            <span><b>{score.tracks[track]?.name || `Track ${track + 1}`}</b></span>
            <select aria-label="Track" value={track} onChange={(e) => chooseTrack(Number(e.target.value))}>
              {score.tracks.map((t, i) => <option key={i} value={i}>{t.name || `Track ${i + 1}`}</option>)}
            </select>
          </label>
        )}
        <div className="loopctl">
          <span className="grp">Bars</span>
          <input className="input num" inputMode="numeric" placeholder="1" value={from} onChange={(e) => setFrom(e.target.value)} onBlur={() => applyRange(from, to, loop)} aria-label="Loop from bar" />
          <span>to</span>
          <input className="input num" inputMode="numeric" placeholder={String(bars || "")} value={to} onChange={(e) => setTo(e.target.value)} onBlur={() => applyRange(from, to, loop)} aria-label="Loop to bar" />
          <button className={`btn ${loop ? "outline on" : "quiet"}`} aria-pressed={loop} onClick={() => {
            setLoop(!loop);
            applyRange(from, to, !loop);
          }}>Loop</button>
          {(from || to) && <button className="linkbtn" onClick={() => {
            setFrom("");
            setTo("");
            applyRange("", "", loop);
          }}>Clear</button>}
        </div>
      </div>
      {error && <p className="notice" role="alert">This tab could not be opened: {error}</p>}
      <div className={`tabscroll${effectiveTheme() === "dark" ? " dark" : ""}`} ref={scroller}>
        <div ref={box} aria-label={`Tab: ${title}`} />
      </div>
    </div>
  );
}
