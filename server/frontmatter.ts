export type FrontMatter = Record<string, string | string[]>;

/** Split a note into its YAML front matter (flat keys and simple lists only) and body. */
export function parseFrontMatter(text: string): { data: FrontMatter; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data: FrontMatter = {};
  let key: string | undefined;
  for (const line of m[1]!.split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && key) {
      const prev = data[key];
      data[key] = [...(Array.isArray(prev) ? prev : []), unquote(item[1]!)];
      continue;
    }
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1]!;
      data[key] = unquote(kv[2]!);
      continue;
    }
    // A folded continuation line of the previous scalar.
    const prev = key ? data[key] : undefined;
    if (key && /^\s+\S/.test(line) && typeof prev === "string") data[key] = unquote(`${prev} ${line.trim()}`);
  }
  return { data, body: text.slice(m[0].length) };
}

function unquote(v: string): string {
  const s = v.trim();
  if (s.length > 1 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  if (s.length > 1 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

export function str(data: FrontMatter, key: string): string {
  const v = data[key];
  return typeof v === "string" ? v : "";
}
