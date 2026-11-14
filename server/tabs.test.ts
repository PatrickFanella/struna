import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { openDb } from "./db.ts";
import { parseTabName, scanTabs, searchTabs, tabArtists } from "./tabs.ts";

test("parseTabName", () => {
  assert.deepEqual(parseTabName("3/311/311 - Beautiful Disaster (2).gp3"), { artist: "311", title: "Beautiful Disaster", version: 2, ext: "gp3" });
  assert.deepEqual(parseTabName("3/311/311 - Amber.gp4"), { artist: "311", title: "Amber", version: 1, ext: "gp4" });
  const u = parseTabName("_/_Unknown/Song.gp4");
  assert.equal(u.artist, "_Unknown");
  assert.equal(u.title, "Song");
  assert.equal(parseTabName("R/Rice, Tony/Rice, Tony - Church Street Blues.GP5").ext, "gp5");
  // A file directly under a letter folder has no artist folder.
  assert.deepEqual(parseTabName("@@/stomping beats!.gp5"), { artist: "Unknown", title: "stomping beats!", version: 1, ext: "gp5" });
  assert.equal(parseTabName("B/Black Sabbath - Paranoid.gp4").artist, "Black Sabbath");
});

let root = "";
before(async () => {
  root = await mkdtemp(join(tmpdir(), "guitar-tabs-"));
  const files = ["3/311/311 - Beautiful Disaster.gp3", "3/311/311 - Beautiful Disaster (2).gp3", "A/Alpha/Alpha - Song.gp5", "Ä/Ärzte/Ärzte - \"Schrei nach Liebe\" ｜ Live.gp4", "К/Кино/Кино - Группа крови.gp3", "notes/readme.txt"];
  for (const f of files) {
    await mkdir(join(root, f, ".."), { recursive: true });
    await writeFile(join(root, f), "x");
  }
});
after(() => rm(root, { recursive: true, force: true }));

test("scanTabs indexes the Guitar Pro files and search finds them", async () => {
  const db = openDb(join(root, "state"));
  await scanTabs(root, db);
  assert.equal(searchTabs(db, { limit: 50, offset: 0 }).total, 5);
  const r = searchTabs(db, { q: "disaster", limit: 50, offset: 0 });
  assert.equal(r.total, 2);
  assert.deepEqual(r.items.map((i) => i.version).sort(), [1, 2]);
  assert.equal(searchTabs(db, { q: "311", limit: 50, offset: 0 }).total, 2);
  assert.equal(searchTabs(db, { artist: "311", limit: 50, offset: 0 }).total, 2);
  const quoted = searchTabs(db, { q: "schrei liebe", limit: 50, offset: 0 }).items[0]!;
  assert.equal(quoted.title, "\"Schrei nach Liebe\" ｜ Live");
  assert.equal(quoted.artist, "Ärzte");
  assert.equal(searchTabs(db, { q: "группа", limit: 50, offset: 0 }).items[0]?.artist, "Кино");
  assert.deepEqual(tabArtists(db, "ki").map((a) => a.artist), []);
  assert.deepEqual(tabArtists(db, "кин").map((a) => a.artist), ["Кино"]);
  assert.equal(tabArtists(db, "").find((a) => a.artist === "311")?.count, 2);
  db.close();
});
