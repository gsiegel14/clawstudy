#!/usr/bin/env bash
set -euo pipefail

STUDY_SERVICE_DIR="${STUDY_SERVICE_DIR:-/Applications/clawstudy/study-service}"
R2_BUCKET="${R2_BUCKET:-clawstudydata}"
CHAPTER_ID="${CHAPTER_ID:-us-01}"
QUESTION_COUNT="${QUESTION_COUNT:-20}"
SCHEMA_VERSION="${SCHEMA_VERSION:-1.0.0}"
TELEGRAM_WEBHOOK_SECRET="${TELEGRAM_WEBHOOK_SECRET:-study-webhook}"
WRANGLER_CMD=()

need_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
}

select_wrangler() {
  local local_wrangler
  local_wrangler="$STUDY_SERVICE_DIR/node_modules/.bin/wrangler"

  if [ -x "$local_wrangler" ]; then
    WRANGLER_CMD=("$local_wrangler")
    return
  fi

  if command -v wrangler >/dev/null 2>&1; then
    WRANGLER_CMD=("wrangler")
    return
  fi

  if npx --yes wrangler --version >/dev/null 2>&1; then
    WRANGLER_CMD=("npx" "--yes" "wrangler")
    return
  fi

  echo "Could not find a runnable wrangler CLI."
  exit 1
}

check_wrangler_auth() {
  if CI=1 "${WRANGLER_CMD[@]}" whoami >/dev/null 2>&1; then
    return
  fi

  echo "Wrangler is not authenticated. Run: ${WRANGLER_CMD[*]} login"
  exit 1
}

prompt_if_empty() {
  local var_name="$1"
  local prompt_text="$2"
  local is_hidden="${3:-false}"
  local value="${!var_name:-}"

  if [ -n "$value" ]; then
    return
  fi

  if [ "$is_hidden" = "true" ]; then
    read -r -s -p "$prompt_text: " value
    echo ""
  else
    read -r -p "$prompt_text: " value
  fi

  if [ -z "$value" ]; then
    echo "$var_name is required."
    exit 1
  fi

  printf -v "$var_name" '%s' "$value"
}

put_secret() {
  local key="$1"
  local value="$2"
  printf '%s' "$value" | "${WRANGLER_CMD[@]}" secret put "$key" >/dev/null
  echo "Set secret: $key"
}

echo "[1/9] Checking prerequisites"
need_cmd curl
need_cmd jq
need_cmd sips
need_cmd npx

if [ ! -d "$STUDY_SERVICE_DIR" ]; then
  echo "Study-service directory not found: $STUDY_SERVICE_DIR"
  exit 1
fi

if grep -q "REPLACE_WITH_D1_DATABASE_ID" "$STUDY_SERVICE_DIR/wrangler.jsonc"; then
  echo "Update $STUDY_SERVICE_DIR/wrangler.jsonc with a real D1 database_id before running this script."
  exit 1
fi

prompt_if_empty PDF_PATH "Absolute path to pilot PDF"
prompt_if_empty STUDY_SERVICE_URL "Deployed study-service URL (example: https://clawstudy-study-service.<subdomain>.workers.dev)"
prompt_if_empty STUDY_SERVICE_TOKEN "Study-service token for x-study-service-token" true
prompt_if_empty TELEGRAM_BOT_TOKEN "Telegram bot token" true

if [ ! -f "$PDF_PATH" ]; then
  echo "PDF file does not exist: $PDF_PATH"
  exit 1
fi

select_wrangler
check_wrangler_auth

echo "[2/9] Preparing upload keys"
PDF_BASENAME="$(basename "$PDF_PATH")"
PDF_SLUG="$(printf '%s' "$PDF_BASENAME" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9._-]+/-/g')"
STAMP="$(date +%Y%m%d-%H%M%S)"
PDF_KEY="sources/pilot-one-pdf/${CHAPTER_ID}-${STAMP}-${PDF_SLUG}"
IMG_KEY="figures/pilot-one-pdf/${CHAPTER_ID}-${STAMP}-p1.png"

echo "[3/9] Converting first PDF page to PNG"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
IMG_PATH="$TMP_DIR/first-page.png"
sips -s format png "$PDF_PATH" --out "$IMG_PATH" >/dev/null

echo "[4/9] Uploading PDF and image to R2"
cd "$STUDY_SERVICE_DIR"
"${WRANGLER_CMD[@]}" r2 object put "${R2_BUCKET}/${PDF_KEY}" --file "$PDF_PATH" >/dev/null
"${WRANGLER_CMD[@]}" r2 object put "${R2_BUCKET}/${IMG_KEY}" --file "$IMG_PATH" >/dev/null

echo "[5/9] Ensuring study-service secrets"
put_secret STUDY_SERVICE_TOKEN "$STUDY_SERVICE_TOKEN"
put_secret TELEGRAM_BOT_TOKEN "$TELEGRAM_BOT_TOKEN"
put_secret TELEGRAM_WEBHOOK_SECRET "$TELEGRAM_WEBHOOK_SECRET"

echo "[6/9] Seeding pilot FAST chapter questions"
IDEMPOTENCY_KEY="seed-${CHAPTER_ID}-${STAMP}"
SEED_RESPONSE="$(curl -fsS -X POST "${STUDY_SERVICE_URL}/v1/admin/seed/fast-pilot" \
  -H "Content-Type: application/json" \
  -H "x-study-service-token: ${STUDY_SERVICE_TOKEN}" \
  -H "Idempotency-Key: ${IDEMPOTENCY_KEY}" \
  -d "{\"schema_version\":\"${SCHEMA_VERSION}\",\"chapter_id\":\"${CHAPTER_ID}\",\"source_object_key\":\"${PDF_KEY}\",\"image_object_key\":\"${IMG_KEY}\",\"question_count\":${QUESTION_COUNT}}")"
printf '%s\n' "$SEED_RESPONSE" | jq .

echo "[7/9] Configuring Telegram webhook"
WEBHOOK_URL="${STUDY_SERVICE_URL}/v1/telegram/webhook"
WEBHOOK_RESPONSE="$(curl -fsS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=${WEBHOOK_URL}" \
  --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}")"
printf '%s\n' "$WEBHOOK_RESPONSE" | jq .

echo "[8/9] Smoke check"
HEALTH_RESPONSE="$(curl -fsS "${STUDY_SERVICE_URL}/healthz")"
printf '%s\n' "$HEALTH_RESPONSE" | jq .

echo "[9/9] Ready"
echo "R2 PDF key: ${PDF_KEY}"
echo "R2 image key: ${IMG_KEY}"
echo "Telegram test flow:"
echo "1) DM your bot: lets start fast"
echo "2) Reply with: A"
echo "3) Ask explicitly: question 1"
