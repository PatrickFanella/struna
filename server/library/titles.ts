import { extname } from "node:path";

const stem = (name: string) => name.slice(0, name.length - extname(name).length);

/** "05a_BS_You Are My Sunshine_Rhythm_Intro_ArtistWorks.mp4" → "You Are My Sunshine Rhythm Intro". */
export function artistWorksTitle(fileName: string): string {
  return stem(fileName)
    .replace(/_ArtistWorks$/i, "")
    .replace(/^\d+[a-z]?_/i, "")
    .replace(/^[A-Z]{2,3}_/, "")
    .replace(/_/g, " ")
    .replace(/(?<=\S)-(?=\S)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The song an ArtistWorks chart or backing track belongs to: "BS_You Are My Sunshine-BasicRhythm_ArtistWorks.pdf" → "you are my sunshine". */
export function artistWorksSong(fileName: string): string {
  const s = stem(fileName).replace(/_ArtistWorks$/i, "").replace(/^\d+[a-z]?_/i, "").replace(/^[A-Z]{2,3}_/, "");
  return s
    .split("-")[0]!
    .split("_")
    .filter((w) => !/^\d+bpm$/i.test(w) && !/^[A-G]$/.test(w))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const STOP = new Set(["guitar", "lesson", "lessons", "tab", "tabs", "tablature", "pdf", "cgo", "download", "member", "the", "a", "an", "of", "in", "on", "to", "for", "with", "and", "short", "part", "w", "s"]);

/** Significant words of a title, for matching sheet music to lessons. */
export function titleTokens(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !STOP.has(w)));
}

/**
 * How well a sheet's title names a lesson: the share of the sheet's words found in the
 * lesson title, or 0 when the sheet has fewer than two words or covers under half the lesson's.
 */
export function titleMatch(sheet: string, lesson: string): number {
  // A lick or solo in another key, or over another chord, is a different lesson.
  for (const re of [/\b(?:in|key of)\s+([a-g])\b/i, /\bover\s+(?:the\s+)?([a-g])\s+chord\b/i]) {
    const x = re.exec(sheet)?.[1]?.toLowerCase();
    const y = re.exec(lesson)?.[1]?.toLowerCase();
    if (x && y && x !== y) return 0;
  }
  const a = titleTokens(sheet);
  const b = titleTokens(lesson);
  if (a.size < 2 || b.size === 0) return 0;
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  return hit / b.size < 0.5 ? 0 : hit / a.size;
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
  const t = decodeURIComponent(slug).replace(/[-_]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "G-Run-Licks.pdf" → "G Run Licks"; a trailing 8-digit hex download hash is dropped. */
export function fileTitle(fileName: string): string {
  return bookTitle(fileName)
    .replace(/[-_ ][0-9a-f]{8}$/, "").replace(/[_]+/g, " ").replace(/(?<=\S)-(?=\S)/g, " ").replace(/\s+/g, " ").trim();
}
