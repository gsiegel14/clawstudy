#!/usr/bin/env bash
set -euo pipefail

MOLT_DIR="${MOLT_DIR:-/Applications/clawstudy/moltworker}"
DM_POLICY="${TELEGRAM_DM_POLICY:-pairing}"

need_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
}

echo "[1/5] Checking prerequisites"
need_cmd npx
need_cmd wrangler

if [ ! -d "$MOLT_DIR" ]; then
  echo "Moltworker directory not found: $MOLT_DIR"
  echo "Clone it first:"
  echo "git clone https://github.com/cloudflare/moltworker.git $MOLT_DIR"
  exit 1
fi

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "TELEGRAM_BOT_TOKEN is required."
  echo "Example:"
  echo "export TELEGRAM_BOT_TOKEN='123456:abcDEF...'"
  echo "export TELEGRAM_DM_POLICY='pairing'"
  echo "bash /Applications/clawstudy/scripts/setup-telegram-moltworker.sh"
  exit 1
fi

echo "[2/5] Writing Telegram bot token secret"
cd "$MOLT_DIR"
printf '%s' "$TELEGRAM_BOT_TOKEN" | npx wrangler secret put TELEGRAM_BOT_TOKEN

echo "[3/5] Writing Telegram DM policy secret"
printf '%s' "$DM_POLICY" | npx wrangler secret put TELEGRAM_DM_POLICY

echo "[4/5] Next deploy step"
echo "cd $MOLT_DIR && npm run deploy"

echo "[5/5] Post-deploy validation"
echo "1) Open worker UI with ?token=<MOLTBOT_GATEWAY_TOKEN>"
echo "2) DM your bot from Telegram"
echo "3) Approve pairing in /_admin/ (if policy is pairing)"
echo "4) Confirm two-way replies in Telegram"
