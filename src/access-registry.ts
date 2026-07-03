import { DurableObject } from "cloudflare:workers";
import type { BotStatus, ChatAccessRecord, ChatSettings, RuntimeEnv, TelegramChat } from "./types";

type StoredChatRow = {
  chat_id: string;
  type: string;
  title: string | null;
  username: string | null;
  requested_at: string;
  approved_at: string | null;
  approved_by: number | null;
};

type StoredSettingsRow = {
  chat_id: string;
  auto_suggestions_enabled: number;
  auto_suggestion_cooldown_seconds: number;
  auto_suggestion_min_confidence: number;
  language: string;
  updated_at: string;
};

type StoredEventRow = {
  event_type: string;
  count: number;
};

const DEFAULT_SETTINGS = {
  autoSuggestionsEnabled: true,
  autoSuggestionCooldownSeconds: 900,
  autoSuggestionMinConfidence: 0.65,
  language: "auto" as const
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

  async revokeChat(chatId: number): Promise<boolean> {
    this.ensureTables();
    const existing = this.ctx.storage.sql
      .exec<StoredChatRow>("SELECT chat_id FROM approved_chats WHERE chat_id = ?", String(chatId))
      .toArray();
    this.ctx.storage.sql.exec("DELETE FROM approved_chats WHERE chat_id = ?", String(chatId));
    this.ctx.storage.sql.exec("DELETE FROM chat_settings WHERE chat_id = ?", String(chatId));
    return existing.length > 0;
  }

  async listPendingChats(): Promise<ChatAccessRecord[]> {
    this.ensureTables();
    return this.ctx.storage.sql
      .exec<StoredChatRow>("SELECT * FROM pending_chats ORDER BY requested_at DESC LIMIT 20")
      .toArray()
      .map(rowToRecord);
  }

  async listApprovedChats(): Promise<ChatAccessRecord[]> {
    this.ensureTables();
    return this.ctx.storage.sql
      .exec<StoredChatRow>("SELECT * FROM approved_chats ORDER BY approved_at DESC LIMIT 50")
      .toArray()
      .map(rowToRecord);
  }

  async getChatSettings(chatId: number): Promise<ChatSettings> {
    this.ensureTables();
    const row = this.ctx.storage.sql
      .exec<StoredSettingsRow>("SELECT * FROM chat_settings WHERE chat_id = ?", String(chatId))
      .toArray()[0];
    return row ? settingsRowToRecord(row) : defaultSettings(chatId);
  }

  async updateChatSettings(
    chatId: number,
    patch: Partial<Omit<ChatSettings, "chatId" | "updatedAt">>,
    updatedAt: string
  ): Promise<ChatSettings> {
    this.ensureTables();
    const current = await this.getChatSettings(chatId);
    const next: ChatSettings = {
      ...current,
      ...patch,
      updatedAt
    };

    this.ctx.storage.sql.exec(
      `
        INSERT INTO chat_settings (
          chat_id,
          auto_suggestions_enabled,
          auto_suggestion_cooldown_seconds,
          auto_suggestion_min_confidence,
          language,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(chat_id) DO UPDATE SET
          auto_suggestions_enabled = excluded.auto_suggestions_enabled,
          auto_suggestion_cooldown_seconds = excluded.auto_suggestion_cooldown_seconds,
          auto_suggestion_min_confidence = excluded.auto_suggestion_min_confidence,
          language = excluded.language,
          updated_at = excluded.updated_at
      `,
      String(chatId),
      next.autoSuggestionsEnabled ? 1 : 0,
      next.autoSuggestionCooldownSeconds,
      next.autoSuggestionMinConfidence,
      next.language,
      next.updatedAt
    );

    return next;
  }

  async recordEvent(eventType: string): Promise<void> {
    this.ensureTables();
    this.ctx.storage.sql.exec(
      "INSERT INTO event_log (event_type, count) VALUES (?, 1) ON CONFLICT(event_type) DO UPDATE SET count = count + 1",
      eventType
    );
  }

  async getStatus(generatedAt: string): Promise<BotStatus> {
    this.ensureTables();
    const pendingRows = this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) as count FROM pending_chats").toArray();
    const approvedRows = this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) as count FROM approved_chats").toArray();
    const events = this.ctx.storage.sql.exec<StoredEventRow>("SELECT event_type, count FROM event_log").toArray();

    return {
      pendingChats: pendingRows[0]?.count ?? 0,
      approvedChats: approvedRows[0]?.count ?? 0,
      events: Object.fromEntries(events.map((event) => [event.event_type, event.count])),
      generatedAt
    };
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

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS chat_settings (
        chat_id TEXT PRIMARY KEY,
        auto_suggestions_enabled INTEGER NOT NULL,
        auto_suggestion_cooldown_seconds INTEGER NOT NULL,
        auto_suggestion_min_confidence REAL NOT NULL,
        language TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS event_log (
        event_type TEXT PRIMARY KEY,
        count INTEGER NOT NULL
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

function defaultSettings(chatId: number): ChatSettings {
  return {
    chatId,
    ...DEFAULT_SETTINGS,
    updatedAt: new Date(0).toISOString()
  };
}

function settingsRowToRecord(row: StoredSettingsRow): ChatSettings {
  return {
    chatId: Number(row.chat_id),
    autoSuggestionsEnabled: row.auto_suggestions_enabled === 1,
    autoSuggestionCooldownSeconds: row.auto_suggestion_cooldown_seconds,
    autoSuggestionMinConfidence: row.auto_suggestion_min_confidence,
    language: row.language === "en" || row.language === "vi" ? row.language : "auto",
    updatedAt: row.updated_at
  };
}
