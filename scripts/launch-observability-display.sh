#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-/Applications/clawstudy}"
MOLT_DIR="${MOLT_DIR:-$ROOT_DIR/moltworker}"
STUDY_DIR="${STUDY_DIR:-$ROOT_DIR/study-service}"

SESSION_NAME="${OBS_SESSION_NAME:-clawstudy-observability}"
REFRESH_SECONDS="${OBS_REFRESH_SECONDS:-8}"
OPEN_BROWSER="${OBS_OPEN_BROWSER:-false}"
DISPLAY_MODE="${OBS_DISPLAY_MODE:-auto}"

GATEWAY_WORKER_NAME="${GATEWAY_WORKER_NAME:-clawstudyme}"
STUDY_WORKER_NAME="${STUDY_WORKER_NAME:-clawstudy-study-service}"

GATEWAY_URL="${GATEWAY_URL:-https://clawstudyme.siegel-gabe.workers.dev}"
STUDY_SERVICE_URL="${STUDY_SERVICE_URL:-https://clawstudy-study-service.siegel-gabe.workers.dev}"

need_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
}

usage() {
  cat <<EOF
Usage:
  bash /Applications/clawstudy/scripts/launch-observability-display.sh [options]

Options:
  --session <name>       tmux session name (default: $SESSION_NAME)
  --refresh <seconds>    refresh interval for health panes (default: $REFRESH_SECONDS)
  --open-browser         open admin/health/dashboard pages on launch
  --tmux                 force tmux pane mode
  --compact              force compact single-terminal mode
  --help                 show this help

Environment overrides:
  OBS_SESSION_NAME, OBS_REFRESH_SECONDS, OBS_OPEN_BROWSER, OBS_DISPLAY_MODE
  GATEWAY_WORKER_NAME, STUDY_WORKER_NAME
  GATEWAY_URL, STUDY_SERVICE_URL
  STUDY_SERVICE_TOKEN    optional; enables authenticated analytics probe
EOF
}

print_probe() {
  local label="$1"
  local url="$2"
  local auth_header="${3:-}"
  local meta

  if [ -n "$auth_header" ]; then
    meta="$(curl -sS -m 10 -o /dev/null -w "%{http_code} %{time_total}" -H "$auth_header" "$url" 2>/dev/null || echo "000 0")"
  else
    meta="$(curl -sS -m 10 -o /dev/null -w "%{http_code} %{time_total}" "$url" 2>/dev/null || echo "000 0")"
  fi

  local status_code="${meta%% *}"
  local latency="${meta##* }"
  printf "%-40s HTTP %-3s %ss\n" "$label" "$status_code" "$latency"
}

watch_health() {
  while true; do
    clear
    echo "ClawStudy Health Checks"
    echo "Updated: $(date '+%B %d, %Y %H:%M:%S %Z')"
    echo ""
    print_probe "Gateway /sandbox-health" "$GATEWAY_URL/sandbox-health"
    print_probe "Gateway /api/status" "$GATEWAY_URL/api/status"
    print_probe "Study-service /healthz" "$STUDY_SERVICE_URL/healthz"
    echo ""
    echo "Study-service /healthz payload:"
    curl -sS -m 10 "$STUDY_SERVICE_URL/healthz" | jq . 2>/dev/null || echo "(unavailable)"
    echo ""
    echo "Press Ctrl+C in this pane to stop refresh loop."
    sleep "$REFRESH_SECONDS"
  done
}

