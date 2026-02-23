# Board Prep Platform PRD Program

Owner: Gabe
Program start: February 23, 2026
Target exam: March 31, 2026
Program objective: Deliver a secure, low-cost, future-proof study system that ingests PDF and web sources, quizzes daily, tracks mastery, and uses ACEP PEER results without sharing ACEP credentials.

## Document map

- `PRD-00-Vision-and-Outcomes.md`
- `PRD-01-Security-and-Compliance.md`
- `PRD-02-System-Architecture.md`
- `PRD-03-Data-Model-and-Contracts.md`
- `PRD-04-Ingestion-Pipeline.md`
- `PRD-05-Question-Engine.md`
- `PRD-06-Messaging-and-Study-UX.md`
- `PRD-07-ACEP-PEER-Local-Sync-Bridge.md`
- `PRD-08-Analytics-and-Study-Planning.md`
- `PRD-09-Ops-Cost-DR.md`
- `PRD-10-Launch-Runbook.md`
- `PRD-11-Telegram-FAST-Loop-MVP.md`
- `PRD-12-Study-Service-MVP-and-Scale.md`

## Planning gates

1. Gate A: Scope lock and constraints accepted.
2. Gate B: Security model approved, including ACEP credential boundary.
3. Gate C: Architecture and data contracts approved.
4. Gate D: Cost guardrails approved.
5. Gate E: Launch runbook and rollback approved.

## Delivery phases

1. Phase 1 (February 23 to March 1, 2026): PRDs and backlog finalization.
2. Phase 2 (March 2 to March 16, 2026): Core implementation.
3. Phase 3 (March 17 to March 24, 2026): Hardening and adaptive scheduling quality.
4. Phase 4 (March 25 to March 30, 2026): Exam-week optimization and freeze.
5. Phase 5 (March 31, 2026): Exam day support mode.

## Operating constraints

1. ACEP credentials must never be stored in cloud services, agent memory, logs, or repositories.
2. Cloud spend target: predictable monthly budget with a hard cap under a defined threshold.
3. System must degrade safely if any model or messaging provider fails.
4. All critical workflows require auditable logs.

## How to use this PRD set

1. Read `PRD-00` and `PRD-01` first.
2. Confirm architecture in `PRD-02` and contracts in `PRD-03`.
3. Build feature tracks in order: `PRD-04` to `PRD-08`.
4. Execute FAST-loop implementation requirements from `PRD-11` and `PRD-12`.
5. Enforce reliability and budget controls from `PRD-09` before launch.
6. Execute `PRD-10` runbook for final go-live.
