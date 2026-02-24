-- Ingest consumer production contracts: dedup metadata + cache state fields.

ALTER TABLE source ADD COLUMN question_cache_state TEXT NOT NULL DEFAULT 'question_cache_empty';
ALTER TABLE source ADD COLUMN ingested_at TEXT;

ALTER TABLE question ADD COLUMN stem_hash TEXT;
ALTER TABLE question ADD COLUMN generation_mode TEXT NOT NULL DEFAULT 'authored';
ALTER TABLE question ADD COLUMN source_page INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_question_chapter_stem_hash
  ON question(chapter_id, stem_hash)
  WHERE stem_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_question_source_source_order
  ON question(source_id, source_order, id);

UPDATE source
SET question_cache_state = CASE
  WHEN (
    SELECT COUNT(*)
    FROM question q
    WHERE q.source_id = source.id
  ) >= 20 THEN 'question_cache_ready'
  WHEN (
    SELECT COUNT(*)
    FROM question q
    WHERE q.source_id = source.id
  ) > 0 THEN 'question_cache_degraded'
  ELSE 'question_cache_empty'
END
WHERE question_cache_state IS NULL OR length(trim(question_cache_state)) = 0;
