import { renameSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { once } from "node:events";
import { resolveInside } from "./files.ts";
import { sendFile } from "./library/media.ts";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, unlink } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { extname, join } from "node:path";

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
  let failed: Error | undefined;
  out.on("error", (e) => { failed = e; });
  try {
    for await (const chunk of req) {
      if (failed) throw failed;
      size += chunk.length;
      if (size > MAX) throw new HttpError(413, "recording larger than 200 MB");
      if (!out.write(chunk)) await once(out, "drain");
    }
  } finally {
    if (!out.destroyed) await new Promise<void>((r) => out.end(r));
  }
  if (failed) throw failed;
  return size;
}

export function recordingRoutes(opts: { mediaRoot: string; timeZone: string }): void {
  route("GET", "/api/recordings/file", async (req, res, { url }) => {
    const path = url.searchParams.get("path") ?? "";
    // Only generated take names are eligible. Never turn this into a general media-root reader.
    if (!/^Recordings\/[a-z0-9][a-z0-9-]{0,100}\/\d{4}-\d{2}-\d{2}-(?:baseline|weekly|midpoint|final)(?:-[1-9][0-9]*)?\.(?:webm|m4a|ogg)$/.test(path)) throw new HttpError(404, "Take not found");
    const type = extname(path) === ".m4a" ? "audio/mp4" : `audio/${extname(path).slice(1)}`;
    await sendFile(req, res, await resolveInside(opts.mediaRoot, path), type);
  });
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
    const relative = `${rel}/${name}`;
    send(res, 200, { path: relative, src: `/api/recordings/file?path=${encodeURIComponent(relative)}` });
  });
}

/** Hosted takes use opaque names and retry ids in the owning account database. */
export function hostedRecordingRoutes(opts: { mediaRoot: string; db: DatabaseSync; assertActive?: (() => void) | undefined }, register = route) {
  const { db } = opts, dir = join(opts.mediaRoot, "recordings");
  db.exec("CREATE TABLE IF NOT EXISTS takes (id TEXT PRIMARY KEY, submission TEXT UNIQUE NOT NULL, hash TEXT NOT NULL, ext TEXT NOT NULL, block TEXT NOT NULL, label TEXT NOT NULL, seconds REAL NOT NULL, size INTEGER NOT NULL)");
  type Row = { id: string; submission: string; hash: string; ext: string; block: string; label: string; seconds: number; size: number };
  const result = (r: Row) => ({ id: r.id, path: `recordings/${r.id}.${r.ext}`, src: `/api/recordings/file?id=${r.id}`, blockId: r.block, label: r.label, seconds: r.seconds, size: r.size });
  const find = (id: string) => {
    const row = db.prepare("SELECT * FROM takes WHERE id=?").get(id) as Row | undefined;
    if (!row) throw new HttpError(404, "Take not found");
    return row;
  };
  register("GET", "/api/recordings", (_req, res) => send(res, 200, (db.prepare("SELECT * FROM takes ORDER BY rowid DESC").all() as Row[]).map(result)));
  register("GET", "/api/recordings/file", async (req, res, { url }) => {
    const row = find(url.searchParams.get("id") ?? "");
    await sendFile(req, res, await resolveInside(dir, `${row.id}.${row.ext}`), row.ext === "m4a" ? "audio/mp4" : `audio/${row.ext}`);
  });
  register("DELETE", "/api/recordings/:id", async (_req, res, { params }) => {
    const row = find(params.id!);
    await unlink(await resolveInside(dir, `${row.id}.${row.ext}`));
    db.prepare("DELETE FROM takes WHERE id=?").run(row.id);
    send(res, 200, { ok: true });
  });
  register("POST", "/api/recordings", async (req, res, { url }) => {
    const block = url.searchParams.get("blockId") ?? "", label = url.searchParams.get("label") ?? "", ext = url.searchParams.get("ext") ?? "";
    const submission = String(req.headers["x-struna-take"] ?? ""), seconds = Number(url.searchParams.get("seconds"));
    if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(block) || !LABELS.has(label) || !EXTS.has(ext)) throw new HttpError(400, "Invalid take metadata");
    if (!/^[a-f0-9-]{36}$/.test(submission)) throw new HttpError(400, "A take retry id is required");
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 600) throw new HttpError(413, "Takes must be between zero and ten minutes");
    if (Number(req.headers["content-length"]) > MAX) throw new HttpError(413, "recording larger than 200 MB");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const id = randomUUID(), tmp = join(dir, `.${id}.upload`), path = join(dir, `${id}.${ext}`);
    try {
      const size = await writeBody(req, tmp);
      if (!size) throw new HttpError(400, "empty recording");
      const digest = createHash("sha256");
      for await (const chunk of createReadStream(tmp)) digest.update(chunk);
      const hash = digest.digest("hex");
      opts.assertActive?.();
      // The synchronous transaction serializes concurrent retries and the quota check.
      db.exec("BEGIN IMMEDIATE");
      try {
        const old = db.prepare("SELECT * FROM takes WHERE submission=?").get(submission) as Row | undefined;
        if (old) {
          if (old.hash !== hash || old.block !== block || old.label !== label || old.ext !== ext || old.seconds !== seconds) throw new HttpError(409, "Retry data differs from the saved take");
          db.exec("COMMIT"); send(res, 200, { ...result(old), replayed: true }); return;
        }
        const used = (db.prepare("SELECT coalesce(sum(size),0) AS n FROM takes").get() as { n: number }).n;
        if (used + size > 1024 * 1024 * 1024) throw new HttpError(413, "Recording storage limit is 1 GB. Delete a take before saving another.");
        // Move before commit; failed database writes remove only this request's file.
        renameSync(tmp, path);
        opts.assertActive?.();
        db.prepare("INSERT INTO takes VALUES(?,?,?,?,?,?,?,?)").run(id, submission, hash, ext, block, label, seconds, size);
        db.exec("COMMIT"); send(res, 200, result({ id, submission, hash, ext, block, label, seconds, size }));
      } catch (e) { db.exec("ROLLBACK"); await unlink(path).catch(() => {}); throw e; }
    } finally { await unlink(tmp).catch(() => {}); }
  });
}
