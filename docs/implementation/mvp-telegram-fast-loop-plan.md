# MVP Plan: Telegram FAST Chapter Quiz Loop

Last updated: February 23, 2026
Owner: Gabe
Status: Ready for execution

Normative requirements source:

1. `/Applications/clawstudy/docs/prd/PRD-11-Telegram-FAST-Loop-MVP.md`
2. `/Applications/clawstudy/docs/prd/PRD-12-Study-Service-MVP-and-Scale.md`

## 1) Target user flow (MVP demo)

Goal: ask the Telegram bot to start FAST chapter study and receive one image-aware question at a time with answer evaluation and progress tracking.

Happy-path demo:

1. User sends: `START FAST` or natural-language variant `lets start fast`.
2. Bot responds with:
- chapter confirmation
- question 1 stem
- choices `A/B/C/D`
- attached chapter image (if relevant figure exists)
3. User sends: `B`
4. Bot responds with:
- correct/incorrect result
- explanation with source citation
- running chapter progress (`correct`, `incorrect`, `accuracy`)
- next question prompt
5. User can explicitly request first question with `question 1` or `q1`.

## 2) How far you are today

Already done:

1. Cloudflare gateway (`moltworker`) is deployed.
2. Telegram channel secrets are configured.
3. Low-cost model route is configured via AI Gateway + Workers AI.
4. PDF source registration and memory helper scripts exist.

Not yet implemented:

1. `study-service` API and D1 schema for source -> chunk -> question -> attempt.
2. Telegram command orchestration for chapter session state.
3. Image-aware question selection from chapter figures/chunks.
4. Durable correctness/progress tracking in D1 and analytics API.

## 3) MVP scope (in/out)

In scope for MVP:

1. One chapter command path: `START FAST`.
2. One active question session per user.
3. Sequential question delivery with optional image attachment.
4. Answer evaluation and explanation response.
5. Correct/incorrect tracking with chapter-level progress.
6. Idempotent write APIs with `Idempotency-Key`.
7. Agent-first intent routing: LLM planner handles all natural-language input; A/B/C/D is the only deterministic fast-path.

Out of scope for MVP:

1. Full adaptive weekly planner.
2. Multi-user cohort analytics.
3. Advanced review queue UI.
4. OCR-heavy scanned PDF recovery beyond baseline parsing.

## 4) Architecture boundaries (scalable-by-default)

1. `moltworker` (gateway/chat transport):
- receives Telegram messages
- performs auth/pairing
- forwards study intents to `study-service`
2. `study-service` (new Worker):
- ingestion orchestration
- question generation/selection
- answer scoring and progress updates
3. D1:
- source, chunk, question, attempt, topic mastery, session state
4. R2:
- source PDFs and extracted figure assets
5. Queue:
- async ingestion + question pre-generation jobs

Boundary rule:

1. Keep study-specific behavior in `study-service` and adjacent scripts.
2. Keep `moltworker` changes minimal and additive.

## 5) API contract slice for MVP

All write endpoints require:

1. `Idempotency-Key` header
2. `schema_version` in request/response

Endpoints:

1. `POST /v1/sources/upload-url`
2. `POST /v1/sources/{source_id}/complete`
3. `GET /v1/sources/{source_id}/status`
4. `POST /v1/quiz/session/start`
- input: `chapter_id`, `user_id`
- output: `session_id`, first `question`
5. `POST /v1/quiz/session/{session_id}/answer`
- input: `question_id`, `selected_choice`
- output: correctness, explanation, citation, progress summary, `next_question`
6. `GET /v1/progress/{user_id}?chapter_id=us-01`

## 6) D1 minimum schema for the FAST loop

