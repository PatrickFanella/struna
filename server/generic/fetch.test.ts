import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { cleanStem, dispositionName, type Internals, isPublicAddress, kindOf, nameFor, parseTarget, safeName, SaveError, saveUrl, vetHost } from "./fetch.ts";

test("isPublicAddress refuses everything that is not the public internet", () => {
  const refused = [
    "127.0.0.1", "127.8.9.10", "0.0.0.0", "0.1.2.3", "10.0.0.50", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", "100.64.0.1", "100.65.164.66", "100.127.255.255", "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
    "192.0.0.8", "198.18.0.1",
    "::", "::1", "fe80::1", "febf::1", "fc00::1", "fd12:3456::1", "ff02::1", "fec0::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:a00:1", "::ffff:169.254.169.254", "::ffff:192.168.0.1", "::ffff:100.64.0.1", "0:0:0:0:0:ffff:7f00:1",
    "::127.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::", "2001:db8::1",
    "fe80::1%eth0", "localhost", "", "1.2.3", "example.com",
  ];
  for (const a of refused) assert.equal(isPublicAddress(a), false, a);
  const allowed = ["93.184.216.34", "8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "100.63.255.255", "100.128.0.1", "169.253.0.1", "192.167.1.1", "223.255.255.1", "::ffff:8.8.8.8", "2606:4700:4700::1111", "2a00:1450:4001::200e"];
  for (const a of allowed) assert.equal(isPublicAddress(a), true, a);
});

test("parseTarget allows only plain http and https on the web ports", () => {
  for (const bad of ["ftp://example.com/a.pdf", "file:///etc/passwd", "gopher://example.com/", "javascript:alert(1)", "data:text/plain,hi", "http://user:pw@example.com/a.pdf", "http://user@example.com/a.pdf", "http://example.com:8080/a.pdf", "https://example.com:22/a.pdf", "http://example.com:5182/api/health", "not a url", ""])
    assert.throws(() => parseTarget(bad), SaveError, bad);
  for (const ok of ["http://example.com/a.pdf", "https://example.com/a.pdf", "https://example.com:443/a.pdf", "http://example.com:80/a.pdf"]) assert.equal(parseTarget(ok).hostname, "example.com");
});

test("vetHost refuses a name when any of its addresses is private, and IP literals in every spelling", async () => {
  const u = (s: string) => parseTarget(s);
  const answers = (list: string[]): Internals => ({ lookup: async () => list });
  assert.equal(await vetHost(u("http://files.test/a"), answers(["93.184.216.34"])), "93.184.216.34");
  assert.equal(await vetHost(u("http://files.test/a"), answers(["2606:4700::1", "93.184.216.34"])), "93.184.216.34"); // Prefers IPv4.
  await assert.rejects(vetHost(u("http://files.test/a"), answers(["93.184.216.34", "127.0.0.1"])), /private or local/);
  await assert.rejects(vetHost(u("http://files.test/a"), answers(["93.184.216.34", "::ffff:10.0.0.5"])), /private or local/);
  await assert.rejects(vetHost(u("http://files.test/a"), answers(["fd00::1"])), /private or local/);
  await assert.rejects(vetHost(u("http://files.test/a"), answers([])), /not found/);
  await assert.rejects(vetHost(u("http://files.test/a"), { lookup: async () => Promise.reject(new Error("ENOTFOUND")) }), /not found/);
  // The URL parser turns these into dotted or bracketed literals; none reaches DNS.
  const never: Internals = { lookup: async () => assert.fail("looked up an IP literal") };
  for (const lit of ["http://127.0.0.1/", "http://2130706433/", "http://0x7f.0.0.1/", "http://0177.0.0.1/", "http://127.1/", "http://0/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/", "http://10.0.0.50/", "http://169.254.169.254/latest/meta-data/", "http://[fe80::1]/", "http://100.65.164.66/"])
    await assert.rejects(vetHost(u(lit), never), /private or local/, lit);
  assert.equal(await vetHost(u("http://93.184.216.34/"), never), "93.184.216.34");
  // Without a test resolver, "localhost" resolves through the system and is refused.
  await assert.rejects(vetHost(u("http://localhost/")), /private or local/);
});

test("names: stems are cleaned, extensions come from the allowlist", () => {
  assert.equal(cleanStem("../../etc/passwd"), "passwd");
  assert.equal(cleanStem("..\\..\\boot.ini"), "boot.ini");
  assert.equal(cleanStem(".hidden"), "hidden");
  assert.equal(cleanStem("  a:b*c?  "), "a b c");
  assert.equal(cleanStem("line\nbreak\u0000‮"), "linebreak");
  assert.equal(cleanStem("..."), "Untitled");
  assert.equal([...cleanStem("é".repeat(400))].length, 100); // 200 bytes of two-byte letters.
  assert.deepEqual(safeName("/tmp/x/Blues in A.PDF"), { stem: "Blues in A", ext: "pdf" });
  assert.deepEqual(safeName(".bashrc.txt"), { stem: "bashrc", ext: "txt" });
  for (const bad of ["run.sh", "page.html", "a.svg", "links.json", "noext", "x.exe", ".pdf/.."]) assert.throws(() => safeName(bad), SaveError, bad);
  assert.equal(kindOf("a.GP5"), "tab");
  assert.equal(kindOf("a.mkv"), "video");
  assert.equal(kindOf("a.opus"), "audio");
  assert.equal(kindOf("a.json"), "other");
  assert.equal(dispositionName(`attachment; filename="plain.pdf"; filename*=UTF-8''Caf%C3%A9%20Blues.pdf`), "Café Blues.pdf");
  assert.equal(dispositionName(`attachment; filename="a \\"b\\".pdf"`), `a "b".pdf`);
  assert.equal(dispositionName("attachment; filename=tab.gp5"), "tab.gp5");
  assert.equal(dispositionName("inline"), null);
});

test("nameFor: type and extension rules", () => {
  const u = (s: string) => new URL(s);
  assert.deepEqual(nameFor(u("https://x.test/files/Blues%20in%20A.pdf"), "application/pdf", undefined), { stem: "Blues in A", ext: "pdf" });
  assert.deepEqual(nameFor(u("https://x.test/get?id=4"), "application/pdf", undefined), { stem: "get", ext: "pdf" });
  assert.deepEqual(nameFor(u("https://x.test/"), "image/png; charset=binary", undefined), { stem: "x.test", ext: "png" });
  assert.deepEqual(nameFor(u("https://x.test/dl"), "application/octet-stream", `attachment; filename="../../Song.gp5"`), { stem: "Song", ext: "gp5" });
  assert.deepEqual(nameFor(u("https://x.test/song.musicxml"), "application/xml", undefined), { stem: "song", ext: "musicxml" });
  assert.deepEqual(nameFor(u("https://x.test/readme"), "text/plain", undefined), { stem: "readme", ext: "txt" });
  assert.throws(() => nameFor(u("https://x.test/lesson.pdf"), "text/html; charset=utf-8", undefined), /web page, not a file; it stays a link/);
  assert.throws(() => nameFor(u("https://x.test/a.pdf"), "application/xhtml+xml", undefined), /web page/);
  assert.throws(() => nameFor(u("https://x.test/a.pdf"), "application/json", undefined), /not a kind of file/);
  assert.throws(() => nameFor(u("https://x.test/a.pdf"), "application/javascript", undefined), /not a kind of file/);
  assert.throws(() => nameFor(u("https://x.test/setup.exe"), "application/octet-stream", undefined), /not a kind of file/);
  assert.throws(() => nameFor(u("https://x.test/book.epub"), "application/octet-stream", undefined), /not a kind of file/);
  assert.throws(() => nameFor(u("https://x.test/blob"), undefined, undefined), /not a kind of file/);
});

// A local server stands in for the internet. The checks stay on: the test resolver gives
// public addresses, and `dial` sends the vetted connection to this server instead.
let server: Server;
let port = 0;
let dir = "";
const hits: string[] = [];
const PUBLIC = "93.184.216.34";
let dns: Record<string, string[]> = {};
const t: Internals = {
  lookup: async (host) => dns[host] ?? [],
  dial: (address, p) => {
    assert.equal(isPublicAddress(address), true, "dialled an address that was not vetted");
    assert.ok(p === 80 || p === 443);
    return { host: "127.0.0.1", port };
  },
};
const PDF = Buffer.from("%PDF-1.4\n% a small file\n");

function serve(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  hits.push(`${req.headers.host}${url.pathname}`);
  const path = url.pathname;
  if (path === "/file.pdf") res.writeHead(200, { "content-type": "application/pdf", "content-length": PDF.length }).end(PDF);
  else if (path === "/page") res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<!doctype html><title>x</title>");
  else if (path === "/disguised.pdf") res.writeHead(200, { "content-type": "application/octet-stream" }).end("\n <!DOCTYPE HTML><html><body>login</body></html>");
  else if (path === "/named") res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="../../../Riff.gp5"` }).end("gp");
  else if (path === "/script.js") res.writeHead(200, { "content-type": "text/javascript" }).end("x");
  else if (path === "/gzip.txt") res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" }).end("x");
  else if (path === "/missing") res.writeHead(404).end();
  else if (path === "/empty.pdf") res.writeHead(200, { "content-type": "application/pdf" }).end();
  else if (path === "/big-declared.pdf") res.writeHead(200, { "content-type": "application/pdf", "content-length": 5000 }).end(Buffer.alloc(5000));
  else if (path === "/big-chunked.pdf") {
    res.writeHead(200, { "content-type": "application/pdf" });
    let n = 0;
    const tick = () => {
      if (res.destroyed) return;
      if (++n > 200) return void res.end();
      res.write(Buffer.alloc(100, 1), () => setImmediate(tick));
    };
    tick();
  } else if (path === "/cut.pdf") {
    res.writeHead(200, { "content-type": "application/pdf", "content-length": 1000 });
    res.write("%PDF", () => res.destroy());
  } else if (path === "/stall.pdf") res.writeHead(200, { "content-type": "application/pdf" }).write("%PDF");
  else if (path === "/silent") void 0;
  else if (path.startsWith("/hop/")) {
    const n = Number(path.slice(5));
    res.writeHead(302, { location: n > 0 ? `/hop/${n - 1}` : "/file.pdf" }).end();
  } else if (path === "/to") res.writeHead(307, { location: url.searchParams.get("u")! }).end();
  else if (path === "/nowhere") res.writeHead(302).end();
  else res.writeHead(500).end();
}

before(async () => {
  server = createServer(serve);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
});
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "guitar-fetch-"));
  hits.length = 0;
  dns = { "files.test": [PUBLIC], "other.test": ["8.8.4.4"], "inside.test": ["10.0.0.50"], "mixed.test": [PUBLIC, "127.0.0.1"] };
});
after(async () => {
  server.closeAllConnections();
  server.close();
});

const listing = async () => (await readdir(dir)).sort();
const clean = () => rm(dir, { recursive: true, force: true });

test("saveUrl saves a file under a safe name and never replaces one", async () => {
  const a = await saveUrl("http://files.test/file.pdf", dir, {}, t);
  assert.equal(a.name, "file.pdf");
  assert.equal(a.size, PDF.length);
  assert.equal(a.type, "application/pdf");
  assert.deepEqual(await readFile(a.path), PDF);
  await writeFile(join(dir, "file (2).pdf"), "mine");
  const b = await saveUrl("http://files.test/file.pdf", dir, {}, t);
  assert.equal(b.name, "file (3).pdf");
  assert.equal(await readFile(join(dir, "file (2).pdf"), "utf8"), "mine");
  const c = await saveUrl("http://files.test/named", dir, {}, t);
  assert.equal(c.name, "Riff.gp5");
  assert.deepEqual(await listing(), ["Riff.gp5", "file (2).pdf", "file (3).pdf", "file.pdf"]);
  assert.equal(hits[0], "files.test/file.pdf"); // The Host header is the name, not the address.
  await clean();
});

test("saveUrl refuses pages, other types, compressed and failed answers, and leaves nothing behind", async () => {
  await assert.rejects(saveUrl("http://files.test/page", dir, {}, t), /this is a web page, not a file; it stays a link/);
  await assert.rejects(saveUrl("http://files.test/disguised.pdf", dir, {}, t), /this is a web page, not a file; it stays a link/);
  await assert.rejects(saveUrl("http://files.test/script.js", dir, {}, t), /not a kind of file/);
  await assert.rejects(saveUrl("http://files.test/gzip.txt", dir, {}, t), /compressed/);
  await assert.rejects(saveUrl("http://files.test/missing", dir, {}, t), /answered 404/);
  await assert.rejects(saveUrl("http://files.test/empty.pdf", dir, {}, t), /empty/);
  await assert.rejects(saveUrl("http://files.test/cut.pdf", dir, {}, t), SaveError);
  assert.deepEqual(await listing(), []);
  await clean();
});

test("saveUrl enforces the size cap from the header and while streaming", async () => {
  await assert.rejects(saveUrl("http://files.test/big-declared.pdf", dir, { maxBytes: 1000 }, t), /too large/);
  await assert.rejects(saveUrl("http://files.test/big-chunked.pdf", dir, { maxBytes: 1000 }, t), /too large/);
  assert.deepEqual(await listing(), []);
  assert.equal((await saveUrl("http://files.test/big-chunked.pdf", dir, { maxBytes: 20_000 }, t)).size, 20_000);
  await clean();
});

test("saveUrl times out a silent server and a stalled download", async () => {
  await assert.rejects(saveUrl("http://files.test/silent", dir, { timeoutMs: 150 }, t), /too long/);
  await assert.rejects(saveUrl("http://files.test/stall.pdf", dir, { timeoutMs: 150 }, t), SaveError);
  await assert.rejects(saveUrl("http://files.test/stall.pdf", dir, { timeoutMs: 5000, totalMs: 150 }, t), /too long/);
  assert.deepEqual(await listing(), []);
  await clean();
});

test("saveUrl follows at most three redirects and checks every hop", async () => {
  assert.equal((await saveUrl("http://files.test/hop/2", dir, {}, t)).name, "file.pdf"); // Three redirects.
  await assert.rejects(saveUrl("http://files.test/hop/3", dir, {}, t), /too many redirects/);
  await assert.rejects(saveUrl("http://files.test/nowhere", dir, {}, t), /without saying where/);
  const to = (u: string) => `http://files.test/to?u=${encodeURIComponent(u)}`;
  // Another public host is fine and is resolved again.
  hits.length = 0;
  assert.equal((await saveUrl(to("http://other.test/file.pdf"), dir, {}, t)).url, "http://other.test/file.pdf");
  assert.deepEqual(hits, ["files.test/to", "other.test/file.pdf"]);
  hits.length = 0;
  for (const [target, why] of [
    ["http://127.0.0.1/file.pdf", /private or local/],
    [`http://127.0.0.1:${port}/file.pdf`, /standard web ports/],
    ["http://localhost/file.pdf", /not found|private or local/],
    ["http://inside.test/file.pdf", /private or local/],
    ["http://mixed.test/file.pdf", /private or local/],
    ["http://169.254.169.254/latest/meta-data/", /private or local/],
    ["http://[::1]/file.pdf", /private or local/],
    ["http://[::ffff:10.0.0.50]/file.pdf", /private or local/],
    ["http://user:pw@files.test/file.pdf", /user name or password/],
    ["file:///etc/passwd", /only http and https/],
    ["ftp://files.test/file.pdf", /only http and https/],
  ] as const)
    await assert.rejects(saveUrl(to(target), dir, {}, t), why, target);
  assert.ok(hits.every((h) => h === "files.test/to"), "a refused hop was still requested");
  await clean();
});

test("saveUrl refuses private targets before connecting", async () => {
  for (const url of ["http://inside.test/file.pdf", "http://mixed.test/file.pdf", "http://127.0.0.1/file.pdf", `http://127.0.0.1:${port}/file.pdf`, "http://unknown.test/file.pdf", "http://10.0.0.50/file.pdf", "https://[fd00::1]/file.pdf"])
    await assert.rejects(saveUrl(url, dir, {}, t), SaveError, url);
  // The real resolver, with no test seam at all: loopback by name is refused.
  await assert.rejects(saveUrl(`http://localhost/file.pdf`, dir), /private or local/);
  assert.deepEqual(hits, []);
  assert.deepEqual(await listing(), []);
  await clean();
});
