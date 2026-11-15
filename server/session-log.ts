import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { HttpError } from "./http.ts";

export function submissionId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) throw new HttpError(400, "invalid session submission id");
  return value;
}
const pending = new Map<string, Promise<unknown>>();
/** One server owns a workspace. Serialize writes, publish complete bytes, recover retries from the log itself. */
export async function publishLog(dir: string, text: string, name: (n: number) => string, id?: string): Promise<{ file: string; replayed?: boolean }> {
  const previous = pending.get(dir) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    await mkdir(dir, { recursive: true });
    const marker = id ? `submission_id: ${submissionId(id)}\n` : "";
    if (id) {
      for (const file of await readdir(dir)) {
        if (!file.endsWith(".md")) continue;
        const bytes = await readFile(join(dir, file), "utf8");
        if (bytes.startsWith(`---\n${marker}`)) return { file, replayed: true };
      }
    }
    const temporary = join(dir, `.session-${randomUUID()}.tmp`);
    const fh = await open(temporary, "wx", 0o664);
    try { await fh.writeFile(id ? text.replace(/^---\n/, `---\n${marker}`) : text); await fh.sync(); }
    finally { await fh.close(); }
    try {
      for (let n = 1; n < 1000; n++) {
        const file = name(n);
        try { await link(temporary, join(dir, file)); return { file }; }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
      }
      throw new HttpError(409, "too many logs for one day");
    } finally { await unlink(temporary); }
  });
  pending.set(dir, task);
  try { return await task; } finally { if (pending.get(dir) === task) pending.delete(dir); }
}
