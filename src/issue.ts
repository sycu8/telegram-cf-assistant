import {
  clampConfidence,
  detectCloudflareProducts,
  getKnowledgeSources,
  redactSensitiveText,
  uniqueProducts,
  uniqueSources,
  uniqueStrings
} from "./knowledge";
import type {
  AgentCommand,
  ChatIssueState,
  CloudflareProduct,
  IngestedMessage,
  KnowledgeSource,
  SuspectedCause
} from "./types";

const ERROR_HINTS = [
  "error",
  "failed",
  "failing",
  "broken",
  "blocked",
  "timeout",
  "timed out",
  "undefined",
  "not found",
  "does not work",
  "not working",
  "issue",
  "problem",
  "bug",
  "fix",
  "troubleshoot",
  "can't",
  "cannot",
  "too many redirects",
  "403",
  "404",
  "500",
  "522",
  "525",
  "526"
];

const CUSTOMER_QUESTION_HINTS = [
  "?",
  "how",
  "why",
  "what",
  "where",
  "when",
  "can you",
  "could you",
  "please help",
  "need help",
  "help me",
  "guide",
  "how to",
  "what should",
  "làm sao",
  "làm sao",
  "làm thế nào",
  "làm thế nào",
  "tại sao",
  "tại sao",
  "vì sao",
  "vì sao",
  "cách sửa",
  "cách sửa",
  "sửa lỗi",
  "sửa lỗi",
  "khắc phục",
  "khắc phục",
  "hướng dẫn",
  "hướng dẫn",
  "giúp",
  "giúp",
  "cần hỗ trợ",
  "cần hỗ trợ",
  "khách hàng hỏi",
  "khách hàng hỏi",
  "bị lỗi",
  "bị lỗi",
  "không chạy",
  "không chạy",
  "không hoạt động",
  "không hoạt động"
];

export function createInitialState(): ChatIssueState {
  return {
    topic: null,
    products: [],
    symptoms: [],
    suspectedCauses: [],
    missingInfo: [],
    recommendedNextSteps: [],
    conversationNotes: [],
    openQuestions: [],
    recentMessages: [],
    lastSummary: null,
    lastSources: [],
    lastAutoSuggestionAt: null,
    lastAutoSuggestionFingerprint: null,
    messageCount: 0,
    updatedAt: null
  };
}

export function reduceIssueState(
  currentState: ChatIssueState,
  message: IngestedMessage,
  maxRecentMessages: number
): ChatIssueState {
  const cleanText = redactSensitiveText(message.text).trim();
  const detectedProducts = detectCloudflareProducts(cleanText);
  const products = uniqueProducts([...detectedProducts, ...currentState.products]).slice(0, 8);
  const symptoms = uniqueStrings([extractSymptom(cleanText), ...currentState.symptoms], 10);
  const suspectedCauses = mergeCauses([...inferSuspectedCauses(cleanText), ...currentState.suspectedCauses]).slice(0, 5);
  const missingInfo = uniqueStrings([...inferMissingInfo(products, cleanText), ...currentState.missingInfo], 8);
  const recommendedNextSteps = uniqueStrings([...inferNextSteps(products, cleanText), ...currentState.recommendedNextSteps], 8);
  const conversationNotes = uniqueStrings(
    [buildConversationNote(cleanText, products), ...(currentState.conversationNotes ?? [])],
    12
  );
  const openQuestions = uniqueStrings(
    [extractCustomerQuestion(cleanText), ...(currentState.openQuestions ?? [])],
    8
  );
  const recentMessages = [
    ...currentState.recentMessages,
    {
      messageId: message.messageId,
      userDisplayName: message.userDisplayName,
      text: cleanText,
      at: message.at,
      isCommand: message.isCommand
    }
  ].slice(-maxRecentMessages);

  return {
    ...currentState,
    topic: currentState.topic ?? inferTopic(products, cleanText),
    products,
    symptoms,
    suspectedCauses,
    missingInfo,
    recommendedNextSteps,
    conversationNotes,
    openQuestions,
    recentMessages,
    lastAutoSuggestionAt: currentState.lastAutoSuggestionAt ?? null,
    lastAutoSuggestionFingerprint: currentState.lastAutoSuggestionFingerprint ?? null,
    messageCount: currentState.messageCount + 1,
    updatedAt: message.at
  };
}