1. `source` (`id`, `chapter_id`, `object_key`, `status`, timestamps)
2. `chunk` (`id`, `source_id`, `chunk_index`, `text`, `topic_tag`, `image_refs_json`)
3. `question` (`id`, `chapter_id`, `source_chunk_ids_json`, `stem`, `choices_json`, `correct_choice`, `explanation`, `image_ref`, `quality_score`)
4. `quiz_session` (`id`, `user_id`, `chapter_id`, `status`, `current_question_index`, timestamps)
5. `question_attempt` (`id`, `session_id`, `question_id`, `selected_choice`, `is_correct`, `response_time_seconds`, timestamps)
6. `chapter_progress` (`user_id`, `chapter_id`, `answered`, `correct`, `accuracy`, `last_question_at`, `next_review_at`)
7. `idempotency_record` (`idempotency_key`, `endpoint`, `request_hash`, `response_json`, `status_code`, `expires_at`)

## 7) Image-aware question behavior (PDF figures)

1. In ingestion, extract and store figure metadata per chunk (`image_ref`, page number, caption text if available).
2. Prefer questions with `image_ref` for image-rich chapters (FAST included).
3. If no figure exists for selected chunk, send text-only question without failing session.
4. Keep model routing split:
- ingestion/image interpretation path: vision-capable model
- normal explanation/evaluation path: lower-cost text model when image not required

## 8) Scale strategy for books and chapters

1. Namespace sources by `book_id/chapter_id` and immutable source version.
2. Make chunking and question generation fully asynchronous via Queue consumers.
3. Pre-generate N questions per chapter and maintain warm cache.
4. Add chapter-level readiness state:
- `registered`
- `uploaded`
- `ingested`
- `question_cache_ready`
5. Route runtime quiz requests only to chapters with `question_cache_ready=true`.
6. Keep strict idempotency tables to make retries safe under scale.

## 9) Execution timeline (explicit dates)

Latency prerequisite:

1. Set `SANDBOX_SLEEP_AFTER=never` for MVP validation window.
2. Validate warm-path first-question P95 <= 5 seconds before generalizing to broader chapter rollout.

## Milestone A: FAST loop backend skeleton (February 24, 2026 to February 25, 2026)

1. Create `study-service` Worker scaffold.
2. Add D1 migrations for core quiz tables.
3. Implement `session/start` and `session/answer` endpoints with idempotency middleware.

Exit criteria:

1. Local/integration test can start FAST session and submit answer with deterministic response.

## Milestone B: PDF chapter ingestion + image refs (February 26, 2026 to February 27, 2026)

1. Implement upload/complete/status endpoints.
2. Ingest FAST PDF into chunks with image references.
3. Seed first 20 FAST questions into D1.

Exit criteria:

1. FAST chapter marked `question_cache_ready`.
2. At least 5 seeded questions include `image_ref`.

## Milestone C: Telegram command bridge (February 28, 2026 to March 1, 2026)

1. Map `START FAST` to `session/start`.
2. Map natural-language variants (`lets start fast`, `question 1`, `q1`) to session commands.
3. Map answer messages (`A/B/C/D`) to `session/answer`.
4. Return explanation + running progress after every answer.

Exit criteria:

1. End-to-end Telegram test passes for 10 consecutive Q/A turns.

## Milestone D: Reliability and scale hardening (March 2, 2026 to March 4, 2026)

1. Add retry tests and dead-letter handling.
2. Add per-user rate limits and queue concurrency caps.
3. Add progress dashboard endpoint and daily summary job.

Exit criteria:

1. Two chapters can run concurrently without duplicate writes.

## 10) MVP definition of done

1. User can run `START FAST` and complete a 10-question session in Telegram.
2. Each answer receives correctness + rationale + citation.
3. Correct/incorrect counts and chapter accuracy persist in D1.
4. At least one question in session includes a chapter image.
5. All write calls prove idempotent behavior in tests.

## 11) Risks and controls

1. Risk: image extraction quality variance across PDFs.
- Control: fallback text-only question path and low-confidence chunk filtering.
2. Risk: duplicate attempts on Telegram retries.
- Control: `Idempotency-Key` on dispatch/answer writes + request hash validation.
3. Risk: cost spikes during mass ingestion.
- Control: queue concurrency caps, warm question cache, model split for vision vs text.
