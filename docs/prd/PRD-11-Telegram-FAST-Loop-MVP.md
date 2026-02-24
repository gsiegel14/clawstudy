# PRD-11: Telegram FAST Loop MVP

Status: Ready for build
Owner: Gabe
Last updated: February 23, 2026

## 1) Problem statement

The deployed gateway can receive Telegram messages, but the core study experience is not implemented: chapter start command, image-aware question delivery, answer evaluation, explanation, and durable progress tracking.

## 2) Scope

In scope:

1. User command `START FAST` and natural-language variants to begin chapter session.
2. One-question-at-a-time quiz delivery in Telegram.
3. Optional image attachment for figure-based questions.
4. Answer capture, correctness scoring, explanation, and source citation.
5. Progress updates for `correct`, `incorrect`, `accuracy`, and `next question`.
6. First-question latency target for warm path.

Out of scope:

1. Full multi-chapter adaptive planner.
2. Group chats and collaborative sessions.
3. Rich web dashboard UX.

## 3) User flows

1. First-time onboarding:
- User sends first DM to bot.
- If pairing not approved, session is held for admin approval.
- After approval, normal study commands are accepted.
2. Start:
- User sends `START FAST` or natural-language equivalent (example: `lets start fast`).
- Bot resolves chapter alias to `chapter_id=us-01` and opens or resumes a session.
3. Question request:
- Bot sends question stem + `A/B/C/D`.
- Bot attaches image when `question.image_ref` exists.
4. Explicit first question request:
- User sends `question 1` (or `q1`) after session start.
- Bot returns question 1 for active chapter session.
5. Answer:
- User sends `A/B/C/D` (or `1/2/3/4`).
- Bot records attempt idempotently and returns result + explanation.
6. Continue:
- Bot sends updated chapter progress and next question.

## 4) Functional requirements

1. Command resolution:
- Normalize user chapter input to canonical `chapter_id`.
- Support at least `FAST`, `US-01`, and `Chapter 1`.
2. Intent routing:
- A/B/C/D answer input is detected deterministically via `normalizeChoice()` — no LLM call.
- All other text is routed through the LLM planner (`planTelegramAgentRoute`), which maps natural-language input to a `route` value (`start`, `resume`, `question`, `folders`, `folder`, `pdf`, `misses`, `chat`, etc.).
- PDF documents sent to the bot are detected by MIME type and queued for ingest before text handling.
- There is no regex/keyword parser. The LLM handles all natural-language variation.
3. Session handling:
- Maximum one active chapter session per user.
- Resume active session on repeated `START FAST`.
4. Question payload:
- `question_id`, `stem`, `choices[]`, `image_ref` (optional), `source_chunk_ids`.
5. Telegram image delivery contract:
- `image_ref` resolves to R2 object metadata (`bucket`, `key`, `mime_type`).
- Bot sends image via Telegram `sendPhoto` using short-lived signed URL or Telegram file upload.
- Media normalization rules:
  - accepted source formats: `jpeg`, `png`, `webp`
  - convert unsupported formats to `jpeg`
  - enforce max outbound image payload size `<= 9 MB`
- Delivery retry rules:
  - retry failed media send up to 2 times with exponential backoff
  - if retries fail, send text-only question and log a recoverable warning
6. Answer handling:
- Accept letter/number input and map to canonical choice.
- Reject invalid choice with corrective prompt without mutating state.
7. Scoring:
- Deterministic correctness from stored `question.correct_choice`.
- Response includes explanation and source citation.
8. Progress state:
- Persist per-user per-chapter counters:
  - `questions_answered`
  - `questions_correct`
  - `accuracy`
- Return progress after every answer.
9. Idempotency:
- All write operations require `Idempotency-Key`.
- Duplicate Telegram delivery or retries must not double-write attempts.
10. Idempotency key derivation:
- Keys must be deterministic from Telegram metadata and intent:
  - start: `tg:{chat_id}:{message_id}:start:{chapter_id}`
  - first question request: `tg:{chat_id}:{message_id}:q1:{chapter_id}`
  - answer: `tg:{chat_id}:{message_id}:answer:{session_id}:{question_id}`
- If a duplicate key is reused with mismatched request hash, return conflict and do not mutate state.
11. Telegram identity mapping:
- Canonical study `user_id` format is `tg:user:{from.id}`.
- Persist `telegram_user_id={from.id}` and `telegram_chat_id={chat.id}` on session create.
- In MVP, only direct-message chat type is supported for scoring/progress.
- If a message arrives from unsupported chat type, return help prompt and do not mutate state.

## 5) Non-functional requirements

1. Warm-path first-question SLA:
- P95 <= 5.0 seconds from inbound Telegram webhook receipt to first question message send.
2. Cold/wake fallback:
- If container or chapter cache is cold, send immediate status message (`warming up`) within 2 seconds.
- Deliver first question once ready; cold path may exceed 5 seconds.
3. P95 answer turnaround <= 2.5 seconds for cached questions.
4. Message delivery success >= 99%.
5. Session writes remain consistent under retry conditions.

## 6) Safety and privacy requirements

1. Never send secrets, credentials, or internal tokens in bot messages.
2. Keep ACEP credentials out of this flow entirely.
3. Log only required user/session metadata.

## 7) Data contract addenda (aligned with PRD-03)

Required `question_attempt` fields:

1. `attempt_id`
2. `session_id`
3. `question_id`
4. `selected_choice`
5. `is_correct`
6. `response_time_seconds`
7. `idempotency_key`
8. `created_at`

Required `quiz_session` fields:

1. `session_id`
2. `user_id`
3. `chapter_id`
4. `status`
5. `current_question_index`
6. `last_question_id`
7. `created_at`
8. `updated_at`
9. `telegram_user_id`
10. `telegram_chat_id`

Required telemetry fields for SLA validation:

1. `telegram_update_id`
2. `intent`
3. `request_received_at`
4. `first_response_sent_at`
5. `latency_ms`

## 8) Acceptance criteria

1. User completes a 10-question FAST session in Telegram.
2. At least one question includes an image attachment.
3. Duplicate answer retries do not change counters twice.
4. Explanation and citation are returned for every answer.
5. Progress counters match persisted attempts exactly.
6. `lets start fast` and `question 1` intents resolve correctly.
7. Warm-path first-question P95 is <= 5 seconds over 100 synthetic runs.
8. Unsupported Telegram chat types do not mutate session/progress state.
9. Image-send failures degrade to text-only question delivery without session loss.

## 9) Implementation dependencies (required before build start)

1. Telegram webhook route is active for the deployed gateway Worker.
2. AI Gateway endpoint and API token are configured in environment secrets:
- `CF_AI_GATEWAY_ACCOUNT_ID`
- `CF_AI_GATEWAY_GATEWAY_ID`
- `CLOUDFLARE_AI_GATEWAY_API_KEY`
3. Cloudflare Access values are configured for gateway auth:
- `CF_ACCESS_TEAM_DOMAIN`
- `CF_ACCESS_AUD`
4. These values are treated as secrets and never committed to repository files.
