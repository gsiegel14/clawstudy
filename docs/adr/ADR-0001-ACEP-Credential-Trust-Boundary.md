# ADR-0001: ACEP Credential Trust Boundary

Date: February 23, 2026
Status: Accepted

## Context

The system needs PEER performance data to adjust study plans. Direct cloud automation of ACEP login creates credential-sharing risk and potential policy conflict.

## Decision

ACEP credentials will remain local-only. The cloud system receives only signed summary payloads from a local sync bridge.

## Consequences

Positive:

1. Reduced credential exposure risk.
2. Clear compliance boundary.
3. Simpler cloud threat model.

Tradeoffs:

1. Requires a short manual local sync step after PEER sessions.
2. No fully automated cloud PEER scraping.

## Follow-up actions

1. Implement signed payload verification.
2. Add audit logging for each import.
3. Document local sync procedure.
