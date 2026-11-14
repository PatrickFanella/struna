import type { DatabaseSync } from "node:sqlite";

import { HttpError, route, send } from "../http.ts";
import { companions, itemById, pdfTitleCache, probeCache, scannedAt, searchLibrary, writeIndex } from "./index-db.ts";
import { ffprobeDuration, type Kind, pdftotextTitle, scanLibrary, type ScanOptions, type Source } from "./scan.ts";

const SOURCES = new Set<Source>(["artistworks", "cgo", "archive", "vault", "books", "music-books", "sheets"]);
const KINDS = new Set<Kind>(["video", "audio", "pdf", "epub", "zip-entry"]);
const PAGE = 50;
const DAY = 24 * 3600_000;

export function libraryRoutes(opts: Omit<ScanOptions, "probe" | "pdfTitle"> & { autoScan: boolean; onScan?: () => void }, db: DatabaseSync): void {
  const cache = probeCache(db);
  const titles = pdfTitleCache(db);
  let running: Promise<void> | null = null;
  let lastError: string | null = null;

  const startScan = (): boolean => {
    if (running) return false;
    lastError = null;
    running = (async () => {
      const items = await scanLibrary({
        ...opts,
        probe: async (path, size, mtime) => {
          const hit = cache.get(path, size, mtime);
          if (hit) return hit.duration;
          const d = await ffprobeDuration(path);
          cache.put(path, size, mtime, d);
          return d;
        },
        pdfTitle: async (path, size, mtime) => {
          const hit = titles.get(path, size, mtime);
          if (hit) return hit.title;
          const t = await pdftotextTitle(path);
          titles.put(path, size, mtime, t);
          return t;
        },
      });
      await writeIndex(db, items, { batch: 200 });
    })()
      .catch((e) => {
        lastError = String((e as Error).message ?? e);
        console.error("library scan failed:", e);
      })
      .finally(() => {
        running = null;
      });
    return true;
  };

  route("GET", "/api/library", (_req, res, { url }) => {
    const q = url.searchParams.get("q") ?? "";
    const source = url.searchParams.get("source") || undefined;
    const kind = url.searchParams.get("kind") || undefined;
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
    if (source && !SOURCES.has(source as Source)) throw new HttpError(400, "unknown source");
    if (kind && !KINDS.has(kind as Kind)) throw new HttpError(400, "unknown kind");
    const r = searchLibrary(db, { q: q.slice(0, 200), ...(source ? { source: source as Source } : {}), ...(kind ? { kind: kind as Kind } : {}), limit: PAGE, offset });
    send(res, 200, { ...r, scannedAt: scannedAt(db), scanning: Boolean(running), scanError: lastError });
  });

  route("GET", "/api/library/:id/companions", (_req, res, { params }) => {
    if (!itemById(db, params.id!)) throw new HttpError(404, "not found");
    send(res, 200, companions(db, params.id!));
  });

  route("POST", "/api/library/scan", (_req, res) => {
    const started = startScan();
    if (started) opts.onScan?.();
    send(res, 200, { started });
  });

  if (opts.autoScan) {
    const at = scannedAt(db);
    if (!at || Date.now() - Date.parse(at) > DAY) startScan();
  }
}
