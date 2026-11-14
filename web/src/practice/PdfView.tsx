import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";

import { store } from "../api.ts";

GlobalWorkerOptions.workerSrc = workerUrl;

/** One PDF page at a time, fitted to the pane's width, with the page remembered per file. */
export function PdfView({ src, storageKey }: { src: string; storageKey: string }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(() => Number(store.get(`guitar-room.page:${storageKey}`)) || 1);
  const [error, setError] = useState("");
  const [width, setWidth] = useState(0);

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
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!doc || !canvas.current || !width) return;
    let task: { cancel(): void; promise: Promise<void> } | undefined;
    let cancelled = false;
    void doc.getPage(page).then((p) => {
      if (cancelled || !canvas.current) return;
      const base = p.getViewport({ scale: 1 });
      const scale = width / base.width;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
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
  }, [doc, page, width, storageKey]);

  return (
    <div className="pdf">
      <div className="pdfpage" ref={box}>
        {error ? <p className="matnote">This PDF could not be opened: {error}</p> : <canvas ref={canvas} aria-label={`Page ${page}`} />}
      </div>
      {doc && doc.numPages > 1 && (
        <div className="pager">
          <button className="ib" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">Previous</button>
          <span className="num">Page {page} of {doc.numPages}</span>
          <button className="ib" disabled={page >= doc.numPages} onClick={() => setPage(page + 1)} aria-label="Next page">Next</button>
        </div>
      )}
    </div>
  );
}
