# HEARTBEAT.md

Runnable periodic checks for ClawStudy stack health.

## Checks

1. `curl -fsS https://clawstudy-study-service.siegel-gabe.workers.dev/healthz`
2. `wrangler d1 execute clawstudy-study --remote --command "SELECT status, count(*) FROM ingest_job GROUP BY status"`
3. `wrangler d1 execute clawstudy-study --remote --command "SELECT chapter_id, count(*) FROM question GROUP BY chapter_id ORDER BY chapter_id"`
4. `wrangler d1 execute clawstudy-study --remote --command "SELECT status, count(*) FROM quiz_session GROUP BY status"`
5. `wrangler d1 execute clawstudy-study --remote --command "SELECT source_id, status, error_code FROM ingest_job WHERE status='failed' ORDER BY created_at DESC LIMIT 10"`
