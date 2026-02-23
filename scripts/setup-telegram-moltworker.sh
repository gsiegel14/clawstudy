#!/usr/bin/env bash
set -euo pipefail

MOLT_DIR="${MOLT_DIR:-/Applications/clawstudy/moltworker}"
DM_POLICY="${TELEGRAM_DM_POLICY:-pairing}"
WRANGLER_CMD=()

need_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
}

node_major() {
  node -p "process.versions.node.split('.')[0]"
}

ensure_node_runtime() {
  if [ "$(node_major)" -ge 20 ]; then
    return
  fi

  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck source=/dev/null
    . "$HOME/.nvm/nvm.sh"
    if nvm ls 22 >/dev/null 2>&1; then
      nvm use 22 >/dev/null
    else
      nvm install 22 >/dev/null
      nvm use 22 >/dev/null
    fi
  fi
}

ensure_token() {
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
    return
  fi
  echo "Enter your BotFather token (input hidden):"
  read -r -s TELEGRAM_BOT_TOKEN
  echo ""
  if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
    echo "TELEGRAM_BOT_TOKEN is required."
    exit 1
  fi
}

validate_token() {
  local resp ok
  resp="$(curl -fsSL "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe" || true)"
  ok="$(printf '%s' "$resp" | jq -r '.ok // false' 2>/dev/null || printf 'false')"
  if [ "$ok" != "true" ]; then
    echo "Telegram token validation failed."
    echo "Response: $resp"
    exit 1
  fi
  local username
  username="$(printf '%s' "$resp" | jq -r '.result.username // empty' 2>/dev/null || true)"
  echo "Validated Telegram bot token for @$username"
}

select_wrangler() {
  local local_wrangler
  local_wrangler="$MOLT_DIR/node_modules/.bin/wrangler"

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
  echo "Install dependencies in $MOLT_DIR (npm install) or fix npm/network setup."
  exit 1
}

check_wrangler_auth() {
  local whoami_out
  whoami_out="$(CI=1 "${WRANGLER_CMD[@]}" whoami 2>&1 || true)"

  if printf '%s' "$whoami_out" | grep -qiE "not authenticated|run \`wrangler login\`"; then
    echo "Wrangler is not authenticated."
    echo "Run the following, complete browser auth, then re-run setup:"
    echo "${WRANGLER_CMD[*]} login"
    exit 1
  fi

  if printf '%s' "$whoami_out" | grep -qiE "error|failed"; then
    echo "Could not verify Wrangler authentication."
    echo "$whoami_out"
    exit 1
  fi
}

echo "[1/5] Checking prerequisites"
need_cmd npx
need_cmd node
need_cmd curl
need_cmd jq

ensure_node_runtime

if [ "$(node_major)" -lt 20 ]; then
  echo "Node.js 20+ is required. Current: $(node --version)"
  echo "If nvm is installed, run:"
  echo "source \"$HOME/.nvm/nvm.sh\" && nvm install 22 && nvm alias default 22"
  exit 1
fi

if [ ! -d "$MOLT_DIR" ]; then
  echo "Moltworker directory not found: $MOLT_DIR"
  echo "Clone it first:"
  echo "git clone https://github.com/cloudflare/moltworker.git $MOLT_DIR"
  exit 1
fi

select_wrangler
"${WRANGLER_CMD[@]}" --version >/dev/null
check_wrangler_auth

ensure_token
validate_token

echo "[2/5] Writing Telegram bot token secret"
cd "$MOLT_DIR"
printf '%s' "$TELEGRAM_BOT_TOKEN" | "${WRANGLER_CMD[@]}" secret put TELEGRAM_BOT_TOKEN

echo "[3/5] Writing Telegram DM policy secret"
printf '%s' "$DM_POLICY" | "${WRANGLER_CMD[@]}" secret put TELEGRAM_DM_POLICY

echo "[4/5] Deploy prompt"
read -r -p "Deploy moltworker now? [y/N] " deploy_now
if [[ "$deploy_now" =~ ^[Yy]$ ]]; then
  npm run deploy
else
  echo "Skipped deploy. Run later:"
  echo "cd $MOLT_DIR && npm run deploy"
fi

echo "[5/5] Post-deploy validation"
echo "1) Open worker UI with ?token=<MOLTBOT_GATEWAY_TOKEN>"
echo "2) DM your bot from Telegram"
echo "3) Approve pairing in /_admin/ (if policy is pairing)"
echo "4) Confirm two-way replies in Telegram"
