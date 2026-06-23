import { describe, expect, it } from "vitest";
import {
  chatAgentName,
  formatAccessRequestForAdmin,
  formatChatNotAllowedResponse,
  formatPendingChats,
  getTelegramChatMemberUpdate,
  getTelegramMessage,
  isAdminChat,
  isAllowedChat,
  isBotAddedToChat,
  parseChatIdArgument,
  parseCommand,
  sendTelegramMessage
} from "../src/telegram";
import type { RuntimeEnv } from "../src/types";

describe("telegram helpers", () => {
  it("parses bot commands with username targeting", () => {
    expect(parseCommand("/diagnose@CfHelperBot please", "CfHelperBot")).toEqual({
      command: "diagnose",
      raw: "diagnose",
      args: "please"
    });
    expect(parseCommand("/cfhelp", "CfHelperBot")).toEqual({ command: "help", raw: "cfhelp", args: "" });
    expect(parseCommand("/start", "CfHelperBot")).toEqual({ command: "help", raw: "start", args: "" });
    expect(parseCommand("/diagnose@OtherBot", "CfHelperBot")).toBeNull();
  });

  it("ignores targeted commands when bot username is not configured", () => {
    expect(parseCommand("/diagnose@OtherBot")).toBeNull();
    expect(parseCommand("/diagnose")).toEqual({ command: "diagnose", raw: "diagnose", args: "" });
  });

  it("parses approval commands and chat id arguments", () => {
    expect(parseCommand("/approve -100123", "CfHelperBot")).toEqual({
      command: "approve",
      raw: "approve",
      args: "-100123"
    });
    expect(parseChatIdArgument("-100123 please")).toBe(-100123);
    expect(parseChatIdArgument("not-a-chat")).toBeNull();
  });

  it("allows only configured chats unless explicitly open", () => {
    const env = { ALLOWED_CHAT_IDS: "123,-456" } as RuntimeEnv;
    expect(isAllowedChat(env, 123)).toBe(true);
    expect(isAllowedChat(env, -456)).toBe(true);
    expect(isAllowedChat(env, 789)).toBe(false);
    expect(isAllowedChat({ ALLOW_ALL_CHATS: "true" } as unknown as RuntimeEnv, 789)).toBe(true);
  });

  it("uses explicit admin ids or falls back to allowed chat ids for admins", () => {
    expect(isAdminChat({ ADMIN_CHAT_IDS: "1,2", ALLOWED_CHAT_IDS: "3" } as unknown as RuntimeEnv, 2)).toBe(true);
    expect(isAdminChat({ ADMIN_CHAT_IDS: "1,2", ALLOWED_CHAT_IDS: "3" } as unknown as RuntimeEnv, 3)).toBe(false);
    expect(isAdminChat({ ALLOWED_CHAT_IDS: "3" } as unknown as RuntimeEnv, 3)).toBe(true);
  });

  it("creates stable agent names from chat ids", () => {
    expect(chatAgentName(-100123)).toBe("telegram-chat--100123");
  });

  it("formats safe allowlist discovery guidance", () => {
    const response = formatChatNotAllowedResponse(-1001234567890);

    expect(response).toContain("not approved");
    expect(response).toContain("Chat ID: -1001234567890");
    expect(response).toContain("access request");
  });

  it("formats admin access request and pending chat messages", () => {
    const record = {
      chatId: -100123,
      type: "supergroup",
      title: "Sanitized Group",
      requestedAt: "2026-06-23T00:00:00.000Z"
    };

    expect(formatAccessRequestForAdmin(record)).toContain("/approve -100123");
    expect(formatPendingChats([record])).toContain("Sanitized Group");
    expect(formatPendingChats([])).toContain("No pending");
  });

  it("recognizes channel posts and bot-added updates", () => {
    const channelPost = {
      update_id: 1,
      channel_post: {
        message_id: 10,
        text: "/start",
        chat: { id: -1001, type: "channel", title: "Channel" }
      }
    };
    const memberUpdate = {
      update_id: 2,
      my_chat_member: {
        chat: { id: -1002, type: "supergroup", title: "Group" },
        new_chat_member: { status: "administrator" }
      }
    };

    expect(getTelegramMessage(channelPost)?.chat.id).toBe(-1001);
    expect(isBotAddedToChat(getTelegramChatMemberUpdate(memberUpdate)!)).toBe(true);
  });

  it("splits long Telegram replies into sendable chunks", async () => {
    const calls: unknown[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    try {
      await sendTelegramMessage({ TELEGRAM_BOT_TOKEN: "sanitized-token" } as unknown as RuntimeEnv, 123, "x".repeat(8001), 77);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(calls).toHaveLength(3);
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ chat_id: 123, reply_parameters: { message_id: 77 } })
      ])
    );
  });
});
