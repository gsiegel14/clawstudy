# PRD-00: Vision and Outcomes

Status: Draft
Owner: Gabe
Last updated: February 23, 2026

## 1) Problem statement

Board prep content is fragmented across PDFs, websites, and ACEP PEER sessions. Manual tracking is inconsistent, making it difficult to identify weak topics and sustain daily practice before the March 31, 2026 exam.

## 2) Product vision

Deliver a personal study operating system that:

1. Ingests trusted study materials.
2. Generates exam-style questions.
3. Delivers questions daily through messaging.
4. Tracks mastery and adapts study focus.
5. Uses ACEP PEER performance summaries without sharing ACEP credentials.

## 3) Goals

1. Maintain daily active study cadence from launch through March 30, 2026.
2. Increase weak-topic accuracy by targeted adaptive review.
3. Provide transparent progress and study-time accounting.
4. Keep operating costs low and predictable.

## 4) Non-goals

1. Automating ACEP question completion.
2. Sharing or storing ACEP account credentials in cloud services.
3. Building a full general-purpose assistant platform.

## 5) Users and jobs to be done

Primary user: single learner preparing for US boards.

Jobs:

1. "Give me the highest-yield questions every day."
2. "Track what I miss and what I am improving."
3. "Use my PEER results to adjust my daily plan."
4. "Keep setup and monthly costs low."

## 6) Scope

In scope:

1. PDF and website ingestion.
2. Question generation and revision.
3. Messaging delivery and answer capture.
4. Study analytics dashboard/API.
5. Local ACEP PEER summary sync bridge.

Out of scope:

1. ACEP credential automation in cloud.
2. Multi-user tenancy.
3. Native mobile apps.

## 7) Success metrics

1. Daily completion rate >= 80% of assigned questions.
2. At least 2 focused study sessions per day on >= 5 days/week.
3. Weak-topic accuracy trend improving week over week.
4. Messaging delivery success >= 99%.
5. Monthly cloud + model spend within budget cap.

## 8) Milestones

1. M1 (March 1, 2026): PRD set approved.
2. M2 (March 9, 2026): Ingestion and question engine operational.
3. M3 (March 16, 2026): Messaging + tracking live daily.
4. M4 (March 24, 2026): Adaptive scheduling and PEER sync active.
5. M5 (March 30, 2026): Final hardening complete.

## 9) Risks and mitigations

1. Risk: Inconsistent daily usage.
Mitigation: fixed schedule, streaks, missed-session auto-reschedule.
2. Risk: Provider/API outage.
Mitigation: queue-based retries and fallback providers.
3. Risk: Scope creep before exam.
Mitigation: strict MVP scope and feature freeze date.

## 10) Acceptance criteria

1. End-to-end daily quiz flow runs without manual intervention except answering questions.
2. Dashboard surfaces weak topics and trend lines from attempts and PEER summary data.
3. Daily plan is generated automatically by 6:00 AM local time.
4. Budget guardrails produce alert before overspend.
