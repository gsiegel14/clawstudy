# PRD-13: PDF Question, Answer, and Image Delivery Pipeline (Production)

Status: Ready for build
Owner: Gabe
Last updated: February 24, 2026

## 1) Problem statement

Moltbot needs a reliable production pipeline that can ingest PDFs, store source-authored questions and answers when present, generate questions when authored questions are absent, preserve question-image associations, and deliver question content to phone channels.

Current risk:

1. Some PDFs ingest partially due to formatting variance.
2. Question count can be lower than source chapter count without explicit readiness gates.
3. Image references can be missing if conversion output is inconsistent.
4. Missing source/media objects in R2 can silently degrade phone delivery quality.

## 2) Goal

Build a Cloudflare-native, low-cost, future-proof pipeline that guarantees:

1. Durable storage of source PDFs and derived assets.
2. Deterministic ingest job state transitions and retries.
3. Reliable extraction of question stem, choices, answer, explanation, and image association.
4. Fallback generation when no authored questions are detected.
5. Phone-channel delivery of question text and image media or explicit fallback description.
6. Budget-safe operation with a target total monthly run cost near $50.

## 3) Non-goals

1. Full OCR-first scanned-document reconstruction in v1.
2. Human editorial UI in v1.
3. Multi-tenant enterprise RBAC in v1.

## 4) Scope

In scope:

1. PDF upload, completion, queue ingest, and status tracking.
2. Authored MCQ parsing from normalized markdown text.
3. Generated MCQ fallback from chunks when authored set is absent.
4. Image extraction and persistence in R2.
5. Question cache readiness gating by chapter/source.
6. Telegram and SMS delivery behavior for text and image-linked questions.

Out of scope:

1. Website crawler ingestion expansion.
2. DOCX ingestion in API contract v1.
3. Rich web review dashboard.

## 5) End-to-end workflow

1. Client calls `POST /v1/sources/upload-url` with `Idempotency-Key`.
2. Service creates `source` row in `registered` state and returns `source_id` and `object_key`.
3. Client uploads PDF to R2 object key.
4. Client calls `POST /v1/sources/{source_id}/complete` with `Idempotency-Key`.
5. Service marks source `uploaded`, creates `ingest_job` as `queued`, sends queue message.
6. Ingest consumer receives message and marks job `processing`.
7. Ingest consumer fetches PDF from R2 and runs markdown conversion.
8. Ingest consumer persists normalized chunks and detects source-authored questions.
9. If authored questions exist, persist authored rows in source order.
10. If authored questions do not exist, generate questions from chunks and persist generated rows.
11. Persist image assets to R2 and attach `image_ref` when available.
12. Compute cache state and mark source `ingested` with `ingested_at`.
13. Mark ingest job `completed`; on failure mark `failed` with error detail.
14. Runtime delivery fetches questions in deterministic order and sends to phone channel.

## 6) Functional requirements

### 6.1 Upload and ingest orchestration

1. All write endpoints require `Idempotency-Key`.
2. `source` lifecycle states: `registered -> uploaded -> ingested|failed`.
3. `ingest_job` lifecycle states: `queued -> processing -> completed|failed`.
4. Queue consumer must be retry-safe and idempotent.

### 6.2 Authored question extraction

1. Parse numbered source questions and preserve `source_order`.
2. Parse choices with both uppercase and lowercase option labels (`A/B/C/D` and `a/b/c/d`).
3. Parse compact choice blocks where options are concatenated in one line.
4. Parse answer key patterns including `Answer:` and `Correct answer:`.
5. Persist question fields:
- `stem`
- `choices_json`
- `correct_choice`
- `explanation`
- `source_order`
- `source_page` when available
- `generation_mode='authored'`

### 6.3 Generated fallback questions

1. Trigger fallback generation only when authored question set is empty.
2. Generate from chunk text using low-cost model default.
3. Validate JSON structure and enforce exactly four choices.
4. Persist with `generation_mode='generated'`.
5. Route low-quality outputs to regeneration or degraded state.

### 6.4 Image handling

1. Persist extracted image bytes to R2 under `figures/ingest/{source_id}/...`.
2. Save normalized `image_ref` as `r2://clawstudydata/<key>`.
3. If image extraction is unavailable, generate and store an `image_description` fallback path.
4. Delivery contract:
- Telegram attempts binary image send then falls back to text + description.
- SMS sends text with image description now; MMS media URL support can be added as a phase gate.

