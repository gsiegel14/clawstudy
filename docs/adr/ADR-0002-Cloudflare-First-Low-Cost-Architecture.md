# ADR-0002: Cloudflare-First Low-Cost Architecture

Date: February 23, 2026
Status: Accepted

## Context

The project requires low operational cost, fast delivery, and manageable complexity for a single-user system.

## Decision

Adopt Cloudflare Workers + D1 + R2 as the default platform, with Telegram as first messaging channel.

## Consequences

Positive:

1. Low baseline cost with generous free-tier capabilities.
2. Simple deployment model and scheduling.
3. Strong integration for edge APIs and storage.

Tradeoffs:

1. Platform-specific implementation details.
2. Need adapter boundaries for future portability.

## Follow-up actions

1. Keep provider interfaces abstracted.
2. Add migration/export utilities for portability.
3. Monitor cost and provider limits continuously.
