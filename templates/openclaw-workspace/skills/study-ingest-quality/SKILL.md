# study-ingest-quality

Triggering, monitoring, and validating PDF ingest jobs using the ClawStudy CLI.

## CLI: claw.sh

All ingest operations use the CLI at `/Applications/clawstudy/scripts/claw.sh`.

```bash
# Check status of one chapter
bash /Applications/clawstudy/scripts/claw.sh status us-02

# Check status of all chapters
bash /Applications/clawstudy/scripts/claw.sh status

# Trigger ingest for one chapter
bash /Applications/clawstudy/scripts/claw.sh ingest us-02

# Trigger an entire batch (us, acep, or gp)
bash /Applications/clawstudy/scripts/claw.sh ingest-batch us

# Show which chapters still need ingest (dry run)
bash /Applications/clawstudy/scripts/claw.sh trigger-all

# Full stack health check
bash /Applications/clawstudy/scripts/claw.sh heartbeat
```

If the service requires auth, set the token first:
```bash
export CLAWSTUDY_TOKEN=<value from ops runbook or wrangler secret>
```

## Workflow: "ingest focused echo for me"

1. Resolve chapter name → ID: "focused echo" = `us-02`
2. Check status: `bash /Applications/clawstudy/scripts/claw.sh status us-02`
3. Read the JSON response fields:
   - `found: false` → no source uploaded; tell user to upload the PDF first
   - `question_count > 0` → already done; suggest "start us-02"
   - `ingest_status: queued|processing` → already running; wait and recheck
   - `found: true, question_count: 0, ingest_status: null|failed` → trigger:
     `bash /Applications/clawstudy/scripts/claw.sh ingest us-02`
4. Report the `status` field of the ingest response to the user:
   - `queued` → "Ingest queued for Focused Echo (us-02). Questions ready in ~1 minute."
   - `already_done` → "Focused Echo already has N questions. Say 'start focused echo' to study."
   - `in_progress` → "Ingest already running for us-02. Check back in a minute."
5. Append to `memory/daily-log.md`: `YYYY-MM-DD HH:MM UTC | ingest_triggered | us-02`
6. Update `memory/progress.json`: `ingest_status.us-02 = "queued"`

## Workflow: trigger all pending US chapters

```bash
bash /Applications/clawstudy/scripts/claw.sh ingest-batch us
```

Tries to ingest all 18 US chapters. Already-done and in-progress chapters are skipped silently.
After running, check with:

```bash
bash /Applications/clawstudy/scripts/claw.sh status
```

## Batch priority order

Trigger and confirm in this order:
1. US chapters: `ingest-batch us` (most structured, highest exam priority)
2. ACEP: `ingest-batch acep` (after US is confirmed working)
3. Gottlieb: `ingest-batch gp` (after ACEP is confirmed working)

Do not trigger the next batch until the current batch has all jobs `completed` or `failed`.

## Monitoring while running

Check every ~2 minutes:
```bash
bash /Applications/clawstudy/scripts/claw.sh status
```

Or raw D1:
```bash
wrangler d1 execute clawstudy-study --remote --command \
  "SELECT status, count(*) FROM ingest_job GROUP BY status"
```

## Post-ingest validation

```bash
wrangler d1 execute clawstudy-study --remote --command \
  "SELECT chapter_id, count(*) as questions, sum(CASE WHEN image_ref IS NOT NULL THEN 1 ELSE 0 END) as with_image FROM question GROUP BY chapter_id ORDER BY chapter_id"
```

If `with_image = 0` for chapters expected to have diagrams (FAST, Echo, Thoracic), escalate to PRD-13.

## Error code actions

| error_code | Action |
|------------|--------|
| `parse_failed` | Re-upload the PDF to R2, then re-trigger: `claw.sh ingest <chapter_id>` |
| `ai_timeout` | Wait 60s, re-trigger. If fails again, check `wrangler tail`. |
| `no_text_extracted` | PDF is image-only. See PRD-13 for fallback page-image extraction. |
| `question_count_zero` | No MCQs found. Review PDF quality; may need manual questions. |
