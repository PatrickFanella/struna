import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, join } from "node:path";

import { resolveInside } from "../files.ts";
import { HttpError, readJson, route, send } from "../http.ts";
import { sendFile } from "../library/media.ts";
import { ensureRemux } from "../library/remux.ts";
import { cleanStem, extOf, kindOf, placeFile, safeName, SaveError, saveUrl, tempName } from "./fetch.ts";
import type { Studio } from "./studio.ts";
import type { LinkEntry, MaterialItem, MaterialKind } from "./types.ts";

const UPLOAD_MAX = 500 * 1024 * 1024;
const LIBRARY_CAP = 20_000;
const LIBRARY_TTL = 60_000;
const KINDS = new Set<MaterialKind>(["pdf", "video", "audio", "image", "tab", "text", "epub", "link", "other"]);

/** A listed item; a link whose download failed also says why, and one being downloaded says so. */
export type Listed = MaterialItem & { saveError?: string; saving?: true };
export type Listing = { items: Listed[]; total: number; truncated?: true; linksError?: string };
/** Downloads a link; tests pass their own. `signal` ends the download early. */
export type Saver = (url: string, destDir: string, signal?: AbortSignal) => Promise<{ name: string }>;
const defaultSaver: Saver = (url, destDir, signal) => saveUrl(url, destDir, signal ? { signal } : {});

const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  epub: "application/epub+zip",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  opus: "audio/ogg",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  musicxml: "application/vnd.recordare.musicxml+xml",
  mxl: "application/vnd.recordare.musicxml",
};

const materialsDir = (s: Pick<Studio, "home">) => join(s.home, "materials");
const linksPath = (s: Pick<Studio, "home">) => join(materialsDir(s), "links.json");
const b64 = (s: string) => Buffer.from(s).toString("base64url");
/** The id of a studio file, from its path inside `materials/`. */
export const fileId = (rel: string) => `f.${b64(rel)}`;
const folderId = (n: number, rel: string) => `d${n}.${b64(rel)}`;
export const linkId = (url: string) => `l.${createHash("sha1").update(url).digest("hex").slice(0, 16)}`;
export const srcOf = (id: string) => `/api/materials/file?id=${encodeURIComponent(id)}`;
const titleOf = (name: string) => {
  const ext = extOf(name);
  return ext ? name.slice(0, name.length - ext.length - 1) : name;
};

