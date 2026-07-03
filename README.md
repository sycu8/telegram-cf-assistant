# telegram-cf-assistant

Telegram assistant for Cloudflare troubleshooting, deployed on Cloudflare Workers and the Cloudflare Agents SDK.

The bot reads messages in approved Telegram chats, keeps a rolling understanding of the discussion, and replies only when someone runs a command such as `/diagnose`.

In approved chats, it can also automatically suggest troubleshooting guidance when it detects that a customer is asking for help or mentioning a likely Cloudflare issue in normal group conversation.

## Live endpoints

```text
Worker:  https://telegram-cf-assistant.sycu-lee.workers.dev
Health:  https://telegram-cf-assistant.sycu-lee.workers.dev/health
Webhook: https://telegram-cf-assistant.sycu-lee.workers.dev/telegram/webhook
Bot:     @cf_assisstant_bot
```

Do not put API tokens, Telegram bot tokens, webhook secrets, or private chat IDs in this README.

## Features

- Telegram webhook ingestion through Cloudflare Workers.
- Per-chat state and message history with `ChatIssueAgent`.
- Approval-based chat onboarding with `AccessRegistry`.
- Workers AI and AI Gateway for Cloudflare-focused answers.
- Curated Cloudflare troubleshooting context with source summaries and product-specific checklists.
- Deterministic fallback guidance when AI is unavailable.
- Secret redaction before storing messages or building AI prompts.
- Fast webhook acknowledgement with background processing.
- Admin approval commands for new groups/channels.
- Conservative auto-suggestions for detected Cloudflare issues, with cooldowns to avoid spam.
- Customer-question detection in English and Vietnamese, including phrases such as "how to", "need help", "làm sao", "sửa lỗi", "khắc phục", and "hướng dẫn".
- Assistant working notes via `conversationNotes` and `openQuestions` so replies can use the broader chat context.
- Per-chat auto-suggestion settings controlled by Telegram admin commands.
- Basic observability counters for messages, commands, approvals, and auto-suggestions.

## Architecture

```text
Telegram
  -> Cloudflare Worker /telegram/webhook
  -> webhook secret validation
  -> AccessRegistry Durable Object
       -> pending/approved chat registry
  -> ChatIssueAgent Durable Object per approved chat
       -> rolling issue state
       -> Durable Object SQLite message log
       -> Workers AI through AI Gateway
  -> Telegram sendMessage
```

## User commands

These commands work in approved chats:

```text
/start
/cfhelp
/diagnose
/summary
/nextsteps
/sources
/forget
/config
```

The bot stays silent for normal messages. It uses those messages only to keep context for the next command.

Exception: if `AUTO_SUGGESTIONS_ENABLED=true`, the bot can proactively reply when it detects either:

- a Cloudflare issue/error signal
- a customer question asking for troubleshooting or fix guidance

```text
My Worker deploys but env.DB is undefined with D1
```

```text
Khách hàng hỏi làm sao sửa lỗi Cloudflare Worker deploy xong nhưng API trả 500?
```

The bot only auto-suggests when the message has Cloudflare product context plus either issue/error language or customer-help intent. It suppresses repeated suggestions using a per-chat cooldown and issue fingerprint.

When it responds automatically, it includes:

- assistant notes from the conversation
- likely issue, confidence, and reply mode
- fix/troubleshooting steps
- missing information to ask the customer for
- relevant Cloudflare docs, source summaries, and product-specific checklist context

## Admin commands

These commands work only from admin chats:

```text
/pending
/approved
/approve <chat_id>
/deny <chat_id>
/revoke <chat_id>
/status
/autosuggest on|off [chat_id]
/setcooldown <seconds> [chat_id]
```

Example:

```text
/approve -1001234567890
/autosuggest off -1001234567890
/setcooldown 300 -1001234567890
```

`/status` reports pending chat count, approved chat count, and event counters such as `message_ingested`, `auto_suggestion_sent`, and command usage.

## Chat approval workflow

The bot is locked down by default:

```text
ALLOW_ALL_CHATS=false
```

Recommended production setup:

```text
ALLOWED_CHAT_IDS=<initial-admin-chat-id>
ADMIN_CHAT_IDS=<admin-chat-id-1>,<admin-chat-id-2>
```

When the bot is added to a new group or channel:

1. Telegram sends a `my_chat_member` update.
2. The Worker stores a pending request in `AccessRegistry`.
3. Admin chats receive an approval message.
4. An admin runs `/approve <chat_id>`.
5. The chat is persistently approved in Durable Object SQLite.

Fallback flow:

1. Add the bot to a chat.
2. Send `/start`.
3. The bot replies with the chat ID and sends an access request to admins.
4. An admin approves the chat.

Approved chats do not need to be manually added to `ALLOWED_CHAT_IDS`.

## Cloudflare resources

Configured in `wrangler.jsonc`:

- Workers runtime
- Agents SDK
- `ChatIssueAgent` Durable Object
- `AccessRegistry` Durable Object
- SQLite-backed Durable Object migrations
- Workers AI binding
- AI Gateway request options
- Workers observability

## Setup

Install dependencies:

```bash
npm install
```

Generate Cloudflare binding types:

```bash
npm run cf-typegen
```

Create local development secrets:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`:

```text
TELEGRAM_BOT_TOKEN=<telegram-bot-token>
TELEGRAM_WEBHOOK_SECRET=<random-webhook-secret>
ALLOWED_CHAT_IDS=<initial-admin-chat-id>
ADMIN_CHAT_IDS=<admin-chat-id>
BOT_USERNAME=<telegram-bot-username>
```

Generate a webhook secret:

```bash
openssl rand -hex 32
```

## Production secrets

Set secrets with Wrangler:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put ALLOWED_CHAT_IDS
npx wrangler secret put ADMIN_CHAT_IDS
npx wrangler secret put BOT_USERNAME
```

Auto-suggestion behavior is configured in `wrangler.jsonc`:

```text
AUTO_SUGGESTIONS_ENABLED=true
AUTO_SUGGESTION_COOLDOWN_SECONDS=900
AUTO_SUGGESTION_MIN_CONFIDENCE=0.65
```

Admins can override auto-suggestion behavior per chat without redeploying:

```text
/autosuggest on
/autosuggest off
/autosuggest off -1001234567890
/setcooldown 300
/setcooldown 900 -1001234567890
```

Set `CLOUDFLARE_API_TOKEN` in the deployment environment, not in the repo:

```bash
export CLOUDFLARE_API_TOKEN=<cloudflare-api-token>
```

Rotate any token that was pasted into chat, logs, issues, or pull requests.

## Telegram webhook

After deployment, register the Telegram webhook:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://telegram-cf-assistant.sycu-lee.workers.dev/telegram/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

Check webhook status:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

The Worker validates `X-Telegram-Bot-Api-Secret-Token` before processing updates.

## Development

```bash
npm run dev
npm run check
npm test
```

## Deploy

Validate first:

```bash
npm test
npm run check
npx wrangler deploy --dry-run
```

Deploy:

```bash
npx wrangler deploy
```

Health check:

```bash
curl https://telegram-cf-assistant.sycu-lee.workers.dev/health
```

## QA documentation

See [`docs/qa-inventory.md`](docs/qa-inventory.md) for:

- feature inventory
- role/route/command/state/workflow acceptance criteria
- risk-based edge cases
- bug log with reproduction evidence
- final validation status
