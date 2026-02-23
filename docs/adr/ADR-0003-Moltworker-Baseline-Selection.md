# ADR-0003: Moltworker Baseline Selection

Date: February 23, 2026
Status: Accepted

## Context

The project needs a Cloudflare-native deployment path and the user explicitly selected `cloudflare/moltworker` over building a custom gateway from scratch.

## Decision

Use `cloudflare/moltworker` as the gateway baseline, and build study-specific logic (ingestion, question generation, analytics, PEER summary sync) in an adjacent Cloudflare Worker service.

## Consequences

Positive:

1. Faster path to Cloudflare-native gateway deployment.
2. Reuse existing OpenClaw integration patterns and admin workflows.
3. Reduced custom gateway engineering before exam date.

Tradeoffs:

1. `moltworker` is an experimental reference and may change without notice.
2. Need careful boundary between upstream gateway and custom study service.
3. Potential cold-start tradeoffs if sleep mode is aggressive.

## Guardrails

1. Keep custom business logic out of upstream internals when possible.
2. Pin and test known-good commit hashes before exam week.
3. Keep ACEP credentials local-only; never store them in gateway or cloud secrets.

## Follow-up actions

1. Create deployment runbook with secrets matrix and hardening steps.
2. Add version pinning and rollback instructions.
3. Add daily health checks for gateway, scheduler, and messaging delivery.
