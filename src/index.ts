import { getAgentByName, routeAgentRequest } from "agents";
import { ChatIssueAgent } from "./agent";
import {
  chatAgentName,
  formatChatNotAllowedResponse,
  getMessageText,
  getTelegramMessage,
  isAllowedChat,
  parseCommand,
  sendTelegramMessage,
  toIngestedMessage,
  verifyTelegramSecret
} from "./telegram";
import type { CommandRequest, RuntimeEnv, TelegramUpdate } from "./types";
import { parseTelegramUpdate } from "./webhook";

export { ChatIssueAgent };

export default {
  async fetch(request: Request, env: RuntimeEnv, ctx: ExecutionContext): Promise<Response> {
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, service: "telegram-cf-assistant" });
    }

    if (request.method === "POST" && url.pathname === "/telegram/webhook") {
      if (!(await verifyTelegramSecret(request, env))) {
        return Response.json({ ok: false, error: "invalid Telegram webhook secret" }, { status: 401 });
      }

      const update = await parseTelegramUpdate(request);
      if (!update) {
        return Response.json({ ok: false, error: "invalid Telegram update payload" }, { status: 400 });
      }

      ctx.waitUntil(handleTelegramUpdate(update, env));
      return Response.json({ ok: true });
    }

    return Response.json({ ok: false, error: "not found" }, { status: 404 });
  }
} satisfies ExportedHandler<RuntimeEnv>;

async function handleTelegramUpdate(update: TelegramUpdate, env: RuntimeEnv): Promise<void> {
  const message = getTelegramMessage(update);
  if (!message) return;

  const text = getMessageText(message);
  if (!text) return;

  const parsedCommand = parseCommand(text, env.BOT_USERNAME);
  if (!isAllowedChat(env, message.chat.id)) {
    console.warn("telegram_chat_not_allowed", { chatId: message.chat.id });
    if (parsedCommand?.command === "help") {
      await sendTelegramMessage(env, message.chat.id, formatChatNotAllowedResponse(message.chat.id), message.message_id);
    }
    return;
  }

  const ingestedMessage = toIngestedMessage(message, text, Boolean(parsedCommand));
  const agent = await getAgentByName<RuntimeEnv, ChatIssueAgent>(env.ChatIssueAgent, chatAgentName(message.chat.id));

  if (!parsedCommand) {
    await agent.ingestMessage(ingestedMessage);
    return;
  }

  if (parsedCommand.command !== "forget") {
    await agent.ingestMessage(ingestedMessage);
  }

  const response = await agent.respondToCommand({
    command: parsedCommand.command,
    chatId: message.chat.id,
    requestedBy: ingestedMessage.userDisplayName,
    at: ingestedMessage.at
  } satisfies CommandRequest);

  await sendTelegramMessage(env, message.chat.id, response.text, message.message_id);
}

