import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { parseFrontMatter, str } from "../frontmatter.ts";
import { readCalibreReceipt } from "./calibre.ts";
import { artistWorksSong, artistWorksTitle, bookTitle, cgoGroupKey, fileTitle, slugTitle, titleMatch } from "./titles.ts";

const run = promisify(execFile);

export type Source = "artistworks" | "cgo" | "archive" | "vault" | "books" | "music-books" | "sheets";
export type Kind = "video" | "audio" | "pdf" | "epub" | "zip-entry";
export type Item = {
  id: string;
  source: Source;
  kind: Kind;
  title: string;
  description: string;
  /** Vault-relative for `vault` items; relative to the media root for the rest. */
  path: string | null;
  url: string | null;
  /** The entry name inside the zip at `path`, for zip entries. */
  entry: string | null;
  size: number | null;
  duration: number | null;
  group: string | null;
  /** The EPUB when a book also has a (preferred) PDF. */
  alt: string | null;
  calibreId: number | null;
  /** A video's thumbnail image, relative to the media root. */
  thumb: string | null;
  /** Ids of sheet music and audio that belong with this video. */
  links: string[];
};

export type ScanOptions = {
  mediaRoot: string;
  vaultRoot: string;
  threadRel: string;
  calibreReceipt?: string | undefined;
  /** Duration in seconds for a video without one in its metadata (ffprobe, cached). */
  probe?: ((absPath: string, size: number, mtime: number) => Promise<number | null>) | undefined;
  /** The title printed on a PDF's first page (pdftotext, cached). */
  pdfTitle?: ((absPath: string, size: number, mtime: number) => Promise<string | null | undefined>) | undefined;
};

export const ARCHIVE = "Source Archives/Country Guitar Online Assessment Archive - 2026-08-07";
const LEDGERS = `${ARCHIVE}/00-Reports-and-Ledgers`;
const VIDEO = new Set([".mp4", ".mkv", ".m4v", ".webm", ".mov"]);
const THUMB = [".jpg", ".webp", ".png", ".jpeg"];
const ENTRY_KINDS = new Set([".pdf", ".epub", ".odt", ".docx", ".doc", ".txt", ".png", ".jpg", ".jpeg"]);
/** A sheet must name a lesson this well to be attached to it. */
const TITLE_MATCH = 0.75;

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");
const ext = (p: string) => extname(p).toLowerCase();
const stemOf = (p: string) => p.slice(0, p.length - extname(p).length);

type FileInfo = { path: string; size: number; mtime: number };

async function walk(dir: string, out: FileInfo[] = []): Promise<FileInfo[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.isFile()) {
      const s = await stat(p).catch(() => undefined);
      if (s) out.push({ path: p, size: s.size, mtime: s.mtimeMs });
    }
  }
  return out;
}

type Article = { title: string; description: string; source: string; folder: string };

async function readArticles(vaultRoot: string, threadRel: string): Promise<Article[]> {
  const dir = join(vaultRoot, threadRel, "Sources/Raw/Country Guitar Online/Articles");
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".md"));
  return Promise.all(
    names.map(async (n) => {
      const { data } = parseFrontMatter(await readFile(join(dir, n), "utf8"));
      const description = str(data, "description").replace(/\s*(\.\.\.|…)\s*Read more\s*$/i, "…").trim();
      return { title: str(data, "title") || n.replace(/\.md$/, ""), description, source: str(data, "source").replace(/\/+$/, ""), folder: basename(str(data, "video-archive")) };
    }),
  );
}

/**
 * Open one of the archive's SQLite ledgers read-only and immutable: they are in WAL mode,
 * and even a read-only open would create -shm and -wal files in the owner-only archive.
 */
