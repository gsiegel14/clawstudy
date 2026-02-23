# PRD-08: Analytics and Study Planning

Status: Draft
Owner: Gabe
Last updated: February 23, 2026

## 1) Problem statement

Without transparent analytics and actionable daily planning, study improvements are inconsistent and difficult to sustain.

## 2) Scope

In scope:

1. Topic mastery scoring.
2. Daily and weekly progress summaries.
3. Adaptive study-plan generation.
4. Streaks and adherence tracking.

Out of scope:

1. Complex cohort benchmarking.
2. Advanced BI tooling.

## 3) Functional requirements

1. Dashboard shows:
- daily completion
- accuracy by topic
- trend over time
- weak-topic queue
2. System generates next-day plan automatically.
3. Plan balances weak-topic reinforcement and coverage breadth.
4. Weekly review highlights top missed concepts.

## 4) Planning algorithm requirements

1. Inputs:
- attempt correctness
- response latency
- confidence mismatch
- PEER summary adjustments
2. Outputs:
- question count by topic
- recommended focus blocks
- suggested review sources

## 5) Non-functional requirements

1. Plan generation runs before 6:00 AM local time.
2. Analytics endpoints return within performance target.
3. Reports remain interpretable and auditable.

## 6) Success metrics

1. Week-over-week reduction in repeated misses.
2. Increased mastery on bottom quartile topics.
3. Consistent daily completion rate above target.

## 7) Acceptance criteria

1. Dashboard data matches source attempt records.
2. Daily plan generated automatically for 14 consecutive days.
3. Weekly summary correctly identifies highest-risk topics.
