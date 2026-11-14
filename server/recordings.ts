import { createWriteStream } from "node:fs";
import { mkdir, open, unlink } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";

import { HttpError, route, send } from "./http.ts";
import { localDate } from "./logs.ts";

const LABELS = new Set(["baseline", "weekly", "midpoint", "final"]);
const EXTS = new Set(["webm", "m4a", "ogg"]);
const MAX = 200 * 1024 * 1024;

/** Create the first free `<date>-<label>[-n].<ext>` with `wx`, so an existing take is never replaced. */
async function claim(dir: string, stem: string, ext: string): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const name = n === 1 ? `${stem}.${ext}` : `${stem}-${n}.${ext}`;
    try {
      await (await open(join(dir, name), "wx", 0o664)).close();
      return name;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  throw new HttpError(409, "too many takes for one day");
}

async function writeBody(req: IncomingMessage, path: string): Promise<number> {
  let size = 0;
  const out = createWriteStream(path, { flags: "w" });
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX) throw new HttpError(413, "recording larger than 200 MB");
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
    }
  } finally {
    await new Promise<void>((r) => out.end(r));
  }
  return size;
}

export function recordingRoutes(opts: { mediaRoot: string; timeZone: string }): void {
  route("POST", "/api/recordings", async (req, res, { url }) => {
    const blockId = url.searchParams.get("blockId") ?? "";
    const label = url.searchParams.get("label") ?? "";
    const ext = url.searchParams.get("ext") ?? "";
    if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(blockId)) throw new HttpError(400, "bad block id");
    if (!LABELS.has(label)) throw new HttpError(400, "label must be baseline, weekly, midpoint or final");
    if (!EXTS.has(ext)) throw new HttpError(400, "unsupported recording format");
    const rel = join("Recordings", blockId);
    const dir = join(opts.mediaRoot, rel);
    await mkdir(dir, { recursive: true });
    const name = await claim(dir, `${localDate(new Date(), opts.timeZone)}-${label}`, ext);
    const path = join(dir, name);
    try {
      const size = await writeBody(req, path);
      if (size === 0) throw new HttpError(400, "empty recording");
    } catch (e) {
      await unlink(path).catch(() => {});
      throw e;
    }
    send(res, 200, { path: `${rel}/${name}` });
  });
}