watch_dashboard() {
  while true; do
    clear
    echo "ClawStudy Debug Summary"
    echo "Updated: $(date '+%B %d, %Y %H:%M:%S %Z')"
    echo ""
    echo "URLs:"
    echo "  Admin:       $GATEWAY_URL/_admin/"
    echo "  Debug:       $GATEWAY_URL/debug/processes"
    echo "  Study health $STUDY_SERVICE_URL/healthz"
    echo ""

    if [ -n "${STUDY_SERVICE_TOKEN:-}" ]; then
      echo "Analytics snapshot (/v1/analytics/dashboard):"
      curl -sS -m 10 -H "Authorization: Bearer $STUDY_SERVICE_TOKEN" \
        "$STUDY_SERVICE_URL/v1/analytics/dashboard" \
        | jq '{questions_total, attempts_total, sessions_active, chapter_cache_ready, chapter_cache_degraded, chapter_cache_empty, generated_at}' \
        2>/dev/null || echo "(analytics endpoint unavailable or token invalid)"
    else
      echo "Set STUDY_SERVICE_TOKEN to display /v1/analytics/dashboard."
    fi

    echo ""
    echo "Useful commands:"
    echo "  tmux attach -t $SESSION_NAME"
    echo "  tmux kill-session -t $SESSION_NAME"
    sleep "$REFRESH_SECONDS"
  done
}

open_url() {
  local url="$1"
  if command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 || true
    return
  fi
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 || true
  fi
}

run_tail() {
  local dir="$1"
  local worker_name="$2"

  cd "$dir"
  if [ -x "./node_modules/.bin/wrangler" ]; then
    ./node_modules/.bin/wrangler tail --name "$worker_name" --format pretty
    return
  fi
  npx --yes wrangler tail --name "$worker_name" --format pretty
}

run_compact_display() {
  need_cmd curl
  need_cmd jq

  if [ ! -d "$MOLT_DIR" ]; then
    echo "Moltworker directory not found: $MOLT_DIR"
    exit 1
  fi

  if [ ! -d "$STUDY_DIR" ]; then
    echo "Study-service directory not found: $STUDY_DIR"
    exit 1
  fi

  if [ "$OPEN_BROWSER" = "true" ]; then
    open_url "$GATEWAY_URL/_admin/"
    open_url "$GATEWAY_URL/debug/processes"
    open_url "$STUDY_SERVICE_URL/healthz"
  fi

  echo "tmux not available (or compact mode selected)."
  echo "Running compact observability stream in this terminal."
  echo "Press Ctrl+C to stop."
  echo ""

  local pids=()

  (
    run_tail "$MOLT_DIR" "$GATEWAY_WORKER_NAME"
  ) 2>&1 | sed -u 's/^/[gateway-tail] /' &
  pids+=("$!")

  (
    run_tail "$STUDY_DIR" "$STUDY_WORKER_NAME"
  ) 2>&1 | sed -u 's/^/[study-tail] /' &
  pids+=("$!")

  (
    while true; do
      {
        echo "------------------------------"
        echo "Health snapshot: $(date '+%B %d, %Y %H:%M:%S %Z')"
        print_probe "Gateway /sandbox-health" "$GATEWAY_URL/sandbox-health"
        print_probe "Gateway /api/status" "$GATEWAY_URL/api/status"
        print_probe "Study-service /healthz" "$STUDY_SERVICE_URL/healthz"
        if [ -n "${STUDY_SERVICE_TOKEN:-}" ]; then
          local analytics
          analytics="$(curl -sS -m 10 -H "Authorization: Bearer $STUDY_SERVICE_TOKEN" \
            "$STUDY_SERVICE_URL/v1/analytics/dashboard" 2>/dev/null || true)"
          if [ -n "$analytics" ]; then
            echo "Analytics:"
            echo "$analytics" | jq '{questions_total, attempts_total, sessions_active, generated_at}' 2>/dev/null || echo "(analytics unavailable)"
          else
            echo "Analytics: (analytics unavailable)"
          fi
        fi
      } | sed -u 's/^/[health] /'
      sleep "$REFRESH_SECONDS"
    done
  ) &
  pids+=("$!")

  cleanup() {
    local pid
    for pid in "${pids[@]}"; do
      kill "$pid" 2>/dev/null || true
    done
  }

  trap cleanup INT TERM EXIT
  wait
}

