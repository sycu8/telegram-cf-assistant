export type CloudflareProduct =
  | "Workers"
  | "Pages"
  | "DNS"
  | "SSL/TLS"
  | "WAF"
  | "Cache"
  | "R2"
  | "D1"
  | "KV"
  | "Queues"
  | "Zero Trust"
  | "Load Balancing"
  | "Email Routing"
  | "Durable Objects"
  | "Vectorize"
  | "Workers AI"
  | "AI Gateway"
  | "Wrangler";

export type AgentCommand =
  | "help"
  | "diagnose"
  | "summary"
  | "nextsteps"
  | "sources"
  | "forget"
  | "config";

export interface RuntimeEnv extends Env {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  ALLOWED_CHAT_IDS?: string;
  BOT_USERNAME?: string;
}

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel" | string;
  title?: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  date?: number;
  text?: string;
  caption?: string;
  from?: TelegramUser;
  chat: TelegramChat;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export interface IngestedMessage {
  chatId: number;
  messageId: number;
  text: string;
  userDisplayName: string;
  at: string;
  isCommand: boolean;
}

export interface RecentMessage {
  messageId: number;
  userDisplayName: string;
  text: string;
  at: string;
  isCommand: boolean;
}

export interface SuspectedCause {
  cause: string;
  confidence: number;
  evidence: string[];
}

export interface KnowledgeSource {
  title: string;
  url: string;
  product?: CloudflareProduct;
}

export interface ChatIssueState {
  topic: string | null;
  products: CloudflareProduct[];
  symptoms: string[];
  suspectedCauses: SuspectedCause[];
  missingInfo: string[];
  recommendedNextSteps: string[];
  recentMessages: RecentMessage[];
  lastSummary: string | null;
  lastSources: KnowledgeSource[];
  messageCount: number;
  updatedAt: string | null;
}

export interface CommandRequest {
  command: AgentCommand;
  chatId: number;
  requestedBy: string;
  at: string;
}

export interface CommandResponse {
  text: string;
  sources: KnowledgeSource[];
}

export interface ParsedCommand {
  command: AgentCommand;
  raw: string;
}
