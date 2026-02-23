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

1. Define monthly budget ceiling and warning thresholds:
- monthly AI+gateway ceiling: `$40.00`
- 50% warning: `$20.00`
- 75% warning: `$30.00`
- 90% warning: `$36.00`
2. Define daily spend and token caps:
- daily model spend cap: `$1.50`
- daily text-token cap: `500,000`
- daily vision-token/page-processing cap: `25,000 token-equivalent`
3. Hard rate-limits for expensive generation endpoints:
- max concurrent chapter-generation jobs: `2`
- max new question generation requests: `120/hour`
4. Daily token and messaging usage reports.
5. Automatic downgrade behavior when thresholds are exceeded:
- at 75% monthly usage: disable non-essential regeneration jobs; keep runtime quiz path cache-only
- at 90% monthly usage: disable all vision generation except active ingest retries and serve only cached questions
- at 100% monthly usage: block new generation, keep answer scoring/explanations from cached content only

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
