import type { MaterialItem, MaterialKind, MaterialRef } from "../generic.ts";
import type { PaneItem } from "../practice/Material.tsx";
import type { PaneContent } from "../workspace/Workspace.tsx";

export const KIND_LABEL: Record<MaterialKind, string> = { pdf: "PDF", video: "Video", audio: "Audio", image: "Image", tab: "Tab", text: "Text", epub: "EPUB", link: "Link", other: "File" };
/** The kinds the filter offers, in the order a player looks for them. */
export const FILTER_KINDS: MaterialKind[] = ["pdf", "video", "audio", "tab", "text", "image", "link", "epub"];
export const SOURCE_LABEL: Record<MaterialItem["source"], string> = { studio: "Yours", link: "Web link", folder: "Library folder" };

/** File extensions the server keeps, by kind. An upload with another extension is refused before it is sent. */
const EXTS: Record<string, MaterialKind> = {
  pdf: "pdf",
  mp4: "video", m4v: "video", mov: "video", webm: "video", mkv: "video",
  mp3: "audio", m4a: "audio", wav: "audio", ogg: "audio", flac: "audio", opus: "audio",
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image",
  gp: "tab", gp3: "tab", gp4: "tab", gp5: "tab", gpx: "tab", musicxml: "tab", mxl: "tab",
  md: "text", txt: "text",
  epub: "epub",
};
export const UPLOAD_ACCEPT = Object.keys(EXTS).map((e) => `.${e}`).join(",");
export const UPLOAD_LIMIT = 500 * 1024 * 1024;

export function kindOfName(name: string): MaterialKind | null {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name);
  return (m && EXTS[m[1]!.toLowerCase()]) || null;
}

/** Why a file cannot be uploaded, or null when it can. */
export function uploadProblem(file: { name: string; size: number }): string | null {
  if (!kindOfName(file.name)) return "This kind of file is not kept. Use a PDF, image, audio, video, Guitar Pro, MusicXML, text or EPUB file.";
  if (file.size > UPLOAD_LIMIT) return "Larger than 500 MB.";
  if (file.size === 0) return "The file is empty.";
  return null;
}

const YOUTUBE_ID = /^[\w-]{6,20}$/;
/** A YouTube id that is safe to put in an embed address, or null. */
export const youtubeId = (id: string | null | undefined): string | null => (id && YOUTUBE_ID.test(id) ? id : null);
export const youtubeEmbed = (id: string) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`;

/** An http or https address, or null: nothing else is ever put in a link. */
export function webUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Display identity never changes the saved source title or URL/file identity. */
export const materialName = (i: Pick<MaterialItem, "title" | "shortTitle">): string => i.shortTitle?.trim() || i.title;
export const materialProvider = (i: Pick<MaterialItem, "provider" | "url" | "source">): string => i.provider?.trim() || (webUrl(i.url) ? hostOf(i.url!) : SOURCE_LABEL[i.source]);
export const externalLabel = (url: string, provider?: string): string => `Open lesson on ${provider?.trim() || hostOf(url)} (new tab)`;

/** The one compact context line shown beside a musical title in the default list. */
export function materialContext(i: Pick<MaterialItem, "kind" | "provider" | "url" | "source">): string {
  return [KIND_LABEL[i.kind], materialProvider(i)].filter(Boolean).join(" · ");
}

const PANE_KIND: Record<MaterialKind, PaneItem["kind"]> = { pdf: "pdf", video: "video", audio: "audio", image: "image", tab: "tabfile", text: "text", epub: "epub", link: "link", other: "other" };

function withLink(p: PaneItem, url: string | null | undefined, youtube: string | null | undefined, note: string | undefined): PaneItem {
  const safe = webUrl(url);
  if (safe) p.url = safe;
  const yt = p.kind === "link" ? youtubeId(youtube) : null;
  if (yt) p.youtube = yt;
  if (note) p.note = note;
  return p;
}

/** One of the player's materials as something a pane can show. A link that has a saved copy opens the copy. */
export function materialPaneItem(i: MaterialItem): PaneItem {
  const kind = i.src ? PANE_KIND[i.kind === "link" ? "other" : i.kind] : "link";
  return withLink({ key: `mat:${i.id}`, label: materialName(i), ...(i.provider ? { provider: i.provider } : {}), kind, src: i.src }, i.url, i.youtube, i.note || undefined);
}

/** An entry of the plan's material list (`today.materials`) as something a pane can show. */
export function refPaneItem(r: MaterialRef): PaneItem {
  const kind = r.src ? PANE_KIND[r.kind === "link" ? "other" : r.kind] : r.url ? "link" : PANE_KIND[r.kind];
  const p: PaneItem = { key: `plan:${r.key}`, label: r.label, kind, src: r.src };
  if (r.missing) p.missing = true;
  return withLink(p, r.url, r.youtube, r.note);
}

export function materialPane(i: MaterialItem): PaneContent {
  return { type: "file", item: materialPaneItem(i) };
}

/** A short list of names for the coach: "A, B and 3 more". */
export function nameList(names: string[], max = 6): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

/** Fill a prompt's `{input}`; a prompt that needs other values from the screen cannot be used here. */
export function fillInput(text: string, input: string): string | null {
  if (!text.includes("{input}") || /\{[a-z]+\}/.test(text.replaceAll("{input}", ""))) return null;
  return text.replaceAll("{input}", () => input);
}

/**
 * Pasted text as it is saved: Markdown stays as written; anything else (a chord chart, text tab,
 * lyrics) goes in a fenced block, so its spacing and line breaks survive.
 */
export function pastedText(text: string): string {
  const t = text.replace(/\r\n?/g, "\n").replace(/^\n+|\s+$/g, "");
  if (/^(#{1,6} |```|~~~)/m.test(t)) return t;
  let fence = "```";
  while (t.includes(fence)) fence += "`";
  return `${fence}\n${t}\n${fence}`;
}
