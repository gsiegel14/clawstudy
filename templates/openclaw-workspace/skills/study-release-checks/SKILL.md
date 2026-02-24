# study-release-checks

Pre-deploy and post-deploy validation checklist.

## Status

Stub — fill in as release workflows are exercised.

## Planned responsibilities

- Pre-deploy: run `wrangler d1 migrations apply --dry-run`, check test suite.
- Post-deploy: hit `/healthz`, verify ingest queue is draining, spot-check one question delivery.
- Define rollback criteria (error rate threshold, ingest failure rate).
