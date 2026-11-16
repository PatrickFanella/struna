import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const tmp = await mkdtemp(join(tmpdir(), "guitar-rec-"));
await cp(join(import.meta.dirname, "fixtures/vault"), join(tmp, "vault"), { recursive: true });
process.env.STRUNA_VAULT_ROOT = join(tmp, "vault");
process.env.STRUNA_STATE_DIR = join(tmp, "state");
process.env.STRUNA_MEDIA_ROOT = join(tmp, "media");

process.umask(0o002);
const { handle } = await import("./index.ts");
const { localDate } = await import("./logs.ts");

let server: Server;
let base = "";
before(async () => {
  server = createServer(handle);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});
after(async () => {
  server.close();
  await rm(tmp, { recursive: true, force: true });
});

const post = (q: string, body = "take") =>
  fetch(`${base}/api/recordings?${q}`, { method: "POST", headers: { "x-struna": "1", "content-type": "application/octet-stream" }, body });

test("stores a take under Recordings/<block>/<date>-<label>.<ext>, never overwriting", async () => {
  const date = localDate(new Date(), "America/Chicago");
  const r1 = await post("blockId=g-vocabulary-nine-pound-hammer-01&label=baseline&ext=webm", "first");
  assert.equal(r1.status, 200);
  const p1 = (await r1.json()).path;
  assert.equal(p1, `Recordings/g-vocabulary-nine-pound-hammer-01/${date}-baseline.webm`);
  assert.equal(await readFile(join(tmp, "media", p1), "utf8"), "first");
  const p2 = (await (await post("blockId=g-vocabulary-nine-pound-hammer-01&label=baseline&ext=webm", "second")).json()).path;
  assert.equal(p2, `Recordings/g-vocabulary-nine-pound-hammer-01/${date}-baseline-2.webm`);
  assert.equal(await readFile(join(tmp, "media", p1), "utf8"), "first");
  const { stat } = await import("node:fs/promises");
  assert.equal((await stat(join(tmp, "media", p1))).mode & 0o060, 0o060, "group-writable like the media folder's files");
  const p3 = (await (await post("blockId=g-vocabulary-nine-pound-hammer-01&label=weekly&ext=m4a")).json()).path;
  assert.match(p3, /-weekly\.m4a$/);
});

test("rejects bad labels, block ids and extensions", async () => {
  assert.equal((await post("blockId=g-vocabulary-nine-pound-hammer-01&label=evil&ext=webm")).status, 400);
  assert.equal((await post("blockId=../x&label=baseline&ext=webm")).status, 400);
  assert.equal((await post("blockId=a%2Fb&label=baseline&ext=webm")).status, 400);
  assert.equal((await post("blockId=g-vocabulary-nine-pound-hammer-01&label=baseline&ext=sh")).status, 400);
  assert.equal((await post("blockId=g-vocabulary-nine-pound-hammer-01&label=baseline&ext=webm", "")).status, 400);
});

test("saved owner takes return playable range URLs without exposing arbitrary media paths", async () => {
  const saved = await post("blockId=playback-check&label=final&ext=webm", "0123456789");
  const { path, src } = await saved.json();
  assert.equal(new URL(src,base).searchParams.get("path"),path);
  const full = await fetch(base+src); assert.equal(full.status,200);assert.equal(full.headers.get("content-type"),"audio/webm");assert.equal(await full.text(),"0123456789");
  const range = await fetch(base+src,{headers:{range:"bytes=2-5"}});assert.equal(range.status,206);assert.equal(await range.text(),"2345");
  const head=await fetch(base+src,{method:"HEAD"});assert.equal(head.status,200);assert.equal(await head.text(),"");
  for(const path of ["../private.webm","profile.json","Recordings/../private.webm","Recordings/playback-check/../../private.webm","Recordings/playback-check/2026-11-16-final.json"]){
    assert.equal((await fetch(base+"/api/recordings/file?path="+encodeURIComponent(path))).status,404);
  }
  await writeFile(join(tmp,"outside.webm"),"OUTSIDE");
  await symlink(join(tmp,"outside.webm"),join(tmp,"media/Recordings/playback-check/2026-11-16-baseline.webm"));
  assert.ok((await fetch(base+"/api/recordings/file?path="+encodeURIComponent("Recordings/playback-check/2026-11-16-baseline.webm"))).status>=400);
});
