# Access Reference (Cloudflare, Twilio, Telegram, MCP)

Last updated: February 24, 2026
Owner: Gabe
Status: Operational reference for console paths, service URLs, and secret names (non-secret values only).

## 1) Security boundary

1. This file stores non-secret identifiers and navigation paths only.
2. Never commit or paste live credentials:
- API tokens
- bot tokens
- auth tokens
- API keys
3. If a secret is exposed in chat or logs, rotate it immediately.

## 2) Cloudflare access reference

Console:

1. Dashboard: `https://dash.cloudflare.com/`
2. Workers & Pages: Dashboard -> Workers & Pages
3. Zero Trust Access: `https://one.dash.cloudflare.com/`
4. R2: Dashboard -> R2

Current worker resources:

1. Gateway Worker: `clawstudyme`
2. Gateway URL: `https://clawstudyme.siegel-gabe.workers.dev`
3. Control UI: `https://clawstudyme.siegel-gabe.workers.dev/?token=<MOLTBOT_GATEWAY_TOKEN>`
4. Admin UI: `https://clawstudyme.siegel-gabe.workers.dev/_admin/`
5. Study-service Worker: `clawstudy-study-service`
6. Study-service URL: `https://clawstudy-study-service.siegel-gabe.workers.dev`
7. Active R2 bucket: `clawstudydata`

Runtime variable location (critical):

1. Set runtime auth/storage/model values in:
- Worker -> Settings -> Variables and Secrets
2. Do not put runtime auth values in:
- Worker -> Settings -> Build -> Variables and secrets

Cloudflare Access values:

1. `CF_ACCESS_TEAM_DOMAIN`: current domain is `siegel-gabe.cloudflareaccess.com`
2. `CF_ACCESS_AUD`: copy from Access application "Audience (aud)" field
3. Access app path:
- Zero Trust -> Access -> Applications -> `clawstudyme.siegel-gabe.workers.dev`

Useful verification commands:

```bash
# verify Cloudflare API token
curl "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer <CF_API_TOKEN>"

# verify gateway URL is active (expect Access redirect/302 when not logged in)
curl -I "https://clawstudyme.siegel-gabe.workers.dev"
```

## 3) R2 persistence reference

Current binding state:

1. Gateway binding: `MOLTBOT_BUCKET -> clawstudydata`
2. Runtime value set: `R2_BUCKET_NAME=clawstudydata`

Required runtime secrets for key-based R2 persistence:

1. `R2_ACCESS_KEY_ID`
2. `R2_SECRET_ACCESS_KEY`
3. `CF_ACCOUNT_ID`

Where to get keys:

1. R2 -> Overview -> Manage R2 API Tokens -> Create token
2. Permission: Object Read & Write
3. Scope: bucket `clawstudydata`

Detailed object access instructions:

1. `/Applications/clawstudy/docs/implementation/r2-access-instructions.md`

## 4) Twilio access reference

Console:

1. Home: `https://console.twilio.com/`
2. Numbers: Phone Numbers -> Manage -> Active Numbers
3. Messaging logs: Monitor -> Logs -> Messaging

Worker target and webhook routes:

1. Inbound SMS webhook:
- `https://clawstudy-study-service.siegel-gabe.workers.dev/v1/channel/sms/webhook`
2. Status callback:
- `https://clawstudy-study-service.siegel-gabe.workers.dev/v1/channel/sms/status`

Required secret on `study-service` Worker:

1. `TWILIO_AUTH_TOKEN`

Useful verification commands:

```bash
TWILIO_ACCOUNT_SID="<ACCOUNT_SID>"
TWILIO_AUTH_TOKEN="<AUTH_TOKEN>"

# list active Twilio numbers and webhook config
curl -sS -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/IncomingPhoneNumbers.json?PageSize=50"
```

Detailed launch instructions:

1. `/Applications/clawstudy/docs/implementation/sms-launch-checklist.md`

## 5) Telegram/Discord/Slack token reference

Token sources:

1. Telegram: `@BotFather` -> `/newbot` (token)
2. Discord: Discord Developer Portal -> Application -> Bot -> Token
3. Slack:
- `SLACK_BOT_TOKEN` from OAuth & Permissions (`xoxb-...`)
- `SLACK_APP_TOKEN` from App-Level Tokens (`xapp-...`)

Typical runtime secret names:

1. `TELEGRAM_BOT_TOKEN`
2. `DISCORD_BOT_TOKEN`
3. `SLACK_BOT_TOKEN`
4. `SLACK_APP_TOKEN`

## 6) MCP access (Cloudflare)

Codex config path:

1. `/Users/gabe/.codex/config.toml`

Required config:

```toml
experimental_use_rmcp_client = true

[mcp_servers.cloudflare]
url = "https://mcp.cloudflare.com/mcp"
```

Login command:

```bash
codex -c model_reasoning_effort="high" -c experimental_use_rmcp_client=true mcp login cloudflare
```

Verify connection:

```bash
codex -c model_reasoning_effort="high" mcp list
```

## 7) Worker secret names used in this project

Gateway (`clawstudyme`):

1. `MOLTBOT_GATEWAY_TOKEN`
2. `ANTHROPIC_API_KEY` or AI Gateway equivalent
3. `CF_ACCESS_TEAM_DOMAIN`
4. `CF_ACCESS_AUD`
5. `CF_ACCOUNT_ID`
6. `R2_BUCKET_NAME`
7. `R2_ACCESS_KEY_ID` (if using key-based R2 path)
8. `R2_SECRET_ACCESS_KEY` (if using key-based R2 path)

Study-service (`clawstudy-study-service`):

1. `STUDY_SERVICE_TOKEN`
2. `TELEGRAM_BOT_TOKEN`
3. `TELEGRAM_WEBHOOK_SECRET`
4. `TWILIO_AUTH_TOKEN`
