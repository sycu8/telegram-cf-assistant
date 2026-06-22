# telegram-cf-assistant

A Telegram bot assistant for Cloudflare troubleshooting. It reads allowed Telegram chats, maintains a per-chat understanding of the discussion, and replies only when commanded.

## What it does

- Ingests Telegram messages through a Cloudflare Worker webhook.
- Keeps one stateful `ChatIssueAgent` per Telegram chat using the Cloudflare Agents SDK and Durable Object SQLite.
- Continuously updates issue understanding in the background with Workers AI.
- Uses AI Gateway for model observability and response caching.
- Detects Cloudflare products such as Workers, Wrangler, D1, DNS, SSL/TLS, WAF, Cache, R2, KV, Durable Objects, Workers AI, AI Gateway, and Vectorize.
- Replies quickly because Telegram webhooks are acknowledged immediately and work runs in `ctx.waitUntil()`.
- Falls back to deterministic Cloudflare-specific guidance if AI inference is unavailable.

## Architecture

```text
Telegram
  -> Cloudflare Worker /telegram/webhook
  -> ChatIssueAgent Durable Object per chat
  -> Agent state + Durable Object SQLite message log
  -> Workers AI through AI Gateway
  -> Telegram sendMessage
```

## Commands

```text
/cfhelp
/diagnose
/summary
/nextsteps
/sources
/forget
/config
```

The bot stays silent for normal messages and only replies to commands.

## Cloudflare resources

Configured in `wrangler.jsonc`:

- Workers runtime
- Agents SDK
- Durable Objects with SQLite migrations
- Workers AI binding
- AI Gateway request options
- Workers observability

Optional future extensions:

- KV for chat configuration
- D1 for global analytics across chats
- Vectorize for indexed Cloudflare docs and internal runbooks
- Queues for long-running document indexing
- R2 for large logs or screenshots

## Setup

Install dependencies:

```bash
npm install
```

Generate Cloudflare binding types:

```bash
npm run cf-typegen
```

Create local secrets:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`:

```text
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...
ALLOWED_CHAT_IDS=123456789,-1001234567890
BOT_USERNAME=YourBotUsername
```

For production, set secrets with Wrangler:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

Set non-secret variables in `wrangler.jsonc` or the Cloudflare dashboard:

```text
ALLOWED_CHAT_IDS
BOT_USERNAME
ALLOW_ALL_CHATS=false
AI_GATEWAY_ID=default
CHAT_MODEL=@cf/meta/llama-3.1-8b-instruct
SUMMARY_MODEL=@cf/meta/llama-3.1-8b-instruct
ENABLE_BACKGROUND_AI=true
MAX_RECENT_MESSAGES=30
```

## Telegram webhook

After deployment, configure Telegram:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://<your-worker-host>/telegram/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

The Worker validates `X-Telegram-Bot-Api-Secret-Token` before processing updates.

## Development

```bash
npm run dev
npm run check
npm test
```

Deploy:

```bash
npm run deploy
```
