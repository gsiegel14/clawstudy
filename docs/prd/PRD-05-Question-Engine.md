# PRD-05: Question Engine

Status: Draft
Owner: Gabe
Last updated: February 23, 2026

## 1) Problem statement

Raw source text must be transformed into high-yield board-style questions with explanations and adaptive scheduling.

## 2) Scope

In scope:

1. MCQ generation from chunks.
2. Difficulty calibration and topic balancing.
3. Explanation and citation links to source chunks.
4. Answer capture and scoring.

Out of scope:

1. Fully autonomous proctored exam simulation in v1.

## 3) Functional requirements

1. Generate MCQs with one best answer and plausible distractors.
2. Attach rationale for correct and incorrect options.
3. Track difficulty (`easy`, `medium`, `hard`) and quality score.
4. Enforce content diversity and avoid repeated stems.
5. Route low-quality generated items to review queue.

## 4) Adaptive logic requirements

1. Use spaced repetition intervals from attempt history.
2. Increase frequency for low-mastery topics.
3. Mix reinforcement and unseen questions in each session.
4. Apply PEER summary weighting to topic prioritization.

## 5) Non-functional requirements

1. Generation cost per question below configured threshold.
2. Dispatch pipeline supports pre-generated cache to reduce latency.
3. Deterministic scoring service for reproducibility.

## 6) Data contracts

Question fields:

1. `question_id`
2. `source_chunk_ids`
3. `topic`
4. `difficulty`
5. `stem`
6. `choices[]`
7. `correct_choice`
8. `explanation`
9. `quality_score`

Attempt fields:

1. `attempt_id`
2. `question_id`
3. `selected_choice`
4. `is_correct`
5. `confidence`
6. `response_time_seconds`

## 7) Quality thresholds

1. Structural validity pass rate >= 99%.
2. Human review sample error rate < 5%.
3. Explanation-source alignment pass on random audits.

## 8) Acceptance criteria

1. Daily target question volume generated and dispatched on schedule.
2. Adaptive selection demonstrably prioritizes weak topics.
3. Question quality dashboard available with failure buckets.
