import { describe, expect, it } from "vitest";
import { chatAgentName, isAllowedChat, parseCommand, sendTelegramMessage } from "../src/telegram";
import type { RuntimeEnv } from "../src/types";

describe("telegram helpers", () => {
  it("parses bot commands with username targeting", () => {
    expect(parseCommand("/diagnose@CfHelperBot please", "CfHelperBot")).toEqual({
      command: "diagnose",
      raw: "diagnose"
    });
    expect(parseCommand("/cfhelp", "CfHelperBot")).toEqual({ command: "help", raw: "cfhelp" });
    expect(parseCommand("/start", "CfHelperBot")).toEqual({ command: "help", raw: "start" });
    expect(parseCommand("/diagnose@OtherBot", "CfHelperBot")).toBeNull();
  });

  it("ignores targeted commands when bot username is not configured", () => {
    expect(parseCommand("/diagnose@OtherBot")).toBeNull();
    expect(parseCommand("/diagnose")).toEqual({ command: "diagnose", raw: "diagnose" });
  });

  it("allows only configured chats unless explicitly open", () => {
    const env = { ALLOWED_CHAT_IDS: "123,-456" } as RuntimeEnv;
    expect(isAllowedChat(env, 123)).toBe(true);
    expect(isAllowedChat(env, -456)).toBe(true);
    expect(isAllowedChat(env, 789)).toBe(false);
    expect(isAllowedChat({ ALLOW_ALL_CHATS: "true" } as unknown as RuntimeEnv, 789)).toBe(true);
  });

  it("creates stable agent names from chat ids", () => {
    expect(chatAgentName(-100123)).toBe("telegram-chat--100123");
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
