#!/usr/bin/env bash
set -euo pipefail

MOLT_DIR="${MOLT_DIR:-/Applications/clawstudy/moltworker}"
WRANGLER_CMD=()

# Vision-capable default for image-heavy PDF handling.
DEFAULT_MODEL="workers-ai/@cf/meta/llama-3.2-11b-vision-instruct"
DEFAULT_SLEEP_AFTER="${SANDBOX_SLEEP_AFTER:-10m}"

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
  if CI=1 "${WRANGLER_CMD[@]}" whoami >/dev/null 2>&1; then
    return
  fi

  echo "Wrangler is not authenticated."
  echo "Run the following, complete browser auth, then re-run setup:"
  echo "${WRANGLER_CMD[*]} login"
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

echo "[1/7] Checking prerequisites"
need_cmd npx
need_cmd node
need_cmd openssl

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

echo "[2/7] Selecting wrangler and checking auth"
select_wrangler
"${WRANGLER_CMD[@]}" --version >/dev/null
check_wrangler_auth

echo "[3/7] Collecting required values"
prompt_if_empty CF_ACCESS_TEAM_DOMAIN "Cloudflare Access team domain (example: myteam.cloudflareaccess.com)"
prompt_if_empty CF_ACCESS_AUD "Cloudflare Access AUD tag"
prompt_if_empty CF_AI_GATEWAY_ACCOUNT_ID "Cloudflare account ID for AI Gateway"
prompt_if_empty CF_AI_GATEWAY_GATEWAY_ID "AI Gateway ID"
prompt_if_empty CLOUDFLARE_AI_GATEWAY_API_KEY "AI Gateway auth token (cf-aig-authorization)" true

if [ -z "${MOLTBOT_GATEWAY_TOKEN:-}" ]; then
  MOLTBOT_GATEWAY_TOKEN="$(openssl rand -hex 32)"
  echo "Generated MOLTBOT_GATEWAY_TOKEN:"
  echo "$MOLTBOT_GATEWAY_TOKEN"
  echo "Save this token now. You will use it in ?token=<value>."
fi

if [ -z "${CF_AI_GATEWAY_MODEL:-}" ]; then
  CF_AI_GATEWAY_MODEL="$DEFAULT_MODEL"
fi

echo "[4/7] Writing required secrets"
cd "$MOLT_DIR"
put_secret MOLTBOT_GATEWAY_TOKEN "$MOLTBOT_GATEWAY_TOKEN"
put_secret CF_ACCESS_TEAM_DOMAIN "$CF_ACCESS_TEAM_DOMAIN"
put_secret CF_ACCESS_AUD "$CF_ACCESS_AUD"
put_secret CF_AI_GATEWAY_ACCOUNT_ID "$CF_AI_GATEWAY_ACCOUNT_ID"
put_secret CF_AI_GATEWAY_GATEWAY_ID "$CF_AI_GATEWAY_GATEWAY_ID"
put_secret CLOUDFLARE_AI_GATEWAY_API_KEY "$CLOUDFLARE_AI_GATEWAY_API_KEY"
put_secret CF_AI_GATEWAY_MODEL "$CF_AI_GATEWAY_MODEL"
put_secret SANDBOX_SLEEP_AFTER "$DEFAULT_SLEEP_AFTER"

echo "[5/7] Optional Telegram setup"
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  put_secret TELEGRAM_BOT_TOKEN "$TELEGRAM_BOT_TOKEN"
  put_secret TELEGRAM_DM_POLICY "${TELEGRAM_DM_POLICY:-pairing}"
  echo "Configured Telegram secrets from environment."
else
  echo "Skipped TELEGRAM_BOT_TOKEN (set it later if needed)."
fi

echo "[6/7] Deploy prompt"
read -r -p "Deploy moltworker now? [y/N] " deploy_now
if [[ "$deploy_now" =~ ^[Yy]$ ]]; then
  npm run deploy
else
  echo "Skipped deploy. Run later:"
  echo "cd $MOLT_DIR && npm run deploy"
fi

echo "[7/7] Post-deploy checks"
echo "1) Open your worker URL with ?token=<MOLTBOT_GATEWAY_TOKEN>"
echo "2) Open /_admin/ and verify Cloudflare Access auth works"
echo "3) DM your bot and approve pairing in /_admin/ (if Telegram is enabled)"
echo "4) Confirm model route is set to: $CF_AI_GATEWAY_MODEL"
echo ""
echo "Note: if this is your first time using Meta Vision models, you may need to"
echo "send a one-time \"agree\" request for Meta license acceptance in Workers AI."
