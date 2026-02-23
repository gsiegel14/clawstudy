# Study-Service MVP Build Plan (Current System)

Last updated: February 23, 2026
Owner: Gabe
Status: Build-ready plan

## Execution status (February 23, 2026)

WS-A scaffold implementation completed in repository:

1. Created `study-service` Worker project under `/Applications/clawstudy/study-service`.
2. Implemented canonical MVP endpoints and idempotency enforcement in `/Applications/clawstudy/study-service/src/app.ts`.
3. Implemented deterministic Telegram idempotency key derivation in `/Applications/clawstudy/study-service/src/telegram-idempotency.ts`.
4. Added D1 migration scaffold in `/Applications/clawstudy/study-service/migrations/0001_initial.sql`.
5. Added contract tests for start/answer APIs in `/Applications/clawstudy/study-service/test/contract.test.ts`.
6. Added Telegram webhook adapter and pilot seed endpoint for one-PDF end-to-end validation.
7. Added SMS channel adapter endpoints and Twilio signature validation:
- `POST /v1/channel/sms/webhook`
- `POST /v1/channel/sms/status`
8. Added progress-memory implementation for chapter/PDF/question/topic tracking and weakness scoring:
- additive migration `0002_progress_memory.sql`
- enriched progress endpoint payload (`chapters`, `pdfs`, `questions`, `topics`, `recent_attempts`)

Remaining before WS-A is operationally complete:

1. Provision D1 database ID in `/Applications/clawstudy/study-service/wrangler.jsonc`.
2. Apply migration to D1 and seed FAST chapter questions.
3. Configure `STUDY_SERVICE_TOKEN` and Telegram webhook secrets.
4. Wire gateway calls from deployed `moltworker` (or use direct Telegram webhook pilot first).

## 1) Objective

Implement a production-capable MVP in the current deployed system:

1. SMS user sends `lets start fast` from iPhone Messages.
2. Bot sends question 1 (text-first, image path when enabled).
3. User answers.
4. Bot explains and tracks correctness/progress.

This plan executes requirements from:

1. `/Applications/clawstudy/docs/prd/PRD-11-Telegram-FAST-Loop-MVP.md`
2. `/Applications/clawstudy/docs/prd/PRD-12-Study-Service-MVP-and-Scale.md`
3. `/Applications/clawstudy/docs/prd/PRD-06-Messaging-and-Study-UX.md`

## 2) Current baseline (already in place)

1. Deployed `moltworker` gateway.
2. Telegram secrets configured.
3. SMS provider setup path defined for iPhone Messages delivery.
4. AI Gateway + Workers AI model route configured.
5. Source corpus uploaded to R2 and chapter metadata registered in memory.

## 2.1) Preflight secrets and discovery (required before WS-0)

`setup-low-cost-moltworker.sh` expects these secrets:

1. `CF_AI_GATEWAY_ACCOUNT_ID`
2. `CF_AI_GATEWAY_GATEWAY_ID`
3. `CLOUDFLARE_AI_GATEWAY_API_KEY`
4. `CF_ACCESS_TEAM_DOMAIN`
5. `CF_ACCESS_AUD`

How to find values:

1. AI Gateway endpoint format:
- `https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/compat/...`
- `CF_AI_GATEWAY_ACCOUNT_ID` = `<account_id>`
- `CF_AI_GATEWAY_GATEWAY_ID` = `<gateway_id>`
2. `CLOUDFLARE_AI_GATEWAY_API_KEY`:
- AI Gateway page -> `Create a token` (`cf-aig-authorization` token value)
3. `CF_ACCESS_TEAM_DOMAIN`:
- Cloudflare Zero Trust dashboard domain (example: `myteam.cloudflareaccess.com`)
4. `CF_ACCESS_AUD`:
- Zero Trust Access application audience value (`aud`) for the gateway/admin app

Validation command:

1. `curl "https://api.cloudflare.com/client/v4/user/tokens/verify" -H "Authorization: Bearer <token>"`

## 3) Workstreams

## WS-0: Latency prerequisites (February 24, 2026)

1. Set MVP runtime to warm mode:
- `SANDBOX_SLEEP_AFTER=never`
2. Add webhook latency instrumentation:
- inbound webhook timestamp
- outbound first-question timestamp
3. Define first-question SLA dashboard and alert threshold.

Deliverable:

