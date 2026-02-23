# Implementation Backlog (MVP Through March 31, 2026)

Last updated: February 23, 2026

## Current execution note (February 23, 2026)

Repository-verified completions:

1. `moltworker` baseline and study workspace policy files are present:
- `/Applications/clawstudy/moltworker/workspace/SOUL.md`
- `/Applications/clawstudy/moltworker/workspace/AGENTS.md`
2. Study skills are present in `/Applications/clawstudy/moltworker/skills`:
- `study-memory`
- `study-pdf`
3. Setup scripts are present for low-cost model path and Telegram:
- `/Applications/clawstudy/scripts/setup-low-cost-moltworker.sh`
- `/Applications/clawstudy/scripts/setup-telegram-moltworker.sh`
4. Source corpus pre-load completed and tracked in memory:
- 18 ultrasound chapter PDFs uploaded under `sources/emergency-clinical-ultrasound/`
- audit manifest: `/Applications/clawstudy/memory/uploaded-sources-emergency-ultrasound-2026-02-23.csv`
5. ACEP paired corpus upload completed and tracked in memory:
- 23 handout+lecture pairs (`46` PDFs) uploaded under `sources/acep-course-2026/pairs/`
- manifests: `/Applications/clawstudy/memory/acep-course-pairs-manifest-2026-02-23.csv`, `/Applications/clawstudy/memory/acep-course-upload-results-2026-02-23.csv`

Next execution priorities:

1. Complete D1 provisioning and run migration for `study-service` schema in `/Applications/clawstudy/study-service/migrations/0001_initial.sql`.
2. Wire deployed `moltworker` routes to `study-service` endpoints with service token auth.
3. Implement parser/chunker queue consumer and persist chunk metadata.
4. Seed FAST chapter question cache (`>=20`) from ingested content.
5. Record end-to-end evidence in `/Applications/clawstudy/docs/implementation/mvp-telegram-fast-loop-plan.md`.
6. Execute pair-wise ACEP generation plan (`>=25` attending-level questions per pair) from `/Applications/clawstudy/docs/implementation/acep-course-question-pathway.md`.

Repository-verified implementation progress (February 23, 2026):

1. Added adjacent Worker project scaffold:
- `/Applications/clawstudy/study-service`
2. Added canonical MVP API surface with idempotent write handling:
- `/Applications/clawstudy/study-service/src/app.ts`
3. Added deterministic Telegram idempotency key utility:
- `/Applications/clawstudy/study-service/src/telegram-idempotency.ts`
4. Added D1 schema migration for source/session/attempt/progress/idempotency tables:
- `/Applications/clawstudy/study-service/migrations/0001_initial.sql`
5. Added contract tests for `session/start` and `session/answer`:
- `/Applications/clawstudy/study-service/test/contract.test.ts`
6. Added one-PDF pilot automation script:
- `/Applications/clawstudy/scripts/setup-one-pdf-pilot.sh`
7. Added SMS webhook + status routes and SMS idempotency support in study-service:
- `/Applications/clawstudy/study-service/src/sms-idempotency.ts`
- `/Applications/clawstudy/study-service/src/twilio-signature.ts`
- `/Applications/clawstudy/study-service/test/sms.test.ts`
8. Added progress-memory extensions for per-PDF/per-question tracking and topic weakness ranking:
- `/Applications/clawstudy/study-service/migrations/0002_progress_memory.sql`
- `/Applications/clawstudy/study-service/src/store.ts`
- `/Applications/clawstudy/study-service/src/app.ts`

## Phase 0: Baseline Adoption (February 23 to March 1)

1. Clone and pin `cloudflare/moltworker` baseline.
2. Configure Cloudflare Access, gateway token, and admin path hardening.
3. Enable R2 persistence and verify backup/restore from admin UI.
4. Set container sleep policy (`SANDBOX_SLEEP_AFTER`) and cold-start expectations.
5. Validate device pairing and channel handshake in the baseline gateway.
6. Seed `SOUL.md` and baseline study skills (`study-memory`, `study-pdf`) in the gateway workspace image.
7. Configure low-cost AI Gateway + Workers AI model profile for PDF/image-capable operation.

## Phase 0.5: FAST MVP Critical Path (February 24 to March 4)

1. Implement `study-service` scaffold with D1 migrations for `question`, `question_attempt`, `quiz_session`, and `chapter_progress`.
2. Implement idempotent endpoints:
- `POST /v1/quiz/session/start`
- `POST /v1/quiz/session/{session_id}/answer`
3. Implement FAST chapter ingest-to-ready pipeline:
- upload
- ingest
- chunk with image refs
- question cache seed
4. Bridge messaging commands:
- `START FAST`
- `lets start fast`
- `question 1`/`q1`
- answer messages (`A/B/C/D`)
5. Validate Twilio SMS webhook signature path and delivery status callback.
6. Return explanation + source citation + running progress on every answer response.
7. Validate 10-question FAST session end-to-end in SMS (iPhone Messages) with text-first fallback and one image-enabled path.
8. Validate warm-path first-question latency P95 <= 5 seconds with warm runtime mode (`SANDBOX_SLEEP_AFTER=never`).
9. Record completion evidence and open risks in:
- `/Applications/clawstudy/docs/implementation/mvp-telegram-fast-loop-plan.md`
- `/Applications/clawstudy/docs/implementation/study-service-mvp-build-plan.md`
- `/Applications/clawstudy/docs/prd/PRD-11-Telegram-FAST-Loop-MVP.md`
- `/Applications/clawstudy/docs/prd/PRD-12-Study-Service-MVP-and-Scale.md`

## Phase 1: Foundation (March 2 to March 6)

1. Create adjacent study-service Worker project with environment separation.
2. Provision D1, study R2 namespace, and optional queue resources.
3. Implement signed service-to-service auth from `moltworker` gateway to study service.
4. Create baseline SQL migrations for core entities.
5. Add audit event framework and request tracing.

## Phase 2: Ingestion and Questions (March 7 to March 12)

1. Build PDF and URL ingestion endpoints.
2. Implement chunking and topic tagging pipeline.
3. Implement question generation worker and validator.
4. Store source citations and quality scores.
5. Add retry and dead-letter handling.

## Phase 3: Messaging and Tracking (March 13 to March 18)

1. Build Telegram adapter and webhook endpoint (or route via gateway channel hooks).
2. Implement dispatch scheduler and session state.
3. Implement answer capture and scoring.
4. Add dashboard endpoint for progress summaries.
5. Add pause/resume/plan/stats commands.

## Phase 4: PEER Sync and Adaptation (March 19 to March 23)

1. Build local `peer-sync` CLI with signed payload upload.
2. Implement cloud endpoint verification and idempotency.
3. Integrate PEER summary weight into planning algorithm.
4. Add explainable "why this topic" output for daily plan.

## Phase 5: Hardening and Launch (March 24 to March 30)

1. Configure alerts and cost guardrails.
2. Run backup/restore drills.
3. Run failure-injection tests for provider outages.
4. Freeze non-critical changes.
5. Execute launch checklist and exam-week mode switch.

## Must/Should/Could

Must:

1. Secure credential boundary.
2. Daily dispatch and answer tracking.
3. Adaptive weak-topic planning.
4. Backup and monitoring.

Should:

1. Alternate messaging provider.
2. Advanced topic taxonomy controls.
3. Review queue UI.

Could:

1. Voice prompts.
2. Rich interactive web dashboard.
3. Provider A/B testing.