launch_tmux() {
  need_cmd tmux
  need_cmd curl
  need_cmd jq

  if [ ! -d "$MOLT_DIR" ]; then
    echo "Moltworker directory not found: $MOLT_DIR"
    exit 1
  fi

  if [ ! -d "$STUDY_DIR" ]; then
    echo "Study-service directory not found: $STUDY_DIR"
    exit 1
  fi

  export ROOT_DIR MOLT_DIR STUDY_DIR
  export REFRESH_SECONDS GATEWAY_URL STUDY_SERVICE_URL SESSION_NAME
  export GATEWAY_WORKER_NAME STUDY_WORKER_NAME STUDY_SERVICE_TOKEN

  local self_path
  self_path="$0"

  if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "Observability session already exists: $SESSION_NAME"
    echo "Attaching to existing session..."
    exec tmux attach -t "$SESSION_NAME"
  fi

  tmux new-session -d -s "$SESSION_NAME" -n "observability"
  tmux send-keys -t "$SESSION_NAME:0.0" \
    "cd '$MOLT_DIR' && if [ -x './node_modules/.bin/wrangler' ]; then ./node_modules/.bin/wrangler tail --name '$GATEWAY_WORKER_NAME' --format pretty; else npx --yes wrangler tail --name '$GATEWAY_WORKER_NAME' --format pretty; fi" C-m

  tmux split-window -h -t "$SESSION_NAME:0.0"
  tmux send-keys -t "$SESSION_NAME:0.1" \
    "cd '$STUDY_DIR' && if [ -x './node_modules/.bin/wrangler' ]; then ./node_modules/.bin/wrangler tail --name '$STUDY_WORKER_NAME' --format pretty; else npx --yes wrangler tail --name '$STUDY_WORKER_NAME' --format pretty; fi" C-m

  tmux split-window -v -t "$SESSION_NAME:0.0"
  tmux send-keys -t "$SESSION_NAME:0.2" "bash '$self_path' _watch-health" C-m

  tmux split-window -v -t "$SESSION_NAME:0.1"
  tmux send-keys -t "$SESSION_NAME:0.3" "bash '$self_path' _watch-dashboard" C-m

  tmux select-layout -t "$SESSION_NAME:0" tiled
  tmux set-option -t "$SESSION_NAME" mouse on >/dev/null

  if [ "$OPEN_BROWSER" = "true" ]; then
    open_url "$GATEWAY_URL/_admin/"
    open_url "$GATEWAY_URL/debug/processes"
    open_url "$STUDY_SERVICE_URL/healthz"
  fi

  echo "Started tmux session: $SESSION_NAME"
  echo "Pane layout:"
  echo "  top-left:  gateway wrangler tail ($GATEWAY_WORKER_NAME)"
  echo "  top-right: study-service wrangler tail ($STUDY_WORKER_NAME)"
  echo "  bottom-left: health checks"
  echo "  bottom-right: analytics/quick links"
  echo ""
  echo "Attach anytime: tmux attach -t $SESSION_NAME"
  echo "Stop session:   tmux kill-session -t $SESSION_NAME"
  exec tmux attach -t "$SESSION_NAME"
}

if [ "${1:-}" = "_watch-health" ]; then
  shift
  watch_health
  exit 0
fi

if [ "${1:-}" = "_watch-dashboard" ]; then
  shift
  watch_dashboard
  exit 0
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --session)
      SESSION_NAME="${2:-}"
      if [ -z "$SESSION_NAME" ]; then
        echo "--session requires a value"
        exit 1
      fi
      shift 2
      ;;
    --refresh)
      REFRESH_SECONDS="${2:-}"
      if ! [[ "$REFRESH_SECONDS" =~ ^[0-9]+$ ]]; then
        echo "--refresh must be an integer number of seconds"
        exit 1
      fi
      shift 2
      ;;
    --open-browser)
      OPEN_BROWSER="true"
      shift
      ;;
    --tmux)
      DISPLAY_MODE="tmux"
      shift
      ;;
    --compact)
      DISPLAY_MODE="compact"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

case "$DISPLAY_MODE" in
  auto)
    if command -v tmux >/dev/null 2>&1; then
      launch_tmux
    else
      run_compact_display
    fi
    ;;
  tmux)
    launch_tmux
    ;;
  compact)
    run_compact_display
    ;;
  *)
    echo "Invalid OBS_DISPLAY_MODE: $DISPLAY_MODE"
    echo "Expected: auto, tmux, or compact"
    exit 1
    ;;
esac
