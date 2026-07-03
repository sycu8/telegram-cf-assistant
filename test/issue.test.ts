import { describe, expect, it } from "vitest";
import {
  createInitialState,
  formatAutoSuggestionResponse,
  formatAssistantNotes,
  formatDiagnoseResponse,
  markAutoSuggestionSent,
  messageLooksLikeCustomerQuestion,
  reduceIssueState,
  shouldSuggestAutomatically
} from "../src/issue";
import { formatKnowledgeContext, getKnowledgeSources, redactSensitiveText } from "../src/knowledge";
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
    expect(state.conversationNotes.join(" ")).toContain("Customer appears to ask for help");
    expect(state.openQuestions[0]).toContain("Maybe the binding is wrong");
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
    expect(response).toContain("Reply mode:");
    expect(response).toContain("SSL/TLS");
    expect(response).toContain("Cloudflare");
  });

  it("adds curated knowledge summaries and checklist context", () => {
    const sources = getKnowledgeSources(["Workers", "D1"]);
    const context = formatKnowledgeContext(sources);

    expect(context).toContain("Cloudflare Workers docs");
    expect(context).toContain("Checklist:");
    expect(context).toContain("Verify binding name");
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

  it("suggests automatically for Cloudflare issue signals", () => {
    const message: IngestedMessage = {
      chatId: 1,
      messageId: 99,
      text: "Our Worker deploys but env.DB is undefined for D1. How do we fix it?",
      userDisplayName: "@dev",
      at: "2026-06-23T04:10:00.000Z",
      isCommand: false
    };
    const state = reduceIssueState(createInitialState(), message, 30);
    const decision = shouldSuggestAutomatically(state, message, {
      now: new Date(message.at),
      cooldownSeconds: 900,
      minConfidence: 0.65
    });

    expect(decision.shouldSuggest).toBe(true);
    expect(decision.reason).toBe("issue-detected");
    expect(formatAutoSuggestionResponse(state, getKnowledgeSources(state.products))).toContain("Auto-detected");
  });

  it("does not auto-suggest for non-issue chatter or command messages", () => {
    const message: IngestedMessage = {
      chatId: 1,
      messageId: 100,
      text: "Cloudflare Workers are useful for edge apps",
      userDisplayName: "@dev",
      at: "2026-06-23T04:10:00.000Z",
      isCommand: false
    };
    const state = reduceIssueState(createInitialState(), message, 30);

    expect(
      shouldSuggestAutomatically(state, message, {
        now: new Date(message.at),
        cooldownSeconds: 900,
        minConfidence: 0.65
      }).reason
    ).toBe("no-customer-question-or-issue-signal");

    expect(
      shouldSuggestAutomatically(state, { ...message, isCommand: true }, {
        now: new Date(message.at),
        cooldownSeconds: 900,
        minConfidence: 0.65
      }).reason
    ).toBe("command-message");
  });

  it("suppresses duplicate auto-suggestions during cooldown", () => {
    const message: IngestedMessage = {
      chatId: 1,
      messageId: 101,
      text: "Cloudflare SSL has too many redirects and the site is broken",
      userDisplayName: "@ops",
      at: "2026-06-23T04:10:00.000Z",
      isCommand: false
    };
    const state = reduceIssueState(createInitialState(), message, 30);
    const firstDecision = shouldSuggestAutomatically(state, message, {
      now: new Date(message.at),
      cooldownSeconds: 900,
      minConfidence: 0.65
    });
    const markedState = markAutoSuggestionSent(state, firstDecision.fingerprint, message.at);
    const secondDecision = shouldSuggestAutomatically(markedState, { ...message, messageId: 102 }, {
      now: new Date("2026-06-23T04:15:00.000Z"),
      cooldownSeconds: 900,
      minConfidence: 0.65
    });

    expect(firstDecision.shouldSuggest).toBe(true);
    expect(secondDecision.shouldSuggest).toBe(false);
    expect(secondDecision.reason).toBe("cooldown");
  });

  it("detects Vietnamese customer questions and records assistant notes", () => {
    const message: IngestedMessage = {
      chatId: 1,
      messageId: 103,
      text: "Khách hàng hỏi làm sao sửa lỗi Cloudflare Worker deploy xong nhưng API trả 500?",
      userDisplayName: "@support",
      at: "2026-06-23T04:20:00.000Z",
      isCommand: false
    };
    const state = reduceIssueState(createInitialState(), message, 30);
    const decision = shouldSuggestAutomatically(state, message, {
      now: new Date(message.at),
      cooldownSeconds: 900,
      minConfidence: 0.65
    });

    expect(messageLooksLikeCustomerQuestion(message.text)).toBe(true);
    expect(state.products).toContain("Workers");
    expect(state.openQuestions[0]).toContain("Khách hàng hỏi");
    expect(formatAssistantNotes(state)).toContain("Customer question");
    expect(decision.shouldSuggest).toBe(true);
  });

  it("can auto-suggest for customer troubleshooting questions even before a known cause exists", () => {
    const message: IngestedMessage = {
      chatId: 1,
      messageId: 104,
      text: "Customer asks: how to troubleshoot Cloudflare R2 CORS upload issue?",
      userDisplayName: "@support",
      at: "2026-06-23T04:25:00.000Z",
      isCommand: false
    };
    const state = reduceIssueState(createInitialState(), message, 30);
    const decision = shouldSuggestAutomatically(state, message, {
      now: new Date(message.at),
      cooldownSeconds: 900,
      minConfidence: 0.65
    });

    expect(state.products).toContain("R2");
    expect(state.suspectedCauses).toHaveLength(0);
    expect(decision.shouldSuggest).toBe(true);
  });
});
