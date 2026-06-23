import { getAgentByName, routeAgentRequest } from "agents";
import { AccessRegistry } from "./access-registry";
import { ChatIssueAgent } from "./agent";
import {
  chatAgentName,
  describeChat,
  formatAccessRequestForAdmin,
  formatChatNotAllowedResponse,
  formatPendingChats,
  getAdminChatIds,
  getMessageText,
  getTelegramChatMemberUpdate,
  getTelegramMessage,
  isAllowedChat,
  isAdminChat,
  isBotAddedToChat,
  parseChatIdArgument,
  parseCommand,
  sendTelegramMessage,
  toIngestedMessage,
  verifyTelegramSecret
} from "./telegram";
import type { CommandRequest, RuntimeEnv, TelegramUpdate } from "./types";
import type { TelegramChat, TelegramMessage } from "./types";
import { parseTelegramUpdate } from "./webhook";

export { AccessRegistry, ChatIssueAgent };

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
  const memberUpdate = getTelegramChatMemberUpdate(update);
  if (memberUpdate && isBotAddedToChat(memberUpdate)) {
    await requestChatApproval(memberUpdate.chat, env, new Date((memberUpdate.date ?? Date.now() / 1000) * 1000).toISOString());
    return;
  }

  const message = getTelegramMessage(update);
  if (!message) return;

  const text = getMessageText(message);
  if (!text) return;

  const parsedCommand = parseCommand(text, env.BOT_USERNAME);
  const registry = env.AccessRegistry.getByName("global");
  const isAdmin = isAdminChat(env, message.chat.id);

  if (parsedCommand?.command === "approve" || parsedCommand?.command === "deny" || parsedCommand?.command === "pending") {
    await handleAdminCommand(parsedCommand, message.chat.id, message.message_id, env, registry);
    return;
  }

  const hasAccess = isAdmin || isAllowedChat(env, message.chat.id) || (await registry.isApprovedChat(message.chat.id));
  if (!hasAccess) {
    console.warn("telegram_chat_not_allowed", { chatId: message.chat.id });
    if (parsedCommand?.command === "help") {
      await requestChatApproval(message.chat, env, ingestedAt(message));
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

async function handleAdminCommand(
  parsedCommand: NonNullable<ReturnType<typeof parseCommand>>,
  adminChatId: number,
  replyToMessageId: number,
  env: RuntimeEnv,
  registry: DurableObjectStub<AccessRegistry>
): Promise<void> {
  if (!isAdminChat(env, adminChatId)) {
    await sendTelegramMessage(env, adminChatId, "Only bot admins can approve chat access.", replyToMessageId);
    return;
  }

  if (parsedCommand.command === "pending") {
    const pending = await registry.listPendingChats();
    await sendTelegramMessage(env, adminChatId, formatPendingChats(pending), replyToMessageId);
    return;
  }

  const targetChatId = parseChatIdArgument(parsedCommand.args);
  if (!targetChatId) {
    await sendTelegramMessage(env, adminChatId, `Usage: /${parsedCommand.command} <chat_id>`, replyToMessageId);
    return;
  }

  if (parsedCommand.command === "approve") {
    const approved = await registry.approveChat(targetChatId, adminChatId, new Date().toISOString());
    await sendTelegramMessage(env, adminChatId, `Approved chat ${targetChatId}.`, replyToMessageId);
    await notifyChat(env, targetChatId, `This chat has been approved. Use /cfhelp or /diagnose to start.`);
    console.log("telegram_chat_approved", { targetChatId, approvedBy: adminChatId, title: approved?.title });
    return;
  }

  const denied = await registry.denyChat(targetChatId);
  await sendTelegramMessage(
    env,
    adminChatId,
    denied ? `Denied chat ${targetChatId}.` : `No pending request found for chat ${targetChatId}.`,
    replyToMessageId
  );
}

async function requestChatApproval(chat: TelegramChat, env: RuntimeEnv, requestedAt: string): Promise<void> {
  if (isAdminChat(env, chat.id) || isAllowedChat(env, chat.id)) return;

  const registry = env.AccessRegistry.getByName("global");
  if (await registry.isApprovedChat(chat.id)) return;

  const record = await registry.requestChatAccess(chat, requestedAt);
  await notifyAdmins(env, formatAccessRequestForAdmin(record), chat.id);
  console.log("telegram_chat_access_requested", { chatId: chat.id, label: describeChat(chat) });
}

async function notifyAdmins(env: RuntimeEnv, text: string, excludeChatId?: number): Promise<void> {
  await Promise.all(
    getAdminChatIds(env)
      .filter((adminChatId) => adminChatId !== excludeChatId)
      .map((adminChatId) => notifyChat(env, adminChatId, text))
  );
}

async function notifyChat(env: RuntimeEnv, chatId: number, text: string): Promise<void> {
  try {
    await sendTelegramMessage(env, chatId, text);
  } catch (error) {
    console.error("telegram_notification_failed", {
      chatId,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function ingestedAt(message: TelegramMessage): string {
  return new Date((message.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
}

