#!/usr/bin/env bash
# claw.sh — ClawStudy command-line interface for the moltworker agent
#
# Usage:
#   claw.sh ingest <chapter_id>      Trigger question extraction for a chapter
#   claw.sh status [chapter_id]      Show ingest status and question count
#   claw.sh heartbeat                Full stack health check
#   claw.sh trigger-all              List all chapters pending ingest (dry run)
#   claw.sh ingest-batch us          Ingest all US chapters in order
#
# Environment:
#   CLAWSTUDY_URL    Service base URL (default: production worker)
#   CLAWSTUDY_TOKEN  x-study-service-token value (if auth is enabled)
#   CLAWSTUDY_DB     Wrangler D1 database name (default: clawstudy-study)

set -euo pipefail

BASE_URL="${CLAWSTUDY_URL:-https://clawstudy-study-service.siegel-gabe.workers.dev}"
DB="${CLAWSTUDY_DB:-clawstudy-study}"
TOKEN="${CLAWSTUDY_TOKEN:-}"

# ---- helpers ----------------------------------------------------------------

api() {
  local method="$1"
  local path="$2"
  shift 2
  local args=(-fsS -X "$method" "${BASE_URL}${path}")
  if [ -n "$TOKEN" ]; then
    args+=(-H "x-study-service-token: $TOKEN")
  fi
  curl "${args[@]}" "$@"
}

d1() {
  wrangler d1 execute "$DB" --remote --command "$1"
}

require_chapter_id() {
  if [ -z "${1:-}" ]; then
    echo "Error: chapter_id required (e.g. us-02, gp-01, acep-05)"
    exit 1
  fi
}

# ---- commands ---------------------------------------------------------------

cmd_status() {
  local chapter_id="${1:-}"
  if [ -n "$chapter_id" ]; then
    echo "=== Status: $chapter_id ==="
    api GET "/v1/chapters/${chapter_id}/status" | jq .
  else
    echo "=== All chapters: ingest status & question counts ==="
    d1 "SELECT s.chapter_id, j.status as ingest_status, j.error_code, (SELECT count(*) FROM question q WHERE q.chapter_id=s.chapter_id) as question_count FROM source s LEFT JOIN ingest_job j ON j.source_id=s.id GROUP BY s.chapter_id ORDER BY s.chapter_id"
  fi
}

cmd_ingest() {
  local chapter_id="${1:-}"
  require_chapter_id "$chapter_id"
  echo "=== Ingest: $chapter_id ==="
  api POST "/v1/chapters/${chapter_id}/ingest" \
    -H "Content-Type: application/json" \
    -d '{}' | jq .
}

cmd_heartbeat() {
  echo "=== Service health ==="
  api GET "/healthz" | jq .
  echo ""
  echo "=== Ingest job summary ==="
  d1 "SELECT status, count(*) as count FROM ingest_job GROUP BY status ORDER BY status"
  echo ""
  echo "=== Question counts by chapter ==="
  d1 "SELECT chapter_id, count(*) as questions FROM question GROUP BY chapter_id ORDER BY chapter_id"
  echo ""
  echo "=== Active sessions ==="
  d1 "SELECT status, count(*) as count FROM quiz_session GROUP BY status"
  echo ""
  echo "=== Failed ingest jobs ==="
  d1 "SELECT source_id, error_code, created_at FROM ingest_job WHERE status='failed' ORDER BY created_at DESC LIMIT 10"
}

cmd_trigger_all() {
  echo "=== Chapters with uploaded source and 0 questions (not already running) ==="
  d1 "SELECT s.chapter_id, s.id as source_id, s.upload_status FROM source s WHERE s.upload_status='uploaded' AND (SELECT count(*) FROM question q WHERE q.chapter_id=s.chapter_id)=0 AND NOT EXISTS (SELECT 1 FROM ingest_job j WHERE j.source_id=s.id AND j.status IN ('queued','processing')) ORDER BY s.chapter_id"
  echo ""
  echo "To ingest all pending, run:"
  echo "  bash /Applications/clawstudy/scripts/claw.sh ingest-batch us"
  echo "  bash /Applications/clawstudy/scripts/claw.sh ingest-batch acep"
  echo "  bash /Applications/clawstudy/scripts/claw.sh ingest-batch gp"
}

