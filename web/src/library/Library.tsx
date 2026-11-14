import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../api.ts";
import { LIBRARY_MATERIAL_KEY } from "../practice/Practice.tsx";
import { ItemRow } from "./ItemRow.tsx";
import { type Kind, KIND_LABEL, type LibItem, paneItem, type Source, SOURCE_LABEL } from "./item.ts";
import { Viewer } from "./Viewer.tsx";
import { libraryContent } from "../workspace/Finder.tsx";

type Result = { items: LibItem[]; total: number; scannedAt: string | null; scanning: boolean; scanError: string | null };
const SOURCES = Object.keys(SOURCE_LABEL) as Source[];
const KINDS = Object.keys(KIND_LABEL) as Kind[];

export function Library({ active }: { active: boolean }) {
  const [q, setQ] = useState("");
  const [source, setSource] = useState<Source | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<LibItem | null>(null);
  const [filters, setFilters] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (offset = 0) => {
    const n = ++seq.current;
    setLoading(true);
    setError("");
    const p = new URLSearchParams({ offset: String(offset) });
    if (q.trim()) p.set("q", q.trim());
    if (source) p.set("source", source);
    if (kind) p.set("kind", kind);
    try {
      const r = await api.get<Result>(`/api/library?${p}`);
      if (n !== seq.current) return;
      setData((d) => (offset && d ? { ...r, items: [...d.items, ...r.items] } : r));
    } catch (e) {
      if (n === seq.current) setError(String((e as Error).message ?? e));
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [q, source, kind]);

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => void load(0), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [active, load, q]);

  // While a scan runs, refresh until it ends.
  useEffect(() => {
    if (!active || !data?.scanning) return;
    const t = setTimeout(() => void load(0), 2000);
    return () => clearTimeout(t);
  }, [active, data, load]);

  const rescan = async () => {
    await api.post("/api/library/scan");
    void load(0);
  };
  const practice = (i: LibItem) => {
    const c = libraryContent(i);
    if (c.type !== "file") return;
    try {
      sessionStorage.setItem(LIBRARY_MATERIAL_KEY, JSON.stringify(c.item));
    } catch {
      /* storage unavailable */
    }
    dispatchEvent(new Event("guitar-room:material"));
    location.hash = "#practice";
  };

  if (open) return <Viewer item={open} onClose={() => setOpen(null)} onPractice={paneItem(open) ? () => practice(open) : undefined} />;

  const filterCount = (source ? 1 : 0) + (kind ? 1 : 0);
  return (
    <div className="library">
      <h1>Library</h1>
      <div className="searchrow">
        <input className="input" type="search" placeholder="Search lessons, books and sheets" aria-label="Search the library" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn quiet filterbtn" aria-expanded={filters} onClick={() => setFilters(!filters)}>Filters{filterCount ? <span className="num"> {filterCount}</span> : null}</button>
      </div>
      {filters && (
        <div className="filters">
          <p className="grp">Source</p>
          <div className="chips" role="radiogroup" aria-label="Source">
            <button role="radio" aria-checked={!source} className={!source ? "on" : ""} onClick={() => setSource(null)}>All</button>
            {SOURCES.map((s) => <button key={s} role="radio" aria-checked={source === s} className={source === s ? "on" : ""} onClick={() => setSource(s)}>{SOURCE_LABEL[s]}</button>)}
          </div>
          <p className="grp">Kind</p>
          <div className="chips" role="radiogroup" aria-label="Kind">
            <button role="radio" aria-checked={!kind} className={!kind ? "on" : ""} onClick={() => setKind(null)}>All</button>
            {KINDS.map((k) => <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>)}
          </div>
        </div>
      )}
      <div className="libstatus">
        <span>
          {data ? <><span className="num">{data.total}</span> {data.total === 1 ? "item" : "items"}</> : null}
          {data?.scanning ? ", scanning the folders" : data?.scannedAt ? `, indexed ${new Date(data.scannedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}
        </span>
        <button className="linkbtn" disabled={Boolean(data?.scanning)} onClick={rescan}>Rescan</button>
      </div>
      {data?.scanError && <p className="notice" role="alert"><b>The last scan failed.</b> {data.scanError}</p>}
      {error && <p className="notice" role="alert">{error}</p>}
      {!data && loading && <p className="srcnote">Loading the library</p>}
      {data && data.items.length === 0 && !loading && (
        <div className="empty">
          <p className="instr">{data.scanning && !data.scannedAt ? "Indexing the library. This takes a few seconds." : data.scannedAt ? "No results." : "The library has not been indexed yet."}</p>
          {!data.scannedAt && !data.scanning && <button className="btn outline" onClick={rescan}>Index the library</button>}
        </div>
      )}
      <ul className="items">
        {data?.items.map((i) => <ItemRow key={i.id} item={i} onOpen={setOpen} onPractice={practice} />)}
      </ul>
      {data && data.items.length < data.total && (
        <button className="btn quiet full" disabled={loading} onClick={() => void load(data.items.length)}>{loading ? "Loading" : "Show more"}</button>
      )}
    </div>
  );
}
