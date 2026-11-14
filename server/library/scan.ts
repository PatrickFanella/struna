import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { parseFrontMatter, str } from "../frontmatter.ts";
import { readCalibreReceipt } from "./calibre.ts";
import { artistWorksTitle, bookTitle, cgoGroupKey, fileTitle, slugTitle } from "./titles.ts";

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
};

export type ScanOptions = {
  mediaRoot: string;
  vaultRoot: string;
  threadRel: string;
  calibreReceipt?: string | undefined;
  /** Duration in seconds for a video without one in its metadata (ffprobe, cached). */
  probe?: ((absPath: string, size: number, mtime: number) => Promise<number | null>) | undefined;
};

export const ARCHIVE = "Source Archives/Country Guitar Online Assessment Archive - 2026-08-07";
const VIDEO = new Set([".mp4", ".mkv", ".m4v", ".webm", ".mov"]);
const ENTRY_KINDS = new Set([".pdf", ".epub", ".odt", ".docx", ".doc", ".txt", ".png", ".jpg", ".jpeg"]);

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");
const ext = (p: string) => extname(p).toLowerCase();

async function walk(dir: string, out: { path: string; size: number; mtime: number }[] = []): Promise<typeof out> {
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

/** Stream captures by `provider:id`, from the archive's own ledger. */
function readStreamLedger(mediaRoot: string): Map<string, { page: string; duration: number | null }> {
  const out = new Map<string, { page: string; duration: number | null }>();
  try {
    // immutable=1: the ledger is in WAL mode, and even a read-only open would create -shm and -wal
    // files beside it in the owner-only archive.
    const url = pathToFileURL(join(mediaRoot, ARCHIVE, "00-Reports-and-Ledgers/stream-archive.sqlite3"));
    url.search = "immutable=1";
    const db = new DatabaseSync(url, { readOnly: true });
    try {
      for (const r of db.prepare("SELECT provider, external_id, source_page, duration_seconds FROM streams").all() as { provider: string; external_id: string; source_page: string; duration_seconds: number | null }[]) {
        out.set(`${r.provider.toLowerCase()}:${r.external_id}`, { page: r.source_page, duration: r.duration_seconds ?? null });
      }
    } finally {
      db.close();
    }
  } catch {
    /* no ledger: captures are titled by id */
  }
  return out;
}

async function infoJson(videoPath: string): Promise<{ title?: string; duration?: number; webpage_url?: string } | null> {
  const p = videoPath.slice(0, videoPath.length - extname(videoPath).length) + ".info.json";
  try {
    return JSON.parse(await readFile(p, "utf8"));
  } catch {
    return null;
  }
}

export async function scanLibrary(o: ScanOptions): Promise<Item[]> {
  const items: Item[] = [];
  const media = (await walk(o.mediaRoot)).map((f) => ({ ...f, rel: relative(o.mediaRoot, f.path) }));
  const articles = await readArticles(o.vaultRoot, o.threadRel);
  const byFolder = new Map(articles.filter((a) => a.folder).map((a) => [a.folder, a]));
  const byPage = new Map(articles.filter((a) => a.source).map((a) => [a.source, a]));
  const ledger = readStreamLedger(o.mediaRoot);
  const calibre = await readCalibreReceipt(o.calibreReceipt);
  const add = (i: Omit<Item, "id" | "url" | "entry" | "alt" | "calibreId" | "group"> & Partial<Item>) =>
    items.push({ url: null, entry: null, alt: null, calibreId: null, group: null, ...i, id: sha1(`${i.source}\0${i.path}${i.entry ? `\0${i.entry}` : ""}`) });
  const duration = async (f: { path: string; size: number; mtime: number }, known: number | null | undefined) =>
    typeof known === "number" && known > 0 ? known : o.probe ? await o.probe(f.path, f.size, f.mtime) : null;

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
      add({ source: "artistworks", kind: e === ".mp3" ? "audio" : "video", title: artistWorksTitle(name), description: `${instructor}, ArtistWorks Bluegrass Rhythm Guitar Toolkit${e === ".mp3" ? ", backing track" : ""}`, path: f.rel, size: f.size, duration: await duration(f, null) });
    } else if ((f.rel.startsWith("Lesson Videos/Country Guitar Online/") || f.rel.startsWith(`${ARCHIVE}/02-Lesson-Videos/`)) && VIDEO.has(e)) {
      const folder = basename(dirname(f.rel));
      const info = await infoJson(f.path);
      const article = byFolder.get(folder);
      const archived = f.rel.startsWith(ARCHIVE);
      add({
        source: archived ? "archive" : "cgo",
        kind: "video",
        title: article?.title ?? info?.title ?? fileTitle(name),
        description: article?.description || (archived ? "Country Guitar Online, earlier free-lesson archive" : "Country Guitar Online free lesson"),
        path: f.rel,
        size: f.size,
        duration: await duration(f, info?.duration),
        group: cgoGroupKey(name),
      });
    } else if (f.rel.startsWith(`${ARCHIVE}/03-Anonymous-Stream-Archive/`) && VIDEO.has(e)) {
      const provider = f.rel.split("/")[3]?.toLowerCase() === "youtube" ? "youtube" : "vimeo";
      const key = `${provider}:${basename(name, extname(name))}`;
      const l = ledger.get(key);
      const article = l ? byPage.get(l.page.replace(/\/+$/, "")) : undefined;
      add({
        source: "archive",
        kind: "video",
        title: article?.title ?? (l ? slugTitle(l.page) || "Country Guitar Online home page clip" : name),
        description: article?.description || `Stream capture from the Country Guitar Online archive${l ? `, ${l.page}` : ""}`,
        path: f.rel,
        size: f.size,
        duration: await duration(f, l?.duration),
        group: key,
      });
    } else if (f.rel.startsWith(ARCHIVE) && e === ".pdf" && (f.rel.includes("/04-WordPress-Media/") || f.rel.includes("/01-Public-Articles-and-Resources/"))) {
      add({ source: "archive", kind: "pdf", title: fileTitle(name), description: "Country Guitar Online archive PDF", path: f.rel, size: f.size, duration: null });
    } else if (f.rel.startsWith("Restricted or Rights Review/Music Sheets/") && e === ".zip") {
      const { stdout } = await run("unzip", ["-Z1", f.path], { maxBuffer: 16 * 1024 * 1024 }).catch(() => ({ stdout: "" }));
      for (const entry of stdout.split("\n").filter((x) => x && !x.endsWith("/") && ENTRY_KINDS.has(ext(x)))) {
        add({ source: "sheets", kind: "zip-entry", title: fileTitle(basename(entry)), description: `${dirname(entry)}, in ${name}`, path: f.rel, entry, size: null, duration: null });
      }
    }
  }

  // Lesson PDFs in the vault.
  const thread = join(o.vaultRoot, o.threadRel);
  const vaultDirs: [string, boolean][] = [["Practice/Materials", false], ["Sources/Raw/ArtistWorks", true], ["Sources/Raw/Country Guitar Online/Downloads", true], ["Sources/Raw/Tony Rice", false]];
  for (const [d, deep] of vaultDirs) {
    const files = deep ? await walk(join(thread, d)) : (await walk(join(thread, d))).filter((f) => dirname(f.path) === join(thread, d));
    for (const f of files.filter((x) => ext(x.path) === ".pdf")) {
      const rel = relative(o.vaultRoot, f.path);
      add({ source: "vault", kind: "pdf", title: fileTitle(basename(f.path)), description: `Vault: ${relative(thread, dirname(f.path)).replace(/^Sources\/Raw\//, "")}`, path: rel, size: f.size, duration: null });
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
  return items;
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
  });
  const counts: Record<string, number> = {};
  for (const i of items) counts[`${i.source} ${i.kind}`] = (counts[`${i.source} ${i.kind}`] ?? 0) + 1;
  const videos = items.filter((i) => i.kind === "video");
  const groups = new Set(videos.map((i) => i.group ?? i.id));
  console.log(JSON.stringify({ items: items.length, counts, videoFiles: videos.length, videoLessons: groups.size, books: items.filter((i) => i.source === "books").length, musicBooks: items.filter((i) => i.source === "music-books").length, withCalibre: items.filter((i) => i.calibreId).length, ms: Date.now() - t0 }, null, 2));
  if (!process.argv.includes("--dry-run")) console.log("(dry run only; the server writes the index)");
}
