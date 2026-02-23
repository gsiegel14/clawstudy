# PRD-06: Messaging and Study UX

Status: Draft
Owner: Gabe
Last updated: February 23, 2026

## 1) Problem statement

The study system must reach the user in low-friction channels while reliably capturing answers and progress.

## 2) Scope

In scope:

1. Telegram delivery for v1.
2. Optional SMS adapter for v2.
3. Session reminders, question threads, and quick commands.

Out of scope:

1. Rich mobile app UI.
2. Group chat collaboration.

## 3) User flows

1. Start session:
- User receives scheduled prompt.
- User taps "Start 10 questions".
2. Answering:
- Bot sends one question at a time.
- User replies with option and confidence.
3. Session end:
- Bot sends summary and weak-topic recommendations.

## 4) Functional requirements

1. Support commands: `/start`, `/plan`, `/pause`, `/resume`, `/stats`, `/help`.
2. Support daily schedule windows and snooze.
3. Persist message delivery state to avoid duplicates.
4. Record abandoned sessions and auto-resume option.

## 5) Non-functional requirements

1. Message dispatch success >= 99%.
2. Retry transient messaging failures.
3. P95 response processing under 2 seconds.

## 6) Safety and privacy requirements

1. Never include secrets or sensitive account data in messages.
2. Respect quiet hours and opt-out.
3. Keep only required user contact metadata.

## 7) Metrics

1. Session start rate.
2. Completion rate.
3. Questions answered per day.
4. Average response time.
5. Drop-off point by question index.

## 8) Acceptance criteria

1. Scheduled sessions run autonomously for 7 consecutive days.
2. User can pause and resume without losing progress.
3. End-of-session summary aligns with recorded attempts.
