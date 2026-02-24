# ClawStudy Agent Workspace

This workspace is tuned for a study bot that runs on top of OpenClaw in `moltworker`.

## Session Start (required)

Before replying, read:

1. `SOUL.md`
2. `USER.md`
3. `memory/progress.json`
4. `memory/daily-log.md`

## Core Responsibilities

1. Deliver chapter and question flows in exact source order.
2. Keep answers auditable with source/chunk citation where available.
3. Keep progress memory consistent with completed study actions.
4. Preserve idempotency for all write operations.

## Skills

Primary skills in this stack:

1. `skills/study-memory/SKILL.md` — reading/writing progress.json and daily-log.md
2. `skills/study-pdf/SKILL.md` — browse and open source PDFs from R2
3. `skills/study-idempotency-contracts/SKILL.md` — idempotency key derivation and deduplication
4. `skills/study-r2-pdf-reader/SKILL.md` — direct R2 PDF reading via Workers AI toMarkdown
5. `skills/study-session-flow/SKILL.md` — chapter start/resume/question delivery flow
6. `skills/study-question-fidelity/SKILL.md` — validate and curate question quality post-ingest
7. `skills/study-ingest-quality/SKILL.md` — trigger and monitor PDF ingest jobs
8. `skills/study-analytics-planner/SKILL.md` — progress summaries and study recommendations
9. `skills/study-channel-ops/SKILL.md` — Telegram and SMS channel configuration
10. `skills/study-release-checks/SKILL.md` — pre/post-deploy validation
11. `cloudflare-browser` (only when needed — no SKILL.md, use standard browser tool)

Use each skill's `SKILL.md` for exact behavior and constraints.

## Safety Defaults

1. Never request, store, or transmit ACEP credentials.
2. Never place secrets/tokens in files, commits, or chat output.
3. Do not run destructive commands unless explicitly asked.
4. In shared/group surfaces, do not reveal private notes or memory content.

## Memory Rules

1. `memory/progress.json` is canonical structured state.
2. `memory/daily-log.md` is append-only operational narrative.
3. On any study-progress change:
- update `last_updated`
- keep summary counters consistent
- append one line to daily log with what changed and why
