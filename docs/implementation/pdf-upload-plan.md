# PDF Upload Plan for Moltbot on Cloudflare

Last updated: February 23, 2026
Owner: Gabe
Status: In progress (source upload batch complete; ingest pipeline pending)

## 0) Current execution state (February 23, 2026)

1. Upload destination confirmed: R2 bucket `clawstudydata`.
2. Completed source upload batch:
- 18 PDF objects
- prefix `sources/emergency-clinical-ultrasound/`
- total bytes `91,434,981`
3. Completed ACEP paired upload batch:
- 46 PDF objects (23 handouts + 23 lecture decks)
- prefix `sources/acep-course-2026/pairs/`
- pair manifest: `/Applications/clawstudy/memory/acep-course-pairs-manifest-2026-02-23.csv`
- upload results: `/Applications/clawstudy/memory/acep-course-upload-results-2026-02-23.csv`
4. Upload verification evidence:
- Cloudflare R2 object list confirms all 18 keys under target prefix.
- Audit manifest: `/Applications/clawstudy/memory/uploaded-sources-emergency-ultrasound-2026-02-23.csv`.
5. `progress.json` reflects source lifecycle state as `source_ingest_status=uploaded` and `source_ingested=false` across all 18 baseline chapters, plus ACEP section metadata in `additional_source_batches`.
6. Remaining work: implement study-service ingest job flow and chunk persistence in D1:
- source state: `registered -> uploaded -> ingested|failed`
- ingest job state: `queued -> processing -> completed|failed`
7. Progress-memory model is now extended for post-ingest analytics:
- per-PDF rollups (`pdf_progress`)
- per-question rollups (`question_progress`)
- topic mastery/weakness ranking (`topic_mastery`)

## 1) Goal

Enable reliable PDF uploads to your Cloudflare-hosted Moltbot stack so source files are ingested, chunked, tagged, and routed into question generation.

## 2) Scope and assumptions

In scope:

1. Manual PDF upload flow (admin or authenticated client).
2. R2 object storage for source artifacts.
3. D1 records for source metadata, ingest jobs, and chunks.
4. Queue-driven async parsing/chunking workflow.
5. Status endpoint for upload + ingest progress.

Out of scope (phase 2+):

1. OCR-heavy scanned PDF optimization.
2. Full crawl ingestion from arbitrary websites.
3. Auto-ingesting files directly from ACEP PEER.

## 3) Target architecture

Components:

1. `moltworker` (existing): gateway/channel surface.
2. `study-service` Worker (new): ingestion APIs and orchestration.
3. Cloudflare R2 bucket: immutable PDF artifact storage.
4. Cloudflare D1 DB: source, job, and chunk metadata.
5. Cloudflare Queue: decoupled ingest jobs and retries.

Data flow:

1. Client requests upload session from `study-service`.
2. `study-service` returns object key + signed upload URL (or direct authenticated multipart endpoint).
3. Client uploads PDF to R2.
4. Client confirms upload completion.
5. `study-service` enqueues ingest job.
6. Queue consumer extracts text, normalizes, chunks, tags topics, persists results.
7. Status endpoint reports source and job states separately:
- source: `registered|uploaded|ingested|failed`
- job: `queued|processing|completed|failed`

## 4) API contracts (v1)

### `POST /v1/sources/upload-url`

Request:

1. `filename`
2. `content_type` (`application/pdf`)
3. `sha256` (optional but recommended)
4. `source_label` (chapter/book label)

Response:

1. `source_id`
2. `object_key`
3. `upload_url`
4. `expires_at`
5. `schema_version`

### `POST /v1/sources/{source_id}/complete`

Purpose: confirms upload and starts ingest job.

Response:

1. `ingest_job_id`
2. `status` (`queued`)

### `GET /v1/sources/{source_id}/status`

Response:

1. `upload_status`
2. `ingest_status`
3. `parse_confidence`
4. `chunk_count`
5. `error_code` (if failed)

