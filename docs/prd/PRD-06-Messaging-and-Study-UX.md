# PRD-06: Messaging and Study UX

Status: Build-ready
Owner: Gabe
Last updated: February 23, 2026

## 1) Problem statement

The study system must run through the iPhone Messages app immediately while preserving robust answer tracking, idempotent writes, and chapter progress state.

## 2) Scope

In scope:

1. SMS channel as the primary v1 transport (user sees messages in iPhone Messages app).
2. Existing Telegram channel retained as fallback/parallel adapter.
3. Channel adapter abstraction so study logic stays in `study-service`.
4. User flows for `start fast`, `question 1`, and answer intents (`A/B/C/D`, `1/2/3/4`).
5. Delivery-state logging and retry-safe processing.

Out of scope:

1. Native iOS app.
2. Group chat study collaboration.
3. Apple Messages for Business onboarding dependencies for MVP launch.

## 3) User flows

1. Start session (SMS):
- User texts `lets start fast`.
- System starts or resumes chapter session and returns question 1.
2. Answering (SMS):
- User replies with `A/B/C/D`.
- System scores answer, sends explanation and progress, and dispatches next question.
3. Recovery:
- If no active session, reply with restart instruction.
- If cache is warming, return retry guidance without mutating attempt state.
4. Session completion:
- Return summary with chapter accuracy and weak-topic direction.

## 4) Functional requirements

1. SMS inbound webhook endpoint:
- `POST /v1/channel/sms/webhook`
2. SMS delivery status webhook endpoint:
- `POST /v1/channel/sms/status`
3. Deterministic SMS idempotency keys:
- start: `sms:{from_phone}:{message_sid}:start:{chapter_id}`
- q1: `sms:{from_phone}:{message_sid}:q1:{chapter_id}`
- answer: `sms:{from_phone}:{message_sid}:answer:{session_id}:{question_id}`
4. Shared intent parser across Telegram and SMS command text.
5. Signature validation for inbound SMS webhooks when auth token is configured.
6. Opt-out/utility command handling:
- `STOP`, `UNSTOP`, `HELP`
7. Store channel identity in canonical user mapping model for multi-channel continuity.

## 5) Non-functional requirements

1. Warm-path first question P95 <= 5.0 seconds after inbound SMS webhook.
2. Answer feedback + next question P95 <= 3.0 seconds.
3. Message processing success >= 99%.
4. Duplicate inbound provider delivery must not create duplicate attempts.
5. Degrade to text-only responses when image media send path fails.

## 6) Safety and privacy requirements

1. Never include credentials, internal tokens, or account IDs in outgoing messages.
2. Respect quiet hours and explicit opt-out state.
3. Persist only required contact metadata (`channel`, `external_id`, consent state).
4. Signature validation failure must return unauthorized without state mutation.

## 7) Metrics

1. SMS session start rate.
2. SMS completion rate by chapter.
3. Questions answered per day.
4. Drop-off by question index.
5. SMS delivery failure rate.
6. Duplicate-delivery dedupe rate.

## 8) Acceptance criteria

1. User can complete a 10-question FAST run entirely through iPhone Messages (SMS).
2. All answer writes remain idempotent under webhook retries.
3. Progress API reflects SMS attempts immediately and accurately.
4. Fallback channel (Telegram) remains operational with no regression.