export function mergeAiUnderstanding(
  currentState: ChatIssueState,
  partial: Partial<ChatIssueState>,
  at: string
): ChatIssueState {
  return {
    ...currentState,
    topic: typeof partial.topic === "string" && partial.topic.trim() ? partial.topic.trim() : currentState.topic,
    products: uniqueProducts([...(partial.products ?? []), ...currentState.products]).slice(0, 8),
    symptoms: uniqueStrings([...(partial.symptoms ?? []), ...currentState.symptoms], 10),
    suspectedCauses: mergeCauses([...(partial.suspectedCauses ?? []), ...currentState.suspectedCauses]).slice(0, 5),
    missingInfo: uniqueStrings([...(partial.missingInfo ?? []), ...currentState.missingInfo], 8),
    recommendedNextSteps: uniqueStrings([...(partial.recommendedNextSteps ?? []), ...currentState.recommendedNextSteps], 8),
    conversationNotes: uniqueStrings([...(partial.conversationNotes ?? []), ...(currentState.conversationNotes ?? [])], 12),
    openQuestions: uniqueStrings([...(partial.openQuestions ?? []), ...(currentState.openQuestions ?? [])], 8),
    lastSummary:
      typeof partial.lastSummary === "string" && partial.lastSummary.trim()
        ? partial.lastSummary.trim()
        : currentState.lastSummary,
    updatedAt: at
  };
}

export function getSourcesForState(state: ChatIssueState): KnowledgeSource[] {
  return uniqueSources([...state.lastSources, ...getKnowledgeSources(state.products)]).slice(0, 6);
}

export function shouldSuggestAutomatically(
  state: ChatIssueState,
  message: IngestedMessage,
  options: {
    now: Date;
    cooldownSeconds: number;
    minConfidence: number;
  }
): { shouldSuggest: boolean; fingerprint: string; reason: string } {
  const fingerprint = buildAutoSuggestionFingerprint(state);

  if (message.isCommand) {
    return { shouldSuggest: false, fingerprint, reason: "command-message" };
  }

  if (state.products.length === 0) {
    return { shouldSuggest: false, fingerprint, reason: "no-cloudflare-product" };
  }

  const hasCustomerQuestion = messageLooksLikeCustomerQuestion(message.text) || state.openQuestions.length > 0;
  const hasIssueSignal = messageLooksLikeIssue(message.text) || state.symptoms.length > 0 || state.suspectedCauses.length > 0;

  if (!hasIssueSignal && !hasCustomerQuestion) {
    return { shouldSuggest: false, fingerprint, reason: "no-customer-question-or-issue-signal" };
  }

  const strongestCause = state.suspectedCauses[0];
  if (strongestCause && strongestCause.confidence < options.minConfidence) {
    return { shouldSuggest: false, fingerprint, reason: "low-confidence" };
  }

  if (state.lastAutoSuggestionAt) {
    const lastSuggestionMs = Date.parse(state.lastAutoSuggestionAt);
    const cooldownMs = options.cooldownSeconds * 1000;
    if (Number.isFinite(lastSuggestionMs) && options.now.getTime() - lastSuggestionMs < cooldownMs) {
      return { shouldSuggest: false, fingerprint, reason: "cooldown" };
    }
  }

  if (state.lastAutoSuggestionFingerprint && state.lastAutoSuggestionFingerprint === fingerprint) {
    return { shouldSuggest: false, fingerprint, reason: "duplicate-topic" };
  }

  return { shouldSuggest: true, fingerprint, reason: "issue-detected" };
}

export function markAutoSuggestionSent(
  state: ChatIssueState,
  fingerprint: string,
  at: string
): ChatIssueState {
  return {
    ...state,
    lastAutoSuggestionAt: at,
    lastAutoSuggestionFingerprint: fingerprint,
    updatedAt: at
  };
}

export function formatAutoSuggestionResponse(state: ChatIssueState, sources: KnowledgeSource[]): string {
  const diagnosis = formatDiagnoseResponse(state, sources);
  return [
    "Auto-detected customer question or possible Cloudflare issue.",
    "",
    formatAssistantNotes(state),
    "",
    diagnosis,
    "",
    "Reply with /diagnose for a deeper answer, /nextsteps for a short action list, or /forget to clear this chat context."
  ].join("\n");
}

export function messageLooksLikeIssue(text: string): boolean {
  const lower = text.toLowerCase();
  return ERROR_HINTS.some((hint) => lower.includes(hint));
}

