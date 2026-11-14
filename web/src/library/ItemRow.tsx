import { type LibItem, KIND_LABEL, megabytes, minutes, paneItem, SOURCE_LABEL } from "./item.ts";

export function ItemRow({ item, onOpen, onPractice }: { item: LibItem; onOpen: (i: LibItem) => void; onPractice: (i: LibItem) => void }) {
  const facts = [
    SOURCE_LABEL[item.source],
    item.kind === "zip-entry" ? `${KIND_LABEL[item.kind]} (${(item.entry ?? "").split(".").pop()?.toUpperCase()})` : KIND_LABEL[item.kind],
    item.alt ? "also EPUB" : "",
    item.sheets ? (item.sheets === 1 ? "sheet music" : `${item.sheets} sheets`) : "",
    item.copies > 1 ? `${item.copies} copies` : "",
  ].filter(Boolean);
  const amount = item.duration ? minutes(item.duration) : item.size ? megabytes(item.size) : "";
  return (
    <li className="item">
      <button className="itemopen" onClick={() => onOpen(item)}>
        {item.thumb ? <img className="thumb" src={`/api/media/${item.id}/thumb`} alt="" loading="lazy" /> : <span className={`thumb kind-${item.kind}`} aria-hidden="true">{item.kind === "zip-entry" ? "Sheet" : item.kind === "pdf" ? "PDF" : item.kind === "epub" ? "EPUB" : item.kind === "audio" ? "Audio" : "Video"}</span>}
        <span className="itemtext">
        <span className="itemtitle">{item.title}</span>
        <span className="itemfacts">
          {facts.join(", ")}
          {amount && <span className="num">{amount}</span>}
        </span>
        </span>
      </button>
      {paneItem(item) && (
        <button className="linkbtn usebtn" onClick={() => onPractice(item)}>Use in practice</button>
      )}
    </li>
  );
}
