import type {
  AgentCommand,
  IngestedMessage,
  ParsedCommand,
  RuntimeEnv,
  TelegramMessage,
  TelegramUpdate
} from "./types";

const COMMAND_ALIASES: Record<string, AgentCommand> = {
  cfhelp: "help",
  help: "help",
  diagnose: "diagnose",
  summary: "summary",
  nextsteps: "nextsteps",
  sources: "sources",
  forget: "forget",
  config: "config"
};

export function getTelegramMessage(update: TelegramUpdate): TelegramMessage | null {
  return update.message ?? update.edited_message ?? null;
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

  const token = text.split(/\s+/, 1)[0] ?? "";
  const match = /^\/([a-zA-Z0-9_]+)(?:@([a-zA-Z0-9_]+))?$/.exec(token);
  if (!match) return null;

  const [, rawCommand, targetUsername] = match;
  if (!rawCommand) return null;
  if (targetUsername && botUsername && targetUsername.toLowerCase() !== botUsername.toLowerCase()) {
    return null;
  }

  const command = COMMAND_ALIASES[rawCommand.toLowerCase()];
  return command ? { command, raw: rawCommand } : null;
}

export function isAllowedChat(env: RuntimeEnv, chatId: number): boolean {
  if (parseBoolean(env.ALLOW_ALL_CHATS)) return true;

  const allowedIds = (env.ALLOWED_CHAT_IDS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return allowedIds.includes(String(chatId));
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
