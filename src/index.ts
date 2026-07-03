import { getAgentByName, routeAgentRequest } from "agents";
import { AccessRegistry } from "./access-registry";
import { ChatIssueAgent } from "./agent";
import {
  chatAgentName,
  describeChat,
  formatAccessRequestForAdmin,
  formatApprovedChats,
  formatBotStatus,
  formatChatSettings,
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
  parsePositiveInteger,
  parseToggleArgument,
  sendTelegramMessage,
  toIngestedMessage,
  verifyTelegramSecret
} from "./telegram";
import type { AgentCommand, CommandRequest, RuntimeEnv, TelegramUpdate } from "./types";
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

  if (parsedCommand && isAdminCommand(parsedCommand.command)) {
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
    await registry.recordEvent("message_ingested");
    const settings = await registry.getChatSettings(message.chat.id);
    const suggestion = await agent.maybeSuggestFix(ingestedMessage, settings);
    if (suggestion) {
      await sendTelegramMessage(env, message.chat.id, suggestion.text, message.message_id);
      await registry.recordEvent("auto_suggestion_sent");
    }
    return;
  }

  if (parsedCommand.command !== "forget") {
    await agent.ingestMessage(ingestedMessage);
  }
  await registry.recordEvent(`command_${parsedCommand.command}`);

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
    await registry.recordEvent("admin_pending");
    return;
  }

  if (parsedCommand.command === "approved") {
    const approved = await registry.listApprovedChats();
    await sendTelegramMessage(env, adminChatId, formatApprovedChats(approved), replyToMessageId);
    await registry.recordEvent("admin_approved");
    return;
  }

  if (parsedCommand.command === "status") {
    const status = await registry.getStatus(new Date().toISOString());
    await sendTelegramMessage(env, adminChatId, formatBotStatus(status), replyToMessageId);
    await registry.recordEvent("admin_status");
    return;
  }

  if (parsedCommand.command === "autosuggest") {
    const toggle = parseToggleArgument(parsedCommand.args);
    if (toggle === null) {
      const settings = await registry.getChatSettings(adminChatId);
      await sendTelegramMessage(env, adminChatId, `${formatChatSettings(settings)}\n\nUsage: /autosuggest on|off [chat_id]`, replyToMessageId);
      return;
    }

    const targetChatId = parseOptionalTargetChatId(parsedCommand.args) ?? adminChatId;
    const settings = await registry.updateChatSettings(targetChatId, { autoSuggestionsEnabled: toggle }, new Date().toISOString());
    await sendTelegramMessage(env, adminChatId, formatChatSettings(settings), replyToMessageId);
    await registry.recordEvent("admin_autosuggest");
    return;
  }

  if (parsedCommand.command === "setcooldown") {
    const seconds = parsePositiveInteger(parsedCommand.args, 0);
    if (seconds <= 0) {
      await sendTelegramMessage(env, adminChatId, "Usage: /setcooldown <seconds> [chat_id]", replyToMessageId);
      return;
    }

    const targetChatId = parseOptionalTargetChatId(parsedCommand.args) ?? adminChatId;
    const settings = await registry.updateChatSettings(targetChatId, { autoSuggestionCooldownSeconds: seconds }, new Date().toISOString());
    await sendTelegramMessage(env, adminChatId, formatChatSettings(settings), replyToMessageId);
    await registry.recordEvent("admin_setcooldown");
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
    await registry.recordEvent("admin_approve");
    console.log("telegram_chat_approved", { targetChatId, approvedBy: adminChatId, title: approved?.title });
    return;
  }

  if (parsedCommand.command === "revoke") {
    const revoked = await registry.revokeChat(targetChatId);
    await sendTelegramMessage(
      env,
      adminChatId,
      revoked ? `Revoked chat ${targetChatId}.` : `No approved chat found for ${targetChatId}.`,
      replyToMessageId
    );
    await registry.recordEvent("admin_revoke");
    return;
  }

  const denied = await registry.denyChat(targetChatId);
  await sendTelegramMessage(
    env,
    adminChatId,
    denied ? `Denied chat ${targetChatId}.` : `No pending request found for chat ${targetChatId}.`,
    replyToMessageId
  );
  await registry.recordEvent("admin_deny");
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

function isAdminCommand(command: AgentCommand | undefined): boolean {
  return (
    command === "approve" ||
    command === "deny" ||
    command === "pending" ||
    command === "approved" ||
    command === "revoke" ||
    command === "status" ||
    command === "autosuggest" ||
    command === "setcooldown"
  );
}

function parseOptionalTargetChatId(args: string): number | null {
  const parts = args.trim().split(/\s+/);
  const candidate = parts.length > 1 ? parts[1] : null;
  if (!candidate) return null;
  const parsed = Number.parseInt(candidate, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

