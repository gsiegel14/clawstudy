# OpenClaw Agent Setup for ClawStudy

Last updated: February 24, 2026

Scope: Adopt upstream OpenClaw agent setup patterns (workspace templates, multi-agent wiring, sandbox checks, skills checks) in this repository.

## 1) Upstream sources reviewed

Reviewed from `https://github.com/openclaw/openclaw` at commit `8dfa33d3731ba1128e35da8888057406698a0816` (February 24, 2026):

1. `README.md` (workspace + skills + sandbox model)
2. `docs/cli/setup.md`
3. `docs/cli/onboard.md`
4. `docs/cli/agents.md`
5. `docs/cli/agent.md`
6. `docs/cli/sandbox.md`
7. `docs/reference/AGENTS.default.md`
8. `docs/reference/templates/*.md`

## 2) What is now copied into this repo

1. Workspace templates in `/Applications/clawstudy/templates/openclaw-workspace/`:
- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `USER.md`
- `IDENTITY.md`
- `HEARTBEAT.md`
2. Seed script:
- `/Applications/clawstudy/scripts/setup-openclaw-agent-workspace.sh`
3. Bootstrap integration:
- `/Applications/clawstudy/scripts/bootstrap-moltworker.sh` now calls the seed script.

## 3) Seed workspace templates

Default target is `moltworker/workspace`:

```bash
bash /Applications/clawstudy/scripts/setup-openclaw-agent-workspace.sh
```

Seed a different workspace path (for example `/root/clawd` on a runtime host):

```bash
bash /Applications/clawstudy/scripts/setup-openclaw-agent-workspace.sh \
  --target-dir /root/clawd
```

Overwrite existing files intentionally:

```bash
bash /Applications/clawstudy/scripts/setup-openclaw-agent-workspace.sh --force
```

## 4) OpenClaw CLI setup sequence (host/runtime)

Follow this order when configuring a fresh OpenClaw runtime:

1. Initialize config/workspace:
```bash
openclaw setup --workspace /root/clawd
```
2. Run guided onboarding if needed:
```bash
openclaw onboard
```
3. Confirm workspace pointer:
```bash
openclaw config get agents.defaults.workspace
```
4. Configure additional agents (optional):
```bash
openclaw agents list
openclaw agents add review --workspace /root/clawd-review
openclaw agents set-identity --agent main --from-identity
```

## 5) Anything else needed (recommended hardening)

1. Sandbox non-main sessions:
```bash
openclaw config set agents.defaults.sandbox.mode "non-main"
```
2. Verify effective sandbox policy:
```bash
openclaw sandbox explain --agent main
```
3. Validate skills readiness:
```bash
openclaw skills check
```
4. Run diagnostic checks:
```bash
openclaw doctor
```

## 6) ClawStudy-specific constraints

1. Never place ACEP credentials in workspace files, config files, or logs.
2. Keep custom study behavior in study-service/skills/docs and avoid deep `moltworker` source forks.
3. Preserve idempotent write behavior for ingestion and question flows.
