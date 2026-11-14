import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type Provider = "claude" | "codex";
export type Conversation = { id: string; provider: Provider; title: string; thread_id: string | null; created: string; updated: string };
export type Message = { role: "user" | "assistant" | "error"; text: string; created: string };

export function conversations(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, provider TEXT, title TEXT, thread_id TEXT, created TEXT, updated TEXT);
    CREATE TABLE IF NOT EXISTS messages (conversation TEXT, role TEXT, text TEXT, created TEXT);
    CREATE INDEX IF NOT EXISTS messages_by_conversation ON messages (conversation);
  `);
  const now = () => new Date().toISOString();
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
      const messages = db.prepare("SELECT role, text, created FROM messages WHERE conversation = ? ORDER BY rowid").all(id) as Message[];
      return { ...c, messages };
    },
    append(id: string, role: Message["role"], text: string): void {
      const t = now();
      db.prepare("INSERT INTO messages (conversation, role, text, created) VALUES (?, ?, ?, ?)").run(id, role, text, t);
      db.prepare("UPDATE conversations SET updated = ? WHERE id = ?").run(t, id);
    },
    setThread(id: string, threadId: string): void {
      db.prepare("UPDATE conversations SET thread_id = ? WHERE id = ?").run(threadId, id);
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
export type Conversations = ReturnType<typeof conversations>;
