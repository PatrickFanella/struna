import { type LibItem, KIND_LABEL, megabytes, minutes, paneItem, SOURCE_LABEL } from "./item.ts";

export function ItemRow({ item, onOpen, onPractice }: { item: LibItem; onOpen: (i: LibItem) => void; onPractice: (i: LibItem) => void }) {
  const facts = [
    SOURCE_LABEL[item.source],
    item.kind === "zip-entry" ? `${KIND_LABEL[item.kind]} (${(item.entry ?? "").split(".").pop()?.toUpperCase()})` : KIND_LABEL[item.kind],
    item.alt ? "also EPUB" : "",
    item.copies > 1 ? `${item.copies} copies` : "",
  ].filter(Boolean);
  const amount = item.duration ? minutes(item.duration) : item.size ? megabytes(item.size) : "";
  return (
    <li className="item">
      <button className="itemopen" onClick={() => onOpen(item)}>
        <span className="itemtitle">{item.title}</span>
        <span className="itemfacts">
          {facts.join(", ")}
          {amount && <span className="num">{amount}</span>}
        </span>
      </button>
      {paneItem(item) && (
        <button className="linkbtn usebtn" onClick={() => onPractice(item)}>Use in practice</button>
      )}
    </li>
  );
}
