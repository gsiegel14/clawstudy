# Agent Instructions (ClawStudy)

Guidance for AI/code agents working in this repository.

## Project intent

Build and operate a Cloudflare-native study stack:

1. `moltworker` is the gateway baseline.
2. Study-specific logic (ingestion, questions, analytics, progress memory) lives outside the upstream gateway where possible.
3. ACEP credentials stay local-only and never enter cloud logs, repos, or agent memory.

## Repository map

1. `/Applications/clawstudy/docs/prd`: product requirements and constraints.
2. `/Applications/clawstudy/docs/adr`: architecture decisions.
3. `/Applications/clawstudy/docs/implementation`: runbooks and execution plans.
4. `/Applications/clawstudy/docs/backlog`: phase-based implementation backlog.
5. `/Applications/clawstudy/scripts`: bootstrap/setup helper scripts.
6. `/Applications/clawstudy/moltworker`: upstream gateway baseline (nested git repo).
7. `/Applications/clawstudy/memory`: persistent project progress memory for chapters/questions.

## Non-negotiable guardrails

1. Never store ACEP credentials in code, docs, logs, or secrets outside approved local-only workflows.
2. Prefer upstream-first changes for `/Applications/clawstudy/moltworker`; keep custom behavior in adjacent services/scripts/docs.
3. Treat security and idempotency as first-class requirements for ingestion and quiz flows.
4. Any write endpoint design must include `Idempotency-Key` handling.

## Working rules for changes

1. Before coding, read the relevant PRDs:
- ingestion work: `PRD-04`
- questions/attempts: `PRD-05`
- data contracts: `PRD-03`
- analytics/planning: `PRD-08`
2. If behavior, API, or schema changes, update the corresponding docs in the same change set.
3. Keep dates explicit (`Month Day, Year`) in planning docs.
4. Prefer additive migrations/contracts over breaking rewrites.

## Definition of done (feature changes)

1. Implementation or plan is reflected in docs and backlog.
2. Security boundary is unchanged or improved.
3. Failure/retry behavior is described and testable.
4. If study progress semantics changed, update `/Applications/clawstudy/memory/progress.json` schema notes and `/Applications/clawstudy/memory/README.md`.

## Memory update protocol

After any work related to question/chapter tracking:

1. Update `/Applications/clawstudy/memory/progress.json`:
- `last_updated`
- summary counters
- chapter/session entries as applicable
2. Append one line-item to `/Applications/clawstudy/memory/daily-log.md` with what changed and why.

## Common commands

```bash
# root repo status
cd /Applications/clawstudy && git status

# bootstrap moltworker deployment prerequisites
bash /Applications/clawstudy/scripts/bootstrap-moltworker.sh

# setup telegram for gateway
export TELEGRAM_BOT_TOKEN='<token>'
export TELEGRAM_DM_POLICY='pairing'
bash /Applications/clawstudy/scripts/setup-telegram-moltworker.sh
```

## Planning docs to keep current

1. `/Applications/clawstudy/docs/implementation/pdf-upload-plan.md`
2. `/Applications/clawstudy/docs/backlog/implementation-backlog.md`
3. `/Applications/clawstudy/memory/README.md`

