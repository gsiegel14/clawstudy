# PRD-12: Study-Service MVP and Scale

Status: Ready for build
Owner: Gabe
Last updated: February 23, 2026

## 1) Problem statement

Current infrastructure is deployed, but study logic is not yet implemented as a scalable service. A dedicated `study-service` must deliver chapter-based quiz orchestration for Telegram now and scale cleanly to many books/chapters in PDF form.

## 2) Scope

In scope:

1. `study-service` Worker as adjacent system to `moltworker`.
2. D1-backed source/chunk/question/session/attempt/progress model.
3. R2-backed source and figure asset lifecycle.
4. Queue-based ingestion and question cache generation.
5. Signed gateway-to-service calls and idempotent write APIs.

Out of scope:

1. Large-scale crawl of arbitrary public web content.
2. Custom mobile application.
3. Multi-region active-active topology.

## 3) Architecture requirements

1. Keep `moltworker` transport-focused:
- user auth/pairing
- command capture
- forwarding to `study-service`
2. Keep study domain logic in `study-service`:
- ingestion
- question generation/selection
- answer scoring
- progress update
3. Persist canonical state in D1 and immutable assets in R2.
4. Use Queue consumers for asynchronous heavy work.
5. Keep runtime quiz path cache-first:
- no synchronous question generation during `session/start` for chapter-ready paths.

## 4) Functional requirements

1. Ingestion readiness pipeline:
- `registered -> uploaded -> ingested -> question_cache_ready`
2. Chapter-scoped question cache:
- pre-generate chapter inventory
- serve runtime questions from cache first
3. Answer write pipeline:
- idempotent attempt record
- chapter progress recompute
- session pointer advance
4. Chapter and book scaling:
- support hierarchical keys (`book_id`, `chapter_id`, `source_version`)
- maintain chapter readiness independent per source version
5. Channel intent support:
- `start fast` variants
- explicit first question requests (`question 1`, `q1`)
- answer intents (`A/B/C/D`, `1/2/3/4`)
6. SMS transport support:
- Twilio webhook ingestion (`/v1/channel/sms/webhook`)
- Twilio delivery status callback (`/v1/channel/sms/status`)
- deterministic SMS idempotency keys from `From` + `MessageSid`
- TwiML response path for immediate inbound-reply loop
7. Media pipeline:
- persist `image_ref` metadata per question
- resolve and deliver Telegram-compatible photo payload from R2-backed assets
- fallback to text-only delivery on media failure without dropping session state
8. Cache depletion behavior:
- cache state machine per chapter:
  - `question_cache_ready`: `>= 20` ready questions
  - `question_cache_degraded`: `1-19` ready questions
  - `question_cache_empty`: `0` ready questions
- `session/start` must never synchronously generate questions.
- On `question_cache_degraded`, serve available cached questions and enqueue async refill.
- On `question_cache_empty`, return warming response, enqueue refill, and retry on next user request.

## 5) Scalability requirements

1. Support at least:
- 10 books
- 300 chapters
- 10,000 cached questions
2. Queue workers must be concurrency-limited and retry-safe.
3. Runtime quiz endpoints should avoid heavy model calls when cache is warm.
4. Rebuild and reindex should be chapter-granular, not global.
5. Cache inventory target:
- maintain minimum chapter cache depth threshold (example: 20 ready questions/chapter).
6. Runtime first-question SLA target:
- warm chapter-ready path P95 <= 5.0 seconds from webhook receipt to outbound Telegram question message.

## 6) API contract requirements (aligned with PRD-03)

Mandatory endpoint set:

1. `POST /v1/sources/upload-url`
2. `POST /v1/sources/{source_id}/complete`
3. `GET /v1/sources/{source_id}/status`
4. `POST /v1/quiz/session/start`
5. `POST /v1/quiz/session/{session_id}/answer`
6. `GET /v1/progress/{user_id}`
7. `GET /v1/analytics/dashboard`
8. `POST /v1/channel/sms/webhook`
9. `POST /v1/channel/sms/status`

Rules:

1. All write endpoints enforce `Idempotency-Key`.
2. Strict schema validation with typed error responses.
3. Response payload includes `schema_version`.
4. Telegram idempotency key derivation is deterministic from update metadata:
- start: `tg:{chat_id}:{message_id}:start:{chapter_id}`
- first-question request: `tg:{chat_id}:{message_id}:q1:{chapter_id}`
- answer: `tg:{chat_id}:{message_id}:answer:{session_id}:{question_id}`
5. Replayed key with mismatched request hash returns conflict and does not mutate state.

## 7) Cost and reliability requirements

1. Split model routing:
- vision-capable model only for image-required tasks
- cheaper text model for standard evaluation/explanation
2. Set queue concurrency and daily generation caps.
3. Baseline budget guardrails (aligned with `PRD-09`):
- monthly AI+gateway ceiling: `$40.00`
- daily model spend cap: `$1.50`
- daily text-token cap: `500,000`
- daily vision-token/page-processing cap: `25,000 token-equivalent`
4. Budget-triggered downgrade rules:
- at 75% monthly usage: disable non-essential regeneration jobs; keep runtime cache-only
- at 90% monthly usage: disable vision generation except active ingest retries
- at 100% monthly usage: block new generation and serve cached questions only
5. Retry with exponential backoff and dead-letter queue for repeated failures.
6. Maintain cached question fallback when model provider fails.
7. MVP latency mode:
- run gateway warm for MVP (`SANDBOX_SLEEP_AFTER=never`) until first-question SLA is proven stable.
- if sleep policy is re-enabled later, implement keep-warm ping schedule and monitor cold-start rate.

## 8) Security requirements

1. Gateway-to-study-service requests use signed service token and timestamp window.
2. Reject stale/replayed signatures and duplicate idempotency keys with mismatched body hashes.
3. Keep ACEP credentials outside cloud services and logs.
4. Signed URL usage for image media must be short-lived and never logged in plaintext.

## 9) Operational requirements

1. Emit audit events for:
- source state transitions
- question generation failures
- attempt writes
- progress recomputes
2. Publish daily metrics:
- ingest success/failure
- question cache depth
- answer accuracy by chapter
- cost indicators
3. Publish latency metrics:
- webhook received timestamp
- first question sent timestamp
- end-to-end first-question latency distribution

## 10) Acceptance criteria

1. FAST loop works end-to-end in Telegram with image-capable questions.
2. At least two chapters can run concurrently with isolated session/progress state.
3. Ingestion retries produce no duplicate chunks or attempts.
4. Runtime path remains functional when model provider is unavailable (cache fallback).
5. Monthly spend guardrails and downgrade behavior are testable and documented.
6. Warm-path first-question P95 <= 5 seconds over defined synthetic test window.
7. Cache state transitions (`ready`, `degraded`, `empty`) are observable and enforce runtime behavior without synchronous generation.

## 11) Build-start dependencies

1. Gateway environment has all required auth and routing secrets configured:
- `CF_AI_GATEWAY_ACCOUNT_ID`
- `CF_AI_GATEWAY_GATEWAY_ID`
- `CLOUDFLARE_AI_GATEWAY_API_KEY`
- `CF_ACCESS_TEAM_DOMAIN`
- `CF_ACCESS_AUD`
2. Telegram webhook route is live and forwarded to deployed `moltworker`.
3. FAST chapter source exists in R2 and can transition to `question_cache_ready` through ingest jobs.
4. All required secret values remain outside repository and logs.
