# Telegram Launch Checklist (Moltworker)

Last updated: February 23, 2026

Use this checklist to launch a Telegram-first study loop with your Cloudflare-native moltworker gateway.

## 1) Create Telegram bot token

1. Open Telegram and chat with `@BotFather`.
2. Run `/newbot`.
3. Save the token securely.

## 2) Set Telegram secret in Cloudflare Worker

Fast path (recommended):

```bash
export TELEGRAM_DM_POLICY='pairing'
bash /Applications/clawstudy/scripts/setup-telegram-moltworker.sh
```

Manual path:

```bash
cd /Applications/clawstudy/moltworker
printf '%s' "${TELEGRAM_DM_POLICY:-pairing}" | npx wrangler secret put TELEGRAM_DM_POLICY
printf '%s' "$TELEGRAM_BOT_TOKEN" | npx wrangler secret put TELEGRAM_BOT_TOKEN
```

## 3) Deploy and verify

```bash
cd /Applications/clawstudy/moltworker
npm run deploy
```

Then:

1. Open the Control UI with your gateway token.
2. Send your bot a DM from Telegram.
3. Approve pairing in admin UI (`/_admin/`) if DM policy is `pairing`.

## 4) Configure study loop behavior

Keep this command set simple for SMS-like back-and-forth:

1. `START` starts daily loop.
2. `QUIZ 10` sends 10 questions.
3. `FOCUS <topic>` shifts question mix.
4. `PAUSE` and `RESUME` control interruptions.
5. `STATS` returns daily and weekly summary.

## 5) Reliability guardrails

1. Keep `dmPolicy=pairing` unless you intentionally open access.
2. Allowlist only your own Telegram user id first.
3. Enable R2 persistence so pairing and history survive restarts.
4. Keep ACEP credentials local-only; upload PEER summary data only.

## 6) Daily cadence recommendation (exam prep)

1. Morning warm-up: 10 questions.
2. Midday reinforcement: 5 weak-topic questions.
3. Afternoon mixed block: 10 questions.
4. Evening review: misses + explanation recap.

This pattern keeps steady repetition without long inactive windows.
