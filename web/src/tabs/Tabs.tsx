import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../api.ts";
import { TabPlayer } from "./TabPlayer.tsx";

type Tab = { id: string; artist: string; title: string; version: number; ext: string };
type Result = { items: Tab[]; total: number; scanning: boolean };

/** The Guitar Pro collection: browse-only, never offered to practice sessions. */
export function Tabs({ active }: { active: boolean }) {
  const [q, setQ] = useState("");
  const [artist, setArtist] = useState<string | null>(null);
  const [artists, setArtists] = useState<{ artist: string; count: number }[]>([]);
  const [data, setData] = useState<Result | null>(null);
  const [open, setOpen] = useState<Tab | null>(null);
  const [error, setError] = useState("");
  const seq = useRef(0);

  const load = useCallback(async (offset = 0) => {
    const n = ++seq.current;
    setError("");
    const p = new URLSearchParams({ offset: String(offset) });
    if (q.trim()) p.set("q", q.trim());
    if (artist) p.set("artist", artist);
    try {
      const [r, a] = await Promise.all([api.get<Result>(`/api/tabs?${p}`), artist ? Promise.resolve(null) : api.get<{ artist: string; count: number }[]>(`/api/tabs/artists?q=${encodeURIComponent(q.trim())}`)]);
      if (n !== seq.current) return;
      setData((d) => (offset && d ? { ...r, items: [...d.items, ...r.items] } : r));
      if (a) setArtists(a);
    } catch (e) {
      if (n === seq.current) setError(String((e as Error).message ?? e));
    }
  }, [q, artist]);

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => void load(0), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [active, load, q]);

  if (open) {
    return (
      <div className="viewer tabview">
        <button className="linkbtn" onClick={() => setOpen(null)}>Back to the tabs</button>
        <h1>{open.title}</h1>
        <p className="srcnote">{open.artist}{open.version > 1 ? `, version ${open.version}` : ""}, {open.ext.toUpperCase()}</p>
        <TabPlayer src={`/api/tabs/${open.id}/file`} title={`${open.artist}, ${open.title}`} />
      </div>
    );
  }

  return (
    <div className="library">
      <h1>Tabs</h1>
      <div className="searchrow">
        <input className="input" type="search" placeholder="Search by artist or title" aria-label="Search the tabs" value={q} onChange={(e) => {
          setQ(e.target.value);
          setArtist(null);
        }} />
      </div>
      {artist ? (
        <p className="libstatus"><span>Artist: <b>{artist}</b></span><button className="linkbtn" onClick={() => setArtist(null)}>All artists</button></p>
      ) : (
        artists.length > 0 && q.trim() !== "" && (
          <div className="chips artists" aria-label="Artists">
            {artists.slice(0, 24).map((a) => (
              <button key={a.artist} onClick={() => setArtist(a.artist)}>{a.artist} <span className="num">{a.count}</span></button>
            ))}
          </div>
        )
      )}
      {error && <p className="notice" role="alert">{error}</p>}
      <div className="libstatus"><span>{data ? <><span className="num">{data.total}</span> tabs{data.scanning ? ", indexing the collection" : ""}</> : "Loading the tabs"}</span></div>
      {data && data.items.length === 0 && <p className="instr">{data.scanning ? "Indexing the collection. This takes a few seconds." : "No results."}</p>}
      <ul className="items">
        {data?.items.map((t) => (
          <li className="item" key={t.id}>
            <button className="itemopen" onClick={() => setOpen(t)}>
              <span className="itemtitle">{t.title}{t.version > 1 ? ` (${t.version})` : ""}</span>
              <span className="itemfacts">{t.artist}, {t.ext.toUpperCase()}</span>
            </button>
          </li>
        ))}
      </ul>
      {data && data.items.length < data.total && <button className="btn quiet full" onClick={() => void load(data.items.length)}>Show more</button>}
    </div>
  );
}
