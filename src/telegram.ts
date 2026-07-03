import type {
  AgentCommand,
  ChatAccessRecord,
  BotStatus,
  ChatSettings,
  IngestedMessage,
  ParsedCommand,
  TelegramChat,
  TelegramChatMemberUpdate,
  RuntimeEnv,
  TelegramMessage,
  TelegramUpdate
} from "./types";

const COMMAND_ALIASES: Record<string, AgentCommand> = {
  start: "help",
  cfhelp: "help",
  help: "help",
  approve: "approve",
  deny: "deny",
  pending: "pending",
  approved: "approved",
  revoke: "revoke",
  status: "status",
  autosuggest: "autosuggest",
  setcooldown: "setcooldown",
  diagnose: "diagnose",
  summary: "summary",
  nextsteps: "nextsteps",
  sources: "sources",
  forget: "forget",
  config: "config"
};

export function getTelegramMessage(update: TelegramUpdate): TelegramMessage | null {
  return update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post ?? null;
}

export function getTelegramChatMemberUpdate(update: TelegramUpdate): TelegramChatMemberUpdate | null {
  return update.my_chat_member ?? null;
}

export function isBotAddedToChat(update: TelegramChatMemberUpdate): boolean {
  const status = update.new_chat_member?.status;
  return status === "member" || status === "administrator";
}

