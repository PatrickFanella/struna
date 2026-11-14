import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import { parseFrontMatter, str } from "./frontmatter.ts";

export const THREAD_REL = "001 Projects/Threads/Guitar";

export type Week = { n: number; title: string; vocabulary: string; mechanism: string; music: string; improvisation: string };
export type Material = { label: string; path: string; kind: "pdf" | "tg" | "other"; exists: boolean };
export type Block = {
  id: string;
  title: string;
  path: string;
  started: string;
  targetSessions: number;
  goal: string;
  weeks: Week[];
  materials: Material[];
  crossTraining: string[];
};
export type Ledger = { nextEvidence: string; lastReview: string | null };

export class VaultError extends Error {}

async function readNote(vaultRoot: string, rel: string): Promise<string> {
  try {
    return await readFile(join(vaultRoot, rel), "utf8");
  } catch {
    throw new VaultError(`Note not found: ${rel}`);
  }
}

/** The `## Heading` sections of a note body, keyed by heading text. */
export function sections(body: string): { heading: string; text: string }[] {
  const out: { heading: string; text: string }[] = [];
  let cur: { heading: string; lines: string[] } | undefined;
  for (const line of body.split(/\r?\n/)) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      if (cur) out.push({ heading: cur.heading, text: cur.lines.join("\n") });
      cur = { heading: h[1]!.trim(), lines: [] };
    } else cur?.lines.push(line);
  }
  if (cur) out.push({ heading: cur.heading, text: cur.lines.join("\n") });
  return out;
}

/** Paragraphs, with wrapped lines joined by a space. */
function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.split("\n").map((l) => l.trim()).join(" ").trim())
    .filter(Boolean);
}

function field(paras: string[], label: string): string {
  const prefix = `**${label}:**`;
  const p = paras.find((x) => x.startsWith(prefix));
  return p ? p.slice(prefix.length).trim() : "";
}

function bullets(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (/^\s*[-*]\s+/.test(line)) out.push(line.replace(/^\s*[-*]\s+/, "").trim());
    else if (/^\s+\S/.test(line) && out.length) out[out.length - 1] += ` ${line.trim()}`;
  }
  return out;
}

async function exists(path: string): Promise<boolean> {
  return Boolean((await stat(path).catch(() => undefined))?.isFile());
}

async function walk(dir: string, out: string[] = [], depth = 0): Promise<string[]> {
  if (depth > 8) return out;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out, depth + 1);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function kindOf(path: string): Material["kind"] {
  const ext = extname(path).toLowerCase();
  return ext === ".pdf" ? "pdf" : ext === ".tg" ? "tg" : "other";
}

/**
 * Resolve a wikilink target to a vault-relative path: as written, then as a note
 * (adding `.md`), then by file name anywhere under the thread folder.
 */
export async function resolveWikilink(vaultRoot: string, threadRel: string, target: string, files?: string[]): Promise<{ path: string; exists: boolean }> {
  const clean = target.split("#")[0]!.trim();
  for (const rel of [clean, `${clean}.md`]) if (await exists(join(vaultRoot, rel))) return { path: rel, exists: true };
  const names = new Set([basename(clean), `${basename(clean)}.md`]);
  const all = files ?? (await walk(join(vaultRoot, threadRel)));
  const hit = all.find((f) => names.has(basename(f)));
  if (hit) return { path: hit.slice(vaultRoot.length + 1), exists: true };
  return { path: clean, exists: false };
}

export function wikilinks(text: string): { target: string; label: string }[] {
  return [...text.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)].map((m) => ({
    target: m[1]!.trim(),
    label: (m[2] ?? basename(m[1]!).replace(/\.[^.]+$/, "")).trim(),
  }));
}

export async function readActiveBlock(vaultRoot: string, threadRel = THREAD_REL): Promise<Block> {
  const pointer = parseFrontMatter(await readNote(vaultRoot, `${threadRel}/Practice/Current Practice Block.md`));
  const blockRel = str(pointer.data, "active-block");
  if (!blockRel) throw new VaultError("Current Practice Block.md has no active-block");
  const text = await readNote(vaultRoot, blockRel);
  const { data, body } = parseFrontMatter(text);
  const secs = sections(body);

  const weeks: Week[] = [];
  for (const s of secs) {
    const m = /^Week\s+(\d+)\s*[—–-]\s*(.*)$/.exec(s.heading);
    if (!m) continue;
    const paras = paragraphs(s.text);
    weeks.push({
      n: Number(m[1]),
      title: m[2]!.trim(),
      vocabulary: field(paras, "Vocabulary"),
      mechanism: field(paras, "Mechanism"),
      music: field(paras, "Music"),
      improvisation: field(paras, "Improvisation constraint"),
    });
  }

  const anchor = secs.find((s) => /^Anchor material/i.test(s.heading))?.text ?? "";
  const files = await walk(join(vaultRoot, threadRel));
  const materials: Material[] = [];
  for (const link of wikilinks(anchor)) {
    const r = await resolveWikilink(vaultRoot, threadRel, link.target, files);
    materials.push({ label: link.label, path: r.path, kind: kindOf(r.path), exists: r.exists });
  }

  const cross = secs.find((s) => /^Optional cross-training/i.test(s.heading))?.text ?? "";
  const goal = /^>\s*\[!goal\]\s*(.*(?:\n>.*)*)/m.exec(body)?.[1]?.replace(/\n>\s*/g, " ").trim() ?? "";
  const title = /^#\s+(.*)$/m.exec(body)?.[1]?.trim() ?? str(data, "title");

  return {
    id: str(data, "block-id"),
    title,
    path: blockRel,
    started: str(data, "started"),
    targetSessions: Number(str(data, "target-session-count")) || 0,
    goal,
    weeks,
    materials,
    crossTraining: bullets(cross),
  };
}

export async function readLedger(vaultRoot: string, threadRel = THREAD_REL): Promise<Ledger> {
  const { body } = parseFrontMatter(await readNote(vaultRoot, `${threadRel}/Practice/Practice Progress Ledger.md`));
  const current = sections(body).find((s) => /^Current state/i.test(s.heading))?.text ?? "";
  const line = (label: string) => new RegExp(`^\\s*-\\s*\\*\\*${label}:\\*\\*\\s*(.*)$`, "mi").exec(current)?.[1]?.trim() ?? "";
  return {
    nextEvidence: line("Next evidence needed"),
    lastReview: /\d{4}-\d{2}-\d{2}/.exec(line("Last review"))?.[0] ?? null,
  };
}
