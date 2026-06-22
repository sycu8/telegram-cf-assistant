import { describe, expect, it } from "vitest";
import { verifyTelegramSecret } from "../src/telegram";
import { parseTelegramUpdate } from "../src/webhook";
import { productionLikeTelegramUpdates } from "./fixtures/telegram-updates";
import type { RuntimeEnv } from "../src/types";

const env = {
  TELEGRAM_WEBHOOK_SECRET: "sanitized-secret",
  ALLOWED_CHAT_IDS: "-1001234567890",
  ALLOW_ALL_CHATS: "false"
} as unknown as RuntimeEnv;

describe("webhook route behavior", () => {
  it("rejects Telegram webhook requests without the secret header", async () => {
    await expect(
      verifyTelegramSecret(
        new Request("https://example.test/telegram/webhook", {
          method: "POST",
          body: JSON.stringify(productionLikeTelegramUpdates.unknownMessageShape)
        }),
        env
      )
    ).resolves.toBe(false);
  });

  it("accepts Telegram webhook requests with the configured secret header", async () => {
    await expect(
      verifyTelegramSecret(
        new Request("https://example.test/telegram/webhook", {
          method: "POST",
          headers: { "X-Telegram-Bot-Api-Secret-Token": "sanitized-secret" },
          body: JSON.stringify(productionLikeTelegramUpdates.unknownMessageShape)
        }),
        env
      )
    ).resolves.toBe(true);
  });

  it("rejects malformed Telegram JSON as an invalid update payload", async () => {
    const update = await parseTelegramUpdate(
      new Request("https://example.test/telegram/webhook", {
        method: "POST",
        headers: { "X-Telegram-Bot-Api-Secret-Token": "sanitized-secret" },
        body: "{not-json"
      })
    );

    expect(update).toBeNull();
  });

  it("parses production-like Telegram updates with unknown message shape", async () => {
    const update = await parseTelegramUpdate(
      new Request("https://example.test/telegram/webhook", {
        method: "POST",
        headers: { "X-Telegram-Bot-Api-Secret-Token": "sanitized-secret" },
        body: JSON.stringify(productionLikeTelegramUpdates.unknownMessageShape)
      })
    );

    expect(update).toEqual(productionLikeTelegramUpdates.unknownMessageShape);
  });

  it("rejects JSON objects without an update id", async () => {
    const update = await parseTelegramUpdate(
      new Request("https://example.test/telegram/webhook", {
        method: "POST",
        headers: { "X-Telegram-Bot-Api-Secret-Token": "sanitized-secret" },
        body: JSON.stringify({ message: {} })
      })
    );

    expect(update).toBeNull();
  });
});
