# PRD-09: Operations, Cost, and Disaster Recovery

Status: Draft
Owner: Gabe
Last updated: February 23, 2026

## 1) Problem statement

System reliability and budget control are required to avoid outages or overspend during final exam prep.

## 2) Scope

In scope:

1. Monitoring and alerting.
2. Cost guardrails and budget controls.
3. Backup, restore, and disaster recovery.
4. Incident response runbooks.

Out of scope:

1. Enterprise multi-region active-active architecture.

## 3) Functional requirements

1. Central operational dashboard for job success and failures.
2. Alerting on:
- failed cron jobs
- messaging failure spike
- model error spike
- budget threshold breach
3. Daily backup export of critical tables and metadata.
4. Weekly restore test into non-production environment.

## 4) Cost requirements

1. Define monthly budget ceiling and warning thresholds (50%, 75%, 90%).
2. Hard rate-limits for expensive generation endpoints.
3. Daily token and messaging usage reports.
4. Automatic downgrade behavior when budget threshold is exceeded.

## 5) Non-functional requirements

1. RPO <= 24 hours.
2. RTO <= 2 hours for major failure.
3. 7-day operational metrics retention minimum (longer for audits as needed).

## 6) Operational procedures

1. On-call checklist for critical incidents.
2. Secret rotation monthly.
3. Dependency vulnerability scan weekly.
4. Change freeze window before exam.

## 7) Acceptance criteria

1. Alerting tested with synthetic failure injection.
2. Backup restore drill passes twice before launch.
3. Budget guardrails trigger and enforce fallback mode.
