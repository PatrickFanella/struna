import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { fail, match } from "../http.ts";
import { SaveError } from "./fetch.ts";
import { type Listed, type Listing, listMaterials, materialsFingerprint, materialsRoutes, pendingSaves, reconcileLinks, saveAndRecord, type Saver, youtubeId } from "./materials.ts";
import type { Studio } from "./studio.ts";

const tmp = await mkdtemp(join(tmpdir(), "guitar-materials-"));
const home = join(tmp, "home");
const lib = join(tmp, "library");
const mat = join(home, "materials");
const studio = { home, libraryDirs: [lib], timeZone: "UTC", web: true, appName: "Guitar Room" } as unknown as Studio;

// Stands in for the downloader: the real one is tested in fetch.test.ts.
const saver: Saver = async (url, dir) => {
  if (url.includes("page")) throw new SaveError("this is a web page, not a file; it stays a link");
  const name = `${new URL(url).pathname.split("/").at(-1)}`;
  await writeFile(join(dir, name), `copy of ${url}`, { flag: "wx" });
  return { name };
};

let server: Server;
let base = "";
before(async () => {
  await mkdir(join(mat, "lessons"), { recursive: true });
  await mkdir(join(mat, ".trash"), { recursive: true });
  await mkdir(join(home, "plan"), { recursive: true });
  await mkdir(join(lib, "Sheets/sub"), { recursive: true });
  await mkdir(join(lib, ".git"), { recursive: true });
  await writeFile(join(mat, "Blues in A.pdf"), "%PDF-1.4 blues");
  await writeFile(join(mat, "lessons/First chords.md"), "# First chords\n");
  await writeFile(join(mat, "page.html"), "<script>alert(1)</script>");
  await writeFile(join(mat, ".hidden.pdf"), "x");
  await writeFile(join(mat, ".trash/old.pdf"), "x");
  await writeFile(join(tmp, "secret.txt"), "secret");
  await symlink(join(tmp, "secret.txt"), join(mat, "escape.txt"));
  await writeFile(join(lib, "Sheets/Minor Swing.pdf"), "%PDF swing");
  await writeFile(join(lib, "Sheets/sub/Riff.gp5"), "gp5");
  await writeFile(join(lib, "Sheets/notes.docx"), "x");
  await writeFile(join(lib, ".git/config.txt"), "x");
  await writeFile(join(lib, "clip.mp4"), "0123456789");
  await writeFile(
    join(home, "plan/plan.json"),
    JSON.stringify({ version: 1, materials: [{ label: "Blues", file: "materials/Blues in A.pdf" }, { label: "Lesson", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }] }),
  );
  materialsRoutes(studio, { save: saver });
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const found = match(req.method === "HEAD" ? "GET" : req.method!, url.pathname);
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

const list = async (query = ""): Promise<Listing> => (await fetch(`${base}/api/materials${query}`)).json() as Promise<Listing>;
const byTitle = async (title: string): Promise<Listed> => {
  const item = (await list()).items.find((i) => i.title === title);
  assert.ok(item, `no item titled ${title}`);
  return item;
};
const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const links = async () => JSON.parse(await readFile(join(mat, "links.json"), "utf8")) as Record<string, unknown>[];
const idOf = (prefix: string, rel: string) => `${prefix}.${Buffer.from(rel).toString("base64url")}`;

test("youtubeId", () => {
  for (const u of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=10", "https://youtu.be/dQw4w9WgXcQ?si=abc", "https://www.youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ", "https://m.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"])
    assert.equal(youtubeId(u), "dQw4w9WgXcQ", u);
  for (const u of ["https://www.youtube.com/@channel", "https://www.youtube.com/watch?v=short", "https://example.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/", "https://notyoutube.com/embed/dQw4w9WgXcQ", "javascript:youtu.be/dQw4w9WgXcQ", "nope"]) assert.equal(youtubeId(u), null, u);
});

test("the list has studio files and library files with kinds, and marks what the plan names", async () => {
  const r = await list();
  assert.equal(r.truncated, undefined);
  const titles = r.items.map((i) => `${i.source}:${i.title}:${i.kind}`).sort();
  assert.deepEqual(titles, ["folder:Minor Swing:pdf", "folder:Riff:tab", "folder:clip:video", "studio:Blues in A:pdf", "studio:First chords:text", "studio:page:other"]);
  const blues = r.items.find((i) => i.title === "Blues in A")!;
  assert.equal(blues.path, "materials/Blues in A.pdf");
  assert.equal(blues.inPlan, true);
  assert.equal(blues.size, 14);
  assert.match(blues.added, /^\d{4}-\d\d-\d\dT/);
  assert.equal(r.items.find((i) => i.title === "First chords")!.path, "materials/lessons/First chords.md");
  const riff = r.items.find((i) => i.title === "Riff")!;
  assert.equal(riff.path, "0:Sheets/sub/Riff.gp5");
  assert.equal(riff.inPlan, false);
  // Studio items come before the library.
  assert.deepEqual(r.items.map((i) => i.source).slice(-3), ["folder", "folder", "folder"]);
  assert.deepEqual((await list("?kind=pdf")).items.map((i) => i.title).sort(), ["Blues in A", "Minor Swing"]);
  assert.deepEqual((await list("?q=SWING%20minor")).items.map((i) => i.title), ["Minor Swing"]);
  assert.deepEqual((await list("?q=lessons")).items.map((i) => i.title), ["First chords"]);
  const cut = await list("?limit=2");
  assert.equal(cut.items.length, 2);
  assert.equal(cut.total, 6);
});

test("files are served with ranges and safe types; nothing outside the folders is reachable", async () => {
  const blues = await byTitle("Blues in A");
  const whole = await fetch(base + blues.src);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get("content-type"), "application/pdf");
  assert.equal(whole.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await whole.text(), "%PDF-1.4 blues");
  const part = await fetch(base + blues.src, { headers: { range: "bytes=1-3" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), "bytes 1-3/14");
  assert.equal(await part.text(), "PDF");
  const clip = await byTitle("clip"); // No cache folder was given, so the video is served as it is.
  assert.equal((await fetch(base + clip.src)).headers.get("content-type"), "video/mp4");
  // A page the coach wrote is a download, never rendered from this origin.
  const page = await fetch(base + (await byTitle("page")).src);
  assert.equal(page.headers.get("content-type"), "application/octet-stream");
  assert.equal(page.headers.get("content-disposition"), "attachment");
  const get = (id: string) => fetch(`${base}/api/materials/file?id=${encodeURIComponent(id)}`).then((r) => r.status);
  assert.equal(await get(idOf("f", "Blues in A.pdf")), 200);
  for (const id of [
    idOf("f", "../../secret.txt"), idOf("f", "../plan/plan.json"), idOf("f", "/etc/passwd"), idOf("f", "escape.txt"), idOf("f", ".hidden.pdf"), idOf("f", ".trash/old.pdf"), idOf("f", "links.json"),
    idOf("f", "lessons"), idOf("f", "nope.pdf"), idOf("f", ""), idOf("d0", "../secret.txt"), idOf("d0", ".git/config.txt"), idOf("d1", "clip.mp4"), idOf("d99", "clip.mp4"), idOf("x", "clip.mp4"), "f", "", "l.0123456789abcdef",
  ])
    assert.equal(await get(id), 404, id);
});

test("uploads get a safe name, never replace a file, and refuse other types", async () => {
  const up = (name: string, body: string) => fetch(`${base}/api/materials/upload?name=${encodeURIComponent(name)}`, { method: "POST", body });
  const a = await up("../../Evil/Scale Chart.PNG", "png-bytes");
  assert.equal(a.status, 201);
  const item = (await a.json()) as Listed;
  assert.equal(item.path, "materials/Scale Chart.png");
  assert.equal(item.kind, "image");
  assert.equal(item.source, "studio");
  assert.equal(await (await fetch(base + item.src)).text(), "png-bytes");
  assert.equal(((await (await up("Scale Chart.png", "second")).json()) as Listed).path, "materials/Scale Chart (2).png");
  assert.equal(((await (await up("Scale Chart.png", "third")).json()) as Listed).path, "materials/Scale Chart (3).png");
  assert.equal(await readFile(join(mat, "Scale Chart.png"), "utf8"), "png-bytes");
  assert.equal(((await (await up(".env.txt", "x")).json()) as Listed).path, "materials/env.txt");
  for (const bad of ["run.sh", "page.html", "x.svg", "links.json", "noext", ""]) assert.equal((await up(bad, "x")).status, 400, bad);
  assert.equal((await up("empty.pdf", "")).status, 400);
  // A body declared larger than 500 MB is refused before any of it is read.
  const declared = await new Promise<number>((resolve, reject) => {
    const req = request(`${base}/api/materials/upload?name=big.pdf`, { method: "POST", headers: { "content-length": 600 * 1024 * 1024 } }, (res) => {
      resolve(res.statusCode ?? 0);
      req.destroy();
    });
    req.on("error", reject);
    req.flushHeaders();
  });
  assert.equal(declared, 413);
  assert.deepEqual((await readdir(mat)).filter((n) => n.endsWith(".part")), []);
});

test("pasted text becomes a Markdown file", async () => {
  const r = await post("/api/materials/text", { title: "House of the Rising Sun: chords", text: "Am C D F" });
  assert.equal(r.status, 201);
  const item = (await r.json()) as Listed;
  assert.equal(item.path, "materials/House of the Rising Sun chords.md");
  assert.equal(item.kind, "text");
  assert.equal(await readFile(join(mat, "House of the Rising Sun chords.md"), "utf8"), "Am C D F\n");
  assert.equal(((await (await post("/api/materials/text", { title: "../../x", text: "a" })).json()) as Listed).path, "materials/x.md");
  assert.equal(((await (await post("/api/materials/text", { text: "a" })).json()) as Listed).path, "materials/Notes.md");
  assert.equal((await post("/api/materials/text", { title: "t", text: "  " })).status, 400);
});

test("links: add, dedupe, save a copy, delete", async () => {
  const yt = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  const a = await post("/api/materials/link", { url: yt, title: "First lesson", note: "Start here" });
  assert.equal(a.status, 201);
  const link = (await a.json()) as Listed;
  assert.equal(link.kind, "link");
  assert.equal(link.source, "link");
  assert.equal(link.youtube, "dQw4w9WgXcQ");
  assert.equal(link.src, null);
  assert.equal(link.inPlan, true);
  assert.equal(link.note, "Start here");
  // The same link again keeps one entry and takes the new title.
  assert.equal((await post("/api/materials/link", { url: yt, title: "Lesson one" })).status, 200);
  assert.equal((await links()).length, 1);
  assert.equal((await links())[0]!.title, "Lesson one");
  for (const bad of ["ftp://x.test/a", "javascript:alert(1)", "not a url", "https://user:pw@x.test/a", ""]) assert.equal((await post("/api/materials/link", { url: bad })).status, 400, bad);

  // Saving a copy turns the link into a file that keeps its URL; it is listed once.
  const saved = (await (await post("/api/materials/link", { url: "https://files.test/tabs/Wonderwall.pdf", title: "Wonderwall chords", save: true })).json()) as Listed;
  assert.equal(saved.source, "studio");
  assert.equal(saved.kind, "pdf");
  assert.equal(saved.path, "materials/Wonderwall.pdf");
  assert.equal(saved.title, "Wonderwall chords");
  assert.equal(saved.url, "https://files.test/tabs/Wonderwall.pdf");
  assert.equal((await list("?q=wonderwall")).items.length, 1);
  assert.equal((await links()).find((l) => l.url === saved.url)!.file, "materials/Wonderwall.pdf");

  // A page stays a link and says why there is no copy.
  const page = (await (await post("/api/materials/link", { url: "https://files.test/page", save: true })).json()) as Listed;
  assert.equal(page.source, "link");
  assert.match(page.saveError!, /web page/);
  assert.equal(page.title, "files.test");
  const again = await fetch(`${base}/api/materials/${page.id}/save`, { method: "POST" });
  assert.equal(again.status, 422);
  assert.match(((await again.json()) as { error: string }).error, /web page/);

  // Save a copy of a plain link later.
  const plain = (await (await post("/api/materials/link", { url: "https://files.test/Scales.pdf" })).json()) as Listed;
  const later = await fetch(`${base}/api/materials/${plain.id}/save`, { method: "POST" });
  assert.equal(later.status, 200);
  assert.equal(((await later.json()) as Listed).path, "materials/Scales.pdf");
  assert.equal((await fetch(`${base}/api/materials/${idOf("f", "Blues in A.pdf")}/save`, { method: "POST" })).status, 400);

  // Deleting: a link leaves links.json; a saved copy goes to the trash with its link; library files stay.
  assert.equal((await fetch(`${base}/api/materials/${link.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await links()).some((l) => l.url === yt), false);
  assert.equal((await fetch(`${base}/api/materials/${saved.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await links()).some((l) => l.url === saved.url), false);
  const trash = await readdir(join(mat, ".trash"));
  assert.ok(trash.some((n) => /^\d{8}T\d{6}Z-[0-9a-f]{4}-Wonderwall\.pdf$/.test(n)), trash.join(", "));
  assert.equal((await list("?q=wonderwall")).items.length, 0);
  const swing = await byTitle("Minor Swing");
  const no = await fetch(`${base}/api/materials/${swing.id}`, { method: "DELETE" });
  assert.equal(no.status, 400);
  assert.equal(await readFile(join(lib, "Sheets/Minor Swing.pdf"), "utf8"), "%PDF swing");
  assert.equal((await fetch(`${base}/api/materials/${idOf("f", "../../secret.txt")}`, { method: "DELETE" })).status, 404);
  assert.equal(await readFile(join(tmp, "secret.txt"), "utf8"), "secret");
});

test("reconcileLinks saves what the coach asked for and records failures", async () => {
  const before = await materialsFingerprint(studio);
  assert.equal(await materialsFingerprint(studio), before);
  const entries = [
    ...(await links()),
    { url: "https://files.test/dl/Pentatonic.pdf", title: "Pentatonic boxes", note: "Five shapes", level: "beginner", save: true, extra: "kept" },
    { url: "https://files.test/page-lesson", title: "A lesson page", save: true },
    { url: "https://files.test/NoSave.pdf", title: "Not asked for" },
    { url: "https://files.test/Failed.pdf", title: "Failed before", save: true, saveError: "the server answered 404" },
    "not an entry",
    { title: "no url" },
  ];
  await writeFile(join(mat, "links.json"), JSON.stringify(entries));
  assert.notEqual(await materialsFingerprint(studio), before);
  const r = await reconcileLinks(studio, saver);
  assert.deepEqual(r.saved, ["materials/Pentatonic.pdf"]);
  assert.equal(r.failed.length, 1);
  assert.match(r.failed[0]!, /page-lesson: this is a web page/);
  const now = await links();
  const pent = now.find((l) => l.url === "https://files.test/dl/Pentatonic.pdf")!;
  assert.equal(pent.file, "materials/Pentatonic.pdf");
  assert.equal(pent.extra, "kept"); // Fields the app does not know survive.
  assert.match(now.find((l) => l.url === "https://files.test/page-lesson")!.saveError as string, /web page/);
  assert.equal(now.find((l) => l.url === "https://files.test/NoSave.pdf")!.file, undefined);
  assert.equal(now.length, entries.length);
  assert.ok((now as unknown[]).includes("not an entry"));
  const item = await byTitle("Pentatonic boxes");
  assert.equal(item.source, "studio");
  assert.equal(item.note, "Five shapes · beginner");
  // Nothing left to do: a second run changes nothing.
  assert.deepEqual(await reconcileLinks(studio, saver), { saved: [], failed: [] });

  // A broken links.json is reported and left exactly as it is.
  const good = await readFile(join(mat, "links.json"), "utf8");
  const broken = '[{"url": "https://files.test/x.pdf", "save": true},';
  await writeFile(join(mat, "links.json"), broken);
  const bad = await reconcileLinks(studio, saver);
  assert.deepEqual(bad.saved, []);
  assert.match(bad.failed[0]!, /links\.json is not valid JSON/);
  assert.equal(await readFile(join(mat, "links.json"), "utf8"), broken);
  const listed = await list();
  assert.match(listed.linksError!, /not valid JSON/);
  assert.ok(listed.items.some((i) => i.title === "Blues in A"));
  assert.equal((await post("/api/materials/link", { url: "https://files.test/y.pdf" })).status, 409);
  assert.equal(await readFile(join(mat, "links.json"), "utf8"), broken);
  await writeFile(join(mat, "links.json"), '{"url": "x"}');
  assert.match((await reconcileLinks(studio, saver)).failed[0]!, /must be a JSON array/);
  await writeFile(join(mat, "links.json"), good);
});

test("a studio without folders or files lists nothing and does not throw", async () => {
  const empty = { home: join(tmp, "fresh"), libraryDirs: [join(tmp, "no-such-folder")] };
  assert.deepEqual(await listMaterials(empty), { items: [], total: 0 });
  assert.deepEqual(await reconcileLinks(empty, saver), { saved: [], failed: [] });
  assert.equal(typeof (await materialsFingerprint(empty)), "string");
});

test("the library walk stops at 20,000 files and says so", async () => {
  const big = join(tmp, "big");
  for (let d = 0; d < 21; d++) {
    await mkdir(join(big, `d${d}`), { recursive: true });
    await Promise.all(Array.from({ length: 1000 }, (_, i) => writeFile(join(big, `d${d}`, `${i}.txt`), "")));
  }
  const r = await listMaterials({ home: join(tmp, "fresh"), libraryDirs: [big, lib] }, { limit: 5 });
  assert.equal(r.truncated, true);
  assert.equal(r.total, 20_000);
  assert.equal(r.items.length, 5);
});

test("overlapping saves of one link download it once and leave no orphan copy", async () => {
  const h = { home: join(tmp, "dedupe"), libraryDirs: [] };
  await mkdir(join(h.home, "materials"), { recursive: true });
  await writeFile(join(h.home, "materials/links.json"), JSON.stringify([{ url: "https://files.test/a.pdf", title: "A", save: true }]));
  let calls = 0;
  const slow: Saver = async (url, dir) => {
    calls++;
    await new Promise((r) => setTimeout(r, 30));
    return saver(url, dir);
  };
  // Two chat turns ending together, and a tap on "Save a copy" while they run.
  const [a, b, c] = await Promise.all([reconcileLinks(h, slow), reconcileLinks(h, slow), saveAndRecord(h, "https://files.test/a.pdf", slow)]);
  assert.equal(calls, 1);
  assert.deepEqual([a.saved, b.saved, c], [["materials/a.pdf"], ["materials/a.pdf"], { file: "materials/a.pdf" }]);
  assert.deepEqual((await readdir(join(h.home, "materials"))).sort(), ["a.pdf", "links.json"]);
  assert.equal((await listMaterials(h)).items.length, 1);
  // Already kept: no new download.
  assert.deepEqual(await saveAndRecord(h, "https://files.test/a.pdf", slow), { file: "materials/a.pdf" });
  assert.equal(calls, 1);
});

test("a copy made while another download ran is dropped, and a stale entry takes a new copy", async () => {
  const h = { home: join(tmp, "orphan"), libraryDirs: [] };
  const m = join(h.home, "materials");
  await mkdir(m, { recursive: true });
  await writeFile(join(m, "links.json"), JSON.stringify([{ url: "https://files.test/b.pdf", title: "B", save: true }]));
  // The entry gets its copy from elsewhere while this download runs.
  const racing: Saver = async (url, dir) => {
    await writeFile(join(m, "kept.pdf"), "first");
    await writeFile(join(m, "links.json"), JSON.stringify([{ url, title: "B", save: true, file: "materials/kept.pdf" }]));
    return saver(url, dir);
  };
  assert.deepEqual(await saveAndRecord(h, "https://files.test/b.pdf", racing), { file: "materials/kept.pdf" });
  assert.deepEqual((await readdir(m)).sort(), ["kept.pdf", "links.json"]);
  // The kept file is removed outside the app: the next save replaces the entry's copy.
  await rm(join(m, "kept.pdf"));
  assert.deepEqual(await saveAndRecord(h, "https://files.test/b.pdf", saver), { file: "materials/b.pdf" });
  assert.equal(JSON.parse(await readFile(join(m, "links.json"), "utf8"))[0].file, "materials/b.pdf");
});

test("a pass stops starting downloads once its signal aborts; the rest stay pending", async () => {
  const h = { home: join(tmp, "budget"), libraryDirs: [] };
  await mkdir(join(h.home, "materials"), { recursive: true });
  await writeFile(join(h.home, "materials/links.json"), JSON.stringify(["c", "d", "e"].map((n) => ({ url: `https://files.test/${n}.pdf`, title: n, save: true }))));
  assert.equal(await pendingSaves(h), 3);
  const stop = new AbortController();
  const seen: (AbortSignal | undefined)[] = [];
  const first: Saver = async (url, dir, signal) => {
    seen.push(signal);
    stop.abort();
    return saver(url, dir);
  };
  const r = await reconcileLinks(h, first, stop.signal);
  assert.deepEqual(r, { saved: ["materials/c.pdf"], failed: [] });
  assert.equal(seen[0], stop.signal, "the download gets the pass's signal");
  assert.equal(await pendingSaves(h), 2);
  const listed = await listMaterials(h);
  assert.equal(listed.items.filter((i) => i.source === "link" && !i.saveError).length, 2);
});

test("a link being downloaded is listed as saving", async () => {
  const h = { home: join(tmp, "saving"), libraryDirs: [] };
  await mkdir(join(h.home, "materials"), { recursive: true });
  await writeFile(join(h.home, "materials/links.json"), JSON.stringify([{ url: "https://files.test/f.pdf", title: "F", save: true }]));
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const held: Saver = async (url, dir) => {
    await gate;
    return saver(url, dir);
  };
  const job = saveAndRecord(h, "https://files.test/f.pdf", held);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((await listMaterials(h)).items[0]!.saving, true);
  release();
  await job;
  const after = (await listMaterials(h)).items[0]!;
  assert.equal(after.saving, undefined);
  assert.equal(after.source, "studio");
});
