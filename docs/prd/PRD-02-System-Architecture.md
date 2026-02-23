# PRD-02: System Architecture

Status: Draft
Owner: Gabe
Last updated: February 23, 2026

## 1) Problem statement

Need an end-to-end architecture that is low-cost, secure, and replaceable by component.

## 2) Target architecture

Core components:

1. Gateway baseline: `cloudflare/moltworker` (OpenClaw running in Cloudflare Sandbox).
2. Study API and scheduler: Cloudflare Workers + Cron Triggers (adjacent study service).
3. Primary study datastore: Cloudflare D1.
4. Object storage: Cloudflare R2 for gateway persistence and source artifacts.
5. Optional vector retrieval: Cloudflare Vectorize or alternate provider.
6. Messaging adapter: Telegram first, optional Twilio SMS.
7. Local PEER bridge: local script that uploads summary results.

## 3) Design principles

1. Split-trust architecture: credentialed ACEP access remains local.
2. Adapter pattern for model and messaging providers.
3. Event-sourced study tracking for portability.
4. Idempotent jobs and retry-safe workflows.
5. Upstream-first: prefer unmodified `moltworker` defaults where possible and isolate custom study logic in a separate service.

## 4) Request flows

Flow A: Ingestion

1. Upload or fetch source.
2. Parse and chunk.
3. Store source in R2 and chunk metadata in D1.
4. Queue question-generation job.

Flow B: Daily quiz

1. Cron triggers plan generation.
2. Question set assembled from weak topics + spaced repetition.
3. Message sent through adapter.
4. Answer captured and scored.
5. Mastery updated and next review scheduled.

Flow C: PEER local sync

1. User completes PEER session manually.
2. Local script extracts or records summary.
3. Script posts signed payload to cloud API.
4. Cloud updates mastery weights only.

## 5) Availability and resilience

1. Retries with exponential backoff for provider calls.
2. Dead-letter queue for repeated failures.
3. Graceful fallback to cached question bank when model unavailable.

## 6) Functional requirements

1. System supports 3 provider interfaces:
- model provider
- messaging provider
- source parser
2. All jobs are idempotent by job key.
3. Every attempt write emits analytics event.

## 7) Non-functional requirements

1. P95 question delivery latency < 3 seconds from scheduled dispatch.
2. Daily job completion success >= 99%.
3. Service recovers from single-provider failure within 15 minutes.

## 8) Cost strategy

1. Prefer free-tier resources with enforced quotas.
2. Pre-generate question batches nightly.
3. Disable expensive retrieval calls when cached items meet quality threshold.

## 9) Acceptance criteria

1. End-to-end sequence diagrams reviewed and implemented.
2. Failure injection tests pass for model and messaging outages.
3. Provider swap test completed with no schema changes.
