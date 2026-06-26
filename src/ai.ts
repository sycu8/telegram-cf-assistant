import { buildCommandPrompt, buildUnderstandingPrompt, mergeAiUnderstanding } from "./issue";
import { detectCloudflareProducts } from "./knowledge";
import type { AgentCommand, ChatIssueState, RuntimeEnv } from "./types";

type AiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type AiRunOptions = {
  cacheTtl?: number;
  skipCache?: boolean;
  model?: string | undefined;
};

export async function generateCommandAnswer(
  env: RuntimeEnv,
  command: AgentCommand,
  state: ChatIssueState
): Promise<string | null> {
  const sources = state.lastSources;
  const prompt = buildCommandPrompt(command, state, sources);
  const text = await runTextGeneration(
    env,
    [
      {
        role: "system",
        content:
          "You are a Cloudflare troubleshooting assistant. Be precise, concise, and honest about uncertainty."
      },
      { role: "user", content: prompt }
    ],
    { cacheTtl: 300, skipCache: false, model: env.CHAT_MODEL }
  );

  return text?.trim() || null;
}

export async function updateUnderstandingWithAi(
  env: RuntimeEnv,
  state: ChatIssueState,
  at: string
): Promise<ChatIssueState | null> {
  const prompt = buildUnderstandingPrompt(state);
  const text = await runTextGeneration(
    env,
    [
      {
        role: "system",
        content:
          "You extract structured Cloudflare troubleshooting state from chat. Return only valid JSON with no prose."
      },
      { role: "user", content: prompt }
    ],
    { cacheTtl: 60, skipCache: true, model: env.SUMMARY_MODEL }
  );

  if (!text) return null;
  const partial = parseUnderstandingJson(text);
  if (!partial) return null;

  return mergeAiUnderstanding(state, partial, at);
}

async function runTextGeneration(
  env: RuntimeEnv,
  messages: AiMessage[],
  options: AiRunOptions
): Promise<string | null> {
  const model = options.model || "@cf/meta/llama-3.1-8b-instruct";
  const gatewayId = env.AI_GATEWAY_ID || "default";

  try {
    const result = await env.AI.run(
      model,
      { messages },
      {
        gateway: {
          id: gatewayId,
          cacheTtl: options.cacheTtl ?? 300,
          skipCache: options.skipCache ?? false
        }
      }
    );

    return extractText(result);
  } catch (error) {
    console.error("ai_generation_failed", {
      message: error instanceof Error ? error.message : String(error),
      model
    });
    return null;
  }
}

function extractText(result: unknown): string | null {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return null;

  const candidate = result as {
    response?: unknown;
    text?: unknown;
    result?: unknown;
    choices?: Array<{ message?: { content?: unknown }; text?: unknown }>;
  };

  if (typeof candidate.response === "string") return candidate.response;
  if (typeof candidate.text === "string") return candidate.text;
  if (typeof candidate.result === "string") return candidate.result;

  const firstChoice = candidate.choices?.[0];
  if (typeof firstChoice?.message?.content === "string") return firstChoice.message.content;
  if (typeof firstChoice?.text === "string") return firstChoice.text;

  return null;
}

function parseUnderstandingJson(text: string): Partial<ChatIssueState> | null {
  const jsonText = extractJsonObject(text);
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const products = asStringArray(parsed.products).flatMap((product) => detectCloudflareProducts(product));
    return {
      topic: typeof parsed.topic === "string" ? parsed.topic : null,
      products,
      symptoms: asStringArray(parsed.symptoms),
      suspectedCauses: asSuspectedCauses(parsed.suspectedCauses),
      missingInfo: asStringArray(parsed.missingInfo),
      recommendedNextSteps: asStringArray(parsed.recommendedNextSteps),
      conversationNotes: asStringArray(parsed.conversationNotes),
      openQuestions: asStringArray(parsed.openQuestions),
      lastSummary: typeof parsed.lastSummary === "string" ? parsed.lastSummary : null
    };
  } catch (error) {
    console.error("ai_understanding_parse_failed", {
      message: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

function extractJsonObject(text: string): string | null {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return text.slice(first, last + 1);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function asSuspectedCauses(value: unknown): ChatIssueState["suspectedCauses"] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.cause !== "string") return [];

    return [
      {
        cause: candidate.cause,
        confidence: typeof candidate.confidence === "number" ? candidate.confidence : 0.5,
        evidence: asStringArray(candidate.evidence)
      }
    ];
  });
}