1. Environment is configured to make `<5s` warm-path first-question possible and measurable.

## WS-A: Study-service scaffold and contracts (February 24, 2026)

1. Create adjacent `study-service` Worker project.
2. Add shared request validation and `Idempotency-Key` middleware.
3. Implement signed gateway-to-study-service auth middleware.
4. Add API contract tests for:
- `POST /v1/quiz/session/start`
- `POST /v1/quiz/session/{session_id}/answer`
5. Implement deterministic idempotency key derivation from Telegram metadata.
6. Implement Telegram identity mapping:
- canonical `user_id = tg:user:{from.id}`
- persist `telegram_user_id` + `telegram_chat_id` on session create.

Deliverable:

1. Running service stub with validated, idempotent write contract.

## WS-B: D1 schema and migrations (February 24, 2026 to February 25, 2026)

1. Add migrations for:
- `source`
- `chunk`
- `question`
- `quiz_session`
- `question_attempt`
- `chapter_progress`
- `idempotency_record`
2. Add deterministic recompute query for chapter progress.

Deliverable:

1. Migration set with integration tests for no-duplicate-attempt guarantees.

## WS-C: Ingestion and image references (February 26, 2026 to February 27, 2026)

1. Implement:
- `POST /v1/sources/upload-url`
- `POST /v1/sources/{source_id}/complete`
- `GET /v1/sources/{source_id}/status`
2. Queue consumer:
- extract text and image references
- chunk and persist
- mark chapter readiness
3. Seed at least 20 FAST questions into cache.
4. Mark chapter ready only when cache depth threshold is met.
5. Implement cache state transitions:
- `question_cache_ready` (`>=20`)
- `question_cache_degraded` (`1-19`)
- `question_cache_empty` (`0`)

Deliverable:

1. FAST chapter transitions to `question_cache_ready`.

## WS-D: Messaging channel orchestration (February 28, 2026 to March 1, 2026)

1. Map SMS/Telegram start intents to `session/start`.
2. Map natural-language variants:
- `lets start fast`
- `question 1`/`q1`
3. Map answer text `A/B/C/D` to `session/answer`.
4. Implement SMS webhook + status callback with signature validation.
5. Implement Telegram image send path (`sendPhoto`) from `image_ref` media.
6. Return:
- correctness
- explanation
- source citation
- running progress
- next question

Deliverable:

1. End-to-end SMS test for 10 consecutive FAST Q/A turns.

## WS-E: Reliability and scale hardening (March 2, 2026 to March 4, 2026)

1. Add queue retry/backoff/dead-letter behavior.
2. Add per-user request throttles and ingest concurrency caps.
3. Add chapter-level readiness and cache depth metrics.
4. Validate two active chapters in parallel sessions.
5. Validate warm-path first-question P95 <= 5 seconds.
6. Validate budget guardrail behavior:
- 75% threshold disables non-essential regeneration
- 90% threshold disables vision generation except ingest retries
- 100% threshold blocks new generation and serves cache-only

Deliverable:

1. MVP reliability gate passed with reproducible test evidence.

## 4) Acceptance tests (must pass)

1. `lets start fast` opens session and returns question payload on SMS.
2. At least one FAST question has an image-capable path with text fallback.
3. Duplicate SMS or Telegram delivery does not duplicate attempt writes.
4. Progress counters equal sum of persisted attempts.
5. Cache fallback works when model provider is unavailable.
6. Warm-path first question is delivered in <= 5 seconds at P95.
7. `lets start fast` and `question 1` intents route correctly across channels.

## 5) Rollout sequence

1. Deploy `study-service` in staging route.
2. Run synthetic FAST loop with seeded data.
3. Enable production routing for one SMS user (iPhone Messages), keep Telegram as fallback.
4. Observe logs/metrics for 24 hours.
5. Expand to full personal usage after clean run.

## 6) Risks and mitigations

1. Risk: figure extraction quality issues.
- Mitigation: fallback to text-only question path and confidence gating.
2. Risk: cost spikes from ingestion bursts.
- Mitigation: queue concurrency caps and schedule windows.
3. Risk: replayed message writes.
- Mitigation: strict `Idempotency-Key` + request hash verification.

## 7) Deliverables checklist

1. PRDs finalized (`PRD-11`, `PRD-12`).
2. Build plan finalized (this document).
3. Backlog linked to plan.
4. Memory log updated with planning milestone.
