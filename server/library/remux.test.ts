import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";

import { ensureRemux, evictCache, remuxStats } from "./remux.ts";

const run = promisify(execFile);
let dir = "";
let mkv = "";
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "guitar-remux-"));
  mkv = join(dir, "lesson ｜ #1 [123456].mkv");
  await run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=d=1:s=320x240", "-f", "lavfi", "-i", "sine=d=1", "-c:v", "libx264", "-c:a", "libopus", mkv]);
});
after(() => rm(dir, { recursive: true, force: true }));

const codecs = async (p: string) => (await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", p])).stdout.trim().split("\n");

test("concurrent remuxes of one file share one ffmpeg run and an AAC result", async () => {
  const cache = join(dir, "cache");
  const before = remuxStats.runs;
  const [a, b] = await Promise.all([ensureRemux(mkv, cache), ensureRemux(mkv, cache)]);
  assert.equal(a, b);
  assert.equal(remuxStats.runs - before, 1);
  assert.deepEqual(await codecs(a), ["h264", "aac"]);
  assert.deepEqual((await readdir(join(cache, "remux"))).filter((f) => f.endsWith(".part")), []);
  // A later call reuses the cached file.
  assert.equal(await ensureRemux(mkv, cache), a);
  assert.equal(remuxStats.runs - before, 1);
});

test("non-H.264 video is converted to H.264", async () => {
  const vp9 = join(dir, "vp9.mkv");
  await run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=d=1:s=160x120", "-f", "lavfi", "-i", "sine=d=1", "-c:v", "libvpx-vp9", "-c:a", "libopus", vp9]);
  assert.deepEqual(await codecs(await ensureRemux(vp9, join(dir, "cache"))), ["h264", "aac"]);
});

test("a failed remux leaves no file and can be retried", async () => {
  const bad = join(dir, "bad.mkv");
  await writeFile(bad, "not a video");
  await assert.rejects(ensureRemux(bad, join(dir, "cache")));
  assert.deepEqual((await readdir(join(dir, "cache", "remux"))).filter((f) => f.endsWith(".part")), []);
  await assert.rejects(ensureRemux(bad, join(dir, "cache")));
});

test("evictCache removes the least recently used files over the limit", async () => {
  const c = join(dir, "evict");
  await (await import("node:fs/promises")).mkdir(c);
  for (const [name, age] of [["old.mp4", 300], ["mid.mp4", 200], ["new.mp4", 100]] as const) {
    await writeFile(join(c, name), Buffer.alloc(1000));
    const t = new Date(Date.now() - age * 1000);
    await utimes(join(c, name), t, t);
  }
  await evictCache(c, 2500);
  assert.deepEqual((await readdir(c)).sort(), ["mid.mp4", "new.mp4"]);
});
