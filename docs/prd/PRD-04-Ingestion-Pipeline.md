# PRD-04: Ingestion Pipeline

Status: Draft
Owner: Gabe
Last updated: February 23, 2026

## 1) Problem statement

Study materials exist across PDFs and websites, but without consistent normalization and chunking question quality is unreliable.

## 2) Scope

In scope:

1. Manual PDF upload and URL ingestion.
2. Parsing, cleaning, chunking, deduplication.
3. Topic tagging and quality checks.

Out of scope:

1. Full web crawling across arbitrary domains.
2. OCR-heavy scanned text optimization for v1.

## 3) Functional requirements

1. Support `application/pdf`, `text/html`, and markdown-like plain text.
2. Store original artifact in R2 and extracted text snapshot.
3. Chunk using token-aware boundaries with overlap.
4. Auto-tag chunks by topic taxonomy.
5. Skip duplicate or near-duplicate chunks.
6. Capture parse confidence and flag low-confidence content.

## 4) Non-functional requirements

1. Single source ingest P95 under 2 minutes for normal PDFs.
2. Retry-safe jobs with no duplicate chunk writes.
3. Partial failure handling with resumable ingestion.

## 5) Security requirements

1. Domain allowlist for URL ingestion.
2. Reject active content and unsafe script payloads.
3. Sanitize extracted text before passing to model provider.

## 6) Pipeline stages

1. Source accepted.
2. Source downloaded or uploaded.
3. Text extracted and normalized.
4. Chunk plan generated.
5. Topic tagging performed.
6. Chunk records persisted.
7. Ingest completion event emitted.

## 7) Quality controls

1. Minimum chunk text length threshold.
2. Maximum boilerplate ratio threshold.
3. Duplicate similarity threshold.
4. Spot-check sample chunks in review endpoint.

## 8) Acceptance criteria

1. Ingest at least 10 representative PDFs successfully.
2. >= 95% of chunk text contains meaningful content.
3. Duplicate chunk rate below agreed threshold.
4. Failed jobs are resumable and auditable.
