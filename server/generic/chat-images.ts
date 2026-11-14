import { createHash } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";

import { HttpError, route } from "../http.ts";
import { sendFile } from "../library/media.ts";
import { extOf, kindOf, SaveError, saveUrl, type SaveOptions } from "./fetch.ts";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const MAX_BYTES = 10 * 1024 * 1024;

type Fetcher = (url: string, dir: string, opts: SaveOptions) => Promise<{ path: string }>;

/**
 * Remote pictures in coach replies, fetched by the server instead of the player's browser.
 * The image host sees this machine, not the player's device, address or cookies; the fetch
 * gets the downloader's checks (public hosts only, pinned address, re-checked redirects);
 * only PNG, JPEG, WebP and GIF up to 10 MB are served, so no SVG or page reaches the browser.
 * Each address is fetched once and kept in the cache folder.
 */
export function chatImageRoutes(cacheDir: string, fetcher: Fetcher = saveUrl): void {
  const root = join(cacheDir, "chat-images");
  const inFlight = new Map<string, Promise<string>>();

  const cached = async (dir: string): Promise<string | null> => {
    const names = await readdir(dir).catch(() => [] as string[]);
    const name = names.find((n) => !n.startsWith(".") && TYPES[extOf(n)]);
    return name ? join(dir, name) : null;
  };

  const load = async (url: string): Promise<string> => {
    const dir = join(root, createHash("sha256").update(url).digest("hex"));
    const hit = await cached(dir);
    if (hit) return hit;
    const saved = await fetcher(url, dir, { maxBytes: MAX_BYTES, timeoutMs: 10_000, totalMs: 30_000, maxRedirects: 3 });
    if (kindOf(saved.path) !== "image" || !TYPES[extOf(saved.path)]) {
      await rm(dir, { recursive: true, force: true });
      throw new SaveError("that address is not a picture");
    }
    return saved.path;
  };

  route("GET", "/api/chat/image", async (req: IncomingMessage, res: ServerResponse, { url }) => {
    const target = url.searchParams.get("url") ?? "";
    if (!/^https?:\/\//i.test(target) || target.length > 2048) throw new HttpError(400, "an http or https image address is required");
    let pending = inFlight.get(target);
    if (!pending) {
      pending = load(target).finally(() => inFlight.delete(target));
      inFlight.set(target, pending);
    }
    let path: string;
    try {
      path = await pending;
    } catch (e) {
      if (e instanceof SaveError) throw new HttpError(422, e.message);
      throw e;
    }
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("content-security-policy", "default-src 'none'; sandbox");
    await sendFile(req, res, path, TYPES[extOf(path)]!);
  });
}
