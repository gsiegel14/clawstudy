-- Ordered delivery and wrong-question spaced review session state.

ALTER TABLE question ADD COLUMN source_order INTEGER;

-- Backfill deterministic 0-based source order per chapter when order is missing.
UPDATE question
SET source_order = (
  SELECT COUNT(*)
  FROM question q2
  WHERE q2.chapter_id = question.chapter_id
    AND (
      q2.created_at < question.created_at
      OR (q2.created_at = question.created_at AND q2.id <= question.id)
    )
) - 1
WHERE source_order IS NULL;

ALTER TABLE quiz_session ADD COLUMN delivery_phase TEXT NOT NULL DEFAULT 'source_order';
ALTER TABLE quiz_session ADD COLUMN review_queue_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE quiz_session ADD COLUMN review_round INTEGER NOT NULL DEFAULT 0;

UPDATE quiz_session
SET delivery_phase = 'source_order'
WHERE delivery_phase IS NULL OR length(trim(delivery_phase)) = 0;

UPDATE quiz_session
SET review_queue_json = '[]'
WHERE review_queue_json IS NULL OR length(trim(review_queue_json)) = 0;

UPDATE quiz_session
SET review_round = 0
WHERE review_round IS NULL OR review_round < 0;

CREATE INDEX IF NOT EXISTS idx_question_chapter_source_order
  ON question(chapter_id, source_order, created_at, id);