### 6.5 Readiness gates

1. Compute `question_cache_state`:
- `question_cache_ready`
- `question_cache_degraded`
- `question_cache_empty`
2. Do not expose chapter as production-ready until question count threshold is met.
3. Threshold policy by chapter profile:
- question-rich chapter target (example FAST): expected authored count from source contract
- generic chapter minimum target: configured fallback threshold

## 7) Data and contract requirements

Aligned with PRD-03 contracts:

1. `source` includes `question_cache_state`, `ingested_at`, `parse_confidence`.
2. `question` includes `stem_hash`, `generation_mode`, `source_page`, `image_ref`.
3. `ingest_job` stores `attempt_count`, `error_code`, `error_detail`.
4. `chunk` stores `chunk_index`, normalized text, token count, topic tag.
5. API responses include `schema_version`.

Additional production requirements:

1. Chapter-scoped dedupe using `stem_hash` must cover legacy and new rows.
2. Source object existence checks must run before ingest starts.
3. Media object existence checks must run before delivery send.

## 8) Cost and model strategy

Budget target: approximately $50 per month.

1. Default ingest generation model uses low-cost Workers AI route.
2. Keep authored extraction deterministic and parser-first, not model-first.
3. Use stronger model only for explicit fallback cases:
- failed answer inference
- repeated parse invalidation
- low-confidence generated set
4. Enforce hard limits:
- max generated questions per source
- max converted images per source
- max retries per ingest job
5. Add budget guardrails:
- 75% budget: disable non-essential regeneration
- 90% budget: disable image-heavy fallback generation
- 100% budget: cache-only runtime dispatch

## 9) Detailed implementation plan

### Phase 0: Contract lock and baselines (February 24, 2026 to February 25, 2026)

1. Confirm canonical endpoint and schema alignment with PRD-03/04/05.
2. Confirm queue + D1 + R2 + AI bindings in production config.
3. Confirm security boundary for service token auth and webhook signatures.

Exit criteria:

1. All required migration files are applied.
2. Queue producer/consumer bindings are deployed.

### Phase 1: Ingest parser hardening (February 25, 2026 to February 27, 2026)

1. Extend authored parser to handle lowercase option labels and concatenated blocks.
2. Support question-number and answer patterns seen in real chapter PDFs.
3. Add parser regression tests from FAST and at least two additional chapters.

Exit criteria:

1. FAST source-authored extraction count matches source contract threshold.
2. Parser tests pass in CI.

### Phase 2: Image association reliability (February 27, 2026 to March 1, 2026)

1. Improve image extraction path from conversion output.
2. Add fallback page-image extraction when embedded image payload is missing.
3. Persist image metadata and map nearest-question associations.
4. Add delivery-safe fallback description generation.

Exit criteria:

1. At least one image-linked question is deliverable in FAST chapter.
2. Missing-image fallback message quality passes acceptance sample.

### Phase 3: Generated fallback quality (March 1, 2026 to March 3, 2026)

1. Enforce generation validation and structural guards.
2. Add retry policy for invalid model outputs.
3. Track generation metrics and quality score buckets.

Exit criteria:

1. No-authored chapter path produces minimum threshold questions.
2. Invalid JSON output failure rate is below tolerance threshold.

### Phase 4: Channel delivery validation (March 3, 2026 to March 5, 2026)

1. Validate Telegram send path for text + image + fallback.
2. Validate SMS send path for text + image description fallback.
3. Validate strict source-order runtime delivery and progress tracking.

Exit criteria:

1. 10-question phone session passes with deterministic progression and answer tracking.
2. Duplicate webhook replay does not duplicate attempts.

### Phase 5: Production hardening and handoff (March 5, 2026 to March 7, 2026)

1. Add reconciliation job for orphaned D1 references to missing R2 objects.
2. Add dashboards for ingest throughput, failure buckets, and question readiness.
3. Finalize rollback and reingest runbook.

Exit criteria:

1. Production checklist is fully complete.
2. Rollback dry run passes.

## 10) Implementation checklist

### 10.1 Infrastructure checklist

