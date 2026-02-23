-- Progress memory extensions: per-question + per-PDF rollups and topic mastery signals.

ALTER TABLE question ADD COLUMN source_id TEXT;
ALTER TABLE question ADD COLUMN topic TEXT;
ALTER TABLE question ADD COLUMN difficulty TEXT;

ALTER TABLE quiz_session ADD COLUMN current_question_presented_at TEXT;

-- Backfill question lineage from first source chunk when available.
UPDATE question
SET source_id = (
  SELECT c.source_id
  FROM chunk c
  WHERE c.id = json_extract(question.source_chunk_ids_json, '$[0]')
)
WHERE source_id IS NULL;

UPDATE question
SET topic = (
  SELECT c.topic_tag
  FROM chunk c
  WHERE c.id = json_extract(question.source_chunk_ids_json, '$[0]')
)
WHERE topic IS NULL;

UPDATE question
SET topic = 'unknown'
WHERE topic IS NULL OR length(trim(topic)) = 0;

UPDATE question
SET difficulty = 'medium'
WHERE difficulty IS NULL OR length(trim(difficulty)) = 0;

CREATE TABLE IF NOT EXISTS question_progress (
  user_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  source_id TEXT,
  topic TEXT NOT NULL,
  answered INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  accuracy REAL NOT NULL DEFAULT 0,
  avg_response_time_seconds REAL,
  confidence_avg REAL,
  last_answered_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, question_id),
  FOREIGN KEY (question_id) REFERENCES question(id)
);

CREATE TABLE IF NOT EXISTS pdf_progress (
  user_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  chapter_id TEXT,
  answered INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  accuracy REAL NOT NULL DEFAULT 0,
  avg_response_time_seconds REAL,
  confidence_avg REAL,
  last_answered_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, source_id),
  FOREIGN KEY (source_id) REFERENCES source(id)
);

CREATE TABLE IF NOT EXISTS topic_mastery (
  user_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  answered INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  accuracy REAL NOT NULL DEFAULT 0,
  avg_response_time_seconds REAL,
  confidence_mismatch_score REAL NOT NULL DEFAULT 0,
  mastery_score REAL NOT NULL DEFAULT 0,
  weakness_rank INTEGER,
  last_answered_at TEXT,
  next_review_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, topic)
);

CREATE INDEX IF NOT EXISTS idx_question_source_topic ON question(source_id, topic, chapter_id);
CREATE INDEX IF NOT EXISTS idx_attempt_question_created ON question_attempt(question_id, created_at);
CREATE INDEX IF NOT EXISTS idx_question_progress_user_chapter ON question_progress(user_id, chapter_id);
CREATE INDEX IF NOT EXISTS idx_pdf_progress_user_chapter ON pdf_progress(user_id, chapter_id);
CREATE INDEX IF NOT EXISTS idx_topic_mastery_user_rank ON topic_mastery(user_id, weakness_rank);