/** The video id of a YouTube watch, short, Shorts, embed or live link. */
export function youtubeId(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  let id: string | null | undefined;
  if (host === "youtu.be") id = u.pathname.split("/")[1];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [, first, second] = u.pathname.split("/");
    if (first === "watch") id = u.searchParams.get("v");
    else if (first === "shorts" || first === "embed" || first === "live") id = second;
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

type FileInfo = { rel: string; size: number; mtimeMs: number };

/** Files under `dir`, skipping dot-files and dot-folders (the trash, half-written uploads). */
async function walk(dir: string, opts: { cap?: number; keep?: (name: string) => boolean } = {}): Promise<{ files: FileInfo[]; truncated: boolean }> {
  const files: FileInfo[] = [];
  const cap = opts.cap ?? Infinity;
  let truncated = false;
  const visit = async (abs: string, rel: string): Promise<void> => {
    const entries = await readdir(abs, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (truncated) return;
      if (e.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await visit(join(abs, e.name), r);
      else if (e.isFile() && (!opts.keep || opts.keep(e.name))) {
        if (files.length >= cap) {
          truncated = true;
          return;
        }
        const st = await stat(join(abs, e.name)).catch(() => undefined);
        if (st) files.push({ rel: r, size: st.size, mtimeMs: st.mtimeMs });
      }
    }
  };
  await visit(dir, "");
  return { files, truncated };
}

const studioFiles = async (s: Pick<Studio, "home">) => (await walk(materialsDir(s))).files.filter((f) => f.rel !== "links.json");

/** A cheap hash of the names, sizes and times under `materials/` (`links.json` included), for change detection. */
export async function materialsFingerprint(s: Pick<Studio, "home">): Promise<string> {
  const { files } = await walk(materialsDir(s));
  const h = createHash("sha1");
  for (const f of files) h.update(`${f.rel}\0${f.size}\0${Math.round(f.mtimeMs)}\n`);
  return h.digest("hex");
}

type Links = { raw: unknown[]; error?: string; mtimeMs: number };
type Entry = LinkEntry & Record<string, unknown>;

const isEntry = (v: unknown): v is Entry => {
  if (!v || typeof v !== "object" || Array.isArray(v) || typeof (v as Entry).url !== "string") return false;
  try {
    const u = new URL((v as Entry).url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const sameUrl = (a: string, b: string) => {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return a === b;
  }
};

/** `links.json` as written. The coach edits this file too, so a broken one is reported, never replaced. */
async function readLinks(s: Pick<Studio, "home">): Promise<Links> {
  let text: string;
  let mtimeMs = 0;
  try {
    text = await readFile(linksPath(s), "utf8");
    mtimeMs = (await stat(linksPath(s))).mtimeMs;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { raw: [], mtimeMs };
    return { raw: [], mtimeMs, error: `materials/links.json could not be read: ${(e as Error).message}` };
  }
  if (!text.trim()) return { raw: [], mtimeMs };
  try {
    const v = JSON.parse(text);
    if (!Array.isArray(v)) return { raw: [], mtimeMs, error: "materials/links.json must be a JSON array of links" };
    return { raw: v, mtimeMs };
  } catch (e) {
    return { raw: [], mtimeMs, error: `materials/links.json is not valid JSON: ${(e as Error).message}` };
  }
}

async function writeLinks(s: Pick<Studio, "home">, raw: unknown[]): Promise<void> {
  await mkdir(materialsDir(s), { recursive: true });
  const tmp = join(materialsDir(s), `.links-${randomBytes(6).toString("hex")}.tmp`);
  await writeFile(tmp, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o664 });
  await rename(tmp, linksPath(s));
}

const queues = new Map<string, Promise<unknown>>();
/** Read, change and write `links.json` one caller at a time. `change` returns false to leave the file alone. */
function editLinks<T>(s: Pick<Studio, "home">, change: (raw: unknown[]) => Promise<{ write: boolean; value: T }> | { write: boolean; value: T }): Promise<T> {
  const run = async () => {
    const links = await readLinks(s);
    if (links.error) throw new HttpError(409, `${links.error}. Fix or remove the file first (the coach can do it).`);
    const { write, value } = await change(links.raw);
    if (write) await writeLinks(s, links.raw);
    return value;
  };
  const next = (queues.get(s.home) ?? Promise.resolve()).then(run, run);
  queues.set(
    s.home,
    next.catch(() => {}),
  );
  return next;
}

/** What the active plan names, read leniently: a plan the validator rejects still marks its materials. */
async function planRefs(s: Pick<Studio, "home">): Promise<{ files: Set<string>; urls: Set<string>; names: Map<string, string> }> {
  const files = new Set<string>();
  const urls = new Set<string>();
  const names = new Map<string, string>();
  try {
    const plan = JSON.parse(await readFile(join(s.home, "plan", "plan.json"), "utf8"));
    // Stage-only references use the same file/URL identity as the plan's resource list.
    for (const k of Array.isArray(plan?.sessions) ? plan.sessions : []) {
      for (const st of Array.isArray(k?.stages) ? k.stages : []) {
        if (typeof st?.material?.file === "string") files.add(st.material.file.replace(/^\.\//, ""));
        if (typeof st?.material?.url === "string") urls.add(st.material.url);
      }
    }
    for (const m of Array.isArray(plan?.materials) ? plan.materials : []) {
      const label = str(m?.label, 300);
      if (label && typeof m?.file === "string") names.set(m.file.replace(/^\.\//, ""), label);
      if (label && typeof m?.url === "string") names.set(m.url, label);
      if (typeof m?.file === "string") files.add(m.file.replace(/^\.\//, ""));
      if (typeof m?.url === "string") urls.add(m.url);
    }
  } catch {
    /* no plan yet */
  }
  return { files, urls, names };
}

const libraries = new Map<string, { at: number; scan: Promise<{ lists: FileInfo[][]; truncated: boolean }> }>();
/** The library folders' files, walked at most once a minute and capped at 20,000 in all. */
function libraryFiles(dirs: string[]): Promise<{ lists: FileInfo[][]; truncated: boolean }> {
  const key = dirs.join("\0");
  const hit = libraries.get(key);
  if (hit && Date.now() - hit.at < LIBRARY_TTL) return hit.scan;
  const scan = (async () => {
    const lists: FileInfo[][] = [];
    let left = LIBRARY_CAP;
    let truncated = false;
    for (const dir of dirs) {
      const r = await walk(dir, { cap: left, keep: (name) => kindOf(name) !== "other" });
      lists.push(r.files);
      left -= r.files.length;
      truncated ||= r.truncated;
    }
    return { lists, truncated };
  })();
  libraries.set(key, { at: Date.now(), scan });
  return scan;
}

function fileItem(f: FileInfo, inPlan: boolean): Listed {
  const id = fileId(f.rel);
  return { id, title: titleOf(basename(f.rel)), kind: kindOf(f.rel), source: "studio", path: `materials/${f.rel}`, src: srcOf(id), url: null, youtube: null, note: "", size: f.size, added: new Date(f.mtimeMs).toISOString(), inPlan };
}

function displayMetadata(e: Entry): Pick<MaterialItem, "shortTitle" | "provider" | "level"> {
  return { ...(str(e.shortTitle, 300) ? { shortTitle: str(e.shortTitle, 300) } : {}), ...(str(e.provider, 200) ? { provider: str(e.provider, 200) } : {}), ...(str(e.level, 200) ? { level: str(e.level, 200) } : {}) };
}

function linkItem(home: string, e: Entry, fallbackAdded: string, inPlan: boolean): Listed {
  let host = e.url;
  try {
    host = new URL(e.url).hostname;
  } catch {
    /* isEntry has checked it */
  }
  return {
    id: linkId(e.url),
    title: str(e.title, 300) || host,
    ...displayMetadata(e),
    kind: "link",
    source: "link",
    path: null,
    src: null,
    url: e.url,
    youtube: youtubeId(e.url),
    note: [str(e.note, 1000), str(e.level, 200)].filter(Boolean).join(" · "),
    size: null,
    added: typeof e.added === "string" && !Number.isNaN(Date.parse(e.added)) ? new Date(e.added).toISOString() : fallbackAdded,
    inPlan,
    ...(typeof e.saveError === "string" && e.saveError ? { saveError: e.saveError } : {}),
    ...(downloading.has(downloadKey(home, e.url)) ? { saving: true as const } : {}),
  };
}

/** Everything the player can open: studio files, links, then the library folders. */
export async function listMaterials(s: Pick<Studio, "home" | "libraryDirs">, opts: { q?: string; kind?: string; limit?: number } = {}): Promise<Listing> {
  const [files, links, plan, library] = await Promise.all([studioFiles(s), readLinks(s), planRefs(s), libraryFiles(s.libraryDirs ?? [])]);
  const byPath = new Map<string, Listed>();
  const own: Listed[] = [];
  for (const f of files) {
    const item = fileItem(f, plan.files.has(`materials/${f.rel}`));
    byPath.set(item.path!, item);
    own.push(item);
  }
  const linksAdded = new Date(links.mtimeMs).toISOString();
  const seen = new Set<string>();
  for (const e of links.raw) {
    if (!isEntry(e) || seen.has(e.url)) continue;
    seen.add(e.url);
    const inPlan = plan.urls.has(e.url);
    const saved = typeof e.file === "string" ? byPath.get(e.file.replace(/^\.\//, "")) : undefined;
    if (saved && !saved.url) {
      // A saved link shows once, as its file.
      Object.assign(saved, displayMetadata(e));
      saved.url = e.url;
      saved.title = str(e.title, 300) || saved.title;
      saved.note = [str(e.note, 1000), str(e.level, 200)].filter(Boolean).join(" · ");
      saved.inPlan ||= inPlan;
    } else own.push(linkItem(s.home, e, linksAdded, inPlan));
  }
  // Plan-only links must also have a durable Materials destination.
  for (const url of plan.urls) if (!own.some((i) => i.url === url)) {
    try { if (!["http:", "https:"].includes(new URL(url).protocol)) continue; } catch { continue; }
    own.push({ ...linkItem(s.home, { url, title: plan.names.get(url) || url }, linksAdded, true), planOnly: true });
  }
  for (const item of own) {
    const name = plan.names.get(item.path ?? "") || plan.names.get(item.url ?? "");
    if (!item.shortTitle && name) item.shortTitle = name;
  }
  own.sort((a, b) => b.added.localeCompare(a.added) || a.title.localeCompare(b.title));

  const folder: Listed[] = [];
  library.lists.forEach((list, n) => {
    for (const f of list) {
      const id = folderId(n, f.rel);
      folder.push({ id, title: titleOf(basename(f.rel)), kind: kindOf(f.rel), source: "folder", path: `${n}:${f.rel}`, src: srcOf(id), url: null, youtube: null, note: "", size: f.size, added: new Date(f.mtimeMs).toISOString(), inPlan: false });
    }
  });
  folder.sort((a, b) => a.title.localeCompare(b.title));

  const words = (opts.q ?? "").toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const kind = opts.kind && KINDS.has(opts.kind as MaterialKind) ? opts.kind : null;
  const hit = (i: Listed) => {
    if (kind && i.kind !== kind) return false;
    if (!words.length) return true;
    const hay = `${i.shortTitle ?? ""} ${i.title} ${i.provider ?? ""} ${i.level ?? ""} ${i.note} ${i.path ?? ""} ${i.url ?? ""}`.toLocaleLowerCase();
    return words.every((w) => hay.includes(w));
  };
  const all = [...own, ...folder].filter(hit);
  return {
    items: all.slice(0, opts.limit ?? all.length),
    total: all.length,
    ...(library.truncated ? { truncated: true as const } : {}),
    ...(links.error ? { linksError: links.error } : {}),
  };
}

async function itemById(s: Pick<Studio, "home" | "libraryDirs">, id: string): Promise<Listed | undefined> {
  return (await listMaterials(s)).items.find((i) => i.id === id);
}

/** The path inside a root that an id names; dot-files and dot-folders are never reachable. */
function relOf(encoded: string): string {
  const rel = Buffer.from(encoded, "base64url").toString();
  if (!rel || rel.includes("\0") || rel.split("/").some((p) => !p || p.startsWith("."))) throw new HttpError(404, "not found");
  return rel;
}

type Located = { where: "studio"; rel: string; path: string } | { where: "folder"; rel: string; path: string };
async function locate(s: Pick<Studio, "home" | "libraryDirs">, id: string): Promise<Located> {
  const dot = id.indexOf(".");
  const head = id.slice(0, dot);
  if (dot < 1) throw new HttpError(404, "not found");
  const rel = relOf(id.slice(dot + 1));
  if (head === "f") {
    if (rel === "links.json") throw new HttpError(404, "not found");
    return { where: "studio", rel, path: await resolveInside(materialsDir(s), rel) };
  }
  const m = /^d(\d{1,3})$/.exec(head);
  const dir = m ? (s.libraryDirs ?? [])[Number(m[1])] : undefined;
  if (!dir) throw new HttpError(404, "not found");
  return { where: "folder", rel, path: await resolveInside(dir, rel) };
}

/** Stream the request body to `path`, which must not exist; stop past `max` bytes. */
async function writeBody(req: IncomingMessage, path: string, max: number): Promise<number> {
  let size = 0;
  const out = createWriteStream(path, { flags: "wx", mode: 0o664 });
  let failed: Error | undefined;
  out.on("error", (e) => (failed = e));
  try {
    for await (const chunk of req) {
      if (failed) throw failed;
      size += chunk.length;
      if (size > max) throw new HttpError(413, `the file is larger than ${Math.round(max / 1024 / 1024)} MB`);
      if (!out.write(chunk)) await once(out, "drain"); // Rejects if the write fails.
    }
  } finally {
    if (!out.destroyed) await new Promise<void>((r) => out.end(() => r()));
  }
  if (failed) throw failed;
  return size;
}

const refuse = (e: unknown, status = 400): never => {
  if (e instanceof SaveError) throw new HttpError(status, e.message);
  throw e;
};

type Outcome = { file: string } | { saveError: string };

async function download(s: Pick<Studio, "home">, url: string, save: Saver, signal?: AbortSignal): Promise<Outcome> {
  try {
    const r = await save(url, materialsDir(s), signal);
    return { file: `materials/${r.name}` };
  } catch (e) {
    if (!(e instanceof SaveError)) console.error("saving a link failed:", e);
    return { saveError: e instanceof SaveError ? e.message : "the download failed" };
  }
}

/** Record a download's result on every entry for `url` that still has no copy. */
function record(raw: unknown[], url: string, result: Outcome): boolean {
  let changed = false;
  for (const e of raw) {
    if (!isEntry(e) || !sameUrl(e.url, url) || e.file) continue;
    if ("file" in result) {
      e.file = result.file;
      delete e.saveError;
    } else e.saveError = result.saveError;
    changed = true;
  }
  return changed;
}

/**
 * The copy an entry for `url` already has, if the file is still there. An entry whose file is gone
 * (removed outside the app) loses its `file`, so the new copy can take its place.
 */
async function keptCopy(home: string, raw: unknown[], url: string): Promise<string | undefined> {
  let kept: string | undefined;
  for (const e of raw) {
    if (!isEntry(e) || !sameUrl(e.url, url) || typeof e.file !== "string" || !e.file) continue;
    if (kept === e.file) continue;
    const there = await resolveInside(home, e.file).then(
      () => true,
      () => false,
    );
    if (there) kept ??= e.file;
    else delete e.file;
  }
  return kept;
}

const downloadKey = (home: string, url: string) => {
  let href = url;
  try {
    href = new URL(url).href; // The same normalisation sameUrl uses.
  } catch {
    /* keep it as it is */
  }
  return `${home}\0${href}`;
};
/** Downloads running now, by studio and URL. A second request for the same link waits for the first. */
const downloading = new Map<string, Promise<Outcome>>();

/**
 * Download one link and record the outcome in `links.json`, once: a second caller for the same link
 * (another chat turn, a tap on "Save a copy") joins the running download instead of starting its own.
 * The entry stays in `downloading` until the outcome is written, so nobody sees it half done.
 */
export function saveAndRecord(s: Pick<Studio, "home">, url: string, save: Saver = defaultSaver, signal?: AbortSignal): Promise<Outcome> {
  const key = downloadKey(s.home, url);
  const running = downloading.get(key);
  if (running) return running;
  const job = (async (): Promise<Outcome> => {
    const before = await readLinks(s);
    const had = before.error ? undefined : await keptCopy(s.home, before.raw, url);
    if (had) return { file: had };
    const result = await download(s, url, save, signal);
    let outcome: Outcome = result;
    let orphan: string | undefined;
    await editLinks(s, async (raw) => {
      const length = JSON.stringify(raw).length;
      const existing = await keptCopy(s.home, raw, url);
      if (existing && "file" in result && existing !== result.file) {
        // Someone kept a copy meanwhile: this one is not needed.
        orphan = result.file;
        outcome = { file: existing };
        return { write: false, value: null };
      }
      // keptCopy may have cleared a stale `file`; record then fills it with the new copy.
      return { write: record(raw, url, result) || JSON.stringify(raw).length !== length, value: null };
    });
    if (orphan) await unlink(join(s.home, orphan)).catch(() => {});
    return outcome;
  })();
  downloading.set(key, job);
  // Remove the entry whatever happens; `job` itself still rejects for its callers.
  void job.then(
    () => downloading.delete(key),
    () => downloading.delete(key),
  );
  return job;
}

/**
 * Download a copy of every link that asks for one (`"save": true`, no `file`, no
 * `saveError`) and record the result in `links.json`. The coach module calls this after
 * each chat turn when the coach has web access. A broken `links.json` is reported in `failed`
 * and left as it is. Once `signal` aborts, no new download starts: those links stay pending
 * for a later pass, and the one running ends with an error.
 */
export async function reconcileLinks(s: Pick<Studio, "home">, save: Saver = defaultSaver, signal?: AbortSignal): Promise<{ saved: string[]; failed: string[] }> {
  const saved: string[] = [];
  const failed: string[] = [];
  const links = await readLinks(s);
  if (links.error) return { saved, failed: [links.error] };
  const todo = [...new Set(links.raw.filter((e): e is Entry => isEntry(e) && e.save === true && !e.file && !e.saveError).map((e) => e.url))].slice(0, 10);
  for (const url of todo) {
    if (signal?.aborted) break;
    try {
      const r = await saveAndRecord(s, url, save, signal);
      if ("file" in r) saved.push(r.file);
      else failed.push(`${url}: ${r.saveError}`);
    } catch (e) {
      failed.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { saved, failed };
}

/** How many links ask for a copy that has not been made or tried. */
export async function pendingSaves(s: Pick<Studio, "home">): Promise<number> {
  const links = await readLinks(s);
  if (links.error) return 0;
  return new Set(links.raw.filter((e): e is Entry => isEntry(e) && e.save === true && !e.file && !e.saveError).map((e) => e.url)).size;
}

export function materialsRoutes(s: Studio, extra: { cacheDir?: string | undefined; save?: Saver } = {}): void {
  const save = extra.save ?? defaultSaver;
  const dir = materialsDir(s);
  const found = async (id: string): Promise<Listed> => {
    const item = await itemById(s, id);
    if (!item) throw new HttpError(404, "not found");
    return item;
  };
  /** Save a link's copy, record the outcome and return the item as it now lists. */
  const saveLink = async (url: string): Promise<Listed> => {
    const result = await saveAndRecord(s, url, save);
    if ("saveError" in result) throw new HttpError(422, result.saveError);
    const item = (await listMaterials(s)).items.find((i) => i.path === result.file);
    if (!item) throw new HttpError(500, "the copy was saved but is not listed");
    return item;
  };

  route("GET", "/api/materials", async (_req, res, { url }) => {
    const limit = Math.min(LIBRARY_CAP * 2, Math.max(1, Number(url.searchParams.get("limit")) || 500));
    send(res, 200, await listMaterials(s, { q: (url.searchParams.get("q") ?? "").slice(0, 200), kind: url.searchParams.get("kind") ?? "", limit }));
  });

  route("GET", "/api/materials/item", async (_req, res, { url }) => {
    send(res, 200, await found(url.searchParams.get("id") ?? ""));
  });

  route("GET", "/api/materials/file", async (req: IncomingMessage, res: ServerResponse, { url }) => {
    const at = await locate(s, url.searchParams.get("id") ?? "");
    const ext = extOf(at.path);
    let path = at.path;
    let type = TYPES[ext];
    // Files here come from uploads, the web and the coach: never let the browser guess a type.
    res.setHeader("x-content-type-options", "nosniff");
    if (!type) {
      type = "application/octet-stream";
      res.setHeader("content-disposition", "attachment");
    }
    if (kindOf(path) === "video" && ext !== "mp4" && ext !== "m4v" && extra.cacheDir) {
      try {
        path = await ensureRemux(path, extra.cacheDir);
        type = "video/mp4";
      } catch (e) {
        console.error("remux failed, serving the file as it is:", e); // No ffmpeg, or a file it cannot read.
      }
    }
    await sendFile(req, res, path, type);
  });

  route("POST", "/api/materials/upload", async (req, res, { url }) => {
    let name: { stem: string; ext: string };
    try {
      name = safeName(url.searchParams.get("name") ?? "");
    } catch (e) {
      return refuse(e);
    }
    if (Number(req.headers["content-length"]) > UPLOAD_MAX) throw new HttpError(413, "the file is larger than 500 MB");
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, tempName("upload"));
    try {
      if ((await writeBody(req, tmp, UPLOAD_MAX)) === 0) throw new HttpError(400, "the file is empty");
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
    const placed = await placeFile(tmp, dir, name.stem, name.ext).catch(refuse);
    const st = await stat(join(dir, placed));
    send(res, 201, fileItem({ rel: placed, size: st.size, mtimeMs: st.mtimeMs }, false));
  });

  route("POST", "/api/materials/text", async (req, res) => {
    const body = await readJson(req);
    const text = typeof body.text === "string" ? body.text : "";
    if (!text.trim()) throw new HttpError(400, "there is no text to save");
    const stem = cleanStem(str(body.title, 200) || "Notes");
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, tempName("text"));
    await writeFile(tmp, text.endsWith("\n") ? text : `${text}\n`, { flag: "wx", mode: 0o664 });
    const placed = await placeFile(tmp, dir, stem, "md").catch(refuse);
    const st = await stat(join(dir, placed));
    send(res, 201, fileItem({ rel: placed, size: st.size, mtimeMs: st.mtimeMs }, false));
  });

  route("POST", "/api/materials/link", async (req, res) => {
    const body = await readJson(req);
    const raw = str(body.url, 2000);
    let href: string;
    try {
      href = parseTargetLoose(raw);
    } catch (e) {
      return refuse(e);
    }
    const title = str(body.title, 300);
    const note = str(body.note, 1000);
    const wantsCopy = body.save === true;
    const { entry, isNew } = await editLinks(s, (list) => {
      const old = list.find((e): e is Entry => isEntry(e) && sameUrl(e.url, href));
      if (old) {
        // The same link again: keep one entry, take what is new.
        let write = false;
        if (title && old.title !== title) {
          old.title = title;
          write = true;
        }
        if (note && old.note !== note) {
          old.note = note;
          write = true;
        }
        return { write, value: { entry: old, isNew: false } };
      }
      const entry: Entry = { url: href, title, ...(note ? { note } : {}), added: new Date().toISOString() };
      list.push(entry);
      return { write: true, value: { entry, isNew: true } };
    });
    if (wantsCopy && !entry.file) {
      try {
        return send(res, isNew ? 201 : 200, await saveLink(entry.url));
      } catch (e) {
        // The link is kept either way; the item says why there is no copy.
        if (!(e instanceof HttpError) || e.status !== 422) throw e;
      }
    }
    const item = (await listMaterials(s)).items.find((i) => i.url !== null && sameUrl(i.url, entry.url));
    if (!item) throw new HttpError(500, "the link was saved but is not listed");
    send(res, isNew ? 201 : 200, item);
  });

  route("POST", "/api/materials/:id/save", async (_req, res, { params }) => {
    const item = await found(params.id!);
    if (!item.url) throw new HttpError(400, "only a link can be saved as a copy");
    if (item.source !== "link") return send(res, 200, item); // Already saved.
    send(res, 200, await saveLink(item.url));
  });

  route("DELETE", "/api/materials/:id", async (_req, res, { params }) => {
    const id = params.id!;
    if (/^d\d+\./.test(id)) throw new HttpError(400, "files in a library folder cannot be deleted from here");
    const item = await found(id);
    if (item.source === "studio") {
      const at = await locate(s, id);
      const trash = join(dir, ".trash");
      await mkdir(trash, { recursive: true });
      const stamp = new Date().toISOString().replace(/[-:]|\.\d+/g, "");
      await rename(at.path, join(trash, `${stamp}-${randomBytes(2).toString("hex")}-${basename(at.path)}`));
    }
    if (item.url) {
      const url = item.url;
      await editLinks(s, (raw) => {
        const before = raw.length;
        for (let i = raw.length - 1; i >= 0; i--) {
          const e = raw[i];
          if (isEntry(e) && sameUrl(e.url, url)) raw.splice(i, 1);
        }
        return { write: raw.length !== before, value: null };
      });
    }
    send(res, 200, { ok: true });
  });
}

/** A link the player may keep: any http(s) address without credentials. Ports are only limited when fetching. */
function parseTargetLoose(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SaveError("not a valid web address");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new SaveError("only http and https links can be added");
  if (u.username || u.password) throw new SaveError("links with a user name or password are not kept");
  return u.href;
}
