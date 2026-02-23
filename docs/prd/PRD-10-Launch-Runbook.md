# PRD-10: Launch and Runbook

Status: Draft
Owner: Gabe
Last updated: February 23, 2026

## 1) Problem statement

A controlled launch process is required to ensure stability during the final study period.

## 2) Launch readiness checklist

1. All PRDs approved and mapped to completed implementation tasks.
2. Security controls validated (secrets, access policies, audit logging).
3. End-to-end daily quiz flow tested for at least 7 days.
4. PEER local sync validated with signed payload and audit trace.
5. Backup and restore drill completed.
6. Budget controls tested and alerting confirmed.

## 3) Go-live plan

1. T-7 days: feature freeze and bug triage only.
2. T-5 days: final performance and load smoke tests.
3. T-3 days: rotate production secrets and verify access.
4. T-2 days: execute final dry-run of schedule.
5. T-1 day: switch to exam-mode content strategy.
6. T day: monitor delivery and keep manual fallback path ready.

## 4) Rollback plan

1. Disable cron dispatch.
2. Revert to cached stable question bank.
3. Route to backup messaging channel if needed.
4. Notify user with fallback study instructions.

## 5) Daily runbook

1. 6:00 AM local: verify daily plan generation success.
2. Midday: check completion and adjust reminders.
3. Evening: review weak-topic deltas and session adherence.
4. Night: run ingestion/generation batch with capped spend.

## 6) Exam-week mode

1. Prioritize high-yield weak topics.
2. Reduce new content generation risk.
3. Increase explanation-driven review and confidence calibration.

## 7) Acceptance criteria

1. Launch checklist has no open critical blockers.
2. Rollback tested once in staging.
3. Exam-week mode plan locked by March 29, 2026.
