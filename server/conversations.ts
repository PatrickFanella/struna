import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/** The coaches on this computer's own logins: the only ones the personal mode has. */
export type HostProvider = "claude" | "codex";
/** A coach id: a host provider, or (generic mode) one the app signs in itself, such as "anthropic". */
export type Provider = string;
export type Conversation = { id: string; provider: Provider; title: string; thread_id: string | null; created: string; updated: string };
/** `meta.auto` names the automatic action that sent a user message (generic mode). */
export type MessageMeta = { auto?: string };
export type Message = { role: "user" | "assistant" | "error"; text: string; created: string; meta?: MessageMeta };

export function conversations(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, provider TEXT, title TEXT, thread_id TEXT, created TEXT, updated TEXT);
    CREATE TABLE IF NOT EXISTS messages (conversation TEXT, role TEXT, text TEXT, created TEXT);
    CREATE INDEX IF NOT EXISTS messages_by_conversation ON messages (conversation);
  `);
  // Databases from before automatic messages get the column on first use.
  const cols = (db.prepare("PRAGMA table_info(messages)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("meta")) db.exec("ALTER TABLE messages ADD COLUMN meta TEXT");
  const now = () => new Date().toISOString();
  /** How many times each coach's sessions were cleared since the server started (see `generation`). */
  const resets = new Map<Provider, number>();
  const titleOf = (message: string) => {
    const t = message.replace(/\s+/g, " ").trim();
    return t.length > 60 ? `${t.slice(0, 57).trimEnd()}…` : t || "New conversation";
  };
  return {
    create(provider: Provider, firstMessage: string): Conversation {
      const c: Conversation = { id: randomUUID(), provider, title: titleOf(firstMessage), thread_id: null, created: now(), updated: now() };
      db.prepare("INSERT INTO conversations (id, provider, title, thread_id, created, updated) VALUES (?, ?, ?, ?, ?, ?)").run(c.id, c.provider, c.title, c.thread_id, c.created, c.updated);
      return c;
    },
    list(): Conversation[] {
      return db.prepare("SELECT id, provider, title, thread_id, created, updated FROM conversations ORDER BY updated DESC").all() as Conversation[];
    },
    get(id: string): (Conversation & { messages: Message[] }) | undefined {
      const c = db.prepare("SELECT id, provider, title, thread_id, created, updated FROM conversations WHERE id = ?").get(id) as Conversation | undefined;
      if (!c) return undefined;
      const rows = db.prepare("SELECT role, text, created, meta FROM messages WHERE conversation = ? ORDER BY rowid").all(id) as (Omit<Message, "meta"> & { meta: string | null })[];
      // Messages without meta keep the shape they always had.
      const messages = rows.map(({ meta, ...m }): Message => {
        const parsed = meta ? parseMeta(meta) : undefined;
        return parsed ? { ...m, meta: parsed } : m;
      });
      return { ...c, messages };
    },
    append(id: string, role: Message["role"], text: string, meta?: MessageMeta): void {
      const t = now();
      db.prepare("INSERT INTO messages (conversation, role, text, created, meta) VALUES (?, ?, ?, ?, ?)").run(id, role, text, t, meta ? JSON.stringify(meta) : null);
      db.prepare("UPDATE conversations SET updated = ? WHERE id = ?").run(t, id);
    },
    setThread(id: string, threadId: string): void {
      db.prepare("UPDATE conversations SET thread_id = ? WHERE id = ?").run(threadId, id);
    },
    /** Forget every CLI session of one coach (its setup changed): those conversations start fresh. */
    resetThreads(provider: Provider): void {
      db.prepare("UPDATE conversations SET thread_id = NULL WHERE provider = ?").run(provider);
      resets.set(provider, (resets.get(provider) ?? 0) + 1);
    },
    /** Changes whenever `resetThreads` runs for this coach: a turn that started before must not save its session. */
    generation(provider: Provider): number {
      return resets.get(provider) ?? 0;
    },
    /** Whether the coach has answered in this conversation: a reply with no session left means it was reset. */
    hasReply(id: string): boolean {
      return db.prepare("SELECT 1 FROM messages WHERE conversation = ? AND role = 'assistant' LIMIT 1").get(id) !== undefined;
    },
    rename(id: string, title: string): boolean {
      return Number(db.prepare("UPDATE conversations SET title = ? WHERE id = ?").run(title.trim().slice(0, 200) || "Untitled", id).changes) > 0;
    },
    remove(id: string): boolean {
      db.prepare("DELETE FROM messages WHERE conversation = ?").run(id);
      return Number(db.prepare("DELETE FROM conversations WHERE id = ?").run(id).changes) > 0;
    },
  };
}
function parseMeta(raw: string): MessageMeta | undefined {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

export type Conversations = ReturnType<typeof conversations>;
