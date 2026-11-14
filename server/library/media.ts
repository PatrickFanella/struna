import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { contentType, resolveInside } from "../files.ts";
import { HttpError, NOINDEX, route } from "../http.ts";
import { itemById } from "./index-db.ts";
import { ensureRemux } from "./remux.ts";
import type { Item } from "./scan.ts";

export function parseRange(header: string | undefined, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    const n = Number(m[2]);
    if (n === 0) return "unsatisfiable";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

/** Stream a file with HTTP range support, as iOS Safari requires for video. */
export async function sendFile(req: IncomingMessage, res: ServerResponse, path: string, type = contentType(path)): Promise<void> {
  const { size } = await stat(path);
  const headers = { "content-type": type, "accept-ranges": "bytes", "cache-control": "private, max-age=3600", "x-robots-tag": NOINDEX };
  const range = parseRange(req.headers.range, size);
  if (range === "unsatisfiable") {
    res.writeHead(416, { ...headers, "content-range": `bytes */${size}` });
    res.end();
    return;
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  res.writeHead(range ? 206 : 200, { ...headers, "content-length": size ? end - start + 1 : 0, ...(range ? { "content-range": `bytes ${start}-${end}/${size}` } : {}) });
  if (req.method === "HEAD" || size === 0) {
    res.end();
    return;
  }
  await new Promise<void>((resolve) => {
    const rs = createReadStream(path, { start, end });
    rs.on("error", () => {
      res.destroy();
      resolve();
    });
    res.on("close", () => {
      rs.destroy();
      resolve();
    });
    rs.pipe(res);
  });
}

/** `unzip` reads entry names as wildcard patterns; bracket the special characters so they match literally. */
export function unzipLiteral(name: string): string {
  return name.replace(/[[*?\\]/g, (c) => `[${c}]`);
}

export function mediaRoutes(opts: { mediaRoot: string; vaultRoot: string; cacheDir: string }, db: DatabaseSync): void {
  const fileOf = async (item: Item, which: string | null) => {
    const rel = which === "epub" && item.alt ? item.alt : item.path;
    if (!rel) throw new HttpError(404, "not found");
    return resolveInside(item.source === "vault" ? opts.vaultRoot : opts.mediaRoot, rel);
  };

  route("GET", "/api/media/:id", async (req, res, { params, url }) => {
    const item = itemById(db, params.id!);
    if (!item || item.kind === "zip-entry") throw new HttpError(404, "not found");
    let path = await fileOf(item, url.searchParams.get("format"));
    const ext = extname(path).toLowerCase();
    if (item.kind === "video" && ext !== ".mp4" && ext !== ".m4v") path = await ensureRemux(path, opts.cacheDir);
    await sendFile(req, res, path);
  });

  route("GET", "/api/media/:id/thumb", async (req, res, { params }) => {
    const item = itemById(db, params.id!);
    if (!item?.thumb) throw new HttpError(404, "not found");
    await sendFile(req, res, await resolveInside(opts.mediaRoot, item.thumb));
  });

  route("GET", "/api/media/:id/entry", async (req, res, { params }) => {
    const item = itemById(db, params.id!);
    if (!item || item.kind !== "zip-entry" || !item.entry) throw new HttpError(404, "not found");
    const zip = await fileOf(item, null);
    const child = spawn("unzip", ["-p", "--", zip, unzipLiteral(item.entry)], { stdio: ["ignore", "pipe", "pipe"] });
    const first = await new Promise<Buffer | null>((resolve) => {
      child.stdout.once("data", (d: Buffer) => resolve(d));
      child.once("close", () => resolve(null));
    });
    if (!first) throw new HttpError(404, "entry not found in the archive");
    const name = basename(item.entry);
    res.writeHead(200, {
      "content-type": contentType(name),
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "private, max-age=3600",
      "x-robots-tag": NOINDEX,
    });
    if (req.method === "HEAD") {
      child.kill();
      res.end();
      return;
    }
    res.write(first);
    res.on("close", () => child.kill());
    child.stdout.pipe(res);
    await new Promise((r) => child.once("close", r));
  });
}
