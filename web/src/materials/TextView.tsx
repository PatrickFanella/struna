import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { nestedHeadings } from "../markdown.ts";

const LIMIT = 400_000;

type Loaded = { text: string; markdown: boolean; cut: boolean };

/**
 * A text or Markdown material: lesson sheets the coach writes, pasted lyrics, chord charts and
 * text tab. Fenced blocks and plain text keep a fixed-width face so tab lines up.
 */
export function TextView({ src, label, hideLabel = false }: { src: string; label: string; hideLabel?: boolean }) {
  const [doc, setDoc] = useState<Loaded | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const stop = new AbortController();
    setDoc(null);
    setError("");
    fetch(src, { signal: stop.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "The file is no longer there." : `The file could not be read (${r.status}).`);
        const text = await r.text();
        setDoc({ text: text.slice(0, LIMIT), markdown: /markdown/i.test(r.headers.get("content-type") ?? ""), cut: text.length > LIMIT });
      })
      .catch((e) => {
        if (!stop.signal.aborted) setError(String((e as Error).message ?? e));
      });
    return () => stop.abort();
  }, [src]);

  if (error) return <p className="matnote" role="alert">{error}</p>;
  if (!doc) return <p className="matnote">Loading {label}</p>;
  return (
    <div className="panescroll">
      {doc.markdown ? (
        <div className="mdoc">
          {/* Pictures are left out: a sheet must not load anything from another site. */}
          <Markdown
            remarkPlugins={[remarkGfm]}
            disallowedElements={["img"]}
            components={{
              a: ({ node: _node, ...p }) => <a {...p} target="_blank" rel="noreferrer noopener" />,
              ...nestedHeadings,
            }}
          >
            {hideLabel ? doc.text.replace(/^# ([^\n]+)\n/, (heading, title: string) => title.trim().toLocaleLowerCase() === label.trim().toLocaleLowerCase() ? "" : heading) : doc.text}
          </Markdown>
        </div>
      ) : (
        <pre className="mdoc plain">{doc.text}</pre>
      )}
      {doc.cut && (
        <p className="matnote">
          This is the start of a long file. <a href={src} download>Download all of it</a>.
        </p>
      )}
    </div>
  );
}
