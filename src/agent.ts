import { Agent } from "agents";
import { generateCommandAnswer, updateUnderstandingWithAi } from "./ai";
import {
  createInitialState,
  formatAutoSuggestionResponse,
  formatFallbackCommandResponse,
  formatHelpResponse,
  getSourcesForState,
  markAutoSuggestionSent,
  reduceIssueState,
  shouldSuggestAutomatically
} from "./issue";
import { getKnowledgeSources } from "./knowledge";
import { parseBoolean, parsePositiveInteger } from "./telegram";
import type { ChatIssueState, ChatSettings, CommandRequest, CommandResponse, IngestedMessage, RuntimeEnv } from "./types";

export class ChatIssueAgent extends Agent<RuntimeEnv, ChatIssueState> {
  override initialState = createInitialState();

  async ingestMessage(message: IngestedMessage): Promise<ChatIssueState> {
    this.ensureTables();

    const maxRecentMessages = parsePositiveInteger(this.env.MAX_RECENT_MESSAGES, 30);
    const nextState = reduceIssueState(this.state ?? this.initialState, message, maxRecentMessages);
    this.setState(nextState);
    this.recordMessage(message);

    if (this.shouldRunBackgroundAi(message)) {
      const aiState = await updateUnderstandingWithAi(this.env, this.state, message.at);
      if (aiState) {
        this.setState({
          ...aiState,
          lastSources: getKnowledgeSources(aiState.products)
        });
      }
    }

    return this.state;
  }

  async respondToCommand(request: CommandRequest): Promise<CommandResponse> {
    this.ensureTables();

    if (request.command === "forget") {
      this.setState({
        ...createInitialState(),
        updatedAt: request.at
      });
      this.sql`DELETE FROM message_log`;
      return {
        text: "I cleared the stored context for this chat.",
        sources: []
      };
    }

    if (request.command === "help") {
      return {
        text: formatHelpResponse(),
        sources: []
      };
    }

    if (request.command === "config") {
      return {
        text: this.formatConfig(),
        sources: []
      };
    }

    const sources = getSourcesForState(this.state);
    this.setState({
      ...this.state,
      lastSources: sources,
      updatedAt: request.at
    });

    const fallback = formatFallbackCommandResponse(request.command, this.state, sources);
    const aiAnswer = await generateCommandAnswer(this.env, request.command, this.state);

    return {
      text: aiAnswer ?? fallback,
      sources
    };
  }

  async maybeSuggestFix(message: IngestedMessage, settings?: ChatSettings): Promise<CommandResponse | null> {
    const enabled = settings?.autoSuggestionsEnabled ?? parseBoolean(this.env.AUTO_SUGGESTIONS_ENABLED ?? "true");
    if (!enabled) return null;

    const cooldownSeconds = settings?.autoSuggestionCooldownSeconds ?? parsePositiveInteger(this.env.AUTO_SUGGESTION_COOLDOWN_SECONDS, 900);
    const minConfidence = settings?.autoSuggestionMinConfidence ?? parseFloatOrFallback(this.env.AUTO_SUGGESTION_MIN_CONFIDENCE, 0.65);
    const decision = shouldSuggestAutomatically(this.state, message, {
      now: new Date(message.at),
      cooldownSeconds,
      minConfidence
    });

    if (!decision.shouldSuggest) {
      console.log("auto_suggestion_skipped", {
        chatId: message.chatId,
        reason: decision.reason,
        fingerprint: decision.fingerprint
      });
      return null;
    }

    const sources = getSourcesForState(this.state);
    const fallback = formatAutoSuggestionResponse(this.state, sources);
    const aiAnswer = await generateCommandAnswer(this.env, "diagnose", {
      ...this.state,
      lastSources: sources
    });
    const text = [
      aiAnswer ? "Auto-detected possible Cloudflare issue.\n\n" + aiAnswer : fallback,
      "",
      "Use /diagnose for a deeper answer or /nextsteps for a short action list."
    ].join("\n");
    const sentAt = new Date(message.at).toISOString();

    this.setState({
      ...markAutoSuggestionSent(this.state, decision.fingerprint, sentAt),
      lastSources: sources
    });

    return { text, sources };
  }

  private shouldRunBackgroundAi(message: IngestedMessage): boolean {
    if (message.isCommand) return false;
    if (!parseBoolean(this.env.ENABLE_BACKGROUND_AI)) return false;
    if (this.state.messageCount < 2) return false;

    const text = message.text.toLowerCase();
    return (
      this.state.products.length > 0 ||
      text.includes("cloudflare") ||
      text.includes("wrangler") ||
      text.includes("worker") ||
      text.includes("dns") ||
      text.includes("ssl") ||
      text.includes("error") ||
      text.includes("failed")
    );
  }

  private ensureTables(): void {
    this.sql`
      CREATE TABLE IF NOT EXISTS message_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        user_display_name TEXT NOT NULL,
        text TEXT NOT NULL,
        is_command INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )
    `;
  }

  private recordMessage(message: IngestedMessage): void {
    this.sql`
      INSERT INTO message_log (message_id, user_display_name, text, is_command, created_at)
      VALUES (${message.messageId}, ${message.userDisplayName}, ${message.text}, ${message.isCommand ? 1 : 0}, ${message.at})
    `;
  }

  private formatConfig(): string {
    return [
      "Active assistant configuration:",
      `Background AI: ${parseBoolean(this.env.ENABLE_BACKGROUND_AI) ? "enabled" : "disabled"}`,
      `Chat model: ${this.env.CHAT_MODEL ?? "@cf/meta/llama-3.1-8b-instruct"}`,
      `Summary model: ${this.env.SUMMARY_MODEL ?? "@cf/meta/llama-3.1-8b-instruct"}`,
      `AI Gateway: ${this.env.AI_GATEWAY_ID ?? "default"}`,
      `Auto suggestions: ${parseBoolean(this.env.AUTO_SUGGESTIONS_ENABLED ?? "true") ? "enabled" : "disabled"}`,
      `Auto suggestion cooldown: ${parsePositiveInteger(this.env.AUTO_SUGGESTION_COOLDOWN_SECONDS, 900)} seconds`,
      `Recent message window: ${parsePositiveInteger(this.env.MAX_RECENT_MESSAGES, 30)}`,
      `Tracked messages: ${this.state.messageCount}`,
      `Detected products: ${this.state.products.length > 0 ? this.state.products.join(", ") : "none yet"}`
    ].join("\n");
  }
}

function parseFloatOrFallback(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
