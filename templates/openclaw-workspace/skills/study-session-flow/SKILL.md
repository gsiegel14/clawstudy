# study-session-flow

Governs chapter start, resume, and question delivery flows.

## Session states

| Status | Meaning |
|--------|---------|
| `active` | Session open, questions being delivered |
| `paused` | Session open but no recent activity |
| `completed` | All source-order questions done and review queue exhausted |

## Delivery phases

| Phase | Behavior |
|-------|---------|
| `source_order` | Deliver questions in `source_order ASC` index order, one at a time |
| `review` | Deliver questions from the spaced-repetition review queue |

Review queue entries have `incorrectCount` and `nextDueRound`. A question re-enters review if answered incorrectly; it exits when answered correctly after its due round.

## Start flow

1. Call `GET /v1/sessions/active?userId=<userId>` — if an active session exists for the same chapter, redirect to resume.
2. Call `POST /v1/sessions` with `{ chapterId, userId, telegramUserId, telegramChatId }`.
3. Deliver question at index 0 via `GET /v1/chapters/{chapterId}/questions/{index}`.
4. Update `memory/progress.json`: set `active_chapter`, append daily-log line.

## Resume flow

1. Call `GET /v1/sessions/active?userId=<userId>` — get `currentQuestionIndex` and `deliveryPhase`.
2. Deliver the question at the current index. Do not re-deliver the previous question.
3. If `deliveryPhase=review`, pick the next due review queue item with `nextDueRound <= reviewRound`.

## Idempotency key derivation

- For question delivery: `tg:<chatId>:<messageId>` (Telegram) or `sms:<fromPhone>:<messageSid>` (SMS).
- Pass as `Idempotency-Key` header on any attempt submission.
- If the API returns 409, the attempt was already recorded — surface the cached response and continue.

## Source order delivery rule

Never skip questions. If question at index N is unavailable (e.g., image not yet ready), surface the question without the image — do not advance to N+1 silently.

## Chapter completion

A chapter is complete when:
- `currentQuestionIndex >= totalQuestions` AND
- review queue is empty (or all items have been answered correctly)

On completion: update session status to `completed`, update `memory/progress.json` counters, append daily-log line.