cmd_ingest_batch() {
  local batch="${1:-us}"
  case "$batch" in
    us)
      chapters=(us-01 us-02 us-03 us-04 us-05 us-06 us-07 us-08 us-09
                us-10 us-11 us-12 us-13 us-14 us-15 us-16 us-17 us-18)
      ;;
    acep)
      chapters=(acep-01 acep-02 acep-03 acep-04 acep-05 acep-06 acep-07
                acep-08 acep-09 acep-10 acep-11 acep-12 acep-13 acep-14
                acep-15 acep-16 acep-17 acep-18 acep-19 acep-20 acep-21
                acep-22 acep-23)
      ;;
    gp)
      chapters=(gp-01 gp-02 gp-03 gp-04 gp-05 gp-06 gp-07 gp-08 gp-09
                gp-10 gp-11 gp-12 gp-13 gp-14 gp-15 gp-16 gp-17 gp-18
                gp-19 gp-20 gp-21 gp-22 gp-23 gp-24 gp-25 gp-26 gp-27
                gp-28 gp-29 gp-30 gp-31)
      ;;
    *)
      echo "Unknown batch: $batch. Use us, acep, or gp."
      exit 1
      ;;
  esac

  echo "=== Batch ingest: $batch (${#chapters[@]} chapters) ==="
  for ch in "${chapters[@]}"; do
    echo ""
    echo "--- $ch ---"
    result=$(api POST "/v1/chapters/${ch}/ingest" \
      -H "Content-Type: application/json" \
      -d '{}' 2>/dev/null || echo '{"status":"error"}')
    status=$(echo "$result" | jq -r '.status // "error"' 2>/dev/null || echo "error")
    message=$(echo "$result" | jq -r '.message // ""' 2>/dev/null || echo "")
    echo "  $ch → $status${message:+: $message}"
    sleep 1
  done
  echo ""
  echo "=== Batch complete. Check status with: claw.sh status ==="
}

cmd_help() {
  cat <<HELP
claw.sh — ClawStudy moltworker CLI

Commands:
  status [chapter_id]        Show ingest status and question count
                             (all chapters if no chapter_id given)
  ingest <chapter_id>        Trigger question extraction for one chapter
  ingest-batch <us|acep|gp>  Trigger ingest for an entire source batch
  trigger-all                Show all chapters that need ingest (dry run)
  heartbeat                  Full stack health check

Chapter ID formats:
  us-01 .. us-18   Emergency & Clinical Ultrasound (18 chapters)
  acep-01 .. acep-23  ACEP Course 2026 (23 chapters)
  gp-01 .. gp-31   Gottlieb POCUS (31 chapters)

Environment:
  CLAWSTUDY_URL    Base URL (default: https://clawstudy-study-service.siegel-gabe.workers.dev)
  CLAWSTUDY_TOKEN  Service auth token (x-study-service-token header)
  CLAWSTUDY_DB     Wrangler D1 database name (default: clawstudy-study)

Examples:
  bash /Applications/clawstudy/scripts/claw.sh status us-02
  bash /Applications/clawstudy/scripts/claw.sh ingest us-02
  bash /Applications/clawstudy/scripts/claw.sh ingest-batch us
  bash /Applications/clawstudy/scripts/claw.sh heartbeat
HELP
}

# ---- dispatch ---------------------------------------------------------------

case "${1:-help}" in
  status)       cmd_status "${2:-}" ;;
  ingest)       cmd_ingest "${2:-}" ;;
  ingest-batch) cmd_ingest_batch "${2:-us}" ;;
  trigger-all)  cmd_trigger_all ;;
  heartbeat)    cmd_heartbeat ;;
  help|--help|-h) cmd_help ;;
  *)
    echo "Unknown command: $1"
    echo "Run 'claw.sh help' for usage."
    exit 1
    ;;
esac
