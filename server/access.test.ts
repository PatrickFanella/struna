import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { checkAccess, loadAccess, TOKEN_FILE } from "./access.ts";
import { fail, send } from "./http.ts";

const tmp = await mkdtemp(join(tmpdir(), "guitar-access-"));
const access = loadAccess(join(tmp, "state"), 5199);
let server: Server;
let base = "";
before(async () => {
  server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (checkAccess(req, res, url, access)) return;
      send(res, 200, { ok: true, path: url.pathname });
    } catch (e) {
      fail(res, e);
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});
after(async () => {
  server.close();
  await rm(tmp, { recursive: true, force: true });
});

test("the token is made once, owner-only, and kept across starts", async () => {
  assert.match(access.token, /^[0-9a-f]{64}$/);
  assert.equal(access.cookie, "struna_5199");
  const file = join(tmp, "state", TOKEN_FILE);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await readFile(file, "utf8")).trim(), access.token);
  assert.equal(loadAccess(join(tmp, "state"), 5199).token, access.token);
});

test("without the token: the API is refused, a page explains, the health check stays open", async () => {
  assert.equal((await fetch(`${base}/api/app`)).status, 403);
  const post = await fetch(`${base}/api/chat`, { method: "POST", headers: { "x-struna": "1" }, body: "{}" });
  assert.equal(post.status, 403);
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 403);
  assert.match(await page.text(), /access link/);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/app`, { headers: { cookie: `${access.cookie}=${"0".repeat(64)}` } })).status, 403);
  assert.equal((await fetch(`${base}/?token=nope`)).status, 403);
});

test("the access link stores an HttpOnly, SameSite=Strict cookie, and the cookie or header lets requests in", async () => {
  const r = await fetch(`${base}/?token=${access.token}#materials`, { redirect: "manual" });
  assert.equal(r.status, 200);
  const set = r.headers.get("set-cookie")!;
  assert.match(set, new RegExp(`^${access.cookie}=${access.token}; Path=/; HttpOnly; SameSite=Strict`));
  const html = await r.text();
  assert.ok(!html.includes(access.token), "the page does not repeat the token");
  assert.match(html, /location\.replace\("\/"\)/);
  assert.equal((await fetch(`${base}/api/app`, { headers: { cookie: `other=1; ${access.cookie}=${access.token}` } })).status, 200);
  assert.equal((await fetch(`${base}/api/app`, { headers: { "x-struna-token": access.token } })).status, 200);
  // The token never works as an API query parameter, which would end up in logs and history.
  assert.equal((await fetch(`${base}/api/app?token=${access.token}`)).status, 403);
});

test("legacy access headers and cookies remain valid, but still require the exact token", async () => {
  for (const headers of [{ "x-guitar-room-token": access.token }, { cookie: `guitar_room_5199=${access.token}` }]) {
    assert.equal((await fetch(`${base}/api/app`, { headers })).status, 200);
  }
  for (const headers of [{ "x-guitar-room-token": "wrong" }, { cookie: "guitar_room_5199=wrong" }]) {
    assert.equal((await fetch(`${base}/api/app`, { headers })).status, 403);
  }
});
