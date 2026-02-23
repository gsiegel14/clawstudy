# PRD-01: Security and Compliance

Status: Draft
Owner: Gabe
Last updated: February 23, 2026

## 1) Problem statement

Sensitive data (study content, personal schedule, account-adjacent metadata) must be protected while enabling cloud automation.

## 2) Security objectives

1. Prevent account compromise and credential leakage.
2. Enforce least privilege for all services.
3. Keep ACEP credentials outside cloud and agent storage.
4. Preserve auditability for all critical actions.

## 3) Compliance constraints

1. ACEP credentials are confidential and must not be shared with third-party agents/services.
2. System stores only derived PEER summary metrics uploaded from a local bridge.
3. Security controls must align with standard secret management and logging hygiene.

## 4) Data classification

1. Class A: Secrets (API keys, bot tokens) - never logged, stored only in secret manager.
2. Class B: Personal metadata (phone/chat ID, schedule) - encrypted at rest where possible, restricted access.
3. Class C: Study artifacts (chunks, questions, attempts) - protected but lower sensitivity.
4. Class D: Aggregated analytics - safest for exports.

## 5) Threat model

Threats:

1. Secret leakage in source control.
2. Unauthorized API access.
3. Replay attacks on webhook endpoints.
4. Prompt injection from untrusted web content.
5. Excessive permissions in service tokens.

Required controls:

1. Secret scanning in CI.
2. HMAC webhook verification + nonce + timestamp window.
3. Strict allowlist for ingestion domains.
4. Input sanitization and content policy enforcement.
5. Rotating short-lived service credentials.

## 6) Functional security requirements

1. All admin endpoints behind identity-aware access.
2. All service-to-service calls use scoped tokens.
3. Write operations produce immutable audit event records.
4. Every external callback validates signature and freshness.

## 7) Non-functional security requirements

1. Zero plaintext secrets in repo, logs, and analytics.
2. Key rotation runbook executed monthly.
3. Incident response RTO <= 2 hours for severe incidents.
4. Security checks required before release.

## 8) Operational controls

1. Access policy: single user + emergency break-glass account.
2. Logging policy: redact PII/secrets by default.
3. Backup policy: daily backup and weekly restore test.
4. Dependency policy: patch critical vulnerabilities within 48 hours.

## 9) Open questions

1. Whether to enable hardware key requirement for admin access.
2. Whether to enforce IP allowlist for admin paths.

## 10) Acceptance criteria

1. Threat model document completed and reviewed.
2. Secret rotation drill completed successfully.
3. Pen-test checklist pass for webhook and admin endpoints.
4. Verified that ACEP credentials are never sent to cloud components.
