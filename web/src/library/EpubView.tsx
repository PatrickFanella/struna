import ePub, { type Book, type Rendition } from "epubjs";
import { useEffect, useRef, useState } from "react";

import { store } from "../api.ts";
import { effectiveTheme } from "../theme.ts";

/** An EPUB, paginated, with the location remembered per item. */
export function EpubView({ src, storageKey }: { src: string; storageKey: string }) {
  const box = useRef<HTMLDivElement>(null);
  const rendition = useRef<Rendition | null>(null);
  const [error, setError] = useState("");
  const [where, setWhere] = useState("");
  const key = `struna.epub:${storageKey}`;

  useEffect(() => {
    if (!box.current) return;
    let book: Book | undefined;
    let cancelled = false;
    setError("");
    (async () => {
      try {
        const res = await fetch(src, { headers: { "x-struna": "1" } });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.arrayBuffer();
        if (cancelled || !box.current) return;
        book = ePub(data);
        const r = book.renderTo(box.current, { width: "100%", height: "100%", spread: "none", flow: "paginated" });
        rendition.current = r;
        const dark = effectiveTheme() === "dark";
        const styles = getComputedStyle(document.documentElement);
        // EPUB pages are separate documents; they need their own local font faces.
        r.hooks.content.register((content: { document: Document }) => {
          const style = content.document.createElement("style");
          style.textContent = [
            ["Regular", "400"], ["Bold", "700"],
          ].map(([face, weight]) => `@font-face{font-family:"Atkinson Hyperlegible Next";font-weight:${weight};src:url("${location.origin}/brand/fonts/AtkinsonHyperlegibleNext-${face}.otf") format("opentype");font-display:swap}`).join("\n");
          content.document.head.append(style);
        });
        r.themes.default({
          body: { color: `${styles.getPropertyValue("--ink").trim()} !important`, background: "transparent !important", "font-family": '"Atkinson Hyperlegible Next", system-ui, sans-serif !important', "line-height": "1.5 !important" },
          a: { color: "inherit !important" },
          img: { "max-width": "100% !important", ...(dark ? { filter: "invert(.88) hue-rotate(180deg)" } : {}) },
        });
        r.on("relocated", (loc: { start: { cfi: string; displayed?: { page: number; total: number } } }) => {
          store.set(key, loc.start.cfi);
          const d = loc.start.displayed;
          setWhere(d ? `Page ${d.page} of ${d.total} in this chapter` : "");
        });
        await r.display(store.get(key) ?? undefined);
      } catch (e) {
        if (!cancelled) setError(String((e as Error).message ?? e));
      }
    })();
    const keys = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") void rendition.current?.next();
      if (e.key === "ArrowLeft") void rendition.current?.prev();
    };
    addEventListener("keydown", keys);
    return () => {
      cancelled = true;
      removeEventListener("keydown", keys);
      rendition.current = null;
      book?.destroy();
    };
  }, [src, key]);

  return (
    <div className="epub">
      {error ? <p className="matnote">This book could not be opened: {error}</p> : <div className="epubpage" ref={box} />}
      <div className="pager">
        <button className="ib" onClick={() => void rendition.current?.prev()} aria-label="Previous page">Previous</button>
        <span>{where}</span>
        <button className="ib" onClick={() => void rendition.current?.next()} aria-label="Next page">Next</button>
      </div>
    </div>
  );
}
