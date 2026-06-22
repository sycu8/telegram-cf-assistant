import { describe, expect, it } from "vitest";
import { createInitialState, formatDiagnoseResponse, reduceIssueState } from "../src/issue";
import { getKnowledgeSources, redactSensitiveText } from "../src/knowledge";
import { getMessageText, toIngestedMessage } from "../src/telegram";
import { productionLikeTelegramUpdates } from "./fixtures/telegram-updates";
import type { IngestedMessage } from "../src/types";

describe("issue understanding", () => {
  it("detects Cloudflare products and likely D1 binding issues", () => {
    const message: IngestedMessage = {
      chatId: 1,
      messageId: 10,
      text: "Our Worker deploys but env.DB is undefined for D1. Maybe the binding is wrong?",
      userDisplayName: "@dev",
      at: "2026-06-22T23:00:00.000Z",
      isCommand: false
    };

    const state = reduceIssueState(createInitialState(), message, 30);

    expect(state.products).toContain("Workers");
    expect(state.products).toContain("D1");
    expect(state.suspectedCauses[0]?.cause).toContain("D1 binding name mismatch");
    expect(state.recommendedNextSteps.join(" ")).toContain("D1 binding name");
  });

  it("formats a useful fallback diagnosis", () => {
    const state = reduceIssueState(
      createInitialState(),
      {
        chatId: 1,
        messageId: 11,
        text: "Cloudflare SSL shows too many redirects after changing origin HTTPS redirect",
        userDisplayName: "@ops",
        at: "2026-06-22T23:01:00.000Z",
        isCommand: false
      },
      30
    );

    const response = formatDiagnoseResponse(state, getKnowledgeSources(state.products));

    expect(response).toContain("Likely issue:");
    expect(response).toContain("SSL/TLS");
    expect(response).toContain("Cloudflare");
  });

  it("builds understanding from sanitized production-like D1 discussion", () => {
    const state = productionLikeTelegramUpdates.d1BindingDiscussion.slice(0, 2).reduce((currentState, update) => {
      const message = update.message;
      if (!message) return currentState;
      const text = getMessageText(message);
      if (!text) return currentState;
      return reduceIssueState(currentState, toIngestedMessage(message, text, false), 30);
    }, createInitialState());

    expect(state.products).toEqual(expect.arrayContaining(["Workers", "Wrangler", "D1"]));
    expect(state.suspectedCauses[0]?.cause).toContain("D1 binding name mismatch");
    expect(state.recentMessages.some((message) => message.text.includes("sk-test-sanitized"))).toBe(false);
    expect(state.recentMessages.some((message) => message.text.includes("[REDACTED]"))).toBe(true);
  });

  it("caps recent message state for high-volume chats", () => {
    const state = Array.from({ length: 50 }, (_, index) => index).reduce((currentState, index) => {
      return reduceIssueState(
        currentState,
        {
          chatId: 1,
          messageId: index,
          text: `Worker error message ${index}`,
          userDisplayName: "@load",
          at: "2026-06-22T23:01:00.000Z",
          isCommand: false
        },
        12
      );
    }, createInitialState());

    expect(state.messageCount).toBe(50);
    expect(state.recentMessages).toHaveLength(12);
    expect(state.recentMessages[0]?.messageId).toBe(38);
  });

  it("redacts common sensitive values before storage or prompts", () => {
    const text =
      "Authorization: Bearer abc.def.ghi api_key=secret-value secret: another-value -----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----";

    const redacted = redactSensitiveText(text);

    expect(redacted).not.toContain("abc.def.ghi");
    expect(redacted).not.toContain("secret-value");
    expect(redacted).not.toContain("another-value");
    expect(redacted).not.toContain("BEGIN PRIVATE KEY");
    expect(redacted).toContain("[REDACTED]");
    expect(redacted).toContain("[REDACTED_PRIVATE_KEY]");
  });
});
