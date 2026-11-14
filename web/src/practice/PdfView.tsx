import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";

import { store } from "../api.ts";

GlobalWorkerOptions.workerSrc = workerUrl;

type Fit = "page" | "width";

/**
 * One PDF page at a time, with the page turner on top. "Fit page" shows the whole page in the
 * pane; "Fit width" fills the width and scrolls. The page and fit are remembered per file.
 */
export function PdfView({ src, storageKey, defaultFit = "width" }: { src: string; storageKey: string; defaultFit?: Fit }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(() => Number(store.get(`guitar-room.page:${storageKey}`)) || 1);
  const [fit, setFit] = useState<Fit>(() => (store.get(`guitar-room.fit:${storageKey}`) as Fit) || defaultFit);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState("");
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [typed, setTyped] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setError("");
    const task = getDocument({ url: src, httpHeaders: { "x-guitar-room": "1" } });
    task.promise.then(
      (d) => {
        if (cancelled) return void d.destroy();
        setDoc(d);
        setPage((p) => Math.min(Math.max(1, p), d.numPages));
      },
      (e) => !cancelled && setError(String(e?.message ?? e)),
    );
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [src]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!doc || !canvas.current || !size.w) return;
    let task: { cancel(): void; promise: Promise<void> } | undefined;
    let cancelled = false;
    void doc.getPage(page).then((p) => {
      if (cancelled || !canvas.current) return;
      const base = p.getViewport({ scale: 1 });
      // The box has 8 px padding on each side; leave a little more so nothing is clipped.
      const pad = 24;
      const byWidth = (size.w - pad) / base.width;
      const byPage = Math.min(byWidth, size.h > 80 ? (size.h - pad) / base.height : byWidth);
      const scale = (fit === "page" ? byPage : byWidth) * zoom;
      // Keep the backing store under about 16 million pixels, or iPad Safari shows a blank canvas.
      const cssW = base.width * scale;
      const cssH = base.height * scale;
      const dpr = Math.min(window.devicePixelRatio || 1, 3, Math.sqrt(16e6 / Math.max(1, cssW * cssH)));
      const vp = p.getViewport({ scale: scale * dpr });
      const c = canvas.current;
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      c.style.width = `${Math.floor(vp.width / dpr)}px`;
      c.style.height = `${Math.floor(vp.height / dpr)}px`;
      task = p.render({ canvas: c, viewport: vp });
      task.promise.catch(() => {});
    });
    store.set(`guitar-room.page:${storageKey}`, String(page));
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, size, fit, zoom, storageKey]);

  const pages = doc?.numPages ?? 0;
  const go = (n: number) => pages && setPage(Math.min(pages, Math.max(1, n)));
  const chooseFit = (f: Fit) => {
    setFit(f);
    setZoom(1);
    store.set(`guitar-room.fit:${storageKey}`, f);
  };
  const keys = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (e.key === "ArrowRight" || e.key === "PageDown") (e.preventDefault(), go(page + 1));
    if (e.key === "ArrowLeft" || e.key === "PageUp") (e.preventDefault(), go(page - 1));
  };

  // On touch, tapping the left or right third of the page turns it, as on a music stand.
  const tap = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!matchMedia("(pointer: coarse)").matches) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    if (x < 1 / 3) go(page - 1);
    else if (x > 2 / 3) go(page + 1);
  };

  return (
    <div className="pdf" tabIndex={0} role="group" aria-label="Sheet, arrow keys turn the page" onKeyDown={keys}>
      <div className="pdfbar" role="toolbar" aria-label="Page controls">
        <button className="tool" disabled={page <= 1} onClick={() => go(page - 1)} aria-label="Previous page">‹</button>
        <label className="pagebox">
          <span className="sr">Page</span>
          <input
            className="num"
            inputMode="numeric"
            value={typed ?? String(page)}
            onFocus={(e) => {
              setTyped(String(page));
              e.target.select();
            }}
            onChange={(e) => setTyped(e.target.value.replace(/\D/g, ""))}
            onBlur={() => {
              if (typed) go(Number(typed));
              setTyped(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            aria-label={`Page, of ${pages}`}
          />
          <span className="num">of {pages || "–"}</span>
        </label>
        <button className="tool" disabled={!pages || page >= pages} onClick={() => go(page + 1)} aria-label="Next page">›</button>
        <span className="barsp" />
        <button className="tool" onClick={() => chooseFit(fit === "page" ? "width" : "page")} aria-label={fit === "page" ? "Fit to width" : "Fit whole page"} title={fit === "page" ? "Fit to width" : "Fit whole page"}>
          {fit === "page" ? "Fit width" : "Whole page"}
        </button>
        {size.w >= 360 && (
          <span className="zoom">
            <button className="tool" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} aria-label="Zoom out">−</button>
            <span className="num">{Math.round(zoom * 100)}%</span>
            <button className="tool" onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))} aria-label="Zoom in">+</button>
          </span>
        )}
      </div>
      <div className={`pdfpage fit-${fit}${zoom !== 1 ? " zoomed" : ""}`} ref={box}>
        {error ? <p className="matnote">This PDF could not be opened: {error}</p> : <canvas ref={canvas} onClick={tap} aria-label={`Page ${page} of ${pages}`} />}
      </div>
    </div>
  );
}
