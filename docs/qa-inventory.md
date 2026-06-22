# Production-readiness QA inventory

This document records the local, sanitized production-scale QA pass for the Telegram Cloudflare assistant.

No production systems, real Telegram chats, sensitive data, or destructive actions were used. Test data lives in `test/fixtures/telegram-updates.ts` and uses synthetic chat IDs, users, tokens, and issue text.

## Sanitized production-like data

Fixture coverage:

- D1/Workers/Wrangler binding mismatch discussion with a sanitized API-key-like value.
- SSL/TLS redirect loop discussion.
- Unauthorized chat command attempt.
- Command addressed to another bot.
- Telegram update with no message payload.
- High-volume local message stream for state-window limits.
- Long assistant response for Telegram message chunking.

Production-like settings covered locally:

- `ALLOW_ALL_CHATS=false`
- allowlisted negative supergroup chat IDs
- Telegram webhook secret header validation
- background-friendly webhook acknowledgement path
- Workers AI configured through `AI_GATEWAY_ID`, `CHAT_MODEL`, and `SUMMARY_MODEL`
- `MAX_RECENT_MESSAGES` retention window behavior

## Roles

| Role | User-facing permissions | Acceptance criteria | Edge cases |
|---|---|---|---|
| Allowed Telegram user in an allowlisted chat | Can have normal messages ingested and can invoke commands | Normal messages are stored silently; commands receive replies | Group command addressed to another bot must be ignored |
| Telegram user in a non-allowlisted chat | No interaction | Updates are ignored and no reply is sent | Private chat not in `ALLOWED_CHAT_IDS` |
| Bot operator | Configures Worker vars/secrets and webhook | Secrets are not committed; README documents setup | Missing webhook secret fails closed |

## Routes

| Route | Acceptance criteria | Edge cases tested |
|---|---|---|
| `GET /health` | Returns service health JSON | Covered by documented inventory; deploy dry-run validates route bundle |
| `POST /telegram/webhook` | Requires `X-Telegram-Bot-Api-Secret-Token`, validates JSON update, then acknowledges before background processing | Missing secret, malformed JSON, missing `update_id`, update without message |
| Agent routes under `/agents/...` | Routed by Agents SDK without wrapping responses | Wrangler dry-run validates Agent export and Durable Object binding |
| Unknown routes | Return JSON 404 | Covered by documented inventory; no public action |

## Commands

| Command | Acceptance criteria | Edge cases tested |
|---|---|---|
| `/start` | Shows help | Newly added alias |
| `/cfhelp`, `/help` | Shows command list | Bot username targeting respected |
| `/diagnose` | Returns likely issue, confidence, why, next steps, missing info, and sources | Low-context fallback; D1 binding mismatch |
| `/summary` | Summarizes topic, products, symptoms, causes, and missing info | No-context fallback |
| `/nextsteps` | Returns prioritized action list | SSL/TLS redirect loop |
| `/sources` | Returns relevant Cloudflare docs | Default source fallback when product unclear |
| `/forget` | Clears per-chat state and message log | Not destructive outside the current chat Agent |
| `/config` | Reports non-secret runtime configuration | Does not expose Telegram token or webhook secret |

## Buttons, inputs, modals

The current bot has no Telegram inline buttons, form inputs, or modals. The only user input is Telegram message text/caption and slash commands.

Acceptance criteria:

- Unsupported media-only updates are ignored.
- Captions are treated as message text.
- Long replies are split before calling Telegram `sendMessage`.

## States

| State | Acceptance criteria | Edge cases tested |
|---|---|---|
| Initial empty state | Commands report insufficient context where appropriate | `/diagnose` and `/summary` no-context fallbacks |
| Active issue state | Products, symptoms, suspected causes, missing info, next steps, sources, and recent messages update deterministically | D1, SSL/TLS, Workers, Wrangler |
| Background AI-enhanced state | AI updates merge into deterministic state without requiring AI for correctness | AI failures fall back to deterministic responses |
| Forgotten state | State returns to initial values and message log is cleared | `/forget` flow implemented |
| High-volume state | `messageCount` keeps total while `recentMessages` is capped | 50-message stream capped to 12 in tests |