All write endpoints require `Idempotency-Key`.

## 5) D1 schema additions (minimum)

1. `source`
- `id`
- `object_key`
- `filename`
- `content_type`
- `byte_size`
- `sha256`
- `status`
- `source_label`
- `created_at`
- `updated_at`

2. `ingest_job`
- `id`
- `source_id`
- `status`
- `attempt_count`
- `started_at`
- `completed_at`
- `error_code`
- `error_detail`
- `created_at`
- `updated_at`

3. `chunk`
- `id`
- `source_id`
- `chunk_index`
- `text`
- `topic_tag`
- `token_count`
- `quality_score`
- `created_at`
- `updated_at`

## 6) Security controls

1. Only authenticated/authorized callers can request upload URLs.
2. Enforce MIME, size, and extension checks before accepting uploads.
3. Virus/malicious-content scanning hook for uploaded artifacts (queue step or external scanner integration).
4. Store and verify SHA256 checksum when provided.
5. Reject active/scripted PDF payload patterns during extraction.
6. Log every upload and ingest transition in audit events.

## 7) Cost and performance controls

1. Max file size limit for v1 (example: 25 MB).
2. Queue concurrency cap to avoid burst compute spend.
3. Retry with exponential backoff; dead-letter after configured max attempts.
4. Skip duplicate uploads by `sha256` + `filename` heuristics.
5. Target ingest P95 under 2 minutes per normal PDF.

## 8) Implementation sequence (2-week execution)

Completed pre-work:

1. Uploaded and verified the initial 18-file ultrasound source corpus in R2.
2. Populated project memory with source metadata/object keys in `/Applications/clawstudy/memory/progress.json`.

Week 1:

1. Ship gateway workspace scaffolding. (Completed on February 23, 2026)
- `SOUL.md` and `AGENTS.md` in `/root/clawd`
- `study-pdf` and `study-memory` skills in `/root/clawd/skills`
2. Provision D1 tables and Queue bindings. (Pending)
3. Implement upload URL + completion + status endpoints. (Pending)
4. Add idempotency middleware and audit events. (Pending)
5. Add integration tests for upload validation and duplicate detection. (Pending)

Week 2:

1. Implement queue consumer for parse/chunk/tag/persist.
2. Add parse confidence and quality thresholds.
3. Add resumable failure handling and dead-letter visibility.
4. Run 10 representative PDF ingest tests and record metrics.

## 9) Validation checklist

1. Upload lifecycle: completed for 18 representative PDFs in R2.
2. Ingest lifecycle: pending implementation and validation.
3. Failed jobs can be retried without duplicate chunk writes.
4. Chunk quality thresholds pass target benchmarks.
5. Status endpoint always reflects latest ingest state.
6. Audit trail exists for all key transitions.

## 10) Model and parsing strategy (cost-aware)

1. Use Workers AI markdown conversion (`toMarkdown`) as the default PDF extraction path.
2. Enable image-aware conversion for pages containing figures, tables, or annotated scans.
3. Keep question-generation prompts on a lower-cost text model when image reasoning is not required.
4. Store parse metadata (mode, model, confidence) with ingest job records for auditability and cost analysis.

## 11) Open implementation decisions

1. Whether initial upload UX is:
- admin UI upload
- SMS/Telegram attachment relay
- simple signed URL CLI flow
2. Whether chapter mapping is provided at upload time or derived later during indexing.

## 12) MVP implementation linkage

1. Primary execution sequences for FAST messaging flows are tracked in:
- `/Applications/clawstudy/docs/implementation/mvp-telegram-fast-loop-plan.md`
 - `/Applications/clawstudy/docs/implementation/sms-launch-checklist.md`
2. This PDF plan remains the ingestion subsystem contract for that MVP.
3. MVP gate to quiz flow:
- FAST chapter source must reach `source_ingest_status=ingested`
- FAST chapter must be `question_cache_ready=true` before live dispatch.
