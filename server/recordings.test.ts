import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const tmp = await mkdtemp(join(tmpdir(), "guitar-rec-"));
await cp(join(import.meta.dirname, "fixtures/vault"), join(tmp, "vault"), { recursive: true });
process.env.GUITAR_VAULT_ROOT = join(tmp, "vault");
process.env.GUITAR_STATE_DIR = join(tmp, "state");
process.env.GUITAR_MEDIA_ROOT = join(tmp, "media");

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
  fetch(`${base}/api/recordings?${q}`, { method: "POST", headers: { "x-guitar-room": "1", "content-type": "application/octet-stream" }, body });

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
