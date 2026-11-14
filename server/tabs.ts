import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { resolveInside } from "./files.ts";
import { HttpError, route } from "./http.ts";
import { ftsQuery } from "./library/index-db.ts";
import { sendFile } from "./library/media.ts";

export const TABS_REL = "Restricted or Rights Review/Guitar Pro Tabs and Wiring/Collection/Guitar_Pro_Tabs";
const EXTS = new Set([".gp3", ".gp4", ".gp5"]);
export type Tab = { id: string; artist: string; title: string; version: number; ext: "gp3" | "gp4" | "gp5"; path: string };

/** "3/311/311 - Beautiful Disaster (2).gp3" → artist "311", title "Beautiful Disaster", version 2. */
export function parseTabName(relPath: string): { artist: string; title: string; version: number; ext: "gp3" | "gp4" | "gp5" } {
  const parts = relPath.split(/[\\/]/);
  const file = parts.at(-1)!;
  const ext = extname(file).slice(1).toLowerCase() as "gp3" | "gp4" | "gp5";
  let title = file.slice(0, file.length - ext.length - 1);
  let artist: string;
  if (parts.length >= 3) {
    artist = parts.at(-2)!;
    if (title.startsWith(`${artist} - `)) title = title.slice(artist.length + 3);
  } else {
    // Directly under a letter folder: the artist, if any, is in the file name.
    const dash = title.indexOf(" - ");
    artist = dash > 0 ? title.slice(0, dash) : "Unknown";
    if (dash > 0) title = title.slice(dash + 3);
  }
  let version = 1;
  const v = /\s\((\d+)\)$/.exec(title);
  if (v) {
    version = Number(v[1]);
    title = title.slice(0, v.index);
  }
  return { artist, title: title.trim(), version, ext };
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.isFile() && EXTS.has(extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

const SCHEMA = "id TEXT PRIMARY KEY, artist TEXT, title TEXT, version INTEGER, ext TEXT, path TEXT";
const FTS = "USING fts5(artist, title, tab_id UNINDEXED, tokenize = 'unicode61 remove_diacritics 2')";

export function ensureTabsSchema(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS tabs (${SCHEMA}); CREATE VIRTUAL TABLE IF NOT EXISTS tabs_fts ${FTS};
    CREATE TABLE IF NOT EXISTS library_meta (key TEXT PRIMARY KEY, value TEXT);`);
}

/** Index the collection into `tabs_next`, then swap it in with one transaction, as the library index does. */
export async function scanTabs(root: string, db: DatabaseSync): Promise<number> {
  ensureTabsSchema(db);
  const files = await walk(root);
  db.exec(`DROP TABLE IF EXISTS tabs_next; DROP TABLE IF EXISTS tabs_fts_next; CREATE TABLE tabs_next (${SCHEMA}); CREATE VIRTUAL TABLE tabs_fts_next ${FTS};`);
  const ins = db.prepare("INSERT OR REPLACE INTO tabs_next (id, artist, title, version, ext, path) VALUES (?, ?, ?, ?, ?, ?)");
  const fts = db.prepare("INSERT INTO tabs_fts_next (artist, title, tab_id) VALUES (?, ?, ?)");
  for (let i = 0; i < files.length; i += 2000) {
    db.exec("BEGIN");
    try {
      for (const f of files.slice(i, i + 2000)) {
        const rel = relative(root, f).split(sep).join("/");
        const t = parseTabName(rel);
        const id = createHash("sha1").update(rel).digest("hex");
        ins.run(id, t.artist, t.title, t.version, t.ext, rel);
        fts.run(t.artist, t.title, id);
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    await new Promise((r) => setImmediate(r));
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DROP TABLE tabs; ALTER TABLE tabs_next RENAME TO tabs; DROP TABLE tabs_fts; ALTER TABLE tabs_fts_next RENAME TO tabs_fts;");
    db.prepare("INSERT INTO library_meta (key, value) VALUES ('tabsScannedAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(new Date().toISOString());
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return files.length;
}

export function searchTabs(db: DatabaseSync, o: { q?: string; artist?: string; limit: number; offset: number }): { items: Tab[]; total: number } {
  ensureTabsSchema(db);
  const match = o.q?.trim() ? ftsQuery(o.q) : null;
  if (o.q?.trim() && !match) return { items: [], total: 0 };
  const where: string[] = [];
  const params: Record<string, string | number> = { limit: o.limit, offset: o.offset };
  if (match) {
    where.push("t.id IN (SELECT tab_id FROM tabs_fts WHERE tabs_fts MATCH :match)");
    params.match = match;
  }
  if (o.artist) {
    where.push("t.artist = :artist");
    params.artist = o.artist;
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const items = db.prepare(`SELECT t.id, t.artist, t.title, t.version, t.ext, t.path FROM tabs t ${w} ORDER BY t.artist COLLATE NOCASE, t.title COLLATE NOCASE, t.version LIMIT :limit OFFSET :offset`).all(params) as Tab[];
  const { limit: _l, offset: _o, ...countParams } = params;
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM tabs t ${w}`).get(countParams) as { n: number }).n;
  return { items, total };
}

