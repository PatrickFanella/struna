import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const fx = join(import.meta.dirname, "../fixtures");
const tmp = await mkdtemp(join(tmpdir(), "guitar-libroutes-"));
await cp(join(fx, "media"), join(tmp, "media"), { recursive: true });
process.env.GUITAR_VAULT_ROOT = join(fx, "vault");
process.env.GUITAR_MEDIA_ROOT = join(tmp, "media");
process.env.GUITAR_STATE_DIR = join(tmp, "state");
process.env.GUITAR_CACHE_DIR = join(tmp, "cache");
process.env.GUITAR_CALIBRE_RECEIPT = join(fx, "calibre-receipt.json");
process.env.GUITAR_NO_SCAN = "1";

const { handle } = await import("../index.ts");

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

const scan = () => fetch(`${base}/api/library/scan`, { method: "POST", headers: { "x-guitar-room": "1" } }).then((r) => r.json());

test("one scan at a time, then search by text and source", async () => {
  const first = await scan();
  const second = await scan();
  assert.equal(first.started, true);
  assert.equal(second.started, false);
  for (let i = 0; i < 100; i++) {
    const s = await (await fetch(`${base}/api/library`)).json();
    if (!s.scanning) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const r = await (await fetch(`${base}/api/library?q=strumming&source=cgo`)).json();
  assert.equal(r.total, 1);
  assert.equal(r.items[0].title, "The Best Country Strumming Patterns");
  assert.ok(r.scannedAt);
  const all = await (await fetch(`${base}/api/library?offset=0`)).json();
  assert.ok(all.total > 5);
  assert.equal((await fetch(`${base}/api/library?source=nope`)).status, 400);
});
