import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { fail, match } from "../http.ts";
import { chatImageRoutes } from "./chat-images.ts";
import { SaveError } from "./fetch.ts";

const tmp = await mkdtemp(join(tmpdir(), "guitar-chat-images-"));
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const fetched: string[] = [];
let server: Server;
let base = "";

before(async () => {
  chatImageRoutes(tmp, async (url, dir) => {
    fetched.push(url);
    await new Promise((r) => setTimeout(r, 20));
    if (url.includes("private")) throw new SaveError("that address is on a private or local network; it is not fetched");
    await mkdir(dir, { recursive: true });
    const name = url.endsWith(".pdf") ? "sheet.pdf" : "shape.png";
    await writeFile(join(dir, name), url.endsWith(".pdf") ? "%PDF" : PNG);
    return { path: join(dir, name) };
  });
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const found = match(req.method!, url.pathname);
      if (!found) return void res.writeHead(404).end();
      await found.handler(req, res, { url, params: found.params });
    } catch (e) {
      fail(res, e);
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});
after(async () => {
  server.closeAllConnections();
  server.close();
  await rm(tmp, { recursive: true, force: true });
});

const get = (url: string) => fetch(`${base}/api/chat/image?url=${encodeURIComponent(url)}`);

test("a remote picture is fetched once by the server and served as an image that cannot run anything", async () => {
  const url = "https://pics.example/c-major.png";
  const [a, b] = await Promise.all([get(url), get(url)]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.headers.get("content-type"), "image/png");
  assert.equal(a.headers.get("x-content-type-options"), "nosniff");
  assert.match(a.headers.get("content-security-policy") ?? "", /sandbox/);
  assert.deepEqual(Buffer.from(await a.arrayBuffer()), PNG);
  assert.equal((await get(url)).status, 200);
  assert.deepEqual(fetched.filter((u) => u === url), [url]); // Two at once and one later: one fetch.
});

test("anything but a picture, a private address or a non-web address is refused", async () => {
  const pdf = await get("https://pics.example/sheet.pdf");
  assert.equal(pdf.status, 422);
  assert.equal((await get("https://pics.example/sheet.pdf")).status, 422); // Not kept, so not served later.
  const priv = await get("https://private.example/x.png");
  assert.equal(priv.status, 422);
  assert.match(((await priv.json()) as { error: string }).error, /private or local/);
  assert.equal((await get("file:///etc/passwd")).status, 400);
  assert.equal((await get("javascript:alert(1)")).status, 400);
  assert.equal((await fetch(`${base}/api/chat/image`)).status, 400);
});