export function messageLooksLikeCustomerQuestion(text: string): boolean {
  const lower = text.toLowerCase();
  return CUSTOMER_QUESTION_HINTS.some((hint) => lower.includes(hint));
}

export function buildCommandPrompt(command: AgentCommand, state: ChatIssueState, sources: KnowledgeSource[]): string {
  const recentMessages = state.recentMessages
    .slice(-12)
    .map((message) => `${message.userDisplayName}: ${message.text}`)
    .join("\n");

  return `You are a concise Cloudflare support assistant in a Telegram group.
Answer only the requested command: /${command}.

Conversation understanding:
${JSON.stringify(
  {
    topic: state.topic,
    products: state.products,
    symptoms: state.symptoms,
    suspectedCauses: state.suspectedCauses,
    missingInfo: state.missingInfo,
    recommendedNextSteps: state.recommendedNextSteps,
    conversationNotes: state.conversationNotes,
    openQuestions: state.openQuestions,
    lastSummary: state.lastSummary
  },
  null,
  2
)}

Recent messages:
${recentMessages || "(none)"}

Available Cloudflare sources:
${sources.map((source) => `- ${source.title}: ${source.url}`).join("\n")}

Rules:
- Be accurate. If confidence is low, say what is missing.
- Decide whether the customer is asking for help; if yes, answer proactively with troubleshooting guidance.
- Use conversationNotes and openQuestions as the assistant's working notes.
- Prefer Cloudflare products, bindings, Wrangler config, DNS, SSL/TLS, WAF, Cache, and deployment diagnostics.
- Do not claim a root cause is confirmed unless the messages prove it.
- Give fast practical guidance: likely issue, confidence, checks, fix steps, and missing info.
- Keep the Telegram reply under 3500 characters. Use plain text, no Markdown tables.`;
}

function buildAutoSuggestionFingerprint(state: ChatIssueState): string {
  const products = [...state.products].sort().join(",");
  const cause = state.suspectedCauses[0]?.cause ?? state.topic ?? "unknown";
  return `${products}|${cause}`.toLowerCase();
}

export function buildUnderstandingPrompt(state: ChatIssueState): string {
  const recentMessages = state.recentMessages
    .slice(-10)
    .map((message) => `${message.userDisplayName}: ${message.text}`)
    .join("\n");

  return `Update the Cloudflare issue understanding from this Telegram discussion.
Return strict JSON only with these keys:
topic: string | null
products: array of Cloudflare product names
symptoms: string[]
suspectedCauses: { cause: string, confidence: number, evidence: string[] }[]
missingInfo: string[]
recommendedNextSteps: string[]
conversationNotes: string[]
openQuestions: string[]
lastSummary: string | null

Existing understanding:
${JSON.stringify(state, null, 2)}

Recent messages:
${recentMessages}`;
}

export function formatHelpResponse(): string {
  return [
    "Cloudflare assistant commands:",
    "/diagnose - likely cause, confidence, checks, and fix steps",
    "/summary - summarize the current discussion",
    "/nextsteps - prioritized action list",
    "/sources - Cloudflare docs related to the issue",
    "/forget - clear this chat's stored context",
    "/config - show active bot configuration"
  ].join("\n");
}

export function formatAssistantNotes(state: ChatIssueState): string {
  const notes = (state.conversationNotes ?? []).slice(0, 4);
  const questions = (state.openQuestions ?? []).slice(0, 3);
  const lines = ["Assistant notes:"];

  if (notes.length === 0 && questions.length === 0) {
    return "Assistant notes: I have limited context so far.";
  }

  for (const note of notes) {
    lines.push(`- ${note}`);
  }

  for (const question of questions) {
    lines.push(`- Customer question: ${question}`);
  }

  return lines.join("\n");
}

export function formatFallbackCommandResponse(command: AgentCommand, state: ChatIssueState, sources: KnowledgeSource[]): string {
  if (command === "help") return formatHelpResponse();
  if (command === "summary") return formatSummaryResponse(state);
  if (command === "nextsteps") return formatNextStepsResponse(state);
  if (command === "sources") return formatSourcesResponse(sources);

  return formatDiagnoseResponse(state, sources);
}

