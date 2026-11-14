import { readFile } from "node:fs/promises";

/**
 * Calibre ids by path inside the Guitar folder (for example
 * "Books/Tony Rice Collection Tab Book (Marcel Ardans).pdf"), from the
 * 2026-11-14 copy receipt. No network call.
 */
export async function readCalibreReceipt(path: string | undefined): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!path) return out;
  try {
    const rows = JSON.parse(await readFile(path, "utf8")) as { calibre_id: number; dest: string }[];
    for (const r of rows) {
      const i = r.dest.indexOf("/Guitar/");
      if (i >= 0 && Number.isInteger(r.calibre_id)) out.set(r.dest.slice(i + "/Guitar/".length), r.calibre_id);
    }
  } catch {
    /* no receipt: books get no Calibre-Web link */
  }
  return out;
}
