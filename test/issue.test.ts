import { describe, expect, it } from "vitest";
import { createInitialState, formatDiagnoseResponse, reduceIssueState } from "../src/issue";
import { getKnowledgeSources } from "../src/knowledge";
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
});
