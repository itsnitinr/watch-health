import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DB_PATH } from "@/lib/db";

// Saved Ask threads live in their own file beside the health database (health.db → health-chats.db),
// so the assistant's read-only SQL tool never sees past conversations, and the demo data set keeps its own.
const CHATS_DB_PATH =
  process.env.CHATS_DB_PATH ?? path.join(path.dirname(DB_PATH), `${path.basename(DB_PATH, ".db")}-chats.db`);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS threads (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  created_ms  INTEGER NOT NULL,
  updated_ms  INTEGER NOT NULL,
  messages    TEXT NOT NULL      -- JSON array of SavedMessage
);
CREATE INDEX IF NOT EXISTS threads_updated ON threads (updated_ms);
`;

export const savedMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  tools: z.array(z.object({ name: z.string(), input: z.unknown() })).optional(),
  error: z.string().optional(),
  via: z.string().optional(),
  ms: z.number().optional(),
});
export type SavedMessage = z.infer<typeof savedMessageSchema>;

export const threadIdSchema = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);

export type ThreadSummary = { id: string; title: string; updated_ms: number; count: number };
export type Thread = ThreadSummary & { created_ms: number; messages: SavedMessage[] };

let db: DatabaseSync | undefined;

function getChatsDb(): DatabaseSync {
  if (!db) {
    fs.mkdirSync(path.dirname(CHATS_DB_PATH), { recursive: true });
    db = new DatabaseSync(CHATS_DB_PATH);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    db.exec(SCHEMA);
  }
  return db;
}

/** A thread's title is its first question, trimmed to one line. */
function titleFor(messages: SavedMessage[]) {
  const first = messages.find((m) => m.role === "user")?.content.replace(/\s+/g, " ").trim() ?? "";
  return first.length > 80 ? first.slice(0, 79).trimEnd() + "…" : first || "Untitled chat";
}

export function listThreads(limit = 50): ThreadSummary[] {
  return getChatsDb()
    .prepare(`SELECT id, title, updated_ms, json_array_length(messages) AS count FROM threads ORDER BY updated_ms DESC LIMIT ?`)
    .all(limit) as ThreadSummary[];
}

export function getThread(id: string): Thread | undefined {
  const row = getChatsDb()
    .prepare(`SELECT id, title, created_ms, updated_ms, messages FROM threads WHERE id = ?`)
    .get(id) as (Omit<Thread, "messages" | "count"> & { messages: string }) | undefined;
  if (!row) return undefined;
  const messages = JSON.parse(row.messages) as SavedMessage[];
  return { ...row, messages, count: messages.length };
}

export function saveThread(id: string, messages: SavedMessage[]) {
  const now = Date.now();
  getChatsDb()
    .prepare(
      `INSERT INTO threads (id, title, created_ms, updated_ms, messages) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET title = excluded.title, updated_ms = excluded.updated_ms, messages = excluded.messages`,
    )
    .run(id, titleFor(messages), now, now, JSON.stringify(messages));
}

export function deleteThread(id: string) {
  getChatsDb().prepare(`DELETE FROM threads WHERE id = ?`).run(id);
}
