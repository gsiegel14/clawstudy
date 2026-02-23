# SMS Launch Checklist (iPhone Messages)

Last updated: February 23, 2026
Owner: Gabe
Status: Ready for execution

## 1) Goal

Run FAST chapter Q/A through SMS so messages appear in iPhone Messages immediately.

## 2) Prerequisites

1. Deployed `study-service` Worker:
- `https://clawstudy-study-service.siegel-gabe.workers.dev`
2. Seeded FAST chapter cache (`us-01`) with at least one question.
3. Twilio account with:
- SMS-capable US number (or Messaging Service)
- account auth token available locally
4. Node.js 20+ for Wrangler operations.

## 3) Configure Worker secret

Set Twilio auth token in Worker secrets:

```bash
cd /Applications/clawstudy/study-service
source ~/.nvm/nvm.sh && nvm use 22
npx wrangler secret put TWILIO_AUTH_TOKEN
```

## 4) Configure Twilio webhooks

In Twilio Console for your number (or Messaging Service):

1. Inbound message webhook:
- Method: `POST`
- URL: `https://clawstudy-study-service.siegel-gabe.workers.dev/v1/channel/sms/webhook`
2. Status callback webhook:
- Method: `POST`
- URL: `https://clawstudy-study-service.siegel-gabe.workers.dev/v1/channel/sms/status`

## 5) Deploy latest SMS adapter

```bash
cd /Applications/clawstudy/study-service
source ~/.nvm/nvm.sh && nvm use 22
npx wrangler deploy
```

## 6) Functional smoke test (phone)

From iPhone Messages, text your Twilio number:

1. `lets start fast`
2. reply `A`
3. reply `B`

Expected:

1. Question 1 returned in SMS text.
2. Answer feedback includes correctness + progress.
3. Next question is sent after each answer.

## 7) Webhook replay/idempotency test

1. Resend the exact same inbound payload from Twilio debugger/replay.
2. Verify no duplicate attempt write in D1.

## 8) Known current limitation

1. SMS path is text-first today.
2. If question has `image_ref`, SMS returns a note and continues quiz state without failure.
3. MMS image delivery can be added next via public/signed media URL path.

## 9) Cutover recommendation

1. Keep Telegram webhook active as fallback until SMS run is stable for 24 hours.
2. Promote SMS to primary once first-question latency and delivery success targets hold.
