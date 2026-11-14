import { useState } from "react";

import { PdfView } from "../practice/PdfView.tsx";
import { EpubView } from "./EpubView.tsx";
import { entryKind, KIND_LABEL, type LibItem, mediaSrc, megabytes, minutes, SOURCE_LABEL } from "./item.ts";
import { VideoView } from "./VideoView.tsx";

export function Viewer({ item, onClose, onPractice }: { item: LibItem; onClose: () => void; onPractice?: (() => void) | undefined }) {
  const [format, setFormat] = useState<"pdf" | "epub">(item.kind === "epub" ? "epub" : "pdf");
  const src = mediaSrc(item);
  const facts = [SOURCE_LABEL[item.source], KIND_LABEL[item.kind], item.duration ? minutes(item.duration) : item.size ? megabytes(item.size) : ""].filter(Boolean).join(", ");

  let body;
  if (item.kind === "video" || item.kind === "audio") body = <VideoView src={src} storageKey={item.id} audioOnly={item.kind === "audio"} />;
  else if (item.kind === "pdf" && format === "pdf") body = <PdfView src={src} storageKey={item.id} />;
  else if (item.kind === "epub" || (item.kind === "pdf" && format === "epub")) body = <EpubView src={item.kind === "pdf" ? `${src}?format=epub` : src} storageKey={`${item.id}:epub`} />;
  else if (item.kind === "zip-entry" && entryKind(item) === "pdf") body = <PdfView src={src} storageKey={item.id} />;
  else if (item.kind === "zip-entry" && entryKind(item) === "epub") body = <EpubView src={src} storageKey={item.id} />;
  else body = (
    <p className="instr">
      This file cannot be shown in the browser. <a href={src} download={(item.entry ?? item.path ?? "").split("/").pop()}>Download it</a>.
    </p>
  );

  return (
    <div className="viewer">
      <button className="linkbtn" onClick={onClose}>Back to the library</button>
      <h1>{item.title}</h1>
      <p className="srcnote">{facts}{item.description && item.description !== "PDF and EPUB" && item.description !== "PDF" && item.description !== "EPUB" ? `. ${item.description}` : ""}</p>
      <div className="vacts">
        {item.alt && (
          <div className="seg mini words" role="radiogroup" aria-label="Format">
            <button role="radio" aria-checked={format === "pdf"} className={format === "pdf" ? "on" : ""} onClick={() => setFormat("pdf")}>PDF</button>
            <button role="radio" aria-checked={format === "epub"} className={format === "epub" ? "on" : ""} onClick={() => setFormat("epub")}>EPUB</button>
          </div>
        )}
        {onPractice && <button className="btn outline" onClick={onPractice}>Use in practice</button>}
        {item.calibreId && <a className="linkbtn" href={`https://books.subcult.tv/book/${item.calibreId}`} target="_blank" rel="noreferrer">Open in Calibre-Web</a>}
      </div>
      <div className="vbody">{body}</div>
    </div>
  );
}
