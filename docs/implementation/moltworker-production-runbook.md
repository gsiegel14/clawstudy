# Moltworker Production Runbook (Study System)

Last updated: February 23, 2026
Scope: Deploy `cloudflare/moltworker` as Cloudflare-native gateway and attach study-specific services.

## 0) Prerequisites

1. Node.js 20+ (Node 22 preferred).
2. npm, wrangler CLI, openssl, and git.
3. Cloudflare account with Workers Paid plan enabled.

## 1) Target deployment model

1. Gateway plane: `moltworker` in Cloudflare Sandbox.
2. Study plane: separate Worker API for ingestion, scheduling, and analytics.
3. Storage: R2 for gateway persistence + source artifacts, D1 for study records.
4. Messaging: Telegram first; optional SMS later.
5. PEER data: local-only sync bridge uploads signed summary payloads.

## 2) Repo and version policy

1. Upstream repo path: `/Applications/clawstudy/moltworker`.
2. Pin deployment to a tested commit hash before exam week.
3. Keep local customization in wrapper scripts/config, not deep source forks unless required.

## 3) Security baseline (must-pass)

1. Enable Cloudflare Access for admin endpoints.
2. Set `MOLTBOT_GATEWAY_TOKEN` as a strong random secret.
3. Use `wrangler secret put` for all credentials.
4. Enable device pairing and approve only known devices.
5. Keep ACEP credentials out of cloud and gateway config.

## 4) Secrets matrix

Required:

1. `MOLTBOT_GATEWAY_TOKEN`
2. `CF_ACCESS_TEAM_DOMAIN`
3. `CF_ACCESS_AUD`
4. One model provider key path:
- `ANTHROPIC_API_KEY`, or
- AI Gateway credentials

Optional but recommended:

1. `R2_ACCESS_KEY_ID`
2. `R2_SECRET_ACCESS_KEY`
3. `CF_ACCOUNT_ID`
4. `TELEGRAM_BOT_TOKEN`
5. `SANDBOX_SLEEP_AFTER` (example: `10m`)

## 5) First deployment checklist

1. Install deps and deploy gateway:
```bash
cd /Applications/clawstudy/moltworker
npm install
npm run deploy
```
2. Set required secrets:
```bash
cd /Applications/clawstudy/moltworker
openssl rand -hex 32 | npx wrangler secret put MOLTBOT_GATEWAY_TOKEN
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN
npx wrangler secret put CF_ACCESS_AUD
npx wrangler secret put ANTHROPIC_API_KEY
```
3. Enable admin access policy in Cloudflare Access.
4. Verify admin UI auth and device pairing flow.
5. Configure R2 secrets and confirm backup timestamp in admin UI.

## 6) Study-service integration plan

1. Create separate Worker service `study-service`.
2. Add endpoints:
- `POST /v1/peer/summary`
- `POST /v1/quiz/dispatch`
- `POST /v1/quiz/answer`
- `GET /v1/analytics/dashboard`
3. Use signed calls between gateway and study service.
4. Persist attempts/mastery in D1.
5. Schedule daily dispatch using cron in study service.

## 7) ACEP PEER boundary

1. PEER login and credentials stay local in browser/password manager.
2. Local script captures summary only: topic, correct/total, time.
3. Script sends signed payload to `study-service`.
4. Reject unsigned or stale payloads.

## 8) Pre-exam hardening (March 24 to March 30)

1. Pin commit hash and freeze upgrades.
2. Run 7-day continuous dispatch reliability check.
3. Run restore drill from R2 + D1 export.
4. Rotate tokens and confirm service health.
5. Enable low-risk mode: prefer cached question bank if model failures spike.

## 9) Rollback plan

1. Disable cron dispatch.
2. Revert to last pinned gateway commit.
3. Use cached questions and manual schedule fallback.
4. Re-enable after health checks pass.
