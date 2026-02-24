# study-ingest-quality

Triggering, monitoring, and validating PDF ingest jobs.

## Trigger ingest

Call `POST /v1/sources/{source_id}/complete` to queue an ingest job for an uploaded source.

- Only trigger if source `upload_status = "uploaded"` and `ingest_status` is null or `"failed"`.
- Never re-trigger if `ingest_status = "processing"` — wait for it to complete or fail.
- After triggering, append a line to `memory/daily-log.md` and update `memory/progress.json`.

## Check ingest status

```bash
wrangler d1 execute clawstudy-study --remote --command \
  "SELECT source_id, status, error_code FROM ingest_job ORDER BY created_at DESC LIMIT 20"
```

Or via API: `GET /v1/sources/{source_id}/status` — returns `{ ingestStatus, questionCount, imageQuestionCount }`.

## What `question_cache_ready` means

A chapter is question-cache-ready when:
1. At least one `ingest_job` for the source has `status = "completed"`, AND
2. At least one row exists in the `question` table for the chapter.

A chapter is degraded (not fully ready) if questions exist but `image_ref` is null for some that should have images.

## Retry guidance

| Error code | Action |
|------------|--------|
| `parse_failed` | Check PDF object key in R2. Re-upload if corrupted. Re-trigger ingest. |
| `ai_timeout` | Re-trigger ingest once. If it fails again, try a different source PDF. |
| `no_text_extracted` | PDF may be image-only. Check PRD-13 for fallback page-image extraction. |
| `question_count_zero` | Ingest ran but no MCQs were found. Review source PDF quality. May need manual questions. |

## Batch ingest order

Priority: US chapters → ACEP pairs → Gottlieb chapters.

When monitoring a batch, check for failures every 5 minutes. Do not trigger the next batch until the current batch has all jobs in `completed` or `failed` (with retry exhausted).

## Image ref validation

After ingest, run:
```bash
wrangler d1 execute clawstudy-study --remote --command \
  "SELECT chapter_id, count(*) as total, sum(CASE WHEN image_ref IS NOT NULL THEN 1 ELSE 0 END) as with_image FROM question GROUP BY chapter_id"
```

If `with_image` is 0 for chapters expected to have diagrams, escalate to PRD-13 image extraction flow.
