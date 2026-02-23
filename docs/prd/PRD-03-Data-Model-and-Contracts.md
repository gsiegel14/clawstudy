# PRD-03: Data Model and Contracts

Status: Draft
Owner: Gabe
Last updated: February 23, 2026

## 1) Problem statement

Need durable, auditable data contracts to track study performance and support provider portability.

## 2) Core entities

1. `source` (pdf/web metadata).
2. `chunk` (normalized text units with topic tags).
3. `question` (generated or curated prompt/options/explanation).
4. `question_attempt` (answer, correctness, confidence, response latency).
5. `topic_mastery` (rolling score, stability, next review date).
6. `study_session` (planned vs actual).
7. `peer_session_summary` (topic-level summary from local bridge).
8. `audit_event` (security and operational events).

## 3) Schema requirements

1. Every table has `id`, `created_at`, `updated_at`.
2. Soft-delete where legal and operationally required.
3. Immutable attempt history; no destructive rewrite.
4. Foreign keys enforced for referential integrity.

## 4) API contracts

Endpoints:

1. `POST /v1/sources`
2. `POST /v1/ingest/jobs`
3. `POST /v1/questions/generate`
4. `POST /v1/quiz/dispatch`
5. `POST /v1/quiz/answer`
6. `POST /v1/peer/summary` (signed local payload)
7. `GET /v1/analytics/dashboard`

Contract rules:

1. All write endpoints idempotent via `Idempotency-Key` header.
2. Schema version in request/response (`schema_version`).
3. Strict JSON validation and typed error codes.

## 5) Event contracts

Events:

1. `ingest.completed`
2. `question.generated`
3. `quiz.dispatched`
4. `attempt.recorded`
5. `mastery.updated`
6. `peer.summary.imported`

Each event includes:

1. `event_id`
2. `event_type`
3. `actor`
4. `timestamp`
5. `payload`
6. `trace_id`

## 6) Data retention

1. Attempts and mastery retained through exam + 6 months.
2. Raw ingestion artifacts archived after exam and optionally purged.
3. Audit events retained minimum 1 year.

## 7) Quality constraints

1. No orphaned chunks/questions.
2. Mastery recompute job deterministic and reproducible.
3. Time zone normalization to local study timezone.

## 8) Acceptance criteria

1. ERD approved and migration files generated.
2. Contract tests pass for all public endpoints.
3. Backward-compatible schema versioning strategy documented.