1. [ ] D1 migrations applied through ingest consumer contracts.
2. [ ] Queue `study-ingest` producer and consumer enabled.
3. [ ] R2 bucket access and object permissions validated.
4. [ ] AI binding configured for conversion and fallback generation.
5. [ ] `STUDY_SERVICE_TOKEN` and channel secrets configured.

### 10.2 Ingest processing checklist

1. [ ] Upload URL endpoint returns valid source and object key.
2. [ ] Complete endpoint creates queued ingest job.
3. [ ] Consumer marks processing and completion states correctly.
4. [ ] Retry path increments attempt count and captures error details.
5. [ ] Chunk rows persist with deterministic indexes.

### 10.3 Authored question extraction checklist

1. [ ] Numbered question detection handles chapter formatting variants.
2. [ ] Choice parsing handles lowercase and uppercase labels.
3. [ ] Choice parsing handles concatenated inline options.
4. [ ] Answer key detection handles multiple answer formats.
5. [ ] Source order is preserved and contiguous when possible.

### 10.4 Generated fallback checklist

1. [ ] Fallback triggers only when authored set is absent.
2. [ ] Generated rows always contain 4 options and one valid answer key.
3. [ ] Generated question count respects configured cap.
4. [ ] Low-quality outputs are retried or excluded.

### 10.5 Image checklist

1. [ ] Extracted image assets are stored in R2 with stable key naming.
2. [ ] `image_ref` is persisted on associated questions when available.
3. [ ] Missing image assets generate explicit description fallback.
4. [ ] Telegram delivery attempts binary media then fallback text.
5. [ ] SMS delivery includes image description fallback text.

### 10.6 Quality and readiness checklist

1. [ ] Question count threshold policy exists per chapter class.
2. [ ] `question_cache_state` reflects actual readiness.
3. [ ] Parse confidence and failure reasons are queryable.
4. [ ] Dedupe with `stem_hash` covers legacy and new rows.

### 10.7 Validation checklist (must pass before go-live)

1. [ ] FAST chapter ingest stores expected authored question count and answer keys.
2. [ ] At least one FAST question can deliver image or fallback description to phone.
3. [ ] Ordered delivery path presents questions in deterministic source order.
4. [ ] Progress and attempt counters match persisted attempt history.
5. [ ] Temporary ingest retries do not create duplicate question rows.

### 10.8 Operations checklist

1. [ ] Alerts exist for ingest failure rate and missing-object references.
2. [ ] Daily reconciliation report for D1-to-R2 object integrity is enabled.
3. [ ] Cost dashboard and budget guardrails are enabled.
4. [ ] Reingest runbook is documented and tested.

## 11) Acceptance criteria

1. Authored chapters with known question sets pass threshold count and ordering checks.
2. Non-authored chapters produce fallback generated sets that pass structural validity.
3. Phone delivery sends question, answer evaluation, explanation, and image path or fallback description.
4. End-to-end ingest path is idempotent, auditable, and retry-safe.
5. Monthly operating behavior remains within target cost guardrails.

## 12) Risks and mitigation

1. Risk: Converter formatting drift reduces authored extraction.
- Mitigation: parser regression corpus from real PDFs and chapter-specific pattern tests.
2. Risk: Missing source or image objects in R2.
- Mitigation: reconciliation job and pre-delivery object existence checks.
3. Risk: Budget spike from regeneration loops.
- Mitigation: capped retries, guarded escalation policy, and cache-first runtime.
4. Risk: Question duplication from legacy rows.
- Mitigation: stem hash backfill and dedupe validation job.

## 13) Linked documents

1. `/Applications/clawstudy/docs/prd/PRD-03-Data-Model-and-Contracts.md`
2. `/Applications/clawstudy/docs/prd/PRD-04-Ingestion-Pipeline.md`
3. `/Applications/clawstudy/docs/prd/PRD-05-Question-Engine.md`
4. `/Applications/clawstudy/docs/prd/PRD-08-Analytics-and-Study-Planning.md`
5. `/Applications/clawstudy/docs/implementation/study-service-mvp-build-plan.md`
6. `/Applications/clawstudy/docs/implementation/pdf-upload-plan.md`
7. `/Applications/clawstudy/docs/backlog/implementation-backlog.md`