export function formatSummaryResponse(state: ChatIssueState): string {
  if (state.messageCount === 0) {
    return "I do not have enough conversation context yet. Share the error, affected Cloudflare product, config, and recent changes.";
  }

  return [
    `Current understanding: ${state.topic ?? "Cloudflare-related issue under discussion"}`,
    `Products: ${state.products.length > 0 ? state.products.join(", ") : "not clear yet"}`,
    `Symptoms: ${state.symptoms.length > 0 ? state.symptoms.slice(0, 4).join("; ") : "not enough evidence yet"}`,
    `Likely causes: ${
      state.suspectedCauses.length > 0
        ? state.suspectedCauses.map((cause) => `${cause.cause} (${Math.round(cause.confidence * 100)}%)`).join("; ")
        : "not enough evidence yet"
    }`,
    `Missing info: ${state.missingInfo.length > 0 ? state.missingInfo.slice(0, 4).join("; ") : "none obvious"}`
  ].join("\n");
}

export function formatNextStepsResponse(state: ChatIssueState): string {
  const nextSteps =
    state.recommendedNextSteps.length > 0
      ? state.recommendedNextSteps
      : [
          "Paste the exact error message.",
          "Share the affected Cloudflare product and recent config/deploy change.",
          "Include relevant Wrangler config, DNS record, SSL mode, or dashboard setting."
        ];

  return ["Recommended next steps:", ...nextSteps.slice(0, 6).map((step, index) => `${index + 1}. ${step}`)].join("\n");
}

export function formatSourcesResponse(sources: KnowledgeSource[]): string {
  if (sources.length === 0) {
    return "No product-specific sources yet. Ask /diagnose after sharing the issue details.";
  }

  return ["Relevant Cloudflare sources:", ...sources.map((source) => `- ${source.title}: ${source.url}`)].join("\n");
}

export function formatDiagnoseResponse(state: ChatIssueState, sources: KnowledgeSource[]): string {
  if (state.messageCount === 0) {
    return "I need more context before diagnosing. Please share the exact error, affected Cloudflare product, config snippet, and what changed recently.";
  }

  const strongestCause = state.suspectedCauses[0];
  const confidence = strongestCause ? `${Math.round(strongestCause.confidence * 100)}%` : "low";

  return [
    `Likely issue: ${strongestCause?.cause ?? state.topic ?? "Cloudflare issue, but the cause is not clear yet"}`,
    `Confidence: ${confidence}`,
    "",
    "Why I think this:",
    ...(strongestCause?.evidence.length ? strongestCause.evidence.slice(0, 3).map((item) => `- ${item}`) : ["- The chat has limited diagnostic detail so far."]),
    "",
    formatNextStepsResponse(state),
    "",
    `Need if still failing: ${state.missingInfo.length > 0 ? state.missingInfo.slice(0, 4).join("; ") : "exact error and relevant Cloudflare config"}`,
    "",
    formatSourcesResponse(sources)
  ].join("\n");
}

function extractSymptom(text: string): string {
  const lower = text.toLowerCase();
  if (ERROR_HINTS.some((hint) => lower.includes(hint))) {
    return text.length > 220 ? `${text.slice(0, 217)}...` : text;
  }
  return "";
}

function buildConversationNote(text: string, products: CloudflareProduct[]): string {
  const snippets: string[] = [];
  if (products.length > 0) snippets.push(`Products mentioned: ${products.slice(0, 4).join(", ")}`);
  if (messageLooksLikeIssue(text)) snippets.push(`Issue signal: ${truncateNote(text)}`);
  if (messageLooksLikeCustomerQuestion(text)) snippets.push(`Customer appears to ask for help: ${truncateNote(text)}`);
  return snippets.join(" | ");
}

function extractCustomerQuestion(text: string): string {
  if (!messageLooksLikeCustomerQuestion(text)) return "";
  return truncateNote(text);
}

