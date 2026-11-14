import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, isAbsolute, join, sep } from "node:path";

import { HttpError, NOINDEX } from "./http.ts";

export const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".epub": "application/epub+zip",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".webm": "audio/webm",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export function contentType(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/**
 * The real path of `rel` inside `root`, or a 404. Resolves symlinks first,
 * so a link that points outside the root is refused like `../`.
 */
export async function resolveInside(root: string, rel: string): Promise<string> {
  if (!rel || isAbsolute(rel) || rel.includes("\0")) throw new HttpError(404, "not found");
  const realRoot = await realpath(root).catch(() => undefined);
  const real = await realpath(join(root, rel)).catch(() => undefined);
  if (!realRoot || !real || !real.startsWith(realRoot + sep)) throw new HttpError(404, "not found");
  if (!(await stat(real)).isFile()) throw new HttpError(404, "not found");
  return real;
}

export function resolveThreadFile(threadDir: string, rel: string): Promise<string> {
  return resolveInside(threadDir, rel);
}

/** Stream a file whole, with the noindex header. Range requests are handled in Plan B's media module. */
export async function streamFile(_req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const s = await stat(path);
  res.writeHead(200, {
    "content-type": contentType(path),
    "content-length": s.size,
    "cache-control": "private, no-cache",
    "x-robots-tag": NOINDEX,
  });
  await new Promise<void>((resolve, reject) => {
    const rs = createReadStream(path);
    rs.on("error", reject);
    res.on("close", () => {
      rs.destroy();
      resolve();
    });
    rs.pipe(res);
  });
}
