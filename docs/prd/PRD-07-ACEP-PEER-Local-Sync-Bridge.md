# PRD-07: ACEP PEER Local Sync Bridge

Status: Draft
Owner: Gabe
Last updated: February 23, 2026

## 1) Problem statement

PEER performance should influence study priorities, but account credentials must remain private and off-cloud.

## 2) Security boundary

1. ACEP login occurs only in local browser session.
2. No ACEP password stored in project files, cloud secrets, logs, or prompts.
3. Cloud receives only summary performance payloads.

## 3) Scope

In scope:

1. Local CLI or desktop script for manual summary entry or local page parsing.
2. Signed payload upload to cloud endpoint.
3. Mapping PEER categories to internal topic taxonomy.

Out of scope:

1. Cloud-hosted PEER login automation.
2. Auto-answering PEER questions.

## 4) Functional requirements

1. Local command creates `peer_session_summary` payload.
2. Payload includes date, topic, total questions, correct count, and optional notes.
3. Payload signed with local private key or HMAC secret.
4. Cloud verifies signature and idempotency key.
5. Imported summaries adjust `topic_mastery` weighting.

## 5) Non-functional requirements

1. Sync operation should complete in under 30 seconds.
2. Duplicate upload attempts must not create duplicate records.
3. Verification failures must be explicit and logged.

## 6) Data contract

Payload example fields:

1. `session_external_id`
2. `session_date`
3. `topic_breakdown[]`
4. `total_questions`
5. `total_correct`
6. `duration_minutes`
7. `schema_version`

## 7) Operational workflow

1. User completes PEER block.
2. User runs `peer-sync` locally.
3. User confirms extracted summary.
4. Script uploads signed payload.
5. Cloud returns accepted summary ID and impact report.

## 8) Acceptance criteria

1. End-to-end sync succeeds with signed validation.
2. Cloud rejects tampered or stale payloads.
3. Mastery changes are traceable to imported session IDs.