function truncateNote(text: string): string {
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function inferTopic(products: CloudflareProduct[], text: string): string | null {
  if (products.length === 0) return null;
  const lower = text.toLowerCase();
  if (lower.includes("deploy")) return `${products[0]} deployment issue`;
  if (lower.includes("dns") || lower.includes("nxdomain")) return "DNS resolution issue";
  if (lower.includes("certificate") || lower.includes("ssl") || lower.includes("tls")) return "SSL/TLS configuration issue";
  if (lower.includes("blocked") || lower.includes("403")) return "Cloudflare request blocking issue";
  return `${products[0]} issue`;
}

function inferSuspectedCauses(text: string): SuspectedCause[] {
  const lower = text.toLowerCase();
  const causes: SuspectedCause[] = [];

  if (lower.includes("env.db") || (lower.includes("d1") && lower.includes("binding"))) {
    causes.push({
      cause: "D1 binding name mismatch between wrangler config and Worker code",
      confidence: 0.82,
      evidence: ["The discussion mentions D1 or env.DB binding behavior."]
    });
  }

  if (lower.includes("too many redirects") || lower.includes("err_too_many_redirects")) {
    causes.push({
      cause: "SSL/TLS mode or origin redirect loop",
      confidence: 0.78,
      evidence: ["The symptom is a redirect loop, commonly caused by SSL mode or origin redirect mismatch."]
    });
  }

  if (lower.includes("nxdomain") || lower.includes("nameserver")) {
    causes.push({
      cause: "DNS records or authoritative nameservers are not configured correctly",
      confidence: 0.76,
      evidence: ["The discussion mentions DNS resolution or nameserver symptoms."]
    });
  }

  if (lower.includes("wrangler") && (lower.includes("deploy") || lower.includes("compatibility_date"))) {
    causes.push({
      cause: "Wrangler configuration or compatibility date issue",
      confidence: 0.72,
      evidence: ["The discussion references Wrangler deployment/configuration."]
    });
  }

  if ((lower.includes("403") || lower.includes("blocked")) && (lower.includes("waf") || lower.includes("firewall"))) {
    causes.push({
      cause: "WAF or security rule is blocking matching requests",
      confidence: 0.75,
      evidence: ["The discussion mentions blocking with WAF/firewall signals."]
    });
  }

  if (lower.includes("cache") && (lower.includes("stale") || lower.includes("old"))) {
    causes.push({
      cause: "Cached response or Cache Rule is serving stale content",
      confidence: 0.7,
      evidence: ["The discussion mentions stale cached content."]
    });
  }

  return causes;
}

function inferMissingInfo(products: CloudflareProduct[], text: string): string[] {
  const lower = text.toLowerCase();
  const missing = ["Exact error message or screenshot", "What changed immediately before the issue"];

  if (products.includes("Workers") || products.includes("Wrangler")) {
    missing.push("wrangler.jsonc and relevant Worker source snippet");
    if (!lower.includes("wrangler")) missing.push("Wrangler version and deploy command");
  }

  if (products.includes("DNS")) missing.push("Record name/type/value and whether it is proxied");
  if (products.includes("SSL/TLS")) missing.push("Cloudflare SSL/TLS mode and origin certificate status");
  if (products.includes("WAF")) missing.push("Security Events entry or Ray ID");
  if (products.includes("D1")) missing.push("D1 binding name, database_id, and code using env binding");

  return missing;
}

function inferNextSteps(products: CloudflareProduct[], text: string): string[] {
  const lower = text.toLowerCase();
  const steps: string[] = [];

  if (products.includes("Workers") || products.includes("Wrangler")) {
    steps.push("Run `npx wrangler deploy --dry-run` and check for binding/config errors.");
    steps.push("Run `npx wrangler types` after changing bindings.");
  }

  if (products.includes("D1")) {
    steps.push("Verify the D1 binding name in wrangler config matches the exact `env.<binding>` used in code.");
  }

  if (products.includes("DNS")) {
    steps.push("Confirm authoritative nameservers, DNS record type/value, and proxy status.");
  }

  if (products.includes("SSL/TLS") || lower.includes("too many redirects")) {
    steps.push("Check Cloudflare SSL/TLS mode and remove conflicting HTTPS redirects at the origin.");
  }

  if (products.includes("WAF")) {
    steps.push("Look up the request Ray ID in Security Events and identify the matching rule.");
  }

  if (products.includes("Cache")) {
    steps.push("Check Cache Rules/Page Rules and purge the exact URL after config changes.");
  }

  if (steps.length === 0) {
    steps.push("Collect the exact error, Ray ID if present, affected URL, product area, and recent changes.");
  }

  return steps;
}

function mergeCauses(causes: SuspectedCause[]): SuspectedCause[] {
  const byCause = new Map<string, SuspectedCause>();

  for (const cause of causes) {
    const key = cause.cause.trim().toLowerCase();
    if (!key) continue;
    const existing = byCause.get(key);
    if (!existing || cause.confidence > existing.confidence) {
      byCause.set(key, {
        cause: cause.cause.trim(),
        confidence: clampConfidence(cause.confidence),
        evidence: uniqueStrings([...(cause.evidence ?? []), ...(existing?.evidence ?? [])], 4)
      });
    }
  }

  return Array.from(byCause.values()).sort((a, b) => b.confidence - a.confidence);
}
