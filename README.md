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
8. PDF upload implementation plan under `docs/implementation/pdf-upload-plan.md`.
9. Low-cost AI setup helper script under `scripts/setup-low-cost-moltworker.sh`.
10. FAST chapter Telegram MVP plan under `docs/implementation/mvp-telegram-fast-loop-plan.md`.
11. Study-service MVP build plan under `docs/implementation/study-service-mvp-build-plan.md`.
12. New PRDs for FAST loop + scale architecture under `docs/prd/PRD-11-Telegram-FAST-Loop-MVP.md` and `docs/prd/PRD-12-Study-Service-MVP-and-Scale.md`.
13. Agent operating guide under `AGENTS.md`.
14. Study progress memory under `memory/`.
15. Study bot workspace policy and skills under `moltworker/workspace` and `moltworker/skills`.
16. Study-service Worker scaffold and contract tests under `study-service/`.
17. One-PDF end-to-end pilot setup script under `scripts/setup-one-pdf-pilot.sh`.
18. SMS launch checklist for iPhone Messages under `docs/implementation/sms-launch-checklist.md`.
19. Twilio PDF image-association review under `docs/implementation/twilio-pdf-image-association-review.md`.
20. PDF image/question mapping script under `scripts/review-pdf-image-question-map.sh`.
21. ACEP paired-source question generation pathway under `docs/implementation/acep-course-question-pathway.md`.
22. ACEP upload and pair tracking manifests under `memory/acep-course-*.{csv,tsv,json}`.

## First actions

1. Read `docs/prd/README.md`.
2. Read `docs/implementation/moltworker-production-runbook.md`.
3. Read `docs/implementation/telegram-launch-checklist.md`.
4. Ensure Node.js 20+ before running bootstrap tasks.
5. Read `docs/implementation/pdf-upload-plan.md` before building ingestion endpoints.
6. Use `memory/progress.json` + `memory/daily-log.md` to track chapter/question progress.
7. Execute `docs/implementation/mvp-telegram-fast-loop-plan.md` for the `START FAST` Telegram loop.
8. Execute `docs/implementation/study-service-mvp-build-plan.md` to build in the current deployed system.
9. Execute `docs/implementation/sms-launch-checklist.md` to switch to iPhone Messages (SMS) transport.

## Current status (February 23, 2026)

1. Active deployed worker: `clawstudyme`.
2. Active R2 bucket binding in deployed worker: `clawstudydata`.
3. Source corpus upload complete: 18 Emergency and Clinical Ultrasound PDFs.
4. Uploaded prefix: `sources/emergency-clinical-ultrasound/`.
5. Upload audit manifest: `memory/uploaded-sources-emergency-ultrasound-2026-02-23.csv`.
6. ACEP Course upload complete: `23` handout+lecture pairs (`46` PDFs) under `sources/acep-course-2026/pairs/`.
7. ACEP pair manifest: `memory/acep-course-pairs-manifest-2026-02-23.csv`.
8. ACEP question progress tracker: `memory/acep-course-question-progress-2026-02-23.csv`.

## Low-cost model quick start

```bash
bash /Applications/clawstudy/scripts/setup-low-cost-moltworker.sh
```

## Telegram quick start

```bash
export TELEGRAM_DM_POLICY='pairing'
bash /Applications/clawstudy/scripts/setup-telegram-moltworker.sh
```

## SMS quick start

```bash
cd /Applications/clawstudy/study-service
source ~/.nvm/nvm.sh && nvm use 22
npx wrangler secret put TWILIO_AUTH_TOKEN
npx wrangler deploy
```
