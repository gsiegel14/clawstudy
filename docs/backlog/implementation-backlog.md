# Implementation Backlog (MVP Through March 31, 2026)

Last updated: February 23, 2026

## Phase 0: Baseline Adoption (February 23 to March 1)

1. Clone and pin `cloudflare/moltworker` baseline.
2. Configure Cloudflare Access, gateway token, and admin path hardening.
3. Enable R2 persistence and verify backup/restore from admin UI.
4. Set container sleep policy (`SANDBOX_SLEEP_AFTER`) and cold-start expectations.
5. Validate device pairing and channel handshake in the baseline gateway.

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
