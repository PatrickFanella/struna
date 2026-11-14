import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, rename, stat, unlink, utimes } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
export const CACHE_LIMIT = 40 * 1024 ** 3;
export const remuxStats = { runs: 0 };
const pending = new Map<string, Promise<string>>();

async function codecs(src: string): Promise<{ video: string; audio: string | null }> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name:stream_disposition=attached_pic", "-of", "json", src], { timeout: 30_000 });
  const streams = (JSON.parse(stdout).streams ?? []) as { codec_type: string; codec_name: string; disposition?: { attached_pic?: number } }[];
  const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  if (!video) throw new Error("no video stream");
  return { video: video.codec_name, audio: streams.find((s) => s.codec_type === "audio")?.codec_name ?? null };
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    remuxStats.runs++;
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-2000)));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}: ${err.trim().split("\n").slice(-3).join(" ")}`))));
  });
}

/**
 * An MP4 copy of `srcPath` that Safari can play, made once and cached at
 * `<cacheDir>/remux/<sha1(path)>.mp4`. H.264 (or HEVC) video is copied; other
 * video (AV1, VP9) is converted to H.264. Audio is converted to AAC 160k unless
 * it is already AAC or MP3. Concurrent calls for one file share a single ffmpeg
 * run, which writes `.part` and renames on success, so no reader sees a partial file.
 */
export function ensureRemux(srcPath: string, cacheDir: string): Promise<string> {
  const dir = join(cacheDir, "remux");
  const out = join(dir, `${createHash("sha1").update(srcPath).digest("hex")}.mp4`);
  const existing = pending.get(out);
  if (existing) return existing;
  const job = (async () => {
    const [src, cached] = await Promise.all([stat(srcPath), stat(out).catch(() => undefined)]);
    if (cached && cached.mtimeMs >= src.mtimeMs) {
      const now = new Date();
      await utimes(out, now, now).catch(() => {}); // Last use, for eviction.
      return out;
    }
    await mkdir(dir, { recursive: true });
    const c = await codecs(srcPath);
    const video = c.video === "h264" || c.video === "hevc" ? ["-c:v", "copy", ...(c.video === "hevc" ? ["-tag:v", "hvc1"] : [])] : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p"];
    const audio = c.audio === "aac" || c.audio === "mp3" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "160k"];
    const part = `${out}.part`;
    try {
      await ffmpeg(["-nostdin", "-y", "-v", "error", "-i", srcPath, "-map", "0:V:0", "-map", "0:a:0?", ...video, ...audio, "-movflags", "+faststart", "-f", "mp4", part]);
      await rename(part, out);
    } catch (e) {
      await unlink(part).catch(() => {});
      throw e;
    }
    void evictCache(dir, CACHE_LIMIT).catch(() => {});
    return out;
  })().finally(() => pending.delete(out));
  pending.set(out, job);
  return job;
}

/** Delete the least recently used MP4s until the folder is within `maxBytes`. */
export async function evictCache(dir: string, maxBytes: number): Promise<void> {
  const files = await Promise.all(
    (await readdir(dir).catch(() => [] as string[]))
      .filter((f) => f.endsWith(".mp4"))
      .map(async (f) => ({ path: join(dir, f), s: await stat(join(dir, f)) })),
  );
  let total = files.reduce((n, f) => n + f.s.size, 0);
  for (const f of files.sort((a, b) => a.s.mtimeMs - b.s.mtimeMs)) {
    if (total <= maxBytes) break;
    if (pending.has(f.path)) continue;
    await unlink(f.path).catch(() => {});
    total -= f.s.size;
  }
}
