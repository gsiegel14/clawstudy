# TOOLS.md - Local Notes

Environment-specific tool notes for the ClawStudy moltworker workspace.

## claw.sh — Primary CLI (use this first)

Path: `/Applications/clawstudy/scripts/claw.sh`

```bash
# Check one chapter status (question count, ingest status)
bash /Applications/clawstudy/scripts/claw.sh status us-02

# Check all chapters
bash /Applications/clawstudy/scripts/claw.sh status

# Trigger ingest for a chapter
bash /Applications/clawstudy/scripts/claw.sh ingest us-02

# Trigger a whole batch
bash /Applications/clawstudy/scripts/claw.sh ingest-batch us   # us-01..us-18
bash /Applications/clawstudy/scripts/claw.sh ingest-batch acep  # acep-01..acep-23
bash /Applications/clawstudy/scripts/claw.sh ingest-batch gp    # gp-01..gp-31

# Full health check
bash /Applications/clawstudy/scripts/claw.sh heartbeat
```

If auth is required: `export CLAWSTUDY_TOKEN=<token>`

## Study Service

- endpoint: `https://clawstudy-study-service.siegel-gabe.workers.dev`
- health: `curl -fsS https://clawstudy-study-service.siegel-gabe.workers.dev/healthz`
- chapter status: `curl -fsS https://clawstudy-study-service.siegel-gabe.workers.dev/v1/chapters/us-02/status`
- trigger ingest: `curl -X POST https://clawstudy-study-service.siegel-gabe.workers.dev/v1/chapters/us-02/ingest -H "Content-Type: application/json" -d '{}'`

## R2

- list US chapters: `wrangler r2 object list clawstudydata --prefix sources/emergency-clinical-ultrasound/`
- list ACEP pairs: `wrangler r2 object list clawstudydata --prefix sources/acep-course-2026/pairs/`
- list Gottlieb: `wrangler r2 object list clawstudydata --prefix sources/gottlieb-pocus-by-chapter/`

## D1

- query sessions: `wrangler d1 execute clawstudy-study --remote --command "SELECT * FROM quiz_session LIMIT 10"`
- check questions: `wrangler d1 execute clawstudy-study --remote --command "SELECT chapter_id, count(*) FROM question GROUP BY chapter_id"`
- check ingest jobs: `wrangler d1 execute clawstudy-study --remote --command "SELECT source_id, status FROM ingest_job ORDER BY created_at DESC LIMIT 20"`
- check topic mastery: `wrangler d1 execute clawstudy-study --remote --command "SELECT topic, mastery_score, weakness_rank FROM topic_mastery WHERE user_id='tg:user:YOUR_ID' ORDER BY weakness_rank ASC LIMIT 10"`

## Wrangler general

- apply migrations: `cd /Applications/clawstudy/study-service && wrangler d1 migrations apply clawstudy-study --remote`
- tail logs: `wrangler tail clawstudy-study-service`
- deploy: `cd /Applications/clawstudy/study-service && wrangler deploy`
