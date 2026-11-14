import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";

import { openDb } from "../db.ts";
import { searchLibrary, writeIndex } from "./index-db.ts";
import { type Item, scanLibrary } from "./scan.ts";

const fx = join(import.meta.dirname, "../fixtures");
let tmp = "";
let items: Item[] = [];
const opts = () => ({ mediaRoot: join(tmp, "media"), vaultRoot: join(fx, "vault"), threadRel: "001 Projects/Threads/Guitar", calibreReceipt: join(fx, "calibre-receipt.json") });

before(async () => {
  tmp = await mkdtemp(join(tmpdir(), "guitar-scan-"));
  await cp(join(fx, "media"), join(tmp, "media"), { recursive: true });
  // The archive's stream ledger, as written by the 2026-08-07 capture.
  const ledgerDir = join(tmp, "media/Source Archives/Country Guitar Online Assessment Archive - 2026-08-07/00-Reports-and-Ledgers");
  await (await import("node:fs/promises")).mkdir(ledgerDir, { recursive: true });
  const l = new DatabaseSync(join(ledgerDir, "stream-archive.sqlite3"));
  l.exec("CREATE TABLE streams (provider TEXT, external_id TEXT, source_page TEXT, player_url TEXT, status TEXT, relative_path TEXT, bytes INTEGER, sha256 TEXT, duration_seconds REAL, attempts INTEGER, error TEXT, completed_at TEXT)");
  l.prepare("INSERT INTO streams (provider, external_id, source_page, status, relative_path, duration_seconds) VALUES (?, ?, ?, 'completed', ?, ?)").run("vimeo", "132673069", "https://countryguitaronline.com/the-best-country-strumming-patterns/", "videos/vimeo/132673069.mp4", 312);
  l.prepare("INSERT INTO streams (provider, external_id, source_page, status, relative_path, duration_seconds) VALUES (?, ?, ?, 'completed', ?, ?)").run("vimeo", "259880969", "https://countryguitaronline.com/12-bar-blues-country-twang-guitar-lesson/", "videos/vimeo/259880969.mp4", 81.4);
  l.exec("PRAGMA journal_mode = WAL");
  l.close();
  items = await scanLibrary(opts());
});
after(() => rm(tmp, { recursive: true, force: true }));

test("CGO lesson copies share a group titled from the vault article note", () => {
  const strum = items.filter((i) => i.group === "vimeo:132673069");
  assert.equal(strum.length, 2);
  assert.ok(strum.every((i) => i.title === "The Best Country Strumming Patterns"), JSON.stringify(strum.map((i) => i.title)));
  const folder = strum.find((i) => i.source === "cgo")!;
  assert.match(folder.description, /Five strumming patterns/);
  assert.equal(folder.duration, 312);
  assert.equal(strum.find((i) => i.source === "archive")!.duration, 312);
});

test("reading the archive's WAL-mode ledger leaves no -shm or -wal files", async () => {
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(join(tmp, "media/Source Archives/Country Guitar Online Assessment Archive - 2026-08-07/00-Reports-and-Ledgers"));
  assert.deepEqual(files, ["stream-archive.sqlite3"]);
});

test("an archive capture without an article is titled from its source page", () => {
  const twang = items.find((i) => i.group === "vimeo:259880969")!;
  assert.equal(twang.source, "archive");
  assert.equal(twang.title, "12 bar blues country twang guitar lesson");
});

test("other sources", () => {
  const aw = items.find((i) => i.source === "artistworks" && i.kind === "video")!;
  assert.equal(aw.title, "You Are My Sunshine Rhythm Intro");
  assert.match(aw.description, /Bryan Sutton/);
  assert.ok(items.some((i) => i.source === "artistworks" && i.kind === "audio" && i.title === "Little Maggie"));
  const vault = items.filter((i) => i.source === "vault");
  assert.ok(vault.some((i) => i.path === "001 Projects/Threads/Guitar/Practice/Materials/Aaron Jaxon - Blues Scales for Bluegrass Guitar.pdf"));
  assert.ok(vault.some((i) => i.title === "Tony Rice Solo (in A TAB)"));
  const entries = items.filter((i) => i.kind === "zip-entry");
  assert.deepEqual(entries.map((e) => e.entry).sort(), ["Music Sheets/Mine/Song ｜ Draft #2.odt", "Music Sheets/Real book/Blues Tune.pdf"]);
  assert.ok(entries.every((e) => e.source === "sheets"));
  const book = items.find((i) => i.source === "books")!;
  assert.equal(book.title, "Test Book");
  assert.equal(book.kind, "pdf");
  assert.match(book.path!, /\.pdf$/);
  assert.match(book.alt!, /\.epub$/);
  assert.equal(book.calibreId, 1112);
  assert.equal(items.filter((i) => i.source === "books").length, 1);
  assert.ok(items.some((i) => i.source === "music-books" && i.title === "Fake Book"));
  assert.ok(items.some((i) => i.source === "archive" && i.kind === "pdf" && i.title === "G Run Licks"));
});

test("search finds the lesson, once, preferring the lesson-folder copy", () => {
  const db = openDb(join(tmp, "state"));
  writeIndex(db, items);
  const r = searchLibrary(db, { q: "strumming", limit: 20, offset: 0 });
  assert.equal(r.total, 1);
  assert.equal(r.items[0]!.source, "cgo");
  assert.equal(r.items[0]!.title, "The Best Country Strumming Patterns");
  assert.equal(searchLibrary(db, { q: "strumming", source: "archive", limit: 20, offset: 0 }).total, 0);
  assert.ok(searchLibrary(db, { source: "sheets", limit: 20, offset: 0 }).total === 2);
  assert.ok(searchLibrary(db, { kind: "audio", limit: 20, offset: 0 }).total === 1);
  db.close();
});

test("titles with ｜, # and ⧸ round-trip and are searchable", () => {
  const db = openDb(join(tmp, "state2"));
  writeIndex(db, items);
  const r = searchLibrary(db, { q: "hammer-ons", limit: 20, offset: 0 });
  assert.equal(r.items[0]?.title, "Smooth Flowing Bass Line w⧸ Hammer-Ons ｜ 12 Bar Workout #bluegrass");
  assert.equal(searchLibrary(db, { q: 'draft "#2', limit: 20, offset: 0 }).items[0]?.entry, "Music Sheets/Mine/Song ｜ Draft #2.odt");
  assert.equal(searchLibrary(db, { q: "\"unbalanced (", limit: 20, offset: 0 }).total, 0);
  db.close();
});

test("a rescan never shows a reader an empty or partial index", async () => {
  const path = join(tmp, "state3");
  const writer = openDb(path);
  const reader = new DatabaseSync(join(path, "guitar-room.sqlite"));
  writeIndex(writer, items);
  const full = searchLibrary(reader, { limit: 500, offset: 0 }).total;
  let stop = false;
  const seen = new Set<number>();
  const loop = (async () => {
    while (!stop) {
      seen.add(searchLibrary(reader, { limit: 500, offset: 0 }).total);
      await new Promise((r) => setImmediate(r));
    }
  })();
  for (let i = 0; i < 5; i++) await writeIndex(writer, items, { batch: 2 });
  stop = true;
  await loop;
  assert.deepEqual([...seen], [full]);
  reader.close();
  writer.close();
});
