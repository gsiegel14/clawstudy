# Study Service (MVP)

Cloudflare Worker service for study-domain APIs used by `moltworker`.

## Scope in this scaffold

1. Canonical MVP endpoints from `PRD-12`.
2. `Idempotency-Key` enforcement for write endpoints.
3. Deterministic Telegram idempotency key derivation utility.
4. D1-backed persistence contract with migration SQL.
5. Contract tests for `session/start` and `session/answer`.
6. Telegram webhook adapter for `lets start fast` + `question 1` + `A/B/C/D`.
7. One-PDF pilot seed endpoint.
8. Telegram image delivery (`sendPhoto`) with text-description fallback when image retrieval/send fails.
9. Progress memory rollups for chapter, PDF, question, topic mastery, and recent attempts.

## Endpoints

1. `POST /v1/sources/upload-url`
2. `POST /v1/sources/{source_id}/complete`
3. `GET /v1/sources/{source_id}/status`
4. `POST /v1/quiz/session/start`
5. `POST /v1/quiz/session/{session_id}/answer`
6. `GET /v1/progress/{user_id}`
7. `GET /v1/analytics/dashboard`
8. `POST /v1/admin/seed/fast-pilot`
9. `POST /v1/telegram/webhook`

## Local setup

```bash
cd /Applications/clawstudy/study-service
npm install
npm run typecheck
npm test
```

## D1 setup

1. Create a D1 database.
2. Replace `database_id` in `/Applications/clawstudy/study-service/wrangler.jsonc`.
3. Apply migrations:
- `/Applications/clawstudy/study-service/migrations/0001_initial.sql`
- `/Applications/clawstudy/study-service/migrations/0002_progress_memory.sql`

Example:

```bash
cd /Applications/clawstudy/study-service
npx wrangler d1 execute clawstudy-study --file migrations/0001_initial.sql
npx wrangler d1 execute clawstudy-study --file migrations/0002_progress_memory.sql
```

## Secrets/vars

1. `STUDY_SERVICE_TOKEN` (optional but recommended) for service-to-service auth via `x-study-service-token`.
2. `SCHEMA_VERSION` default `1.0.0`.
3. `TELEGRAM_BOT_TOKEN` for Telegram webhook responses.
4. `TELEGRAM_WEBHOOK_SECRET` optional Telegram webhook header validation.

Set secret:

```bash
cd /Applications/clawstudy/study-service
npx wrangler secret put STUDY_SERVICE_TOKEN
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

## One-PDF end-to-end pilot

Use the root helper script:

```bash
bash /Applications/clawstudy/scripts/setup-one-pdf-pilot.sh
```

## Image behavior (Telegram and SMS)

1. If a question has `image_ref`, Telegram attempts `sendPhoto` with the question text as caption.
2. If image retrieval/send fails, Telegram falls back to text and includes an `Image description:` line derived from explanation/stem context.
3. SMS remains text-first and includes `Image description:` when `image_ref` is present.

## Progress memory behavior

1. `GET /v1/progress/{user_id}` now returns:
- chapter rollups (`chapters[]`)
- per-PDF rollups (`pdfs[]`)
- per-question rollups (`questions[]`)
- topic mastery/weakness ranking (`topics[]`)
- immutable recent attempt history (`recent_attempts[]`)
2. `GET /v1/analytics/dashboard?user_id=<id>` includes weak-topic and weak-PDF snapshots when `user_id` is provided.
3. Answer feedback is now explanation-first with deeper chapter context pulled from `source_chunk_ids` when available.