function readLedger<T>(mediaRoot: string, name: string, sql: string): T[] {
  try {
    const url = pathToFileURL(join(mediaRoot, LEDGERS, name));
    url.search = "immutable=1";
    const db = new DatabaseSync(url, { readOnly: true });
    try {
      return db.prepare(sql).all() as T[];
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

/** Stream captures by `provider:id`, from the archive's own ledger. */
function readStreamLedger(mediaRoot: string): Map<string, { page: string; duration: number | null }> {
  const out = new Map<string, { page: string; duration: number | null }>();
  for (const r of readLedger<{ provider: string; external_id: string; source_page: string; duration_seconds: number | null }>(mediaRoot, "stream-archive.sqlite3", "SELECT provider, external_id, source_page, duration_seconds FROM streams")) {
    out.set(`${r.provider.toLowerCase()}:${r.external_id}`, { page: r.source_page.replace(/\/+$/, ""), duration: r.duration_seconds ?? null });
  }
  return out;
}

/** The original upload name of each archived WordPress file, by media id ("media-16265.pdf" → its source URL's file name). */
function readMediaLedger(mediaRoot: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of readLedger<{ media_id: number; source_url: string }>(mediaRoot, "media-archive.sqlite3", "SELECT media_id, source_url FROM media")) {
    const raw = String(r.source_url ?? "").split("/").pop() ?? "";
    let name = raw;
    try {
      name = decodeURIComponent(raw);
    } catch {
      /* a malformed escape: keep the raw name */
    }
    out.set(String(r.media_id), name);
  }
  return out;
}

async function infoJson(videoPath: string): Promise<{ title?: string; duration?: number; webpage_url?: string } | null> {
  try {
    return JSON.parse(await readFile(`${stemOf(videoPath)}.info.json`, "utf8"));
  } catch {
    return null;
  }
}

/** Facts used only to attach sheet music to lessons. */
type Keys = { slug?: string; page?: string; awSong?: string; instructor?: string; sheetTitle?: string };

export async function scanLibrary(o: ScanOptions): Promise<Item[]> {
  const items: Item[] = [];
  const keys = new Map<Item, Keys>();
  const media = (await walk(o.mediaRoot)).map((f) => ({ ...f, rel: relative(o.mediaRoot, f.path) }));
  const files = new Set(media.map((f) => f.rel));
  const articles = await readArticles(o.vaultRoot, o.threadRel);
  const byFolder = new Map(articles.filter((a) => a.folder).map((a) => [a.folder, a]));
  const byPage = new Map(articles.filter((a) => a.source).map((a) => [a.source, a]));
  const ledger = readStreamLedger(o.mediaRoot);
  const uploads = readMediaLedger(o.mediaRoot);
  const calibre = await readCalibreReceipt(o.calibreReceipt);
  const add = (i: Omit<Item, "id" | "url" | "entry" | "alt" | "calibreId" | "group" | "thumb" | "links"> & Partial<Item>, k: Keys = {}) => {
    const item: Item = { url: null, entry: null, alt: null, calibreId: null, group: null, thumb: null, links: [], ...i, id: sha1(`${i.source}\0${i.path}${i.entry ? `\0${i.entry}` : ""}`) };
    items.push(item);
    keys.set(item, k);
    return item;
  };
  const duration = async (f: FileInfo, known: number | null | undefined) =>
    typeof known === "number" && known > 0 ? known : o.probe ? await o.probe(f.path, f.size, f.mtime) : null;
  const thumbOf = (rel: string) => THUMB.map((e) => `${stemOf(rel)}${e}`).find((t) => files.has(t)) ?? null;

  // Books: one item per title, PDF preferred over EPUB.
  const books = new Map<string, { pdf?: (typeof media)[number]; epub?: (typeof media)[number] }>();
  for (const f of media) {
    const top = f.rel.startsWith("Books/Music Books/") ? "music-books" : f.rel.startsWith("Books/") && !f.rel.slice(6).includes("/") ? "books" : null;
    if (!top || (ext(f.rel) !== ".pdf" && ext(f.rel) !== ".epub")) continue;
    const key = `${top}\0${bookTitle(basename(f.rel))}`;
    const b = books.get(key) ?? {};
    b[ext(f.rel) === ".pdf" ? "pdf" : "epub"] = f;
    books.set(key, b);
  }
  for (const [key, b] of books) {
    const [source, title] = key.split("\0") as ["books" | "music-books", string];
    const main = (b.pdf ?? b.epub)!;
    add({
      source,
      kind: b.pdf ? "pdf" : "epub",
      title,
      description: [b.pdf ? "PDF" : "", b.epub ? "EPUB" : ""].filter(Boolean).join(" and "),
      path: main.rel,
      size: main.size,
      duration: null,
      alt: b.pdf && b.epub ? b.epub.rel : null,
      calibreId: calibre.get(main.rel) ?? (b.epub ? calibre.get(b.epub.rel) : undefined) ?? null,
    });
  }

  for (const f of media) {
    const e = ext(f.rel);
    const name = basename(f.rel);
    if (f.rel.startsWith("Lesson Videos/ArtistWorks/") && (VIDEO.has(e) || e === ".mp3")) {
      const instructor = f.rel.split("/")[2] ?? "";
      const audio = e === ".mp3";
      add(
        { source: "artistworks", kind: audio ? "audio" : "video", title: artistWorksTitle(name), description: `${instructor}, ArtistWorks Bluegrass Rhythm Guitar Toolkit${audio ? ", backing track" : ""}`, path: f.rel, size: f.size, duration: await duration(f, null), thumb: audio ? null : thumbOf(f.rel) },
        { instructor, ...(audio ? { awSong: artistWorksSong(name) } : {}) },
      );
    } else if ((f.rel.startsWith("Lesson Videos/Country Guitar Online/") || f.rel.startsWith(`${ARCHIVE}/02-Lesson-Videos/`)) && VIDEO.has(e)) {
      const folder = basename(dirname(f.rel));
      const info = await infoJson(f.path);
      const article = byFolder.get(folder);
      const archived = f.rel.startsWith(ARCHIVE);
      add(
        {
          source: archived ? "archive" : "cgo",
          kind: "video",
          title: article?.title ?? info?.title ?? fileTitle(name),
          description: article?.description || (archived ? "Country Guitar Online, earlier free-lesson archive" : "Country Guitar Online free lesson"),
          path: f.rel,
          size: f.size,
          duration: await duration(f, info?.duration),
          group: cgoGroupKey(name),
          thumb: thumbOf(f.rel),
        },
        { slug: folder, ...(article?.source ? { page: article.source } : {}) },
      );
    } else if (f.rel.startsWith(`${ARCHIVE}/03-Anonymous-Stream-Archive/`) && VIDEO.has(e)) {
      const provider = f.rel.split("/")[3]?.toLowerCase() === "youtube" ? "youtube" : "vimeo";
      const key = `${provider}:${basename(name, extname(name))}`;
      const l = ledger.get(key);
      const article = l ? byPage.get(l.page) : undefined;
      add(
        {
          source: "archive",
          kind: "video",
          title: article?.title ?? (l ? slugTitle(l.page) || "Country Guitar Online home page clip" : name),
          description: article?.description || `Stream capture from the Country Guitar Online archive${l ? `, ${l.page}` : ""}`,
          path: f.rel,
          size: f.size,
          duration: await duration(f, l?.duration),
          group: key,
          thumb: thumbOf(f.rel),
        },
        { ...(l ? { page: l.page } : {}), ...(article?.folder ? { slug: article.folder } : {}) },
      );
    } else if (f.rel.startsWith(ARCHIVE) && e === ".pdf" && (f.rel.includes("/04-WordPress-Media/") || f.rel.includes("/01-Public-Articles-and-Resources/"))) {
      // Archived uploads are named by media id; their first line, or failing that the original
      // upload name, says what they are.
      const printed = o.pdfTitle ? await o.pdfTitle(f.path, f.size, f.mtime) : null;
      const upload = uploads.get(/^media-(\d+)\.pdf$/i.exec(name)?.[1] ?? "");
      const title = printed || (upload ? fileTitle(upload) : fileTitle(name));
      add({ source: "archive", kind: "pdf", title, description: `Country Guitar Online archive PDF${upload ? ` (${upload})` : ""}`, path: f.rel, size: f.size, duration: null }, printed ? { sheetTitle: printed } : {});
    } else if (f.rel.startsWith("Restricted or Rights Review/Music Sheets/") && e === ".zip") {
      const { stdout } = await run("unzip", ["-Z1", f.path], { maxBuffer: 16 * 1024 * 1024 }).catch(() => ({ stdout: "" }));
      for (const entry of stdout.split("\n").filter((x) => x && !x.endsWith("/") && ENTRY_KINDS.has(ext(x)))) {
        add({ source: "sheets", kind: "zip-entry", title: fileTitle(basename(entry)), description: `${dirname(entry)}, in ${name}`, path: f.rel, entry, size: null, duration: null });
      }
    }
  }

  // Lesson files in the vault: PDFs, plus the audio examples in the CGO downloads.
  const thread = join(o.vaultRoot, o.threadRel);
  const vaultDirs: [string, boolean][] = [["Practice/Materials", false], ["Sources/Raw/ArtistWorks", true], ["Sources/Raw/Country Guitar Online/Downloads", true], ["Sources/Raw/Tony Rice", false]];
  for (const [d, deep] of vaultDirs) {
    const found = deep ? await walk(join(thread, d)) : (await walk(join(thread, d))).filter((f) => dirname(f.path) === join(thread, d));
    for (const f of found) {
      const e = ext(f.path);
      const audio = e === ".mp3";
      if (e !== ".pdf" && !(audio && d.endsWith("Downloads"))) continue;
      const rel = relative(o.vaultRoot, f.path);
      const name = basename(f.path);
      const aw = d === "Sources/Raw/ArtistWorks";
      const k: Keys = d.endsWith("Downloads") ? { slug: basename(dirname(f.path)) } : aw ? { awSong: artistWorksSong(name), instructor: basename(dirname(f.path)) } : {};
      add({ source: "vault", kind: audio ? "audio" : "pdf", title: aw ? artistWorksTitle(name) : fileTitle(name), description: `Vault: ${relative(thread, dirname(f.path)).replace(/^Sources\/Raw\//, "")}`, path: rel, size: f.size, duration: null }, k);
    }
  }

  // Captures share their lesson-folder copy's title, so a lesson reads the same however it is found.
  const bestTitle = new Map<string, Item>();
  for (const i of items) if (i.group && (i.source === "cgo" || !bestTitle.has(i.group))) bestTitle.set(i.group, i);
  for (const i of items) {
    const best = i.group ? bestTitle.get(i.group) : undefined;
    if (best && best !== i && best.source === "cgo") {
      i.title = best.title;
      if (!i.description || i.description.startsWith("Stream capture")) i.description = best.description;
    }
  }

  linkCompanions(items, keys);
  return items;
}

/**
 * Attach sheet music and audio to lessons:
 * - a CGO lesson and the vault download folder of the same name;
 * - an ArtistWorks video and the same instructor's charts and backing tracks whose song leads the video title;
 * - an archive sheet whose printed title names the lesson (at least 75% of its words, covering half the lesson title).
 * Links go on one copy; lookups gather them across all copies of a lesson.
 */
function linkCompanions(items: Item[], keys: Map<Item, Keys>): void {
  const videos = items.filter((i) => i.kind === "video");
  const companions = items.filter((i) => i.kind === "pdf" || i.kind === "audio");
  const link = (v: Item, c: Item) => {
    if (v !== c && !v.links.includes(c.id)) v.links.push(c.id);
  };
  const bySlug = new Map<string, Item[]>();
  for (const c of companions) {
    const s = keys.get(c)?.slug;
    if (s && c.source === "vault") bySlug.set(s, [...(bySlug.get(s) ?? []), c]);
  }
  for (const v of videos) {
    const k = keys.get(v) ?? {};
    for (const c of k.slug ? (bySlug.get(k.slug) ?? []) : []) link(v, c);
    if (v.source === "artistworks") {
      const title = v.title.toLowerCase();
      for (const c of companions) {
        const ck = keys.get(c) ?? {};
        if (ck.awSong && ck.instructor === k.instructor && title.startsWith(ck.awSong)) link(v, c);
      }
    }
  }
  // Archive sheets by printed title: attach each to its best-named lessons.
  const lessons = videos.filter((v) => v.source === "cgo" || v.source === "archive");
  for (const c of companions) {
    const sheet = keys.get(c)?.sheetTitle;
    if (!sheet) continue;
    let best = 0;
    let hits: Item[] = [];
    for (const v of lessons) {
      const m = titleMatch(sheet, v.title);
      if (m > best) {
        best = m;
        hits = [v];
      } else if (m === best && m > 0) hits.push(v);
    }
    if (best >= TITLE_MATCH) for (const v of hits) link(v, c);
  }
}

/** ffprobe a file's duration in seconds. */
export async function ffprobeDuration(path: string): Promise<number | null> {
  try {
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], { timeout: 30_000 });
    const n = Number(stdout.trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * The first meaningful line on a PDF's first page, via pdftotext: null when the page has none,
 * undefined when pdftotext could not run (so the caller does not cache a failure as "no title").
 */
export async function pdftotextTitle(path: string): Promise<string | null | undefined> {
  let stdout: string;
  try {
    ({ stdout } = await run("pdftotext", ["-l", "1", "-q", path, "-"], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }));
  } catch {
    return undefined;
  }
  const line = stdout
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .find((l) => /[\p{L}]{3}/u.test(l) && l.length <= 120 && !/^(=|page\b|www\.|https?:)/i.test(l));
  return line ?? null;
}

if (import.meta.main) {
  const { config } = await import("../config.ts");
  const probe = process.argv.includes("--probe");
  const t0 = Date.now();
  const items = await scanLibrary({
    mediaRoot: config.mediaRoot,
    vaultRoot: config.vaultRoot,
    threadRel: config.threadRel,
    calibreReceipt: config.calibreReceipt,
    probe: probe ? (p) => ffprobeDuration(p) : undefined,
    pdfTitle: probe ? (p) => pdftotextTitle(p) : undefined,
  });
  const counts: Record<string, number> = {};
  for (const i of items) counts[`${i.source} ${i.kind}`] = (counts[`${i.source} ${i.kind}`] ?? 0) + 1;
  const videos = items.filter((i) => i.kind === "video");
  const groups = new Set(videos.map((i) => i.group ?? i.id));
  const withSheets = new Set(videos.filter((v) => v.links.length).map((v) => v.group ?? v.id));
  console.log(JSON.stringify({ items: items.length, counts, videoFiles: videos.length, videoLessons: groups.size, lessonsWithCompanions: withSheets.size, thumbs: videos.filter((v) => v.thumb).length, books: items.filter((i) => i.source === "books").length, musicBooks: items.filter((i) => i.source === "music-books").length, ms: Date.now() - t0 }, null, 2));
}