export function getMessageText(message: TelegramMessage): string | null {
  const text = message.text ?? message.caption ?? null;
  const trimmed = text?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function toIngestedMessage(message: TelegramMessage, text: string, isCommand: boolean): IngestedMessage {
  return {
    chatId: message.chat.id,
    messageId: message.message_id,
    text,
    userDisplayName: formatUserDisplayName(message),
    at: new Date((message.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    isCommand
  };
}

export function parseCommand(text: string, botUsername?: string): ParsedCommand | null {
  if (!text.startsWith("/")) return null;

  const [token = "", ...args] = text.split(/\s+/);
  const match = /^\/([a-zA-Z0-9_]+)(?:@([a-zA-Z0-9_]+))?$/.exec(token);
  if (!match) return null;

  const [, rawCommand, targetUsername] = match;
  if (!rawCommand) return null;
  if (targetUsername && !botUsername) {
    return null;
  }

  if (targetUsername && botUsername && targetUsername.toLowerCase() !== botUsername.toLowerCase()) {
    return null;
  }

  const command = COMMAND_ALIASES[rawCommand.toLowerCase()];
  return command ? { command, raw: rawCommand, args: args.join(" ").trim() } : null;
}

export function isAllowedChat(env: RuntimeEnv, chatId: number): boolean {
  if (parseBoolean(env.ALLOW_ALL_CHATS)) return true;

  const allowedIds = (env.ALLOWED_CHAT_IDS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return allowedIds.includes(String(chatId));
}

export function isAdminChat(env: RuntimeEnv, chatId: number): boolean {
  const adminIds = parseChatIdList(env.ADMIN_CHAT_IDS);
  const fallbackAdminIds = parseChatIdList(env.ALLOWED_CHAT_IDS);
  const ids = adminIds.length > 0 ? adminIds : fallbackAdminIds;
  return ids.includes(chatId);
}

export function getAdminChatIds(env: RuntimeEnv): number[] {
  const adminIds = parseChatIdList(env.ADMIN_CHAT_IDS);
  return adminIds.length > 0 ? adminIds : parseChatIdList(env.ALLOWED_CHAT_IDS);
}

export function parseChatIdArgument(args: string): number | null {
  const [rawChatId] = args.trim().split(/\s+/);
  if (!rawChatId) return null;
  const parsed = Number.parseInt(rawChatId, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function formatChatNotAllowedResponse(chatId: number): string {
  return [
    "This chat is not approved yet.",
    `Chat ID: ${chatId}`,
    "",
    "I sent an access request to the bot admin.",
    "After approval, use /cfhelp or /diagnose."
  ].join("\n");
}

export function formatAccessRequestForAdmin(record: ChatAccessRecord): string {
  return [
    "New Telegram chat requested Cloudflare assistant access.",
    `Chat ID: ${record.chatId}`,
    `Type: ${record.type}`,
    `Title: ${record.title ?? "(none)"}`,
    `Username: ${record.username ? `@${record.username}` : "(none)"}`,
    "",
    `Approve: /approve ${record.chatId}`,
    `Deny: /deny ${record.chatId}`
  ].join("\n");
}

export function formatPendingChats(records: ChatAccessRecord[]): string {
  if (records.length === 0) return "No pending chat access requests.";

  return [
    "Pending chat access requests:",
    ...records.map((record) => {
      const label = record.title ?? record.username ?? record.type;
      return `- ${record.chatId} (${label}) requested ${record.requestedAt}`;
    })
  ].join("\n");
}

export function formatApprovedChats(records: ChatAccessRecord[]): string {
  if (records.length === 0) return "No approved chats yet.";

  return [
    "Approved chats:",
    ...records.map((record) => {
      const label = record.title ?? record.username ?? record.type;
      return `- ${record.chatId} (${label}) approved ${record.approvedAt ?? "unknown"}`;
    })
  ].join("\n");
}

export function formatBotStatus(status: BotStatus): string {
  const events = Object.entries(status.events);
  return [
    "Bot status:",
    `Pending chats: ${status.pendingChats}`,
    `Approved chats: ${status.approvedChats}`,
    `Generated at: ${status.generatedAt}`,
    "Events:",
    ...(events.length > 0 ? events.map(([event, count]) => `- ${event}: ${count}`) : ["- none recorded"])
  ].join("\n");
}

export function formatChatSettings(settings: ChatSettings): string {
  return [
    `Chat settings for ${settings.chatId}:`,
    `Auto suggestions: ${settings.autoSuggestionsEnabled ? "on" : "off"}`,
    `Cooldown: ${settings.autoSuggestionCooldownSeconds} seconds`,
    `Min confidence: ${settings.autoSuggestionMinConfidence}`,
    `Language: ${settings.language}`,
    `Updated: ${settings.updatedAt}`
  ].join("\n");
}

export function parseToggleArgument(args: string): boolean | null {
  const [raw] = args.trim().toLowerCase().split(/\s+/);
  if (!raw) return null;
  if (raw === "on" || raw === "true" || raw === "enable" || raw === "enabled") return true;
  if (raw === "off" || raw === "false" || raw === "disable" || raw === "disabled") return false;
  return null;
}

export async function verifyTelegramSecret(request: Request, env: RuntimeEnv): Promise<boolean> {
  const expected = env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) return false;

  const actual = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  return timingSafeEqual(actual, expected);
}

export async function sendTelegramMessage(
  env: RuntimeEnv,
  chatId: number,
  text: string,
  replyToMessageId?: number
): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }

  for (const chunk of splitTelegramMessage(text)) {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true
    };

    if (replyToMessageId) {
      payload.reply_parameters = { message_id: replyToMessageId };
    }

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Telegram sendMessage failed with ${response.status}`);
    }
  }
}

export function chatAgentName(chatId: number): string {
  return `telegram-chat-${String(chatId).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseBoolean(value: string | undefined): boolean {
  return value?.toLowerCase() === "true" || value === "1";
}

export function describeChat(chat: TelegramChat): string {
  return chat.title ?? (chat.username ? `@${chat.username}` : `${chat.type} ${chat.id}`);
}

function formatUserDisplayName(message: TelegramMessage): string {
  const user = message.from;
  if (!user) return message.chat.title ?? String(message.chat.id);
  if (user.username) return `@${user.username}`;

  return [user.first_name, user.last_name].filter(Boolean).join(" ") || String(user.id);
}

async function timingSafeEqual(actual: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const actualBytes = encoder.encode(actual);
  const expectedBytes = encoder.encode(expected);
  const maxLength = Math.max(actualBytes.length, expectedBytes.length);
  let diff = actualBytes.length ^ expectedBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (actualBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }

  return diff === 0;
}

function splitTelegramMessage(text: string): string[] {
  const maxLength = 3900;
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += maxLength) {
    chunks.push(text.slice(index, index + maxLength));
  }
  return chunks;
}

function parseChatIdList(value: string | undefined): number[] {
  return (value ?? "")
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isSafeInteger(item));
}
