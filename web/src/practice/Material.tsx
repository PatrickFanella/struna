import { useState } from "react";

import { Icon } from "../icons.tsx";
import { VideoView } from "../library/VideoView.tsx";
import { PdfView } from "./PdfView.tsx";

/** Anything the material pane can show: a vault file from the block, or (Plan B) a library item. */
export type PaneItem = { key: string; label: string; kind: "pdf" | "tg" | "video" | "epub" | "other"; src: string | null; missing?: boolean; note?: string };

export function vaultSrc(path: string): string {
  return `/api/vault-file?path=${encodeURIComponent(path)}`;
}

export function Material({ items, current, onPick }: { items: PaneItem[]; current: PaneItem | null; onPick: (key: string) => void }) {
  const [wide, setWide] = useState(false);
  if (!current) return null;
  return (
    <figure className={`mat${wide ? " wide" : ""}`}>
      <figcaption className="cap">
        <span className="matlabel">{current.label}</span>
        {items.length > 1 && (
          <label className="matpick">
            <span>Change</span>
            <Icon id="i-down" />
            <select aria-label="Material" value={current.key} onChange={(e) => onPick(e.target.value)}>
              {items.map((m) => (
                <option key={m.key} value={m.key}>{m.label}{m.missing ? " (missing)" : ""}</option>
              ))}
            </select>
          </label>
        )}
        {current.kind === "pdf" && current.src && !current.missing && (
          <button className="matwide" onClick={() => setWide(!wide)} aria-pressed={wide}>{wide ? "Close" : "Enlarge"}</button>
        )}
      </figcaption>
      {current.missing ? (
        <p className="matnote">Material missing: {current.note ?? current.label}. Check the link in the block note.</p>
      ) : current.kind === "tg" ? (
        <p className="matnote">Export to Guitar Pro to view here. This is a TuxGuitar file ({current.note ?? current.label}).</p>
      ) : current.kind === "pdf" && current.src ? (
        <PdfView src={current.src} storageKey={current.key} />
      ) : current.kind === "video" && current.src ? (
        <VideoView className="matvideo" src={current.src} storageKey={current.key.replace(/^lib:/, "")} />
      ) : (
        <p className="matnote">This file type cannot be shown here.</p>
      )}
    </figure>
  );
}
