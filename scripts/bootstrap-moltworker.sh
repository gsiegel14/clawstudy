#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/Applications/clawstudy"
MOLT_DIR="$ROOT_DIR/moltworker"

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

echo "[1/6] Checking prerequisites"
need_cmd node
need_cmd npm
need_cmd npx
need_cmd openssl
need_cmd git
need_cmd wrangler

if [ ! -d "$MOLT_DIR/.git" ]; then
  echo "moltworker repo not found at: $MOLT_DIR"
  exit 1
fi

echo "[2/6] Showing versions"
node --version
npm --version
wrangler --version

if [ "$(node_major)" -lt 20 ]; then
  echo "Node.js 20+ is required for current moltworker dependencies."
  echo "Install Node 20 or 22, then re-run this script."
  exit 1
fi

echo "[3/6] Installing dependencies"
cd "$MOLT_DIR"
npm install

echo "[4/6] Preparing required secrets"
echo "Run these commands now (interactive):"
echo ""
echo "cd $MOLT_DIR"
echo "openssl rand -hex 32 | npx wrangler secret put MOLTBOT_GATEWAY_TOKEN"
echo "npx wrangler secret put CF_ACCESS_TEAM_DOMAIN"
echo "npx wrangler secret put CF_ACCESS_AUD"
echo "npx wrangler secret put ANTHROPIC_API_KEY"
echo ""
echo "Recommended optional secrets:"
echo "npx wrangler secret put R2_ACCESS_KEY_ID"
echo "npx wrangler secret put R2_SECRET_ACCESS_KEY"
echo "npx wrangler secret put CF_ACCOUNT_ID"
echo "npx wrangler secret put TELEGRAM_BOT_TOKEN"
echo "npx wrangler secret put SANDBOX_SLEEP_AFTER"

echo ""
echo "[5/6] Deploy command"
echo "cd $MOLT_DIR && npm run deploy"

echo ""
echo "[6/6] Post-deploy checks"
echo "1) Open worker URL with ?token=<MOLTBOT_GATEWAY_TOKEN>"
echo "2) Enable Cloudflare Access on workers.dev"
echo "3) Visit /_admin/ and verify device pairing"
echo "4) Verify R2 backup status in admin UI"
