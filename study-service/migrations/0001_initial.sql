-- Study-service MVP schema

CREATE TABLE IF NOT EXISTS source (
  id TEXT PRIMARY KEY,
  chapter_id TEXT,
  object_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  status TEXT NOT NULL,
  source_label TEXT,
  parse_confidence REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingest_job (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  error_code TEXT,
  error_detail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES source(id)
);

CREATE TABLE IF NOT EXISTS chunk (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  topic_tag TEXT,
  token_count INTEGER NOT NULL DEFAULT 0,
  quality_score REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES source(id)
);

CREATE TABLE IF NOT EXISTS question (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL,
  source_chunk_ids_json TEXT NOT NULL,
  stem TEXT NOT NULL,
  choices_json TEXT NOT NULL,
  correct_choice TEXT NOT NULL,
  explanation TEXT NOT NULL,
  image_ref TEXT,
  quality_score REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quiz_session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_question_index INTEGER NOT NULL DEFAULT 0,
  last_question_id TEXT,
  telegram_user_id TEXT,
  telegram_chat_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS question_attempt (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  selected_choice TEXT NOT NULL,
  is_correct INTEGER NOT NULL,
  response_time_seconds REAL NOT NULL,
  confidence REAL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES quiz_session(id),
  FOREIGN KEY (question_id) REFERENCES question(id)
);

CREATE TABLE IF NOT EXISTS chapter_progress (
  user_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  answered INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  accuracy REAL NOT NULL DEFAULT 0,
  last_question_at TEXT,
  next_review_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, chapter_id)
);

CREATE TABLE IF NOT EXISTS idempotency_record (
  idempotency_key TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (idempotency_key, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_question_chapter_created ON question(chapter_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_session_user_status ON quiz_session(user_id, status, chapter_id);
CREATE INDEX IF NOT EXISTS idx_attempt_session ON question_attempt(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ingest_source_created ON ingest_job(source_id, created_at);
