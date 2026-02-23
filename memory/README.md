# Study Memory (Questions + Chapters)

Last updated: February 23, 2026

This folder is the persistent project memory for tracking study progress across chapters and question sessions.

## Files

1. `/Applications/clawstudy/memory/progress.json`
- Canonical machine-readable state.
- Update after each study session or ingestion batch.

2. `/Applications/clawstudy/memory/daily-log.md`
- Human-readable append-only notes.
- Use for quick audit trail and context handoff.

3. `/Applications/clawstudy/memory/uploaded-sources-emergency-ultrasound-2026-02-23.csv`
- Upload audit manifest for the first 18-chapter ultrasound batch.
- Includes `chapter_id`, local file path, R2 key, size, and SHA256.
4. `/Applications/clawstudy/memory/acep-course-pairs-manifest-2026-02-23.csv`
- Canonical pairing map for ACEP handout + lecture sources (`23` pairs).
- Includes per-pair R2 object keys and minimum question target.
5. `/Applications/clawstudy/memory/acep-course-upload-results-2026-02-23.csv`
- Upload execution result log for all ACEP source objects (`46/46` uploaded).
6. `/Applications/clawstudy/memory/acep-course-question-progress-2026-02-23.csv`
- Pair-level question generation tracker (`draft -> review -> approved -> published`).
7. `/Applications/clawstudy/memory/acep-course-section-memory-2026-02-23.json`
- Section summary for ACEP totals, targets, and source artifacts.

## Current snapshot (February 23, 2026)

1. `source_batch`: `emergency-clinical-ultrasound-2026-02-23`
2. `ingestion_summary.sources_pdf_total`: `18`
3. `ingestion_summary.sources_uploaded`: `18`
4. `ingestion_summary.sources_ingested`: `0`
5. `additional_source_batches[0].batch_id`: `acep-course-2026-02-23`
6. `additional_source_batches[0].sources_uploaded`: `46`
7. `additional_source_batches[0].min_questions_total`: `575`
8. `question_sessions`: empty (no quiz sessions recorded yet)
9. `pdf_progress` / `question_progress` / `topic_mastery` / `recent_attempts`: initialized and ready for runtime memory sync

## Update protocol

1. Update `progress.json` first:
- `last_updated`
- summary totals (`questions_answered`, `questions_correct`, accuracy)
- chapter-level progress fields
- `pdf_progress`, `question_progress`, `topic_mastery`, and `recent_attempts`
- session entry in `question_sessions`
2. Append one log item in `daily-log.md` with date, what changed, and next action.

## progress.json top-level keys

1. `schema_version`
2. `owner`
3. `last_updated`
4. `exam_date`
5. `source_batch`
6. `ingestion_summary`
7. `summary`
8. `chapters[]`
9. `pdf_progress[]`
10. `question_progress[]`
11. `topic_mastery[]`
12. `recent_attempts[]`
13. `question_sessions[]`
14. `additional_source_batches[]` (optional multi-section source tracking)

## Chapter progress semantics

`status` values:

1. `not_started`
2. `in_progress`
3. `reviewing`
4. `mastered`

Required chapter fields:

1. `chapter_id`
2. `chapter_name`
3. `status`
4. `questions_assigned`
5. `questions_answered`
6. `questions_correct`
7. `accuracy`
8. `last_reviewed`
9. `next_review`

Optional chapter source-tracking fields (PDF ingestion lifecycle):

1. `source_file`
2. `source_size_bytes`
3. `source_sha256`
4. `source_object_key`
5. `source_registered_at`
6. `source_uploaded`
7. `source_ingested`
8. `source_ingest_status`

`source_ingest_status` values:

1. `registered`
2. `uploaded`
3. `ingested`
4. `failed`

## Question session semantics

Each `question_sessions[]` item records one block:

1. `session_id`
2. `date`
3. `chapter_id`
4. `questions_answered`
5. `questions_correct`
6. `avg_confidence`
7. `avg_response_time_seconds`
8. `notes`

Keep session history immutable. Correct mistakes with a new `correction` log entry instead of rewriting history.

## Per-PDF and question memory semantics

1. `pdf_progress[]` tracks one row per `user_id + source_id`:
- `questions_answered`
- `questions_correct`
- `accuracy`
- `avg_response_time_seconds`
- `confidence_avg`
- `last_answered_at`
2. `question_progress[]` tracks one row per `user_id + question_id`:
- `chapter_id`
- `source_id`
- `topic`
- `questions_answered`
- `questions_correct`
- `accuracy`
- `last_answered_at`
3. `topic_mastery[]` tracks weakness ranking:
- `topic`
- `mastery_score`
- `weakness_rank`
- `next_review_at`
4. `recent_attempts[]` is append-only attempt memory for auditing:
- `question_id`
- `source_id`
- `selected_choice`
- `is_correct`
- `response_time_seconds`
- `confidence`
- `created_at`