/** Artists with a word starting with `prefix` (case-insensitive in any script), with their tab counts. */
export function tabArtists(db: DatabaseSync, prefix: string, limit = 100): { artist: string; count: number }[] {
  ensureTabsSchema(db);
  const all = db.prepare("SELECT artist, COUNT(*) AS count FROM tabs GROUP BY artist ORDER BY artist COLLATE NOCASE").all() as { artist: string; count: number }[];
  const p = prefix.trim().toLocaleLowerCase();
  const hit = p ? all.filter((a) => a.artist.toLocaleLowerCase().split(/[\s_,.&-]+/).some((w) => w.startsWith(p)) || a.artist.toLocaleLowerCase().startsWith(p)) : all;
  return hit.slice(0, limit);
}

/**
 * `root` is the Guitar Pro collection folder. Without it the collection is the
 * personal one, `TABS_REL` under `mediaRoot`.
 */
export function tabsRoutes(opts: { root?: string | undefined; mediaRoot?: string | undefined; autoScan: boolean }, db: DatabaseSync): { rescan: () => boolean } {
  const root = opts.root || (opts.mediaRoot ? join(opts.mediaRoot, TABS_REL) : "");
  if (!root) throw new Error("tabsRoutes needs the collection root");
  let running = false;
  const rescan = () => {
    if (running) return false;
    running = true;
    void scanTabs(root, db)
      .catch((e) => console.error("tab scan failed:", e))
      .finally(() => {
        running = false;
      });
    return true;
  };
  route("GET", "/api/tabs", (_req, res, { url }) => {
    const r = searchTabs(db, { q: (url.searchParams.get("q") ?? "").slice(0, 200), ...(url.searchParams.get("artist") ? { artist: url.searchParams.get("artist")! } : {}), limit: 50, offset: Math.max(0, Number(url.searchParams.get("offset")) || 0) });
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" });
    res.end(JSON.stringify({ ...r, scanning: running }));
  });
  route("GET", "/api/tabs/artists", (_req, res, { url }) => {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" });
    res.end(JSON.stringify(tabArtists(db, (url.searchParams.get("q") ?? "").slice(0, 100))));
  });
  route("GET", "/api/tabs/:id/file", async (req, res, { params }) => {
    ensureTabsSchema(db);
    const t = db.prepare("SELECT path FROM tabs WHERE id = ?").get(params.id!) as { path: string } | undefined;
    if (!t) throw new HttpError(404, "not found");
    await sendFile(req, res, await resolveInside(root, t.path), "application/octet-stream");
  });
  if (opts.autoScan) {
    ensureTabsSchema(db);
    const at = (db.prepare("SELECT value FROM library_meta WHERE key = 'tabsScannedAt'").get() as { value: string } | undefined)?.value;
    if (!at || Date.now() - Date.parse(at) > 24 * 3600_000) rescan();
  }
  return { rescan };
}

export const tabFileName = (t: Tab) => basename(t.path);
