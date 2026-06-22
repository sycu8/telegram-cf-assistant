import type { TelegramUpdate } from "../../src/types";

const CHAT_ID = -1001234567890;
const BASE_DATE = 1782171000;

export const productionLikeTelegramUpdates = {
  d1BindingDiscussion: [
    messageUpdate(1001, "Alice", "alice", "Deploy passed but the Worker runtime says env.DB is undefined."),
    messageUpdate(
      1002,
      "Ben",
      "ben",
      "wrangler.jsonc has binding = \"DATABASE\" for D1, code uses env.DB. API key: sk-test-sanitized"
    ),
    messageUpdate(1003, "Alice", "alice", "/diagnose@CfHelperBot")
  ],
  sslRedirectDiscussion: [
    messageUpdate(2001, "Ops", "ops", "Cloudflare SSL started showing ERR_TOO_MANY_REDIRECTS after origin HTTPS redirect."),
    messageUpdate(2002, "Ops", "ops", "/nextsteps")
  ],
  unauthorizedChat: messageUpdate(3001, "Mallory", "mallory", "/diagnose", 987654321),
  commandForOtherBot: messageUpdate(4001, "Alice", "alice", "/diagnose@OtherHelperBot"),
  unknownMessageShape: { update_id: 5001 } satisfies TelegramUpdate
};

function messageUpdate(
  messageId: number,
  firstName: string,
  username: string,
  text: string,
  chatId = CHAT_ID
): TelegramUpdate {
  const chat = {
    id: chatId,
    type: chatId < 0 ? "supergroup" : "private",
    ...(chatId < 0 ? { title: "Sanitized Cloudflare Support Room" } : {})
  };

  return {
    update_id: messageId,
    message: {
      message_id: messageId,
      date: BASE_DATE + messageId,
      text,
      from: {
        id: messageId,
        first_name: firstName,
        username
      },
      chat
    }
  };
}
