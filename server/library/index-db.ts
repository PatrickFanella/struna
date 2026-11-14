import type { DatabaseSync } from "node:sqlite";

import type { Item } from "./scan.ts";

const COLUMNS = "id TEXT PRIMARY KEY, source TEXT, kind TEXT, title TEXT, description TEXT, path TEXT, url TEXT, entry TEXT, size INTEGER, duration REAL, grp TEXT, alt TEXT, calibre_id INTEGER, pref INTEGER";
const FTS = "USING fts5(title, description, item_id UNINDEXED, tokenize = 'unicode61 remove_diacritics 2')";

export function ensureLibrarySchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (${COLUMNS});
    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts ${FTS};
    CREATE TABLE IF NOT EXISTS library_meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS probe_cache (path TEXT PRIMARY KEY, size INTEGER, mtime REAL, duration REAL);
  `);
}

/** Lower is preferred when a lesson has several copies: the lesson folder, then the archive's lesson videos, then stream captures. */
function pref(i: Item): number {
  if (!i.path) return 3;
  if (i.path.startsWith("Lesson Videos/")) return 0;
  if (i.path.includes("/02-Lesson-Videos/")) return 1;
  return 2;
}

/**
 * Fill `items_next` and `items_fts_next`, then swap both in one transaction, so a
 * search on any connection sees the old index or the new one, never a partial one.
 * With `batch`, yields to the event loop between batches of inserts.
 */
export async function writeIndex(db: DatabaseSync, items: Item[], opts: { batch?: number } = {}): Promise<void> {
  ensureLibrarySchema(db);
  db.exec(`DROP TABLE IF EXISTS items_next; DROP TABLE IF EXISTS items_fts_next;
    CREATE TABLE items_next (${COLUMNS}); CREATE VIRTUAL TABLE items_fts_next ${FTS};`);
  const ins = db.prepare("INSERT OR REPLACE INTO items_next (id, source, kind, title, description, path, url, entry, size, duration, grp, alt, calibre_id, pref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const fts = db.prepare("INSERT INTO items_fts_next (title, description, item_id) VALUES (?, ?, ?)");
  const size = opts.batch ?? items.length;
  for (let start = 0; start < items.length; start += size) {
    db.exec("BEGIN");
    try {
      for (const i of items.slice(start, start + size)) {
        ins.run(i.id, i.source, i.kind, i.title, i.description, i.path, i.url, i.entry, i.size, i.duration, i.group, i.alt, i.calibreId, pref(i));
        fts.run(i.title, i.description, i.id);
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    if (opts.batch) await new Promise((r) => setImmediate(r));
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`DROP TABLE items; ALTER TABLE items_next RENAME TO items;
      DROP TABLE items_fts; ALTER TABLE items_fts_next RENAME TO items_fts;`);
    db.prepare("INSERT INTO library_meta (key, value) VALUES ('scannedAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(new Date().toISOString());
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function scannedAt(db: DatabaseSync): string | null {
  ensureLibrarySchema(db);
  return (db.prepare("SELECT value FROM library_meta WHERE key = 'scannedAt'").get() as { value: string } | undefined)?.value ?? null;
}

/** Each word becomes a quoted prefix term, so user input can never be FTS syntax. */
export function ftsQuery(q: string): string | null {
  const words = q.match(/[\p{L}\p{N}]+/gu);
  return words?.length ? words.map((w) => `"${w}"*`).join(" ") : null;
}

type Row = { id: string; source: Item["source"]; kind: Item["kind"]; title: string; description: string; path: string | null; url: string | null; entry: string | null; size: number | null; duration: number | null; grp: string | null; alt: string | null; calibre_id: number | null; copies: number };

const toItem = (r: Row): Item & { copies: number } => ({
  id: r.id, source: r.source, kind: r.kind, title: r.title, description: r.description, path: r.path, url: r.url, entry: r.entry,
  size: r.size, duration: r.duration, group: r.grp, alt: r.alt, calibreId: r.calibre_id, copies: r.copies,
});

/** One row per lesson group, preferring the lesson-folder copy; filters apply to that preferred copy. */
export function searchLibrary(db: DatabaseSync, o: { q?: string; source?: Item["source"]; kind?: Item["kind"]; limit: number; offset: number }): { items: (Item & { copies: number })[]; total: number } {
  const match = o.q?.trim() ? ftsQuery(o.q) : null;
  if (o.q?.trim() && !match) return { items: [], total: 0 };
  const hits = match
    ? `SELECT COALESCE(i.grp, i.id) AS g, MIN(m.score) AS score FROM (SELECT item_id, rank AS score FROM items_fts WHERE items_fts MATCH :match ORDER BY rank LIMIT -1) m JOIN items i ON i.id = m.item_id GROUP BY g`
    : `SELECT COALESCE(grp, id) AS g, 0 AS score FROM items GROUP BY g`;
  const where = [o.source ? "b.source = :source" : "", o.kind ? "b.kind = :kind" : ""].filter(Boolean).join(" AND ");
  const sql = `WITH hits AS (${hits}),
    ranked AS (
      SELECT i.*, h.score, COUNT(*) OVER (PARTITION BY COALESCE(i.grp, i.id)) AS copies,
        ROW_NUMBER() OVER (PARTITION BY COALESCE(i.grp, i.id) ORDER BY i.pref, i.title) AS rn
      FROM items i JOIN hits h ON h.g = COALESCE(i.grp, i.id)
    )
    SELECT b.*, COUNT(*) OVER () AS total FROM ranked b WHERE b.rn = 1 ${where ? `AND ${where}` : ""}
    ORDER BY ${match ? "b.score," : ""} b.title COLLATE NOCASE LIMIT :limit OFFSET :offset`;
  const params: Record<string, string | number> = { limit: o.limit, offset: o.offset };
  if (match) params.match = match;
  if (o.source) params.source = o.source;
  if (o.kind) params.kind = o.kind;
  const rows = db.prepare(sql).all(params) as (Row & { total: number })[];
  let total = rows[0]?.total ?? 0;
  if (!rows.length && o.offset > 0) {
    total = (db.prepare(sql.replace(/LIMIT :limit OFFSET :offset/, "LIMIT 1")).get({ ...params, limit: 1, offset: 0 }) as { total: number } | undefined)?.total ?? 0;
  }
  return { items: rows.map(toItem), total };
}

export function itemById(db: DatabaseSync, id: string): Item | undefined {
  ensureLibrarySchema(db);
  const r = db.prepare("SELECT *, 1 AS copies FROM items WHERE id = ?").get(id) as Row | undefined;
  return r ? toItem(r) : undefined;
}

/** ffprobe durations cached by path, size and mtime. */
export function probeCache(db: DatabaseSync) {
  ensureLibrarySchema(db);
  const get = db.prepare("SELECT duration FROM probe_cache WHERE path = ? AND size = ? AND mtime = ?");
  const put = db.prepare("INSERT INTO probe_cache (path, size, mtime, duration) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, duration = excluded.duration");
  return {
    get: (path: string, size: number, mtime: number) => (get.get(path, size, mtime) as { duration: number | null } | undefined),
    put: (path: string, size: number, mtime: number, duration: number | null) => void put.run(path, size, mtime, duration),
  };
}
