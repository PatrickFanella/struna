import type { PaneItem } from "../practice/Material.tsx";

export type Source = "artistworks" | "cgo" | "archive" | "vault" | "books" | "music-books" | "sheets";
export type Kind = "video" | "audio" | "pdf" | "epub" | "zip-entry";
export type LibItem = {
  id: string;
  source: Source;
  kind: Kind;
  title: string;
  description: string;
  path: string | null;
  entry: string | null;
  size: number | null;
  duration: number | null;
  group: string | null;
  alt: string | null;
  calibreId: number | null;
  thumb: string | null;
  copies: number;
  /** Sheet music that comes with this lesson. */
  sheets?: number;
};

export const SOURCE_LABEL: Record<Source, string> = {
  artistworks: "ArtistWorks",
  cgo: "Country Guitar Online",
  archive: "Archive",
  vault: "Vault lessons",
  books: "Books",
  "music-books": "Music books",
  sheets: "Music sheets",
};
export const KIND_LABEL: Record<Kind, string> = { video: "Video", audio: "Audio", pdf: "PDF", epub: "EPUB", "zip-entry": "Sheet" };

/** What a zip entry opens as, from its file extension. */
export function entryKind(i: LibItem): "pdf" | "epub" | "other" {
  const e = (i.entry ?? "").toLowerCase();
  return e.endsWith(".pdf") ? "pdf" : e.endsWith(".epub") ? "epub" : "other";
}

export const mediaSrc = (i: LibItem) => (i.kind === "zip-entry" ? `/api/media/${i.id}/entry` : `/api/media/${i.id}`);

export function minutes(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

export function megabytes(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/** Usable in the practice material pane: videos, PDFs and PDF sheets. */
export function paneItem(i: LibItem): PaneItem | null {
  const kind = i.kind === "zip-entry" ? (entryKind(i) === "pdf" ? "pdf" : null) : i.kind === "video" || i.kind === "pdf" ? i.kind : null;
  if (!kind) return null;
  return { key: `lib:${i.id}`, label: i.title, kind, src: mediaSrc(i) };
}
