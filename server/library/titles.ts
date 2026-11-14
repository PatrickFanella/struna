import { extname } from "node:path";

const stem = (name: string) => name.slice(0, name.length - extname(name).length);

/** "05a_BS_You Are My Sunshine_Rhythm_Intro_ArtistWorks.mp4" → "You Are My Sunshine Rhythm Intro". */
export function artistWorksTitle(fileName: string): string {
  return stem(fileName)
    .replace(/_ArtistWorks$/i, "")
    .replace(/^\d+[a-z]?_/i, "")
    .replace(/^[A-Z]{2,3}_/, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The Vimeo or YouTube id in brackets, or a bare id as the file stem. */
export function cgoGroupKey(fileName: string): string | null {
  const s = stem(fileName);
  const id = /\[([A-Za-z0-9_-]+)\]\s*$/.exec(s)?.[1] ?? (/^[A-Za-z0-9_-]+$/.test(s) ? s : null);
  if (!id) return null;
  if (/^\d{5,12}$/.test(id)) return `vimeo:${id}`;
  if (/^[A-Za-z0-9_-]{11}$/.test(id)) return `youtube:${id}`;
  return null;
}

/** A book's file name without its extension or the "(z-library…)" download suffix. */
export function bookTitle(fileName: string): string {
  return stem(fileName)
    .replace(/\s*\((?:z-library|z-lib|1lib)[^)]*\)\s*$/i, "")
    .replace(/(\.pdf)+$/i, "")
    .trim();
}

/** "https://countryguitaronline.com/12-bar-bluegrass-in-g-creekside-lesson/" → "12 bar bluegrass in g creekside lesson". */
export function slugTitle(url: string): string {
  const slug = url.replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop() ?? "";
  return decodeURIComponent(slug).replace(/[-_]+/g, " ").trim();
}

/** "G-Run-Licks.pdf" → "G Run Licks"; a trailing 8-digit hex download hash is dropped. */
export function fileTitle(fileName: string): string {
  return bookTitle(fileName)
    .replace(/[-_ ][0-9a-f]{8}$/, "").replace(/[_]+/g, " ").replace(/(?<=\S)-(?=\S)/g, " ").replace(/\s+/g, " ").trim();
}
