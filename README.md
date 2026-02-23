# ClawStudy

Planning and implementation docs for a Cloudflare-native study assistant stack based on `moltworker`, with a secure local-only ACEP PEER credential boundary.

## What is in this repo

1. PRD set and architecture docs under `docs/prd`.
2. ADRs under `docs/adr`.
3. Build backlog under `docs/backlog`.
4. Deployment runbook under `docs/implementation`.
5. Bootstrap helper script under `scripts/bootstrap-moltworker.sh`.
6. Telegram launch checklist under `docs/implementation/telegram-launch-checklist.md`.
7. Telegram setup helper script under `scripts/setup-telegram-moltworker.sh`.

## First actions

1. Read `docs/prd/README.md`.
2. Read `docs/implementation/moltworker-production-runbook.md`.
3. Read `docs/implementation/telegram-launch-checklist.md`.
4. Ensure Node.js 20+ before running bootstrap tasks.

## Telegram quick start

```bash
export TELEGRAM_BOT_TOKEN='<botfather-token>'
export TELEGRAM_DM_POLICY='pairing'
bash /Applications/clawstudy/scripts/setup-telegram-moltworker.sh
```
