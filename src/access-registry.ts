import { DurableObject } from "cloudflare:workers";
import type { ChatAccessRecord, RuntimeEnv, TelegramChat } from "./types";

type StoredChatRow = {
  chat_id: string;
  type: string;
  title: string | null;
  username: string | null;
  requested_at: string;
  approved_at: string | null;
  approved_by: number | null;
};

export class AccessRegistry extends DurableObject<RuntimeEnv> {
  async isApprovedChat(chatId: number): Promise<boolean> {
    this.ensureTables();
    const rows = this.ctx.storage.sql
      .exec<StoredChatRow>("SELECT chat_id FROM approved_chats WHERE chat_id = ?", String(chatId))
      .toArray();
    return rows.length > 0;
  }

  async requestChatAccess(chat: TelegramChat, requestedAt: string): Promise<ChatAccessRecord> {
    this.ensureTables();
    this.ctx.storage.sql.exec(
      `
        INSERT INTO pending_chats (chat_id, type, title, username, requested_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(chat_id) DO UPDATE SET
          type = excluded.type,
          title = excluded.title,
          username = excluded.username,
          requested_at = excluded.requested_at
      `,
      String(chat.id),
      chat.type,
      chat.title ?? null,
      chat.username ?? null,
      requestedAt
    );

    return {
      chatId: chat.id,
      type: chat.type,
      ...(chat.title ? { title: chat.title } : {}),
      ...(chat.username ? { username: chat.username } : {}),
      requestedAt
    };
  }

  async approveChat(chatId: number, approvedBy: number, approvedAt: string): Promise<ChatAccessRecord | null> {
    this.ensureTables();
    const pending = this.ctx.storage.sql
      .exec<StoredChatRow>("SELECT * FROM pending_chats WHERE chat_id = ?", String(chatId))
      .toArray()[0];

    const record: ChatAccessRecord =
      pending ?
        rowToRecord({ ...pending, approved_at: approvedAt, approved_by: approvedBy })
      : {
          chatId,
          type: "unknown",
          requestedAt: approvedAt,
          approvedAt,
          approvedBy
        };

    this.ctx.storage.sql.exec(
      `
        INSERT INTO approved_chats (chat_id, type, title, username, requested_at, approved_at, approved_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(chat_id) DO UPDATE SET
          type = excluded.type,
          title = excluded.title,
          username = excluded.username,
          requested_at = excluded.requested_at,
          approved_at = excluded.approved_at,
          approved_by = excluded.approved_by
      `,
      String(record.chatId),
      record.type,
      record.title ?? null,
      record.username ?? null,
      record.requestedAt,
      approvedAt,
      approvedBy
    );
    this.ctx.storage.sql.exec("DELETE FROM pending_chats WHERE chat_id = ?", String(chatId));

    return { ...record, approvedAt, approvedBy };
  }

  async denyChat(chatId: number): Promise<boolean> {
    this.ensureTables();
    const existing = this.ctx.storage.sql
      .exec<StoredChatRow>("SELECT chat_id FROM pending_chats WHERE chat_id = ?", String(chatId))
      .toArray();
    this.ctx.storage.sql.exec("DELETE FROM pending_chats WHERE chat_id = ?", String(chatId));
    return existing.length > 0;
  }

  async listPendingChats(): Promise<ChatAccessRecord[]> {
    this.ensureTables();
    return this.ctx.storage.sql
      .exec<StoredChatRow>("SELECT * FROM pending_chats ORDER BY requested_at DESC LIMIT 20")
      .toArray()
      .map(rowToRecord);
  }

  private ensureTables(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS pending_chats (
        chat_id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT,
        username TEXT,
        requested_at TEXT NOT NULL
      )
    `);

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS approved_chats (
        chat_id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT,
        username TEXT,
        requested_at TEXT NOT NULL,
        approved_at TEXT NOT NULL,
        approved_by INTEGER NOT NULL
      )
    `);
  }
}

function rowToRecord(row: StoredChatRow): ChatAccessRecord {
  return {
    chatId: Number(row.chat_id),
    type: row.type,
    ...(row.title ? { title: row.title } : {}),
    ...(row.username ? { username: row.username } : {}),
    requestedAt: row.requested_at,
    ...(row.approved_at ? { approvedAt: row.approved_at } : {}),
    ...(row.approved_by !== null ? { approvedBy: row.approved_by } : {})
  };
}
