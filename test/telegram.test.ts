import { describe, expect, it } from "vitest";
import { chatAgentName, isAllowedChat, parseCommand } from "../src/telegram";
import type { RuntimeEnv } from "../src/types";

describe("telegram helpers", () => {
  it("parses bot commands with username targeting", () => {
    expect(parseCommand("/diagnose@CfHelperBot please", "CfHelperBot")).toEqual({
      command: "diagnose",
      raw: "diagnose"
    });
    expect(parseCommand("/cfhelp", "CfHelperBot")).toEqual({ command: "help", raw: "cfhelp" });
    expect(parseCommand("/diagnose@OtherBot", "CfHelperBot")).toBeNull();
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
});