## Workflows

| Workflow | Acceptance criteria | Edge cases tested |
|---|---|---|
| Normal chat ingestion | Allowed chat messages update Agent state and do not reply | Product detection and redaction tests |
| Command reply | Command is ingested, state is read, sources selected, AI answer attempted, fallback returned if needed | D1 diagnosis, no-context fallback |
| Unauthorized chat | Chat is ignored before Agent lookup or reply | Synthetic unauthorized chat fixture |
| Webhook validation | Bad secrets and bad payloads fail before background work | Missing header, malformed JSON, missing `update_id` |
| Secret handling | Secrets are redacted before state/prompt storage | Bearer token, API key, generic secret, private key |
| Long response send | Telegram sends multiple chunks under message limit | 8001-character response splits into 3 calls |

## Bug log and reproduction evidence

### BUG-001: Bot could respond to commands addressed to another bot when `BOT_USERNAME` was unset

- Reproduction: `parseCommand("/diagnose@OtherBot")` returned a command when `BOT_USERNAME` was undefined.
- Risk: Group bot could answer commands intended for a different bot.
- Fix: Targeted commands are ignored unless `BOT_USERNAME` is configured and matches.
- Regression: `test/telegram.test.ts` covers targeted commands with and without `BOT_USERNAME`.

### BUG-002: `/start` was not supported

- Reproduction: Telegram users commonly start bots with `/start`, but command aliases did not include it.
- Risk: First-run user experience looked broken.
- Fix: Added `/start` alias to help.
- Regression: `test/telegram.test.ts` covers `/start`.

### BUG-003: Malformed Telegram JSON could throw during webhook handling

- Reproduction: Valid webhook secret with body `{not-json` caused JSON parsing to throw.
- Risk: Client error could surface as runtime exception instead of a controlled 400.
- Fix: Added `parseTelegramUpdate()` helper and 400 response path.
- Regression: `test/routes.test.ts` covers malformed JSON and missing `update_id`.

### BUG-004: `API key:` with a space was not redacted

- Reproduction: Production-like fixture text `API key: sk-test-sanitized` remained in recent message state.
- Risk: User-provided secrets could be stored or included in AI prompts.
- Fix: Broadened redaction regex to cover `api key`, `api_key`, and `api-key`.
- Regression: `test/issue.test.ts` covers the fixture and common sensitive values.

### BUG-005: Test environment attempted to import Cloudflare runtime-only modules in Node

- Reproduction: Importing the Worker entrypoint in Node Vitest failed on `cloudflare:` imports from the Agents runtime.
- Risk: Route-adjacent QA would be blocked or flaky.
- Fix: Extracted pure webhook payload parsing to `src/webhook.ts` and tested security/payload behavior without importing runtime-only modules.
- Regression: `test/routes.test.ts` covers webhook validation helpers.

## Shared causes and coherent fixes

Shared causes:

- Runtime-specific code was coupled to pure request validation.
- Command targeting rules were permissive when optional bot config was missing.
- Sanitization patterns did not cover common human phrasing.

Coherent fixes:

- Separated webhook payload validation into a pure module.
- Tightened Telegram command targeting.
- Added `/start` to match Telegram user expectations.
- Expanded sanitizer coverage.
- Added production-like fixtures and regression tests across the shared helper boundaries.

## Final rerun status

Clean pass:

- `npm test`
- `npm run check`
- `npx wrangler deploy --dry-run`

Known blocked/not executed:

- No production Telegram webhook registration was performed.
- No real Telegram chats were contacted.
- No production Cloudflare resources or sensitive data were accessed.
