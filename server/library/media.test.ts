import assert from "node:assert/strict";
import { cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { parseRange } from "./media.ts";

const fx = join(import.meta.dirname, "../fixtures");
const tmp = await mkdtemp(join(tmpdir(), "guitar-media-"));
await cp(join(fx, "media"), join(tmp, "media"), { recursive: true });
const book = join(tmp, "media/Books/Test Book (z-library.sk, 1lib.sk, z-lib.sk).pdf");
await writeFile(join(tmp, "secret.txt"), "secret");
await symlink(join(tmp, "secret.txt"), join(tmp, "media/Books/escape.pdf"));
process.env.GUITAR_VAULT_ROOT = join(fx, "vault");
process.env.GUITAR_MEDIA_ROOT = join(tmp, "media");
process.env.GUITAR_STATE_DIR = join(tmp, "state");
process.env.GUITAR_CACHE_DIR = join(tmp, "cache");
process.env.GUITAR_CALIBRE_RECEIPT = join(fx, "calibre-receipt.json");
process.env.GUITAR_NO_SCAN = "1";

const { handle, db } = await import("../index.ts");
const { writeIndex, searchLibrary } = await import("./index-db.ts");
const { scanLibrary } = await import("./scan.ts");

let server: Server;
let base = "";
let bookId = "";
let size = 0;
before(async () => {
  await writeIndex(db, await scanLibrary({ mediaRoot: join(tmp, "media"), vaultRoot: join(fx, "vault"), threadRel: "001 Projects/Threads/Guitar", calibreReceipt: join(fx, "calibre-receipt.json") }));
  const b = searchLibrary(db, { source: "books", limit: 5, offset: 0 }).items[0]!;
  bookId = b.id;
  size = (await import("node:fs")).statSync(book).size;
  server = createServer(handle);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});
after(async () => {
  server.close();
  await rm(tmp, { recursive: true, force: true });
});

test("parseRange", () => {
  assert.deepEqual(parseRange("bytes=0-1", 100), { start: 0, end: 1 });
  assert.deepEqual(parseRange("bytes=50-", 100), { start: 50, end: 99 });
  assert.deepEqual(parseRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=90-500", 100), { start: 90, end: 99 });
  assert.equal(parseRange("bytes=200-", 100), "unsatisfiable");
  assert.equal(parseRange("bytes=5-2", 100), "unsatisfiable");
  assert.equal(parseRange(undefined, 100), null);
  assert.equal(parseRange("items=0-1", 100), null);
});

test("range requests get 206 with Content-Range", async () => {
  const r = await fetch(`${base}/api/media/${bookId}`, { headers: { range: "bytes=0-1" } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get("content-range"), `bytes 0-1/${size}`);
  assert.equal(r.headers.get("content-type"), "application/pdf");
  assert.equal((await r.arrayBuffer()).byteLength, 2);
  const open = await fetch(`${base}/api/media/${bookId}`, { headers: { range: `bytes=${size - 5}-` } });
  assert.equal(open.status, 206);
  assert.equal((await open.arrayBuffer()).byteLength, 5);
  const bad = await fetch(`${base}/api/media/${bookId}`, { headers: { range: `bytes=${size + 10}-` } });
  assert.equal(bad.status, 416);
  assert.equal(bad.headers.get("content-range"), `bytes */${size}`);
});

test("no Range gives the whole file, and the EPUB copy is served on request", async () => {
  const r = await fetch(`${base}/api/media/${bookId}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("accept-ranges"), "bytes");
  assert.equal((await r.arrayBuffer()).byteLength, size);
  const e = await fetch(`${base}/api/media/${bookId}?format=epub`);
  assert.equal(e.status, 200);
  assert.equal(e.headers.get("content-type"), "application/epub+zip");
});

test("stored paths that escape the media root, symlinks out and unknown ids are 404", async () => {
  db.prepare("INSERT INTO items (id, source, kind, title, description, path) VALUES ('evil1', 'books', 'pdf', 'x', '', '../secret.txt'), ('evil2', 'books', 'pdf', 'x', '', 'Books/escape.pdf'), ('evil3', 'books', 'pdf', 'x', '', '/etc/passwd'), ('evil4', 'vault', 'pdf', 'x', '', '001 Projects/../../../etc/passwd')").run();
  for (const id of ["evil1", "evil2", "evil3", "evil4", "nope", "..%2F..%2Fsecret.txt"]) {
    assert.equal((await fetch(`${base}/api/media/${id}`)).status, 404, id);
  }
});

test("zip entries stream by name, including ｜ and #", async () => {
  const entries = searchLibrary(db, { source: "sheets", limit: 5, offset: 0 }).items;
  const pdf = entries.find((e) => e.entry!.endsWith(".pdf"))!;
  const r = await fetch(`${base}/api/media/${pdf.id}/entry`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/pdf");
  assert.match(Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString(), /^%PDF/);
  const odt = entries.find((e) => e.entry!.endsWith(".odt"))!;
  const o = await fetch(`${base}/api/media/${odt.id}/entry`);
  assert.equal(o.status, 200);
  assert.equal(await o.text(), "odt");
  assert.match(o.headers.get("content-disposition") ?? "", /filename\*=UTF-8''Song/);
  assert.equal((await fetch(`${base}/api/media/${bookId}/entry`)).status, 404);
});

test("a lesson's companions and thumbnail are served", async () => {
  const strum = searchLibrary(db, { q: "strumming", kind: "video", limit: 5, offset: 0 }).items[0]!;
  const c = await (await fetch(`${base}/api/library/${strum.id}/companions`)).json();
  assert.deepEqual(c.map((x: any) => x.kind).sort(), ["audio", "pdf"]);
  const t = await fetch(`${base}/api/media/${strum.id}/thumb`);
  assert.equal(t.status, 200);
  assert.equal(t.headers.get("content-type"), "image/jpeg");
  assert.equal((await fetch(`${base}/api/media/${bookId}/thumb`)).status, 404);
  assert.equal((await fetch(`${base}/api/library/nope/companions`)).status, 404);
});
